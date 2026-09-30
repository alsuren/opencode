// Imported by the generated Workbox service worker. Notifications shown through
// the registration are owned by the worker, so clicks are delivered here and
// forwarded to the pages, which keep the click callbacks.
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const id = event.notification.data?.opencodeNotificationID
  if (typeof id !== "string") return
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      clients.forEach((client) => client.postMessage({ type: "opencode.notification.click", id }))
      const client = clients[0]
      if (client) await client.focus().catch(() => undefined)
      if (!client) await self.clients.openWindow("/")
    }),
  )
})
