// Mermaid diagram hydration for the markdown component.
//
// `marked` emits a placeholder of the form
//   <div data-component="mermaid-block" data-source="<base64 source>"></div>
// for ```mermaid``` fences. After morphdom patches the DOM, this module finds
// those placeholders and replaces their contents with the rendered SVG plus a
// toggle button that flips between the rendered diagram and the original
// source. The toggle is always available, even on successful renders, so the
// user can copy/inspect/edit the source.
//
// The `mermaid` package is dynamically imported so it only loads when a
// diagram actually appears in a session.

type MermaidModule = typeof import("mermaid")["default"]

let mermaidLoader: Promise<MermaidModule> | undefined

// Mermaid's color parser doesn't understand CSS variables. We resolve the
// CSS variables to concrete colour strings on every render so theme switches
// take effect without us having to listen for them.
function resolveCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return fallback
  // The raw value may itself contain `var(...)` references (because we layer
  // OpenCode's design tokens). Force the browser to resolve them by reading
  // the computed `color` of a probe element with that value.
  const probe = document.createElement("div")
  probe.style.position = "absolute"
  probe.style.visibility = "hidden"
  probe.style.pointerEvents = "none"
  probe.style.color = raw
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved || fallback
}

function resolveCssValue(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return raw || fallback
}

function applyMermaidTheme(mermaid: MermaidModule) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: resolveCssValue("--font-family-sans", "system-ui, sans-serif"),
    themeVariables: {
      fontFamily: resolveCssValue("--font-family-sans", "system-ui, sans-serif"),
      fontSize: "13px",
      background: resolveCssVar("--surface-base", "#ffffff"),
      primaryColor: resolveCssVar("--surface-base-strong", "#f4f4f5"),
      primaryTextColor: resolveCssVar("--text-strong", "#111111"),
      primaryBorderColor: resolveCssVar("--border-weak-base", "#d4d4d8"),
      lineColor: resolveCssVar("--border-strong-base", "#71717a"),
      secondaryColor: resolveCssVar("--surface-base", "#ffffff"),
      tertiaryColor: resolveCssVar("--surface-base", "#ffffff"),
      textColor: resolveCssVar("--text-base", "#1f1f1f"),
      mainBkg: resolveCssVar("--surface-base-strong", "#f4f4f5"),
      noteBkgColor: resolveCssVar("--surface-base", "#ffffff"),
      noteTextColor: resolveCssVar("--text-base", "#1f1f1f"),
      noteBorderColor: resolveCssVar("--border-weak-base", "#d4d4d8"),
    },
  })
}

function loadMermaid(): Promise<MermaidModule> {
  if (mermaidLoader) return mermaidLoader
  mermaidLoader = import("mermaid")
    .then((module) => {
      const mermaid = module.default
      applyMermaidTheme(mermaid)
      return mermaid
    })
    .catch((err) => {
      mermaidLoader = undefined
      throw err
    })
  return mermaidLoader
}

export function encodeMermaidSource(source: string): string {
  if (typeof window === "undefined") return ""
  const bytes = new TextEncoder().encode(source)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return window.btoa(binary)
}

function decodeMermaidSource(encoded: string): string {
  try {
    const binary = window.atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return ""
  }
}

// Each block gets a numeric id so mermaid can produce unique element ids.
let counter = 0
function nextId() {
  counter += 1
  return `oc-mermaid-${counter}`
}

type BlockState = {
  source: string
  mode: "diagram" | "source"
  rendered: { svg: string } | null
  error: string | null
  renderToken: number
  renderId: string
}

const STATE_KEY = "__ocMermaidState"
const CLEANUP_KEY = "__ocMermaidCleanup"

type StatefulElement = HTMLElement & {
  [STATE_KEY]?: BlockState
  [CLEANUP_KEY]?: () => void
}

function getState(el: StatefulElement): BlockState | undefined {
  return el[STATE_KEY]
}

function setState(el: StatefulElement, state: BlockState) {
  el[STATE_KEY] = state
}

function paint(el: StatefulElement) {
  const state = getState(el)
  if (!state) return

  // Clear children but keep the data-* attrs so future morphdom updates can
  // still see them.
  while (el.firstChild) el.removeChild(el.firstChild)

  const toolbar = document.createElement("div")
  toolbar.setAttribute("data-slot", "mermaid-toolbar")

  const toggle = document.createElement("button")
  toggle.type = "button"
  toggle.setAttribute("data-slot", "mermaid-toggle")
  toggle.setAttribute("data-variant", "secondary")
  const showingSource = state.mode === "source"
  toggle.textContent = showingSource ? "Diagram" : "Source"
  toggle.setAttribute(
    "aria-label",
    showingSource ? "Show rendered diagram" : "Show diagram source",
  )
  toolbar.appendChild(toggle)

  const copy = document.createElement("button")
  copy.type = "button"
  copy.setAttribute("data-slot", "mermaid-copy")
  copy.setAttribute("data-variant", "secondary")
  copy.textContent = "Copy"
  copy.setAttribute("aria-label", "Copy diagram source")
  toolbar.appendChild(copy)

  el.appendChild(toolbar)

  const body = document.createElement("div")
  body.setAttribute("data-slot", "mermaid-body")

  if (state.mode === "diagram" && state.rendered) {
    body.setAttribute("data-mode", "diagram")
    // Inject the rendered SVG. The SVG is produced by mermaid itself and
    // never passes through DOMPurify, so we keep it in a child div outside
    // the morphdom-managed sanitization path.
    const figure = document.createElement("div")
    figure.setAttribute("data-slot", "mermaid-figure")
    figure.innerHTML = state.rendered.svg
    // mermaid stamps the SVG with absolute width/height attributes plus
    // `style="max-width: <natural>px"`, which prevents the diagram from
    // growing to fill the available container width. Strip those so CSS
    // governs sizing instead — the viewBox is what we actually care about.
    const svg = figure.querySelector("svg")
    if (svg) {
      svg.removeAttribute("width")
      svg.removeAttribute("height")
      const style = svg.getAttribute("style")
      if (style) {
        const cleaned = style
          .split(";")
          .map((part) => part.trim())
          .filter((part) => part && !/^max-width\s*:/i.test(part))
          .join("; ")
        if (cleaned) svg.setAttribute("style", cleaned)
        else svg.removeAttribute("style")
      }
    }
    body.appendChild(figure)
  } else {
    body.setAttribute("data-mode", "source")
    if (state.error) {
      const errBox = document.createElement("div")
      errBox.setAttribute("data-slot", "mermaid-error")
      errBox.textContent = `Diagram failed to render: ${state.error}`
      body.appendChild(errBox)
    }
    const pre = document.createElement("pre")
    pre.setAttribute("data-slot", "mermaid-source")
    const code = document.createElement("code")
    code.textContent = state.source
    pre.appendChild(code)
    body.appendChild(pre)
  }

  el.appendChild(body)
  el.setAttribute("data-hydrated", state.error ? "error" : state.rendered ? "rendered" : "pending")
  el.setAttribute("data-mode", state.mode)
}

async function render(el: StatefulElement) {
  const state = getState(el)
  if (!state) return
  const token = ++state.renderToken
  const id = state.renderId
  const source = state.source

  try {
    const mermaid = await loadMermaid()
    // Re-resolve theme colours each render so light/dark theme switches take
    // effect on the next render (mermaid only reads themeVariables at
    // initialize() time).
    applyMermaidTheme(mermaid)
    // Validate first — parse() throws synchronously on syntax errors so the
    // error UI can show without mermaid having tried to manipulate the DOM.
    await mermaid.parse(source)
    const result = await mermaid.render(id, source)
    if (state.renderToken !== token) return
    state.rendered = { svg: result.svg }
    state.error = null
    if (state.mode === "diagram") paint(el)
    else el.setAttribute("data-hydrated", "rendered")
  } catch (err) {
    if (state.renderToken !== token) return
    state.error = err instanceof Error ? err.message : String(err)
    state.rendered = null
    // On error force the source view so the user always sees something
    // useful. Toggle still works to flip back, which will retry render.
    state.mode = "source"
    paint(el)
  }
}

function attachHandlers(el: StatefulElement) {
  if (el[CLEANUP_KEY]) return

  const handler = (event: Event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const toggleBtn = target.closest('[data-slot="mermaid-toggle"]')
    const copyBtn = target.closest('[data-slot="mermaid-copy"]')
    const state = getState(el)
    if (!state) return

    if (toggleBtn) {
      state.mode = state.mode === "diagram" ? "source" : "diagram"
      if (state.mode === "diagram" && !state.rendered) {
        paint(el)
        void render(el)
      } else {
        paint(el)
      }
      return
    }
    if (copyBtn) {
      const clipboard = navigator?.clipboard
      if (!clipboard) return
      void clipboard.writeText(state.source).then(() => {
        if (!(copyBtn instanceof HTMLElement)) return
        const original = copyBtn.textContent
        copyBtn.textContent = "Copied"
        setTimeout(() => {
          if (copyBtn.textContent === "Copied") copyBtn.textContent = original ?? "Copy"
        }, 1500)
      })
    }
  }

  el.addEventListener("click", handler)
  el[CLEANUP_KEY] = () => {
    el.removeEventListener("click", handler)
  }
}

export function hydrateMermaidBlocks(root: HTMLElement) {
  if (!root) return
  const blocks = root.querySelectorAll<HTMLElement>('[data-component="mermaid-block"]')
  for (const el of Array.from(blocks)) {
    const stateful = el as StatefulElement
    const encoded = el.getAttribute("data-source") ?? ""
    const source = decodeMermaidSource(encoded).trim()
    const existing = getState(stateful)

    if (existing) {
      if (existing.source === source) {
        // Source unchanged — make sure the DOM still reflects state (e.g.
        // after morphdom restored it).
        if (!el.firstChild) paint(stateful)
        attachHandlers(stateful)
        continue
      }
      // Source changed (probably from streaming). Invalidate any in-flight
      // render and re-render.
      existing.source = source
      existing.rendered = null
      existing.error = null
      existing.mode = "diagram"
      paint(stateful)
      attachHandlers(stateful)
      void render(stateful)
      continue
    }

    if (!source) continue

    const state: BlockState = {
      source,
      mode: "diagram",
      rendered: null,
      error: null,
      renderToken: 0,
      renderId: nextId(),
    }
    setState(stateful, state)
    paint(stateful)
    attachHandlers(stateful)
    void render(stateful)
  }
}

export function teardownMermaidBlocks(root: HTMLElement) {
  if (!root) return
  const blocks = root.querySelectorAll<HTMLElement>('[data-component="mermaid-block"]')
  for (const el of Array.from(blocks)) {
    const stateful = el as StatefulElement
    const cleanup = stateful[CLEANUP_KEY]
    if (cleanup) {
      cleanup()
      delete stateful[CLEANUP_KEY]
    }
    delete stateful[STATE_KEY]
  }
}
