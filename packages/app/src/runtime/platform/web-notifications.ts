import type { Platform } from "./platform"

const CLICK_MESSAGE = "opencode.notification.click"
const OWNER_MESSAGE = "opencode.notification.owner"
const PING_MESSAGE = "opencode.notification.ping"
const PING_TIMEOUT_MS = 1000
const ICON = "https://opencode.ai/favicon-96x96-v3.png"

// Notifications shown through the service worker registration can be listed and
// closed after macOS collapses them into Notification Center; page-owned
// `new Notification(...)` objects cannot, so they are only a fallback for
// development builds without a service worker.
export function createWebNotifications(): Pick<Platform, "notify" | "closeNotifications"> {
  const clicks = new Map<string, () => void>()
  const fallback = new Map<string, Notification>()

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const message = event.data
      if (typeof message !== "object" || message === null) return
      if (!("id" in message) || typeof message.id !== "string") return
      if (!("type" in message)) return
      if (message.type === OWNER_MESSAGE) {
        event.ports[0]?.postMessage(clicks.has(message.id))
        return
      }
      if (message.type !== CLICK_MESSAGE) return
      const onClick = clicks.get(message.id)
      if (!onClick) return
      clicks.delete(message.id)
      window.focus()
      onClick()
    })
    navigator.serviceWorker.startMessages()
  }

  return {
    async notify(title, description, onClick, tag) {
      if (!("Notification" in window)) return

      const permission =
        Notification.permission === "default"
          ? await Notification.requestPermission().catch(() => "denied")
          : Notification.permission
      if (permission !== "granted") return
      if (document.visibilityState === "visible" && document.hasFocus()) return

      const registration = await clickableRegistration()
      if (registration) {
        // Unique per notification: another tab may later replace this tag and must own the click.
        const id = crypto.randomUUID()
        if (tag) {
          const replaced = await registration.getNotifications({ tag }).catch(() => [])
          replaced.forEach((notification) => clicks.delete(notification.data?.opencodeNotificationID))
        }
        if (onClick) clicks.set(id, onClick)
        const options = {
          body: description ?? "",
          icon: ICON,
          tag,
          // Re-alert when replacing an earlier notification with the same tag.
          renotify: tag !== undefined,
          data: { opencodeNotificationID: id },
        }
        await registration.showNotification(title, options).catch(() => clicks.delete(id))
        return
      }

      if (tag) fallback.get(tag)?.close()
      const notification = new Notification(title, { body: description ?? "", icon: ICON, tag })
      if (tag) fallback.set(tag, notification)
      notification.onclick = () => {
        window.focus()
        onClick?.()
        notification.close()
      }
      notification.onclose = () => {
        if (tag && fallback.get(tag) === notification) fallback.delete(tag)
      }
    },
    async closeNotifications(match) {
      fallback.forEach((notification, tag) => {
        if (match(tag)) notification.close()
      })
      const registration = await activeRegistration()
      if (!registration) return
      const notifications = await registration.getNotifications().catch(() => [])
      notifications
        .filter((notification) => match(notification.tag))
        .forEach((notification) => {
          const id: unknown = notification.data?.opencodeNotificationID
          if (typeof id === "string") clicks.delete(id)
          notification.close()
        })
    },
  }
}

async function activeRegistration() {
  if (!("serviceWorker" in navigator)) return undefined
  const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined)
  if (!registration?.active) return undefined
  return registration
}

// A worker from an older build keeps control until every tab closes and has no
// click handler, so only route notifications through workers that answer a ping.
const handlesClicks = new WeakMap<ServiceWorker, Promise<boolean>>()

async function clickableRegistration() {
  const registration = await activeRegistration()
  const worker = registration?.active
  if (!registration || !worker) return undefined
  const cached = handlesClicks.get(worker) ?? pingWorker(worker)
  handlesClicks.set(worker, cached)
  return (await cached) ? registration : undefined
}

function pingWorker(worker: ServiceWorker) {
  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(false), PING_TIMEOUT_MS)
    channel.port1.onmessage = () => {
      clearTimeout(timer)
      resolve(true)
    }
    worker.postMessage({ type: PING_MESSAGE }, [channel.port2])
  })
}
