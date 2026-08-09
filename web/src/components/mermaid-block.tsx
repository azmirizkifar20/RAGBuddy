import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import mermaid from 'mermaid'
import { TriangleAlert } from 'lucide-react'

type MermaidTheme = 'dark' | 'default'

function getTheme(): MermaidTheme {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
    return 'dark'
  }
  return 'default'
}

// Single theme store shared by every diagram instance. A MutationObserver watches
// the `<html class>` attribute (next-themes toggles `.dark` there) and broadcasts
// changes so all diagrams re-initialise and re-render with the matching palette.
const themeListeners = new Set<() => void>()
let currentTheme: MermaidTheme = getTheme()
let themeObserverAttached = false

function attachThemeObserver() {
  if (themeObserverAttached || typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return
  }
  themeObserverAttached = true
  const observer = new MutationObserver(() => {
    const next = getTheme()
    if (next !== currentTheme) {
      currentTheme = next
      themeListeners.forEach((listener) => listener())
    }
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
}

function subscribeTheme(listener: () => void) {
  themeListeners.add(listener)
  attachThemeObserver()
  return () => {
    themeListeners.delete(listener)
  }
}

function useMermaidTheme(): MermaidTheme {
  return useSyncExternalStore(subscribeTheme, getTheme, getTheme)
}

interface MermaidResult {
  svg: string
  bind?: (element: Element) => void
}

export function MermaidBlock({ code }: { code: string }) {
  const theme = useMermaidTheme()
  const [result, setResult] = useState<MermaidResult | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const svgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setResult(null)

    // Re-initialise on every theme/code change so the diagram uses the current palette.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'antiscript',
      theme,
      maxTextSize: 50000,
    })

    // Reuse a fresh id per render; mermaid.render mutates the DOM node it produces.
    const id = `mermaid-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`

    mermaid
      .render(id, code)
      .then(({ svg, bindFunctions }) => {
        if (cancelled) return
        setResult({ svg, bind: bindFunctions })
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('Mermaid render failed:', err)
        setError(true)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [code, theme])

  // Attach mermaid's event bindings (e.g. flowchart click handlers) once the SVG is in the DOM.
  useEffect(() => {
    if (result?.bind && svgRef.current) {
      result.bind(svgRef.current)
    }
  }, [result])

  if (loading) {
    return <div className="my-3 h-28 rounded-lg border border-border skeleton-shimmer" aria-label="Rendering diagram" />
  }

  if (error) {
    return (
      <div className="my-3 overflow-hidden rounded-lg border border-border">
        <div className="flex items-center gap-2 border-b border-border bg-destructive/10 px-3 py-2">
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
          <span className="text-sm font-medium text-destructive">Invalid diagram</span>
        </div>
        <pre className="max-h-64 overflow-auto break-words bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {code}
        </pre>
        <p className="border-t border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          This diagram could not be parsed. Fix the Mermaid syntax and regenerate the response.
        </p>
      </div>
    )
  }

  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-border bg-card">
      <div className="mx-auto w-fit p-4">
        <div ref={svgRef} dangerouslySetInnerHTML={{ __html: result?.svg ?? '' }} />
      </div>
    </div>
  )
}