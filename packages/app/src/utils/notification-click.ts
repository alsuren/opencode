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

// Action returned from the SW notification-click message router.  Caller is
// responsible for actually executing it (focus / navigate).  Exposed as a
// pure function purely for testability — the production caller wires it up
// to `window.focus()` and `handleNotificationClick` respectively.
export type SwClickMessage = { type: "notification-click"; href: string; tag?: string | null; sameUrl?: boolean }
export type SwClickAction =
  | { kind: "ignore"; reason: string }
  | { kind: "focus-only"; href: string }
  | { kind: "navigate"; href: string }

export const planSwClickAction = (msg: unknown): SwClickAction => {
  if (!msg || typeof msg !== "object") return { kind: "ignore", reason: "non-object message" }
  const m = msg as Partial<SwClickMessage>
  if (m.type !== "notification-click") return { kind: "ignore", reason: "wrong message type" }
  if (typeof m.href !== "string") return { kind: "ignore", reason: "href not a string" }
  if (m.sameUrl === true) return { kind: "focus-only", href: m.href }
  return { kind: "navigate", href: m.href }
}
