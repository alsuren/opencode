let nav: ((href: string) => void) | undefined
let serverLogger: ((message: string, extra: Record<string, unknown>) => void) | undefined
let lastClickAt = 0
const RECENT_CLICK_WINDOW_MS = 2000

export const setNavigate = (fn: (href: string) => void) => {
  nav = fn
}

export const setServerLogger = (fn: ((message: string, extra: Record<string, unknown>) => void) | undefined) => {
  serverLogger = fn
}

export const handleNotificationClick = (href?: string) => {
  console.debug("[notification] os notification clicked", { href })
  serverLogger?.("os notification clicked", { href: href ?? null })
  lastClickAt = Date.now()
  window.focus()
  if (!href) return
  if (nav) return nav(href)
  console.warn("notification-click: navigate function not set, falling back to window.location.assign")
  window.location.assign(href)
}

export const wasRecentlyTriggeredByNotificationClick = () =>
  Date.now() - lastClickAt < RECENT_CLICK_WINDOW_MS
