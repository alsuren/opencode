import { describe, expect, test } from "bun:test"
import { Wildcard } from "@opencode/core/util/wildcard"

describe("Wildcard.match", () => {
  test("treats <arg> as a single-token wildcard", () => {
    expect(Wildcard.match("timeout 20 npx vitest", "timeout <arg> npx vitest")).toBe(true)
    expect(Wildcard.match("timeout 20 npx vitest run", "timeout <arg> npx vitest *")).toBe(true)
    expect(Wildcard.match("sudo -u root apt-get install foo", "sudo <arg> <arg> apt-get install *")).toBe(true)
  })

  test("<arg> requires at least one character", () => {
    expect(Wildcard.match("timeout  npx vitest", "timeout <arg> npx vitest")).toBe(false)
  })

  test("<arg> does not cross whitespace", () => {
    expect(Wildcard.match("timeout 20 30 npx vitest", "timeout <arg> npx vitest")).toBe(false)
    expect(Wildcard.match("timeout 20\n30 npx vitest", "timeout <arg> npx vitest")).toBe(false)
  })

  test("multiple <arg> tokens compose", () => {
    expect(Wildcard.match("git commit -m foo", "git commit <arg> <arg>")).toBe(true)
    expect(Wildcard.match("git commit -m foo bar", "git commit <arg> <arg>")).toBe(false)
  })

  test("<arg> composes with the optional trailing ' *'", () => {
    expect(Wildcard.match("npm run build --watch", "npm run <arg> *")).toBe(true)
    expect(Wildcard.match("npm run build", "npm run <arg> *")).toBe(true)
    expect(Wildcard.match("npm run", "npm run <arg> *")).toBe(false)
  })

  test("<arg> works with slash normalization", () => {
    expect(Wildcard.match("cat C:\\Users\\me\\file.txt", "cat <arg>")).toBe(true)
    expect(Wildcard.match("C:\\tools\\bin\\run fast", "C:\\tools\\*\\run <arg>")).toBe(true)
  })

  test("existing wildcards are unchanged", () => {
    expect(Wildcard.match("ls", "ls *")).toBe(true)
    expect(Wildcard.match("ls -la", "ls *")).toBe(true)
    expect(Wildcard.match("file1.txt", "file?.txt")).toBe(true)
    expect(Wildcard.match("a+b(c).txt", "a+b(c).*")).toBe(true)
    expect(Wildcard.match("C:/Windows/System32/drivers", "C:\\Windows\\System32\\*")).toBe(true)
  })
})
