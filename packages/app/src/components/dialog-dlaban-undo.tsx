// dlaban-undo: experimental "rewind to any user message, prefill the composer,
// do not submit" picker. Built as a sibling of dialog-fork.tsx so it can be
// deleted/rebased independently. To remove: delete this file and the
// `dlaban-undo` block in use-session-commands.tsx.
import { Component, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { usePrompt } from "@/context/prompt"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { showToast } from "@/utils/toast"
import { extractPromptFromParts } from "@/utils/prompt"
import type { TextPart as SDKTextPart } from "@opencode-ai/sdk/v2/client"
import { useLanguage } from "@/context/language"

interface UndoableMessage {
  id: string
  text: string
  time: string
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { timeStyle: "short" })
}

export const DialogDlabanUndo: Component = () => {
  const params = useParams()
  const sync = useSync()
  const sdk = useSDK()
  const prompt = usePrompt()
  const dialog = useDialog()
  const language = useLanguage()

  const messages = createMemo((): UndoableMessage[] => {
    const sessionID = params.id
    if (!sessionID) return []

    const msgs = sync().data.message[sessionID] ?? []
    const result: UndoableMessage[] = []

    for (const message of msgs) {
      if (message.role !== "user") continue

      const parts = sync().data.part[message.id] ?? []
      const textPart = parts.find((x): x is SDKTextPart => x.type === "text" && !x.synthetic && !x.ignored)
      if (!textPart) continue

      result.push({
        id: message.id,
        text: textPart.text.replace(/\n/g, " ").slice(0, 200),
        time: formatTime(new Date(message.time.created)),
      })
    }

    return result.reverse()
  })

  const handleSelect = (item: UndoableMessage | undefined) => {
    if (!item) return

    const sessionID = params.id
    if (!sessionID) return

    const parts = sync().data.part[item.id] ?? []
    const restored = extractPromptFromParts(parts, {
      directory: sdk().directory,
      attachmentName: language.t("common.attachment"),
    })

    const run = async () => {
      if (sync().data.session_working(sessionID)) {
        await sdk().client.session.abort({ sessionID }).catch(() => {})
      }
      const result = await sdk().client.session.revert({ sessionID, messageID: item.id })
      if (!result.data) {
        showToast({ title: language.t("common.requestFailed") })
        return
      }
      dialog.close()
      prompt.set(restored)
    }

    run().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    })
  }

  return (
    <Dialog title="Undo to question">
      <List
        class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage="No questions to undo to"
        key={(x) => x.id}
        items={messages}
        filterKeys={["text"]}
        onSelect={handleSelect}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <span class="truncate flex-1 min-w-0 text-left font-normal">{item.text}</span>
            <span class="text-text-weak shrink-0 font-normal">{item.time}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
