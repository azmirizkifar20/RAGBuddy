import { useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MermaidBlock } from '@/components/mermaid-block'

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const lines = code.split('\n')
  const collapsed = lines.length > 20
  const visible = collapsed && !expanded ? lines.slice(0, 20).join('\n') : code

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between bg-muted/80 px-3 py-1.5 font-mono text-xs">
        <span className="text-muted-foreground">{lang}</span>
        <button type="button" onClick={copy} className="text-muted-foreground hover:text-foreground">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="overflow-x-auto bg-muted/40 p-3 font-mono text-sm whitespace-pre">{visible}</div>
      {collapsed && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full border-t border-border bg-muted/40 px-3 py-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? 'Show less' : `Show more (${lines.length - 20} more)`}
        </button>
      )}
    </div>
  )
}

const mdComponents: Components = {
  // `pre` is a pass-through: the `code` renderer below already emits the styled
  // wrapper (or a Mermaid diagram) for fenced blocks, so we must not nest a second `<pre>`.
  pre: ({ children }) => <>{children}</>,
  code({ className, children }) {
    const classNames = className ?? ''
    const raw = Array.isArray(children) ? children.join('') : String(children ?? '')
    const code = raw.replace(/\n$/, '')

    if (/language-mermaid/.test(classNames)) {
      return <MermaidBlock code={code} />
    }
    if (/language-/.test(classNames)) {
      const lang = classNames.replace('language-', '') || 'text'
      return <CodeBlock lang={lang} code={code} />
    }
    return (
      <code className="rounded bg-muted-foreground/10 px-1.5 py-0.5 font-mono text-xs text-foreground">
        {children}
      </code>
    )
  },
  h1: ({ children }) => (
    <h1 className="my-3 font-heading text-lg font-semibold text-foreground first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => <h2 className="my-3 font-heading text-base font-semibold text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="my-2 font-heading text-sm font-semibold text-foreground">{children}</h3>,
  h4: ({ children }) => <h4 className="my-2 font-heading text-sm font-medium text-foreground">{children}</h4>,
  h5: ({ children }) => <h5 className="my-2 font-heading text-sm font-medium text-foreground">{children}</h5>,
  h6: ({ children }) => (
    <h6 className="my-2 font-heading text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</h6>
  ),
  p: ({ children }) => <p className="my-2 text-sm leading-relaxed text-foreground">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-sm text-muted-foreground">{children}</blockquote>
  ),
  ul({ className, children }) {
    const isTask = (className ?? '').includes('contains-task-list')
    return (
      <ul className={isTask ? 'my-2 space-y-1 pl-1' : 'my-2 list-disc space-y-1 pl-5'}>{children}</ul>
    )
  },
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li({ className, children }) {
    const isTask = (className ?? '').includes('task-list-item')
    return (
      <li className={isTask ? 'flex items-start gap-2 text-sm leading-relaxed' : 'text-sm leading-relaxed'}>
        {children}
      </li>
    )
  },
  input: ({ checked }) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      readOnly
      disabled
      className="mt-0.5 size-4 shrink-0 rounded border-border accent-brand"
    />
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border last:border-b-0">{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-medium text-foreground">{children}</th>
  ),
  td: ({ children }) => <td className="px-3 py-2 align-top text-foreground">{children}</td>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-2 hover:text-brand/80">
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <img src={src} alt={alt ?? ''} className="my-2 max-w-full rounded-lg border border-border" />
  ),
  hr: () => <hr className="my-4 border-border" />,
}

export function FormattedChatMessage({ text }: { text: string }) {
  return (
    <div className="min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  )
}