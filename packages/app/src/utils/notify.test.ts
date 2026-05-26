import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  buildOptions,
  dismissForSession,
  ensurePermission,
  register,
  show,
  tagFor,
  type Logger,
  type NotificationLike,
  type RegistrationLike,
} from "./notify"

type LogEntry = { level: "info" | "warn"; message: string; extra?: Record<string, unknown> }

const captureLogger = (): { log: Logger; entries: LogEntry[] } => {
  const entries: LogEntry[] = []
  const log: Logger = (level, message, extra) => entries.push({ level, message, extra })
  return { log, entries }
}

const fakeNotification = (tag: string, title = "t"): NotificationLike & { closed: number } => {
  const n = {
    tag,
    title,
    data: undefined as unknown,
    closed: 0,
    close() {
      n.closed += 1
    },
  }
  return n
}

describe("tagFor", () => {
  test("includes session ID when present", () => {
    expect(tagFor("permission", "ses_abc")).toBe("permission:ses_abc")
    expect(tagFor("session-idle", "ses_xyz")).toBe("session-idle:ses_xyz")
  })

  test("falls back to kind when sessionID missing", () => {
    expect(tagFor("session-error", undefined)).toBe("session-error")
  })
})

describe("buildOptions", () => {
  test("populates body, icon, tag, renotify, and data", () => {
    const opts = buildOptions({
      kind: "permission",
      sessionID: "ses_a",
      title: "Permission required",
      body: "do thing?",
      href: "/foo",
    })
    expect(opts.body).toBe("do thing?")
    expect(opts.icon).toBe("https://opencode.ai/favicon-96x96-v3.png")
    expect(opts.tag).toBe("permission:ses_a")
    expect(opts.renotify).toBe(true)
    expect(opts.data).toEqual({ href: "/foo", kind: "permission", sessionID: "ses_a" })
  })

  test("defaults body to empty string and accepts icon override", () => {
    const opts = buildOptions({
      kind: "session-idle",
      sessionID: "ses_b",
      title: "Ready",
      icon: "/custom.png",
    })
    expect(opts.body).toBe("")
    expect(opts.icon).toBe("/custom.png")
  })

  test("omits sessionID in tag when not provided", () => {
    const opts = buildOptions({ kind: "session-error", title: "Oops" })
    expect(opts.tag).toBe("session-error")
    expect((opts.data as { sessionID?: string }).sessionID).toBeUndefined()
  })
})

describe("show", () => {
  test("calls showNotification with the right args and returns true", async () => {
    const { log, entries } = captureLogger()
    const calls: Array<{ title: string; options?: NotificationOptions }> = []
    const reg: RegistrationLike = {
      showNotification: async (title, options) => {
        calls.push({ title, options })
      },
      getNotifications: async () => [],
    }
    const ok = await show(
      reg,
      { kind: "session-idle", sessionID: "ses_x", title: "Done", href: "/x" },
      log,
    )
    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].title).toBe("Done")
    expect(calls[0].options?.tag).toBe("session-idle:ses_x")
    const showEntries = entries.filter((e) => e.message === "show")
    expect(showEntries).toHaveLength(1)
    expect(showEntries[0].extra).toMatchObject({
      kind: "session-idle",
      sessionID: "ses_x",
      tag: "session-idle:ses_x",
      title: "Done",
      hasHref: true,
    })
  })

  test("returns false and logs warn on showNotification rejection", async () => {
    const { log, entries } = captureLogger()
    const reg: RegistrationLike = {
      showNotification: async () => {
        throw new Error("boom")
      },
      getNotifications: async () => [],
    }
    const ok = await show(reg, { kind: "permission", sessionID: "ses_q", title: "?" }, log)
    expect(ok).toBe(false)
    expect(entries.some((e) => e.level === "warn" && e.message === "show failed")).toBe(true)
  })
})

describe("dismissForSession", () => {
  test("closes notifications whose tag ends with :<sessionID>", async () => {
    const { log, entries } = captureLogger()
    const a = fakeNotification("session-idle:ses_a")
    const b = fakeNotification("permission:ses_a")
    const c = fakeNotification("session-idle:ses_b")
    const reg: RegistrationLike = {
      showNotification: async () => {},
      getNotifications: async () => [a, b, c],
    }
    const count = await dismissForSession(reg, "ses_a", log)
    expect(count).toBe(2)
    expect(a.closed).toBe(1)
    expect(b.closed).toBe(1)
    expect(c.closed).toBe(0)
    const entry = entries.find((e) => e.message === "dismissForSession")
    expect(entry?.extra).toMatchObject({
      sessionID: "ses_a",
      total: 3,
      matched: 2,
    })
    expect(entry?.extra?.tags).toEqual(["session-idle:ses_a", "permission:ses_a"])
  })

  test("matches every kind suffix for the same session", async () => {
    const { log } = captureLogger()
    const ids = ["session-idle:ses_a", "session-error:ses_a", "permission:ses_a", "question:ses_a"]
    const notifications = ids.map((t) => fakeNotification(t))
    const reg: RegistrationLike = {
      showNotification: async () => {},
      getNotifications: async () => notifications,
    }
    const count = await dismissForSession(reg, "ses_a", log)
    expect(count).toBe(4)
    for (const n of notifications) expect(n.closed).toBe(1)
  })

  test("does not match when sessionID is only a prefix (suffix match required)", async () => {
    const { log } = captureLogger()
    // Tag for `ses_a_long` should not be cleared when dismissing `ses_a`.
    const wrong = fakeNotification("session-idle:ses_a_long")
    const reg: RegistrationLike = {
      showNotification: async () => {},
      getNotifications: async () => [wrong],
    }
    const count = await dismissForSession(reg, "ses_a", log)
    expect(count).toBe(0)
    expect(wrong.closed).toBe(0)
  })

  test("logs and returns zero when getNotifications rejects", async () => {
    const { log, entries } = captureLogger()
    const reg: RegistrationLike = {
      showNotification: async () => {},
      getNotifications: async () => {
        throw new Error("nope")
      },
    }
    const count = await dismissForSession(reg, "ses_a", log)
    expect(count).toBe(0)
    expect(entries.some((e) => e.level === "warn" && e.message === "dismissForSession getNotifications failed")).toBe(
      true,
    )
  })

  test("tolerates close() throwing on individual notifications", async () => {
    const { log, entries } = captureLogger()
    const good = fakeNotification("permission:ses_a")
    const bad: NotificationLike = {
      tag: "session-idle:ses_a",
      title: "x",
      close() {
        throw new Error("close exploded")
      },
    }
    const reg: RegistrationLike = {
      showNotification: async () => {},
      getNotifications: async () => [good, bad],
    }
    const count = await dismissForSession(reg, "ses_a", log)
    // matched count is reported regardless of close() failures.
    expect(count).toBe(2)
    expect(good.closed).toBe(1)
    expect(entries.some((e) => e.message === "notification.close threw")).toBe(true)
  })
})

describe("register", () => {
  const realNavigator = globalThis.navigator
  let restoredServiceWorker: PropertyDescriptor | undefined
  let restoredNavigator: { value: typeof navigator } | { delete: true } | undefined

  beforeEach(() => {
    restoredServiceWorker = Object.getOwnPropertyDescriptor(globalThis.navigator, "serviceWorker")
  })

  afterEach(() => {
    if (restoredServiceWorker) {
      Object.defineProperty(globalThis.navigator, "serviceWorker", restoredServiceWorker)
    } else {
      // happy-dom may have added it during the test; drop the override.
      try {
        delete (globalThis.navigator as { serviceWorker?: ServiceWorkerContainer }).serviceWorker
      } catch {}
    }
    if (restoredNavigator) {
      if ("delete" in restoredNavigator) {
        delete (globalThis as { navigator?: Navigator }).navigator
      } else {
        Object.defineProperty(globalThis, "navigator", {
          configurable: true,
          value: restoredNavigator.value,
        })
      }
    }
  })

  test("returns null when navigator.serviceWorker is missing", async () => {
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    })
    const { log, entries } = captureLogger()
    const reg = await register("/sw.js", undefined, log)
    expect(reg).toBeNull()
    expect(entries.some((e) => e.message === "serviceWorker unavailable in navigator")).toBe(true)
  })

  test("returns null when navigator itself is undefined", async () => {
    restoredNavigator = realNavigator
      ? { value: realNavigator }
      : { delete: true }
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: undefined })
    const { log, entries } = captureLogger()
    const reg = await register("/sw.js", undefined, log)
    expect(reg).toBeNull()
    expect(entries.some((e) => e.message === "serviceWorker unavailable in navigator")).toBe(true)
  })

  test("returns the registration on success and logs scope info", async () => {
    const fakeReg = {
      scope: "https://example.test/",
      active: { state: "activated" },
      installing: null,
      waiting: null,
    } as unknown as ServiceWorkerRegistration
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: async (url: string, opts?: { scope?: string }) => {
          expect(url).toBe("/sw.js")
          expect(opts?.scope).toBe("/")
          return fakeReg
        },
        ready: Promise.resolve(fakeReg),
      },
    })
    const { log, entries } = captureLogger()
    const reg = await register("/sw.js", "/", log)
    expect(reg).toBe(fakeReg)
    expect(entries.some((e) => e.message === "register ok")).toBe(true)
  })

  test("returns null and logs warn when register() rejects", async () => {
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: async () => {
          throw new Error("registration failed")
        },
        // never-resolving ready promise — should not be awaited because
        // register() bails out before then.
        get ready() {
          return new Promise<ServiceWorkerRegistration>(() => {})
        },
      },
    })
    const { log, entries } = captureLogger()
    const reg = await register("/sw.js", undefined, log)
    expect(reg).toBeNull()
    expect(entries.some((e) => e.level === "warn" && e.message === "register failed")).toBe(true)
  })
})

describe("ensurePermission", () => {
  // Notification global state survives across tests; restore after each.
  const realNotification = (globalThis as { Notification?: typeof Notification }).Notification

  afterEach(() => {
    if (realNotification) {
      Object.defineProperty(globalThis, "Notification", { configurable: true, value: realNotification })
    } else {
      try {
        delete (globalThis as { Notification?: typeof Notification }).Notification
      } catch {}
    }
  })

  test("returns 'denied' when Notification API is missing", async () => {
    Object.defineProperty(globalThis, "Notification", { configurable: true, value: undefined })
    const { log, entries } = captureLogger()
    const out = await ensurePermission(log)
    expect(out).toBe("denied")
    expect(entries.some((e) => e.message === "Notification undefined")).toBe(true)
  })

  test("returns existing permission without prompting when already decided", async () => {
    const calls: number[] = []
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: {
        permission: "granted",
        requestPermission: async () => {
          calls.push(1)
          return "granted"
        },
      },
    })
    const { log, entries } = captureLogger()
    const out = await ensurePermission(log)
    expect(out).toBe("granted")
    expect(calls).toHaveLength(0)
    expect(entries.some((e) => e.message === "permission already decided")).toBe(true)
  })

  test("prompts when permission is 'default' and returns the answer", async () => {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission: async () => "granted",
      },
    })
    const { log, entries } = captureLogger()
    const out = await ensurePermission(log)
    expect(out).toBe("granted")
    expect(entries.some((e) => e.message === "permission requested")).toBe(true)
  })

  test("returns 'denied' if requestPermission throws", async () => {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission: async () => {
          throw new Error("boom")
        },
      },
    })
    const { log, entries } = captureLogger()
    const out = await ensurePermission(log)
    expect(out).toBe("denied")
    expect(entries.some((e) => e.level === "warn" && e.message === "requestPermission threw")).toBe(true)
  })
})
