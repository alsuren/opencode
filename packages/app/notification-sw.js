// Imported by the generated Workbox service worker. Notifications shown through
// the registration are owned by the worker, so clicks are delivered here. The
// click callback lives in the page that showed the notification, so ask each
// window whether it owns the notification and focus that one.
const OWNER_TIMEOUT_MS = 300

// Lets pages confirm the active worker includes this click handler.
self.addEventListener("message", (event) => {
  if (event.data?.type === "opencode.notification.ping") event.ports[0]?.postMessage(true)
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const id = event.notification.data?.opencodeNotificationID
  if (typeof id !== "string") return
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const owner = await findOwner(clients, id)
      const client = owner ?? clients[0]
      if (!client) {
        await self.clients.openWindow("/")
        return
      }
      await client.focus().catch(() => undefined)
      client.postMessage({ type: "opencode.notification.click", id })
    }),
  )
})

function findOwner(clients, id) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), OWNER_TIMEOUT_MS)
    let remaining = clients.length
    if (remaining === 0) {
      clearTimeout(timer)
      resolve(undefined)
      return
    }
    clients.forEach((client) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = (message) => {
        remaining -= 1
        if (message.data === true) {
          clearTimeout(timer)
          resolve(client)
          return
        }
        if (remaining > 0) return
        clearTimeout(timer)
        resolve(undefined)
      }
      client.postMessage({ type: "opencode.notification.owner", id }, [channel.port2])
    })
  })
}
