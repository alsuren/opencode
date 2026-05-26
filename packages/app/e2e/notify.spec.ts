import { expect, test } from "@playwright/test"

/**
 * Verifies the service-worker-based notification flow used by the web app:
 *
 *   1. `/sw.js` registers and activates
 *   2. `registration.showNotification(...)` with a `kind:sessionID` tag is
 *      enumerable via `registration.getNotifications()`
 *   3. `getNotifications()` filtered by tag returns only matching ones
 *   4. `notification.close()` removes it from `getNotifications()`
 *   5. Multiple notifications for the same session can be dismissed by
 *      iterating matches, mirroring `dismissForSession` in src/utils/notify.ts
 *
 * The full happy path (session.idle event → platform.notify → SW → OS
 * notification → user clicks → onclick → navigate → dismissForSession)
 * requires a live opencode backend and a real OS, so it stays out of CI.
 */

// Notifications API requires the full Chromium (not the headless-shell that
// Playwright defaults to).  Force the chromium channel so the runtime has the
// permission machinery installed.
test.use({ channel: "chromium" })

test.describe("notification service worker", () => {
  test.beforeEach(async ({ context, page }) => {
    // Grant for the dev server origin BEFORE first navigation.
    // playwright.config.ts uses baseURL = http://127.0.0.1:${port}.
    const baseURL = test.info().project.use.baseURL ?? "http://127.0.0.1:3000"
    const origin = new URL(baseURL).origin
    await context.grantPermissions(["notifications"], { origin })
    await page.goto("/")
    // Wait for the page-level SW registration that entry.tsx kicks off.
    await page.waitForFunction(
      async () => {
        if (!navigator.serviceWorker) return false
        const reg = await navigator.serviceWorker.getRegistration()
        return !!reg?.active
      },
      undefined,
      { timeout: 30_000 },
    )
  })

  test.afterEach(async ({ page }) => {
    // Best-effort cleanup so a flaky test doesn't poison the next one with
    // leftover notifications.  Same selector logic as dismissForSession but
    // unconditional.
    await page
      .evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration()
        if (!reg) return
        const all = await reg.getNotifications()
        for (const n of all) n.close()
      })
      .catch(() => {})
  })

  test("registers /sw.js and serves it with the expected scope", async ({ page }) => {
    const info = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      return {
        hasReg: !!reg,
        scope: reg?.scope ?? null,
        active: !!reg?.active,
        scriptURL: reg?.active?.scriptURL ?? reg?.installing?.scriptURL ?? reg?.waiting?.scriptURL ?? null,
      }
    })
    expect(info.hasReg).toBe(true)
    expect(info.active).toBe(true)
    expect(info.scriptURL ?? "").toMatch(/\/sw\.js(\?.*)?$/)
    expect(info.scope ?? "").toMatch(/\/$/)
  })

  test("showNotification produces an entry visible to getNotifications", async ({ page }) => {
    const tags = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      if (!reg) throw new Error("no registration")
      await reg.showNotification("Response ready", {
        body: "session title",
        tag: "session-idle:ses_e2e_a",
        data: { href: "/foo", kind: "session-idle", sessionID: "ses_e2e_a" },
      })
      const all = await reg.getNotifications()
      return all.map((n) => n.tag)
    })
    expect(tags).toContain("session-idle:ses_e2e_a")
  })

  test("getNotifications({ tag }) filters to that exact tag", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      if (!reg) throw new Error("no registration")
      await reg.showNotification("Idle A", { tag: "session-idle:ses_filter_a" })
      await reg.showNotification("Perm A", { tag: "permission:ses_filter_a" })
      await reg.showNotification("Idle B", { tag: "session-idle:ses_filter_b" })
      const filtered = (await reg.getNotifications({ tag: "permission:ses_filter_a" })).map((n) => n.tag)
      const allCount = (await reg.getNotifications()).length
      return { filtered, allCount }
    })
    expect(result.filtered).toEqual(["permission:ses_filter_a"])
    expect(result.allCount).toBeGreaterThanOrEqual(3)
  })

  test("notification.close() removes it from getNotifications()", async ({ page }) => {
    const after = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      if (!reg) throw new Error("no registration")
      await reg.showNotification("Close test", { tag: "session-idle:ses_close_me" })
      const before = (await reg.getNotifications()).filter((n) => n.tag === "session-idle:ses_close_me")
      for (const n of before) n.close()
      // close() is async w.r.t. the SW; give it a tick.
      await new Promise((r) => setTimeout(r, 50))
      const left = (await reg.getNotifications()).filter((n) => n.tag === "session-idle:ses_close_me")
      return { before: before.length, after: left.length }
    })
    expect(after.before).toBe(1)
    expect(after.after).toBe(0)
  })

  test("session-suffix dismiss mirrors dismissForSession() behaviour", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      if (!reg) throw new Error("no registration")
      await reg.showNotification("Idle", { tag: "session-idle:ses_X" })
      await reg.showNotification("Error", { tag: "session-error:ses_X" })
      await reg.showNotification("Perm", { tag: "permission:ses_X" })
      await reg.showNotification("Question", { tag: "question:ses_X" })
      // Plus one that should not be matched (suffix-only, not whole sessionID):
      await reg.showNotification("Other", { tag: "session-idle:ses_X_other" })

      const suffix = ":ses_X"
      const matches = (await reg.getNotifications()).filter((n) => n.tag.endsWith(suffix))
      for (const n of matches) n.close()
      await new Promise((r) => setTimeout(r, 50))

      const remaining = (await reg.getNotifications()).map((n) => n.tag)
      return { matchedCount: matches.length, remaining }
    })
    expect(result.matchedCount).toBe(4)
    // The "ses_X_other" notification should remain (suffix mismatch by design).
    expect(result.remaining).toContain("session-idle:ses_X_other")
    // None of the four ses_X ones should remain.
    expect(result.remaining).not.toContain("session-idle:ses_X")
    expect(result.remaining).not.toContain("session-error:ses_X")
    expect(result.remaining).not.toContain("permission:ses_X")
    expect(result.remaining).not.toContain("question:ses_X")
  })

  test("renotify and tag replace each other for repeated session-idle events", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      if (!reg) throw new Error("no registration")
      await reg.showNotification("First", {
        body: "first body",
        tag: "session-idle:ses_repeat",
      })
      await reg.showNotification("Second", {
        body: "second body",
        tag: "session-idle:ses_repeat",
      })
      const matches = (await reg.getNotifications()).filter((n) => n.tag === "session-idle:ses_repeat")
      return matches.map((n) => ({ title: n.title, body: n.body }))
    })
    // Two `showNotification` calls with the same tag must collapse to one
    // notification — that is the whole point of using tags.
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ title: "Second", body: "second body" })
  })
})
