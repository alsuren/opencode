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

  // Focus an existing window on the same origin if we have one, otherwise
  // open a new one.  We always navigate it to the href.
  event.waitUntil(
    (async () => {
      const url = new URL(href, SCOPE).toString()
      try {
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
        for (const client of clients) {
          if (!("focus" in client)) continue
          try {
            await client.focus()
          } catch {}
          if ("navigate" in client && typeof client.navigate === "function") {
            try {
              await client.navigate(url)
              return
            } catch {
              // navigate() can throw if the client isn't same-origin or has been
              // controlled-navigated-away; fall through to openWindow.
            }
          }
          // If we can't navigate the existing client, post a message so the
          // page can do client-side routing if it wants to.
          try {
            client.postMessage({ type: "notification-click", href, tag: notification.tag || null })
            return
          } catch {}
        }
        if (self.clients.openWindow) {
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
