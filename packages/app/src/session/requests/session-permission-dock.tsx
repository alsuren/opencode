import { createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { PermissionEvaluation, PermissionRequest } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Collapsible } from "@opencode/ui/collapsible"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const [resourcesOpen, setResourcesOpen] = createSignal(true)
  const [rows, setRows] = createStore<{ expanded: Record<number, boolean>; copied?: number }>({ expanded: {} })

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

  // Older servers omit evaluations; treat every resource as an unmatched ask.
  const evaluations = (): ReadonlyArray<PermissionEvaluation> =>
    props.request.evaluations?.length === props.request.resources.length
      ? props.request.evaluations
      : props.request.resources.map((resource) => ({ resource, effect: "ask" as const }))

  const copy = (text: string, index: number) => {
    void (platform.writeClipboardText?.(text) ?? navigator.clipboard.writeText(text)).then(
      () => setRows("copied", index),
      () => showToast({ title: language.t("common.requestFailed") }),
    )
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
                <For each={evaluations()}>
                  {(item, index) => (
                    <div
                      data-slot="permission-pattern"
                      data-effect={item.effect}
                      data-expanded={rows.expanded[index()] ? "true" : "false"}
                    >
                      <div data-slot="permission-pattern-row">
                        <button
                          type="button"
                          data-slot="permission-pattern-trigger"
                          aria-expanded={rows.expanded[index()] ? "true" : "false"}
                          onClick={() => setRows("expanded", index(), (value) => !value)}
                        >
                          <Icon
                            name={item.effect === "allow" ? "check-small" : "warning"}
                            size="small"
                            data-slot="permission-pattern-icon"
                          />
                          <code class="text-12-regular text-text-base break-all">{item.resource}</code>
                        </button>
                        <Tooltip
                          value={
                            rows.copied === index()
                              ? language.t("common.copied")
                              : language.t("session.permission.copyResource")
                          }
                        >
                          <IconButton
                            data-slot="permission-pattern-copy"
                            size="small"
                            variant="ghost-muted"
                            icon={<Icon name={rows.copied === index() ? "check" : "outline-copy"} />}
                            aria-label={language.t("session.permission.copyResource")}
                            onClick={() => copy(item.resource, index())}
                          />
                        </Tooltip>
                      </div>
                      <Show when={rows.expanded[index()]}>
                        <div data-slot="permission-pattern-details">
                          <Show
                            when={item.rule}
                            fallback={
                              <span data-slot="permission-pattern-rule-empty">
                                {language.t("session.permission.noMatchingRule")}
                              </span>
                            }
                          >
                            {(rule) => (
                              <>
                                <span>{language.t("session.permission.matchedRule")}</span>
                                <code class="text-12-regular break-all">
                                  {`${rule().action} ${rule().resource} → ${rule().effect}`}
                                </code>
                              </>
                            )}
                          </Show>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Collapsible.Content>
          </Collapsible>
        </div>
      </Show>
    </DockPrompt>
  )
}
