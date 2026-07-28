import { createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { PermissionPatternEvaluation, PermissionRequest, PermissionRule } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { DockPrompt } from "@opencode-ai/session-ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"

interface PatternRow {
  pattern: string
  action: "allow" | "deny" | "ask"
  rule?: PermissionRule
}

function rowsFor(request: PermissionRequest): PatternRow[] {
  if (request.evaluations && request.evaluations.length === request.patterns.length) {
    return request.evaluations.map((e: PermissionPatternEvaluation) => ({
      pattern: e.pattern,
      action: e.action,
      rule: e.rule,
    }))
  }
  // Fallback: server didn't send evaluations (older backend). Treat everything as ask, no rule.
  return request.patterns.map((pattern) => ({ pattern, action: "ask" as const }))
}

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()
  const [expanded, setExpanded] = createStore<Record<number, boolean>>({})
  const [patternsOpen, setPatternsOpen] = createSignal(true)

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  // Falls back to the tool title, then the raw permission id, so the
  // disclosure summary always has a label even for permissions that don't
  // have a description string (e.g. custom plugin-defined permissions).
  const toolLabel = () => {
    const description = toolDescription()
    if (description) return description
    const key = `settings.permissions.tool.${props.request.permission}.title`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return props.request.permission
    return value
  }

  const rows = () => rowsFor(props.request)

  const copy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() =>
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("ui.permission.copied"),
          description: text,
          // Auto-dismiss quickly — the user only needs a "yes, that worked"
          // confirmation, not a sticky banner.
          duration: 1000,
        }),
      )
      .catch(() =>
        showToast({
          variant: "error",
          icon: "warning",
          title: language.t("ui.permission.copyFailed"),
          duration: 1000,
        }),
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
              variant="secondary"
              size="normal"
              onClick={() => props.onDecide("always")}
              disabled={props.responding}
            >
              {language.t("ui.permission.allowAlways")}
            </Button>
            <Button variant="primary" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {language.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </>
      }
    >
      <Show
        when={rows().length > 0}
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
            data-scope="permission"
            variant="ghost"
            open={patternsOpen()}
            onOpenChange={setPatternsOpen}
          >
            <Collapsible.Trigger data-slot="permission-disclosure-trigger">
              <span data-slot="permission-hint">{toolLabel()}</span>
              <Collapsible.Arrow />
            </Collapsible.Trigger>
            <Collapsible.Content>
              <div data-slot="permission-patterns">
                <For each={rows()}>
                  {(row, index) => (
                    <div
                      data-slot="permission-pattern"
                      data-action={row.action}
                      data-expanded={expanded[index()] ? "true" : "false"}
                    >
                      <div data-slot="permission-pattern-row">
                        <button
                          type="button"
                          data-slot="permission-pattern-trigger"
                          aria-expanded={expanded[index()] ? "true" : "false"}
                          onClick={() => setExpanded(index(), (v) => !v)}
                        >
                          <Show
                            when={row.action === "allow"}
                            fallback={<Icon name="warning" size="small" data-slot="permission-pattern-icon" />}
                          >
                            <Icon name="check-small" size="small" data-slot="permission-pattern-icon" />
                          </Show>
                          <code class="text-12-regular text-text-base break-all">{row.pattern}</code>
                        </button>
                        <IconButton
                          data-slot="permission-pattern-copy"
                          variant="ghost"
                          size="small"
                          icon="copy"
                          aria-label={language.t("ui.permission.copyCommand")}
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation()
                            copy(row.pattern)
                          }}
                        />
                      </div>
                      <Show when={expanded[index()]}>
                        <div data-slot="permission-pattern-details">
                          <div data-slot="permission-pattern-rule">
                            <Show
                              when={row.rule}
                              fallback={
                                <span data-slot="permission-pattern-rule-empty">
                                  {language.t("ui.permission.noMatchingRule")}
                                </span>
                              }
                            >
                              {(rule) => (
                                <>
                                  <span data-slot="permission-pattern-rule-label">
                                    {language.t("ui.permission.matchingRule")}
                                  </span>
                                  <code class="text-12-regular break-all">
                                    {rule().permission} {rule().pattern} → {rule().action}
                                  </code>
                                </>
                              )}
                            </Show>
                          </div>
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
