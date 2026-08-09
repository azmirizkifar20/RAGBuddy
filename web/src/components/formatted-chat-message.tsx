import { useState, type ReactNode } from 'react'

type Block =
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'paragraph'; text: string }

function splitBlocks(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    const fence = line.match(/^```(\S*)\s*$/)
    if (fence) {
      const lang = fence[1] || 'code'
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i])
        i++
      }
      i++ // skip closing fence (or run off the end)
      blocks.push({ kind: 'code', lang, code: code.join('\n') })
      continue
    }

    if (line.startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      const parsed = parseTable(tableLines)
      if (parsed) blocks.push({ kind: 'table', ...parsed })
      continue
    }

    const para: string[] = [line]
    i++
    while (i < lines.length) {
      const nxt = lines[i]
      if (nxt.startsWith('```') || nxt.startsWith('|')) break
      para.push(nxt)
      i++
    }
    const textBlock = para.filter((l) => l.trim() !== '').join('\n')
    if (textBlock) blocks.push({ kind: 'paragraph', text: textBlock })
  }

  return blocks
}

function parseTable(lines: string[]): { header: string[]; rows: string[][] } | null {
  const split = (line: string) =>
    line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim())

  const header = split(lines[0])
  const rows: string[][] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i])
    // Skip a separator row like |---|---| (all cells containing only - and :)
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue
    rows.push(cells)
  }
  return { header, rows }
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const regex = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    if (match[1] !== undefined) {
      nodes.push(
        <code
          key={`${keyPrefix}${key}`}
          className="rounded bg-muted-foreground/10 px-1.5 py-0.5 font-mono text-xs text-foreground"
        >
          {match[1]}
        </code>,
      )
    } else if (match[2] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}${key}`}>{match[2]}</strong>)
    } else {
      nodes.push(
        <a
          key={`${keyPrefix}${key}`}
          href={match[4]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand underline"
        >
          {match[3]}
        </a>,
      )
    }
    lastIndex = regex.lastIndex
    key++
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

function renderParagraph(text: string): ReactNode {
  const lines = text.split('\n')
  const listItems: string[] = []
  const rest: string[] = []

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    if (line.startsWith('- ')) listItems.push(line.slice(2))
    else rest.push(line)
  }

  const restNodes = rest
    .filter((l) => l.trim() !== '')
    .map((l, i) => <p key={i}>{renderInline(l, `p${i}-`)}</p>)

  const list = listItems.length ? (
    <ul className="my-1 list-disc space-y-0.5 pl-5">
      {listItems.map((item, i) => (
        <li key={i}>{renderInline(item, `li${i}-`)}</li>
      ))}
    </ul>
  ) : null

  if (restNodes.length === 0 && list) return list
  return (
    <>
      {restNodes}
      {list}
    </>
  )
}

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
        <span>{lang}</span>
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

export function FormattedChatMessage({ text }: { text: string }) {
  const blocks = splitBlocks(text)
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        if (block.kind === 'code') return <CodeBlock key={i} lang={block.lang} code={block.code} />
        if (block.kind === 'table') {
          return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {block.header.map((cell, j) => (
                      <th
                        key={j}
                        className="border border-border/60 bg-muted/50 px-3 py-1.5 text-left font-medium"
                      >
                        {renderInline(cell, `th${j}-`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={r} className="even:bg-muted/30">
                      {row.map((cell, c) => (
                        <td key={c} className="border border-border/60 px-3 py-1.5">
                          {renderInline(cell, `td${r}-${c}-`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return <div key={i}>{renderParagraph(block.text)}</div>
      })}
    </div>
  )
}