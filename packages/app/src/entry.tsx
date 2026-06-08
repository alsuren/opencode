// @refresh reload

import * as Sentry from "@sentry/solid"
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { loadInitialLocale } from "@/context/language"
import { type Platform, PlatformProvider } from "@/context/platform"
import { createBrowserDraftStore } from "@/utils/draft-store"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"
import { handleNotificationClick, planSwClickAction } from "@/utils/notification-click"
import {
  dismissForSession as swDismissForSession,
  ensurePermission,
  type Logger as NotifyLogger,
  register as swRegister,
  sessionIDFromPathname,
  shouldShowNotification,
  show as swShow,
} from "@/utils/notify"
import { authFromToken } from "@/utils/server"
import pkg from "../package.json"
import { ServerConnection } from "./context/server"

const DEFAULT_SERVER_URL_KEY = "opencode.settings.dat:defaultServerUrl"

const getLocale = () => {
  if (typeof navigator !== "object") return "en" as const
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    if (language.toLowerCase().startsWith("zh")) return "zh" as const
  }
  return "en" as const
}

const getRootNotFoundError = () => {
  const key = "error.dev.rootNotFound" as const
  const locale = getLocale()
  return locale === "zh" ? (zh[key] ?? en[key]) : en[key]
}

const getStorage = (key: string) => {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const setStorage = (key: string, value: string | null) => {
  if (typeof localStorage === "undefined") return
  try {
    if (value !== null) {
      localStorage.setItem(key, value)
      return
    }
    localStorage.removeItem(key)
  } catch {
    return
  }
}

const readDefaultServerUrl = () => getStorage(DEFAULT_SERVER_URL_KEY)
const writeDefaultServerUrl = (url: string | null) => setStorage(DEFAULT_SERVER_URL_KEY, url)

// Forward web-notification lifecycle events to the opencode server log so an
// agent can debug "why didn't this notification show up / clear?" without
// opening DevTools.  See packages/app/src/utils/notify.ts for the rest of
// the lifecycle.  Falls back to console only if /log is unreachable.
const swLogger: NotifyLogger = (level, message, extra) => {
  // eslint-disable-next-line no-console
  console[level === "warn" ? "warn" : "log"]("[notify-sw]", message, extra ?? {})
  try {
    void fetch("/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // level=info because the server's default log level filters out debug.
      body: JSON.stringify({
        service: "app-notification-sw-client",
        level: level === "warn" ? "warn" : "info",
        message,
        extra: extra ?? {},
      }),
      keepalive: true,
    }).catch(() => {})
  } catch {}
}

// Listen for messages from the SW (e.g. "you should client-side route to X").
if (typeof navigator !== "undefined" && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    const action = planSwClickAction(event.data)
    swLogger("info", "client received message from sw", {
      kind: action.kind,
      ...(action.kind === "ignore" ? { reason: action.reason } : { href: action.href }),
    })
    if (action.kind === "focus-only") {
      // Already on the right page — just focus the window.  Calling
      // navigate(href, href) can re-fire SPA effects in some routers and
      // SW client.navigate() would do a full document reload.
      try {
        window.focus()
      } catch {}
      return
    }
    if (action.kind === "navigate") handleNotificationClick(action.href)
  })
}

// Register the SW eagerly so the first session.idle event after page load
// can use it.  We hold the registration as a module-level singleton because
// every platform.notify call needs it.
let swRegistration: ServiceWorkerRegistration | null = null
const swReady: Promise<ServiceWorkerRegistration | null> =
  typeof window === "undefined"
    ? Promise.resolve(null)
    : swRegister("/sw.js", "/", swLogger).then((reg) => {
        swRegistration = reg
        return reg
      })

const notify: Platform["notify"] = async (title, description, href, meta) => {
  const visible = document.visibilityState === "visible" && document.hasFocus()
  const currentSessionID = sessionIDFromPathname(location.pathname)
  const decision = shouldShowNotification({
    visible,
    notifySessionID: meta?.sessionID,
    currentSessionID,
  })
  if (!decision.show) {
    swLogger("info", "notify skipped — tab in view", {
      title,
      kind: meta?.kind ?? null,
      sessionID: meta?.sessionID ?? null,
      currentSessionID: currentSessionID ?? null,
      reason: decision.reason,
    })
    return
  }
  if (visible) {
    // Tab is in view but the notification is for a different session;
    // fire it so the user knows a background session needs attention.
    swLogger("info", "notify firing despite tab in view — different session", {
      title,
      kind: meta?.kind ?? null,
      sessionID: meta?.sessionID ?? null,
      currentSessionID: currentSessionID ?? null,
    })
  }

  const permission = await ensurePermission(swLogger)
  if (permission !== "granted") {
    swLogger("warn", "notify skipped — permission not granted", { permission, title })
    return
  }

  const reg = swRegistration ?? (await swReady)
  if (!reg) {
    swLogger("warn", "notify skipped — no service worker registration", { title })
    return
  }

  // `meta` is optional for backwards compatibility with desktop callers that
  // predate the SW migration.  When absent we fall back to a kind that won't
  // collide with any real session-tagged notification.
  const kind = meta?.kind ?? "session-idle"
  await swShow(
    reg,
    {
      kind,
      sessionID: meta?.sessionID,
      title,
      body: description,
      href,
    },
    swLogger,
  )
}

const dismissNotificationsForSession: NonNullable<Platform["dismissNotificationsForSession"]> = async (sessionID) => {
  const reg = swRegistration ?? (await swReady)
  if (!reg) {
    swLogger("warn", "dismissNotificationsForSession skipped — no service worker registration", { sessionID })
    return 0
  }
  return swDismissForSession(reg, sessionID, swLogger)
}

const openExternal: Platform["openExternal"] = (value) => {
  if (!URL.canParse(value)) return
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") return
  window.open(url.href, "_blank", "noopener,noreferrer")
}

const restart: Platform["restart"] = async () => {
  window.location.reload()
}

const root = document.getElementById("root")
if (!(root instanceof HTMLElement) && import.meta.env.DEV) {
  throw new Error(getRootNotFoundError())
}

const getCurrentUrl = () => {
  if (location.hostname.includes("opencode.ai")) return "http://localhost:4096"
  if (import.meta.env.DEV)
    return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
  return location.origin
}

const getDefaultUrl = () => {
  const lsDefault = readDefaultServerUrl()
  if (lsDefault) return lsDefault
  return getCurrentUrl()
}

const clearAuthToken = () => {
  const params = new URLSearchParams(location.search)
  if (!params.has("auth_token")) return
  params.delete("auth_token")
  history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash)
}

const platform: Platform = {
  platform: "web",
  draftStore: createBrowserDraftStore(),
  version: pkg.version,
  openExternal,
  restart,
  notify,
  dismissNotificationsForSession,
  getDefaultServer: async () => {
    const stored = readDefaultServerUrl()
    return stored ? ServerConnection.Key.make(stored) : null
  },
  setDefaultServer: writeDefaultServerUrl,
}

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? `web@${pkg.version}`,
    initialScope: {
      tags: {
        platform: "web",
      },
    },
    integrations: (integrations) => {
      return integrations.filter(
        (i) =>
          i.name !== "Breadcrumbs" && !(import.meta.env.OPENCODE_CHANNEL === "prod" && i.name === "GlobalHandlers"),
      )
    },
  })
}

if (root instanceof HTMLElement) {
  void loadInitialLocale().then((locale) => {
    const auth = authFromToken(new URLSearchParams(location.search).get("auth_token"))
    clearAuthToken()
    const server: ServerConnection.Http = {
      type: "http",
      authToken: !!auth,
      http: {
        url: getCurrentUrl(),
        ...auth,
      },
    }
    render(
      () => (
        <PlatformProvider value={platform}>
          <AppBaseProviders locale={locale}>
            <AppInterface
              defaultServer={ServerConnection.Key.make(getDefaultUrl())}
              canonicalLocalServer={ServerConnection.key(server)}
              servers={[server]}
              disableHealthCheck
            />
          </AppBaseProviders>
        </PlatformProvider>
      ),
      root,
    )
  })
}
