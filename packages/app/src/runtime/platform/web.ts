import { createBrowserDraftStore } from "@/runtime/persistence/drafts"
import { ServerConnection } from "@/runtime/server/registry"
import type { Platform } from "./platform"
import { createWebNotifications } from "./web-notifications"

const DEFAULT_SERVER_URL_KEY = "opencode.settings.dat:defaultServerUrl"

export function createWebPlatform(version: string) {
  const currentServerUrl = getCurrentServerUrl()
  const storedServerUrl = readDefaultServerUrl()
  const platform: Platform = {
    platform: "web",
    draftStore: createBrowserDraftStore(),
    version,
    openExternal(value) {
      if (!URL.canParse(value)) return
      const url = new URL(value)
      if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") return
      window.open(url.href, "_blank", "noopener,noreferrer")
    },
    restart: async () => window.location.reload(),
    ...createWebNotifications(),
    getDefaultServer: async () => {
      const stored = readDefaultServerUrl()
      return stored ? ServerConnection.Key.make(stored) : null
    },
    setDefaultServer: writeDefaultServerUrl,
  }

  return {
    platform,
    currentServerUrl,
    defaultServerUrl: storedServerUrl ?? currentServerUrl,
  }
}

function getCurrentServerUrl() {
  if (import.meta.env.VITE_OPENCODE_SERVER_MODE === "none") return undefined
  if (import.meta.env.DEV) {
    const loopback =
      location.hostname === "localhost" || location.hostname === "[::1]" || location.hostname.startsWith("127.")
    const host = import.meta.env.VITE_OPENCODE_SERVER_HOST ?? (loopback ? location.hostname : "localhost")
    return `http://${host}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
  }
  return location.origin
}

function readDefaultServerUrl() {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(DEFAULT_SERVER_URL_KEY)
  } catch {
    return null
  }
}

function writeDefaultServerUrl(value: string | null) {
  if (typeof localStorage === "undefined") return
  try {
    if (value !== null) {
      localStorage.setItem(DEFAULT_SERVER_URL_KEY, value)
      return
    }
    localStorage.removeItem(DEFAULT_SERVER_URL_KEY)
  } catch {
    return
  }
}
