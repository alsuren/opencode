// opencode service worker — owns OS notifications so they can be programmatically
// dismissed (via getNotifications + close) when the user navigates to the
// related session.
//
// Notifications API ref: https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API
// Non-persistent notifications cannot be enumerated; only service-worker
// notifications can. That is the entire reason this SW exists.

const SCOPE = self.registration?.scope ?? self.location.origin + "/"

const log = (level, message, extra) => {
  // Best-effort: never block on the network and never throw out of the
  // worker.  Failure to log must not affect notification delivery.
  try {
    // eslint-disable-next-line no-console
    console[level === "warn" ? "warn" : "log"]("[sw]", message, extra ?? {})
  } catch {}
  try {
    void fetch("/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: "app-notification-sw",
        level,
        message,
        extra: extra ?? {},
      }),
      // keepalive lets the request complete even if the SW is shutting down.
      keepalive: true,
    }).catch(() => {})
  } catch {}
}

// install/activate cleanly so the SW takes control of the page on first load.
self.addEventListener("install", (event) => {
  log("info", "install", { scope: SCOPE })
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  log("info", "activate", { scope: SCOPE })
  event.waitUntil(self.clients.claim())
})

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification
  const data = notification.data ?? {}
  const href = typeof data.href === "string" ? data.href : undefined
  log("info", "notificationclick", {
    tag: notification.tag || null,
    title: notification.title,
    href: href ?? null,
  })
  notification.close()

  if (!href) return

  // We always prefer postMessage on an existing client — the page-side
  // handler routes via the SPA router (no reload).  client.navigate() is a
  // last-resort fallback because, even when the target URL matches the
  // current one, it triggers a full document reload that wipes session
  // state.  See https://developer.mozilla.org/en-US/docs/Web/API/WindowClient/navigate
  event.waitUntil(
    (async () => {
      const url = new URL(href, SCOPE).toString()
      try {
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
        if (clients.length > 0) {
          // Pick the most-recently-focused window (matchAll returns them in
          // most-recent-first order) and route the click there.
          const target = clients[0]
          const sameUrl = target.url === url
          log("info", "notificationclick routing to existing client", {
            clients: clients.length,
            targetUrl: target.url,
            href,
            sameUrl,
          })
          if ("focus" in target) {
            try {
              await target.focus()
            } catch {}
          }
          try {
            target.postMessage({ type: "notification-click", href, tag: notification.tag || null, sameUrl })
            return
          } catch (err) {
            log("warn", "notificationclick postMessage failed", { error: String(err) })
          }
          // postMessage shouldn't fail, but if it did fall back to navigate
          // for cross-URL cases only.  Same-URL fallthrough would just
          // reload the page for no benefit.
          if (!sameUrl && "navigate" in target && typeof target.navigate === "function") {
            try {
              await target.navigate(url)
              log("info", "notificationclick fell back to client.navigate")
              return
            } catch {}
          }
          return
        }
        // No existing window — open one.
        if (self.clients.openWindow) {
          log("info", "notificationclick opening new window", { href })
          await self.clients.openWindow(url)
        }
      } catch (err) {
        log("warn", "notificationclick error", { error: String(err) })
      }
    })(),
  )
})

self.addEventListener("notificationclose", (event) => {
  log("info", "notificationclose", {
    tag: event.notification.tag || null,
    title: event.notification.title,
  })
})

// Allow the page to ping the SW (useful for verifying registration).
self.addEventListener("message", (event) => {
  const msg = event.data
  if (msg && msg.type === "ping") {
    event.source?.postMessage?.({ type: "pong", at: Date.now() })
  }
})
