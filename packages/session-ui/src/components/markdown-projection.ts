import { marked, type Tokens } from "marked"
import type { Block, Projection } from "./markdown-stream"

export function completedProjection(text: string): Projection {
  const blocks: Block[] = []
  for (const token of marked.lexer(text)) {
    if (token.type === "space") {
      const previous = blocks.at(-1)
      if (previous) previous.raw += token.raw
      continue
    }
    if (token.type === "code") {
      const code = token as Tokens.Code
      blocks.push({ raw: code.raw, src: code.text, mode: "code", language: language(code.lang), complete: true })
      continue
    }
    blocks.push({ raw: token.raw, src: token.raw, mode: "full" })
  }
  return { text, blocks }
}

export function canReusePendingBlock(current: Pick<Block, "mode" | "raw"> | undefined, next: Block) {
  if (!current || current.mode !== next.mode) return false
  if (next.mode === "code" || next.mode === "live") return next.raw.startsWith(current.raw)
  return current.raw === next.raw
}

function language(value: string | undefined) {
  return value?.trim().split(/\s+/, 1)[0] || undefined
}
