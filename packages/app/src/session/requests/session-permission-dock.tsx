import { createSignal, For, Show } from "solid-js"
import type { PermissionRequest } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Collapsible } from "@opencode/ui/collapsible"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()
  const [resourcesOpen, setResourcesOpen] = createSignal(true)

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.action}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  // Falls back to the tool title, then the raw action id, so the disclosure
  // summary always has a label, even for plugin-defined permissions.
  const toolLabel = () => {
    const description = toolDescription()
    if (description) return description
    const key = `settings.permissions.tool.${props.request.action}.title`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return props.request.action
    return value
  }

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">{language.t("notification.permission.title")}</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <Button variant="ghost" size="normal" onClick={() => props.onDecide("reject")} disabled={props.responding}>
              {language.t("ui.permission.deny")}
            </Button>
            <Button
              variant="neutral"
              size="normal"
              onClick={() => props.onDecide("always")}
              disabled={props.responding}
            >
              {language.t("ui.permission.allowAlways")}
            </Button>
            <Button variant="submit" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {language.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </>
      }
    >
      <Show
        when={props.request.resources.length > 0}
        fallback={
          <Show when={toolDescription()}>
            <div data-slot="permission-row">
              <span data-slot="permission-spacer" aria-hidden="true" />
              <div data-slot="permission-hint">{toolDescription()}</div>
            </div>
          </Show>
        }
      >
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <Collapsible
            data-slot="permission-disclosure"
            variant="ghost"
            open={resourcesOpen()}
            onOpenChange={setResourcesOpen}
          >
            <Collapsible.Trigger>
              <span data-slot="permission-hint">{toolLabel()}</span>
              <Collapsible.Arrow />
            </Collapsible.Trigger>
            <Collapsible.Content>
              <div data-slot="permission-patterns">
                <For each={props.request.resources}>
                  {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
                </For>
              </div>
            </Collapsible.Content>
          </Collapsible>
        </div>
      </Show>
    </DockPrompt>
  )
}
