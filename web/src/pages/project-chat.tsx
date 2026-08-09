import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Paperclip, Pencil, Plus, Send, Square, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormattedChatMessage } from '@/components/formatted-chat-message'
import {
  streamProjectChat,
  type ChatContentPart,
  type ChatMessage,
  type ChatSource,
} from '@/lib/api-client'
import { useProjectContext } from '@/pages/project-layout'
import { cn } from '@/lib/utils'

interface StoredMsg {
  role: 'user' | 'assistant'
  content: string
  useRag?: boolean
  sources?: ChatSource[]
  images?: string[]
  attachments?: { name: string; text: string }[]
}

interface ChatSession {
  id: string
  title: string
  createdAt: number
  messages: StoredMsg[]
}

const STORAGE_PREFIX = 'project-rag:chats:'
const MAX_SENT_MESSAGES = 30

const STARTERS = [
  'How does auto-sync work?',
  'Explain the project architecture',
  'What documents are indexed?',
  'Show me a sync history example',
]

function genId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now())
}

function newSession(): ChatSession {
  return { id: genId(), title: 'New chat', createdAt: Date.now(), messages: [] }
}

function buildChatContent(msg: StoredMsg): string | ChatContentPart[] {
  let text = msg.content
  if (msg.attachments?.length) {
    text +=
      '\n\n' +
      msg.attachments.map((a) => `[Attached File: ${a.name}]\n${a.text}`).join('\n\n')
  }
  if (msg.images?.length) {
    const parts: ChatContentPart[] = [{ type: 'text', text }]
    for (const url of msg.images) parts.push({ type: 'image_url', image_url: { url } })
    return parts
  }
  return text
}

function isTextLike(file: File): boolean {
  if (file.type.startsWith('text/')) return true
  return /\.(txt|md|markdown|csv|pdf)$/i.test(file.name)
}

function ThinkingDots() {
  return (
    <span className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
          style={{ animationDelay: `-${0.3 - i * 0.15}s` }}
        />
      ))}
    </span>
  )
}

function SourcesList({ sources }: { sources: ChatSource[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
      {sources.map((s, i) => (
        <button
          key={i}
          type="button"
          title={`${s.file}${s.section ? ` — ${s.section}` : ''}`}
          className="rounded bg-muted-foreground/10 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
        >
          {s.file} ({s.score.toFixed(2)})
        </button>
      ))}
    </div>
  )
}

export function ProjectChat() {
  const { project } = useProjectContext()
  const storageKey = `${STORAGE_PREFIX}${project.id}`

  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeId, setActiveId] = useState('')
  const [input, setInput] = useState('')
  const [useRag, setUseRag] = useState(true)
  const [images, setImages] = useState<string[]>([])
  const [attachments, setAttachments] = useState<{ name: string; text: string }[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [streamSources, setStreamSources] = useState<ChatSource[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed.sessions)) {
          setSessions(parsed.sessions)
          if (typeof parsed.activeId === 'string') setActiveId(parsed.activeId)
        }
      }
    } catch {
      /* corrupt storage — start fresh */
    }
  }, [storageKey])

  useEffect(() => {
    if (sessions.length === 0) {
      const s = newSession()
      setSessions([s])
      setActiveId(s.id)
    } else if (!sessions.some((s) => s.id === activeId)) {
      setActiveId(sessions[0].id)
    }
  }, [sessions, activeId])

  useEffect(() => {
    if (sessions.length) {
      localStorage.setItem(storageKey, JSON.stringify({ sessions, activeId }))
    }
  }, [sessions, activeId, storageKey])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [streamText, streaming, sessions])

  const activeSession = sessions.find((s) => s.id === activeId)

  function finalize(keepAssistant: boolean) {
    if (keepAssistant) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeId
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  {
                    role: 'assistant' as const,
                    content: streamText,
                    sources: streamSources.length ? streamSources : undefined,
                  },
                ],
              }
            : s,
        ),
      )
    }
    setStreaming(false)
    setStreamText('')
    setStreamSources([])
    abortRef.current = null
  }

  function send(textOverride?: string) {
    if (streaming) return
    const text = (textOverride ?? input).trim()
    if (!text && images.length === 0 && attachments.length === 0) return

    const userMsg: StoredMsg = {
      role: 'user',
      content: text,
      useRag,
      images: images.length ? images : undefined,
      attachments: attachments.length ? attachments : undefined,
    }

    const updated = sessions.map((s) =>
      s.id === activeId ? { ...s, messages: [...s.messages, userMsg] } : s,
    )
    let active = updated.find((s) => s.id === activeId)
    if (!active) {
      active = newSession()
      updated.push(active)
      setActiveId(active.id)
    }
    setSessions(updated)
    setInput('')
    setImages([])
    setAttachments([])

    if (textOverride && active.messages.length === 1) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === active.id
            ? { ...s, title: textOverride.slice(0, 40) || s.title }
            : s,
        ),
      )
    }

    const chatMessages: ChatMessage[] = active.messages
      .slice(-MAX_SENT_MESSAGES)
      .map((m) => ({ role: m.role, content: buildChatContent(m) }))

    const controller = new AbortController()
    abortRef.current = controller
    setStreaming(true)
    setStreamText('')
    setStreamSources([])

    streamProjectChat(
      project.id,
      { messages: chatMessages, useRag },
      {
        onToken: (t) => setStreamText((prev) => prev + t),
        onSources: (src) => setStreamSources(src),
        onError: (msg) => {
          toast.error(msg)
          finalize(false)
        },
        onDone: () => finalize(true),
      },
      controller.signal,
    ).catch((err) => {
      if (!controller.signal.aborted) {
        toast.error(err instanceof Error ? err.message : String(err))
        finalize(false)
      }
    })
  }

  function stop() {
    abortRef.current?.abort()
    setStreaming(false)
    setStreamText('')
    setStreamSources([])
    abortRef.current = null
  }

  function activate(id: string) {
    if (id === activeId) return
    stop()
    setActiveId(id)
    setInput('')
    setImages([])
    setAttachments([])
    setEditingId(null)
  }

  function createSession() {
    const s = newSession()
    setSessions((prev) => [...prev, s])
    setActiveId(s.id)
    setImages([])
    setAttachments([])
  }

  function deleteSession(id: string) {
    const target = sessions.find((s) => s.id === id)
    if (!window.confirm(`Delete "${target?.title ?? 'chat'}"?`)) return
    const remaining = sessions.filter((s) => s.id !== id)
    setSessions(remaining)
    if (activeId === id) setActiveId(remaining[0]?.id ?? '')
  }

  function saveRename() {
    if (!editingId) return
    const inputEl = document.getElementById(`rename-${editingId}`) as HTMLInputElement | null
    const title = inputEl?.value.trim() || 'New chat'
    setSessions((prev) => prev.map((s) => (s.id === editingId ? { ...s, title } : s)))
    setEditingId(null)
  }

  function handleFiles(files: FileList | null | File[]) {
    if (!files) return
    Array.from(files).forEach((file) => {
      if (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp') {
        const reader = new FileReader()
        reader.onload = () => setImages((prev) => [...prev, String(reader.result)])
        reader.readAsDataURL(file)
      } else if (isTextLike(file)) {
        const reader = new FileReader()
        reader.onload = () =>
          setAttachments((prev) => [...prev, { name: file.name, text: String(reader.result) }])
        reader.readAsText(file)
      }
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function renderUserExtras(msg: StoredMsg): ReactNode {
    const imgs = msg.images ?? []
    const atts = msg.attachments ?? []
    if (imgs.length === 0 && atts.length === 0) return null
    return (
      <>
        {imgs.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {imgs.map((img, i) => (
              <img
                key={i}
                src={img}
                alt="attachment"
                className="w-40 rounded border object-cover"
              />
            ))}
          </div>
        )}
        {atts.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {atts.map((a, i) => (
              <span
                key={i}
                className="flex items-center gap-1 rounded bg-brand-foreground/10 px-1.5 py-0.5 text-[10px]"
              >
                <Paperclip className="size-3" />
                {a.name}
              </span>
            ))}
          </div>
        )}
      </>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-[28rem] overflow-hidden rounded-lg border">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r">
        <div className="border-b p-2">
          <Button variant="outline" size="sm" className="w-full" onClick={createSession}>
            <Plus className="size-3.5" />
            New session
          </Button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => activate(s.id)}
              className={cn(
                'group flex cursor-pointer items-center gap-1 rounded px-2 py-1.5 text-sm',
                s.id === activeId ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              {editingId === s.id ? (
                <input
                  id={`rename-${s.id}`}
                  defaultValue={s.title}
                  autoFocus
                  onBlur={saveRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
              )}
              <button
                type="button"
                title="Rename"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingId(s.id)
                }}
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation()
                  deleteSession(s.id)
                }}
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Main panel */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto p-4">
          {activeSession && activeSession.messages.length === 0 && !streaming && (
            <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-3">
              <h2 className="text-lg font-medium">Ask about {project.name}</h2>
              {STARTERS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => send(prompt)}
                  className="rounded-lg border border-border p-3 text-left text-sm text-muted-foreground transition-colors hover:border-brand hover:text-foreground"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {activeSession && activeSession.messages.length > 0 && (
            <div className="mx-auto flex max-w-3xl flex-col gap-3">
              {activeSession.messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[80%] rounded-lg px-3 py-2',
                      msg.role === 'user'
                        ? 'bg-brand text-brand-foreground'
                        : 'bg-muted text-foreground',
                    )}
                  >
                    {msg.role === 'user' && renderUserExtras(msg)}
                    {msg.role === 'assistant' ? (
                      <FormattedChatMessage text={msg.content} />
                    ) : (
                      <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                    )}
                    {msg.sources && msg.sources.length > 0 && <SourcesList sources={msg.sources} />}
                  </div>
                </div>
              ))}

              {streaming && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2 text-foreground">
                    {streamText ? (
                      <>
                        <FormattedChatMessage text={streamText} />
                        <span className="animate-pulse text-brand">▍</span>
                      </>
                    ) : (
                      <ThinkingDots />
                    )}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {!activeSession && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a session or create a new one.
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="border-t p-3">
          {(images.length > 0 || attachments.length > 0) && (
            <div className="mb-2 flex flex-wrap gap-2">
              {images.map((img, i) => (
                <div key={i} className="relative">
                  <img src={img} alt="upload" className="h-16 w-24 rounded border object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-white"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              {attachments.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground"
                >
                  <Paperclip className="size-3" />
                  <span className="max-w-40 truncate">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            className="flex items-center gap-2 rounded-lg border border-input p-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              handleFiles(e.dataTransfer.files)
            }}
          >
            <label className="cursor-pointer text-muted-foreground hover:text-foreground">
              <Paperclip className="size-4" />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => handleFiles(e.target.files)}
              />
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={1}
              placeholder="Ask about this project... (Enter to send, Shift+Enter for newline)"
              className="max-h-40 min-h-6 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {streaming ? (
              <Button variant="ghost" size="icon" onClick={stop} title="Stop">
                <Square className="size-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={() => send()}
                disabled={!input.trim() && images.length === 0}
                title="Send"
              >
                <Send className="size-4" />
              </Button>
            )}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUseRag((v) => !v)}
              className={cn(
                'relative h-5 w-9 rounded-full transition-colors',
                useRag ? 'bg-brand' : 'bg-muted',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 size-4 rounded-full bg-white transition-transform',
                  useRag ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
            <span className="text-xs text-muted-foreground">Use RAG</span>
          </div>
        </div>
      </div>
    </div>
  )
}