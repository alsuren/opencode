import { afterEach, describe, expect, test } from "bun:test"
import { handleNotificationClick, planSwClickAction, setNavigate } from "./notification-click"

describe("notification click", () => {
  afterEach(() => {
    setNavigate(undefined as any)
  })

  test("navigates via registered navigate function", () => {
    const calls: string[] = []
    setNavigate((href) => calls.push(href))
    handleNotificationClick("/abc/session/123")
    expect(calls).toEqual(["/abc/session/123"])
  })

  test("does not navigate when href is missing", () => {
    const calls: string[] = []
    setNavigate((href) => calls.push(href))
    handleNotificationClick(undefined)
    expect(calls).toEqual([])
  })

  test("falls back to location.assign without registered navigate", () => {
    handleNotificationClick("/abc/session/123")
    // falls back to window.location.assign — no error thrown
  })
})

describe("planSwClickAction", () => {
  test("focus-only when SW reports sameUrl=true (regression: avoid page reload)", () => {
    const action = planSwClickAction({ type: "notification-click", href: "/x/session/y", sameUrl: true })
    expect(action).toEqual({ kind: "focus-only", href: "/x/session/y" })
  })

  test("navigate when SW reports sameUrl=false", () => {
    const action = planSwClickAction({ type: "notification-click", href: "/x/session/y", sameUrl: false })
    expect(action).toEqual({ kind: "navigate", href: "/x/session/y" })
  })

  test("navigate when SW omits sameUrl (legacy/explicit-navigate case)", () => {
    const action = planSwClickAction({ type: "notification-click", href: "/x/session/y" })
    expect(action).toEqual({ kind: "navigate", href: "/x/session/y" })
  })

  test("ignores non-notification-click messages", () => {
    expect(planSwClickAction({ type: "something-else" })).toMatchObject({ kind: "ignore" })
    expect(planSwClickAction({ type: "notification-click" })).toMatchObject({ kind: "ignore", reason: expect.any(String) })
    expect(planSwClickAction(null)).toMatchObject({ kind: "ignore" })
    expect(planSwClickAction(undefined)).toMatchObject({ kind: "ignore" })
    expect(planSwClickAction("string")).toMatchObject({ kind: "ignore" })
  })
})
