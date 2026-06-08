// Notification orchestrator backed by the service worker registered at
// /sw.js.  Lives here (not in entry.tsx) so the implementation is
// independently unit-testable with a fake ServiceWorkerRegistration.
//
// The whole reason we use a service worker rather than `new Notification(...)`
// is so we can call `registration.getNotifications({ tag })` and dismiss
// stale notifications when the user navigates to the relevant session.
// Non-persistent (page-owned) notifications cannot be enumerated.

export type Logger = (level: "info" | "warn", message: string, extra?: Record<string, unknown>) => void

export type NotifyKind = "session-idle" | "session-error" | "permission" | "question"

export type NotifyOptions = {
  kind: NotifyKind
  sessionID?: string
  title: string
  body?: string
  href?: string
  icon?: string
}

// Minimal ServiceWorkerRegistration surface we actually use, so tests can
// substitute a plain object rather than spinning up a real worker.
export type RegistrationLike = {
  showNotification(title: string, options?: NotificationOptions): Promise<void>
  getNotifications(filter?: { tag?: string }): Promise<ReadonlyArray<NotificationLike>>
}

export type NotificationLike = {
  tag: string
  title: string
  data?: unknown
  close(): void
}

export const tagFor = (kind: NotifyKind, sessionID: string | undefined) =>
  sessionID ? `${kind}:${sessionID}` : kind

/**
 * Extract the sessionID from a route pathname.  Returns `undefined` when
 * the path is not a session route.  Stable URL shape:
 *   `/<base64-dir>/session/<sessionID>[/...]`.
 */
export const sessionIDFromPathname = (pathname: string): string | undefined => {
  const segments = pathname.split("/")
  const i = segments.indexOf("session")
  if (i === -1) return undefined
  const sid = segments[i + 1]
  return sid && sid.length > 0 ? sid : undefined
}

export type ShouldShowInput = {
  visible: boolean
  notifySessionID: string | undefined
  currentSessionID: string | undefined
}

export type ShouldShowDecision =
  | { show: false; reason: "on-same-session" | "no-session-id-fallback" }
  | { show: true; reason: "tab-not-visible" | "different-session" }

/**
 * Decide whether to actually fire an OS notification given current
 * focus/visibility state, the notification's sessionID, and the
 * current route's sessionID.
 *
 * Rules:
 *   - If the tab is not visible/focused, always show.
 *   - If the tab is visible AND the notification refers to the session
 *     the user is currently looking at, suppress (user has already seen
 *     the event).
 *   - If the tab is visible but we don't know the notification's
 *     sessionID, suppress conservatively — without that info we can't
 *     tell whether the user has seen the event, and previous behaviour
 *     was to suppress in this case.
 *   - Otherwise (visible, different session) → show.  This is the fix
 *     for "background tab needs permission while another opencode tab
 *     is focused" — the notification is the only signal the user has.
 */
export const shouldShowNotification = (input: ShouldShowInput): ShouldShowDecision => {
  if (!input.visible) return { show: true, reason: "tab-not-visible" }
  if (!input.notifySessionID) return { show: false, reason: "no-session-id-fallback" }
  if (input.notifySessionID === input.currentSessionID) return { show: false, reason: "on-same-session" }
  return { show: true, reason: "different-session" }
}

// The ServiceWorker NotificationOptions surface (which includes `renotify`,
// `actions`, etc.) is not modelled in lib.dom.d.ts as part of the plain
// NotificationOptions; rather than juggling type augmentations we widen the
// builder return type to the runtime-accepted superset.
type SwNotificationOptions = NotificationOptions & {
  renotify?: boolean
  actions?: ReadonlyArray<{ action: string; title: string; icon?: string }>
}

/** Build the NotificationOptions we hand to showNotification(). Pure for tests. */
export const buildOptions = (opts: NotifyOptions): SwNotificationOptions => ({
  body: opts.body ?? "",
  icon: opts.icon ?? "https://opencode.ai/favicon-96x96-v3.png",
  tag: tagFor(opts.kind, opts.sessionID),
  // `renotify: true` makes macOS re-banner when an existing tag is replaced.
  // We want the OS to nudge the user when, say, a permission ask comes in
  // on a session that already has a stale permission notification queued.
  renotify: true,
  data: { href: opts.href, kind: opts.kind, sessionID: opts.sessionID },
})

export const show = async (registration: RegistrationLike, opts: NotifyOptions, log: Logger): Promise<boolean> => {
  log("info", "show", {
    kind: opts.kind,
    sessionID: opts.sessionID ?? null,
    tag: tagFor(opts.kind, opts.sessionID),
    title: opts.title,
    hasHref: !!opts.href,
  })
  try {
    await registration.showNotification(opts.title, buildOptions(opts))
    return true
  } catch (err) {
    log("warn", "show failed", {
      kind: opts.kind,
      sessionID: opts.sessionID ?? null,
      error: String(err),
    })
    return false
  }
}

/**
 * Close every live SW notification associated with the given session.
 * Matches by tag suffix so all four kinds (`session-idle:<id>`,
 * `session-error:<id>`, `permission:<id>`, `question:<id>`) are dismissed.
 *
 * Note: macOS will only remove a notification from Notification Center when
 * close() is called.  Notifications that were dismissed by the user
 * (clicked or swiped) are already gone and won't appear here.
 */
export const dismissForSession = async (
  registration: RegistrationLike,
  sessionID: string,
  log: Logger,
): Promise<number> => {
  const all = await registration.getNotifications().catch((err) => {
    log("warn", "dismissForSession getNotifications failed", { sessionID, error: String(err) })
    return [] as ReadonlyArray<NotificationLike>
  })
  const suffix = `:${sessionID}`
  const matches = all.filter((n) => n.tag.endsWith(suffix))
  log("info", "dismissForSession", {
    sessionID,
    total: all.length,
    matched: matches.length,
    tags: matches.map((n) => n.tag),
    allTags: all.map((n) => n.tag),
  })
  for (const n of matches) {
    try {
      n.close()
    } catch (err) {
      log("warn", "notification.close threw", { tag: n.tag, error: String(err) })
    }
  }
  return matches.length
}

/**
 * Register the SW.  Returns the registration on success or null on any
 * failure (unsupported browser, fetch error, etc.).  Caller is responsible
 * for treating null as "notifications disabled" — we do NOT fall back to
 * `new Notification(...)`.
 */
export const register = async (
  swUrl: string,
  scope: string | undefined,
  log: Logger,
): Promise<ServiceWorkerRegistration | null> => {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) {
    log("warn", "serviceWorker unavailable in navigator", {})
    return null
  }
  try {
    const reg = await navigator.serviceWorker.register(swUrl, scope ? { scope } : undefined)
    log("info", "register ok", {
      swUrl,
      scope: reg.scope,
      hasActive: !!reg.active,
      hasInstalling: !!reg.installing,
      hasWaiting: !!reg.waiting,
    })
    // Wait for the SW to become active so the first notify() succeeds.
    if (!reg.active) {
      await navigator.serviceWorker.ready
        .then((ready) => {
          log("info", "register ready", { scope: ready.scope })
        })
        .catch((err) => {
          log("warn", "register ready failed", { error: String(err) })
        })
    }
    return reg
  } catch (err) {
    log("warn", "register failed", { swUrl, error: String(err) })
    return null
  }
}

/**
 * Ensure the user has granted notification permission.  Returns the
 * resulting permission state.  Logs every transition.
 */
export const ensurePermission = async (log: Logger): Promise<NotificationPermission> => {
  if (typeof Notification === "undefined") {
    log("warn", "Notification undefined", {})
    return "denied"
  }
  const before = Notification.permission
  if (before !== "default") {
    log("info", "permission already decided", { permission: before })
    return before
  }
  try {
    const after = await Notification.requestPermission()
    log("info", "permission requested", { before, after })
    return after
  } catch (err) {
    log("warn", "requestPermission threw", { error: String(err) })
    return "denied"
  }
}
