import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import {
  ArrowUp,
  ChevronLeft,
  FileText,
  MessageSquareIcon,
  Paperclip,
  Pencil,
  Plus,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { FormattedChatMessage } from '@/components/formatted-chat-message'
import {
  getProject,
  streamProjectChat,
  generateChatTitle,
  type ChatContentPart,
  type ChatMessage,
  type ChatSource,
  type Project,
} from '@/lib/api-client'
import { useProjects } from '@/lib/projects-context'
import { cn } from '@/lib/utils'

interface StoredMsg {
  role: 'user' | 'assistant'
  content: string
  useRag?: boolean
  sources?: ChatSource[]
  /** Set only when RAG retrieval itself failed (not just "found nothing relevant") — shown as a visible notice. */
  ragError?: string
  images?: string[]
  attachments?: { name: string; text: string }[]
  error?: boolean
}

interface ChatSession {
  id: string
  title: string
  createdAt: number
  /** Bumped whenever a message is appended — drives the sidebar's most-recent-first sort. Older sessions predate this field, so callers fall back to createdAt. */
  updatedAt?: number
  messages: StoredMsg[]
}

const STORAGE_PREFIX = 'project-rag:chats:'
const MAX_SENT_MESSAGES = 30

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function loadSessions(key: string): ChatSession[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    // Older builds stored { sessions: [...], activeId } under this key; new
    // builds store the array directly. Accept both so a refresh never crashes.
    if (Array.isArray(parsed)) return parsed as ChatSession[]
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { sessions?: unknown }).sessions)) {
      return (parsed as { sessions: ChatSession[] }).sessions
    }
    return []
  } catch {
    return []
  }
}

/** Only counts sessions that actually have a message — a freshly auto-created
 * empty session shouldn't read as "1 saved chat" on the picker screen. */
function sessionCountLabel(projectId: string): string {
  const count = loadSessions(`${STORAGE_PREFIX}${projectId}`).filter((s) => s.messages.length > 0).length
  if (count === 0) return 'No chats yet'
  return `${count} saved chat${count === 1 ? '' : 's'}`
}

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
  const now = Date.now()
  return { id: genId(), title: 'New chat', createdAt: now, updatedAt: now, messages: [] }
}

function dayLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

interface SessionGroup {
  label: string
  sessions: ChatSession[]
}

/** `sorted` must already be most-recent-first — consecutive same-day entries fold into one group without a map. */
function groupSessionsByDay(sorted: ChatSession[]): SessionGroup[] {
  const groups: SessionGroup[] = []
  for (const s of sorted) {
    const label = dayLabel(s.updatedAt ?? s.createdAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) {
      last.sessions.push(s)
    } else {
      groups.push({ label, sessions: [s] })
    }
  }
  return groups
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

/** Kept to what both chat providers accept as inline image parts. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

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

interface GroupedSource {
  file: string
  sections: string[]
  maxScore: number
}

function groupSources(sources: ChatSource[]): GroupedSource[] {
  const byFile = new Map<string, GroupedSource>()
  for (const s of sources) {
    const existing = byFile.get(s.file)
    if (existing) {
      if (s.section && !existing.sections.includes(s.section)) existing.sections.push(s.section)
      existing.maxScore = Math.max(existing.maxScore, s.score)
    } else {
      byFile.set(s.file, {
        file: s.file,
        sections: s.section ? [s.section] : [],
        maxScore: s.score,
      })
    }
  }
  return [...byFile.values()]
}

function SourcesList({ sources }: { sources: ChatSource[] }) {
  const grouped = useMemo(() => groupSources(sources), [sources])
  if (grouped.length === 0) return null

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <FileText className="h-3.5 w-3.5" />
        Related Documents
        <span className="rounded-full bg-muted-foreground/10 px-1.5 py-px font-mono text-[10px] text-muted-foreground">
          {grouped.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {grouped.map((g) => (
          <li
            key={g.file}
            title={g.sections.length ? g.sections.join(' — ') : g.file}
            className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 transition-colors hover:border-border hover:bg-muted/50"
          >
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-[11px] text-foreground/90">{g.file}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {Math.round(g.maxScore * 100)}% match
                </span>
              </div>
              {g.sections.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {g.sections.map((sec) => (
                    <span
                      key={sec}
                      className="rounded bg-muted-foreground/10 px-1.5 py-px text-[10px] text-muted-foreground"
                    >
                      {sec}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ProjectPickerCard({ project }: { project: Project }) {
  return (
    <Link
      to={`/chat/${project.id}`}
      className="flex flex-col gap-1.5 rounded-lg border p-4 transition-colors hover:border-foreground/25"
    >
      <p className="truncate font-medium">{project.name}</p>
      <p className="truncate font-mono text-xs text-muted-foreground" title={project.repository}>
        {project.repository}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{sessionCountLabel(project.id)}</p>
    </Link>
  )
}

function ChatPicker() {
  const { projects, loading } = useProjects()

  return (
    // The chat route is full-bleed at the shell level, so the picker restores
    // the standard centred page column for itself.
    <div className="animate-fade-up mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-2 py-10 text-center">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Chat with a project</h1>
        <p className="text-sm text-muted-foreground">
          Pick a project to start a new chat, or continue one you already have saved.
        </p>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={MessageSquareIcon}
          title="No projects registered yet"
          description="Register a project first, then come back here to start chatting with its indexed docs."
          action={
            <Link to="/projects">
              <Button size="sm">Go to Projects</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectPickerCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  )
}

function ChatWithProject({ project }: { project: Project }) {
  const storageKey = `${STORAGE_PREFIX}${project.id}`

  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions(storageKey))
  const [activeId, setActiveId] = useState(() => loadFromStorage<string>(`${storageKey}:active`, ''))
  const [input, setInput] = useState('')
  const [useRag, setUseRag] = useState(true)
  const [images, setImages] = useState<string[]>([])
  const [attachments, setAttachments] = useState<{ name: string; text: string }[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Mirror of streamText for callbacks (onDone/onError) that run against a
  // stale closure captured at send() time; avoids saving an empty assistant reply.
  const streamTextRef = useRef('')
  const streamSourcesRef = useRef<ChatSource[]>([])
  const streamRagErrorRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (sessions.length > 0) {
      if (!sessions.some((s) => s.id === activeId)) setActiveId(sessions[0].id)
    } else {
      const s = newSession()
      setSessions([s])
      setActiveId(s.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (sessions.length) {
      localStorage.setItem(storageKey, JSON.stringify(sessions))
      localStorage.setItem(`${storageKey}:active`, activeId)
    }
  }, [sessions, activeId, storageKey])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [streamText, streaming, sessions])

  const activeSession = sessions.find((s) => s.id === activeId)
  // Most-recent-activity-first, grouped by calendar day; `sessions` itself
  // stays in insertion order so nothing else that iterates it needs to change.
  const sessionGroups = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
    return groupSessionsByDay(sorted)
  }, [sessions])

  function finalize(errMsg?: string) {
    // Read refs into locals BEFORE the setSessions updater runs (React defers
    // updater execution until render, by which point the refs are reset below).
    const text = streamTextRef.current
    const sources = streamSourcesRef.current
    const ragError = streamRagErrorRef.current
    if (errMsg) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeId
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  { role: 'assistant' as const, content: errMsg, error: true },
                ],
                updatedAt: Date.now(),
              }
            : s,
        ),
      )
    } else if (text) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeId
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  {
                    role: 'assistant' as const,
                    content: text,
                    sources: sources.length ? sources : undefined,
                    ragError,
                  },
                ],
                updatedAt: Date.now(),
              }
            : s,
        ),
      )
    }
    setStreaming(false)
    setStreamText('')
    streamTextRef.current = ''
    streamSourcesRef.current = []
    streamRagErrorRef.current = undefined
    abortRef.current = null
  }

  // Best-effort: replaces the "New chat"/starter-text placeholder with an LLM-
  // generated title once the first exchange finishes. Never blocks the UI, and
  // never overwrites a title the user has since renamed by hand.
  async function maybeGenerateTitle(sessionId: string, userText: string, assistantText: string) {
    try {
      const { title } = await generateChatTitle(project.id, userText, assistantText)
      if (!title) return
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId && (s.title === 'New chat' || s.title === userText.slice(0, 40)) ? { ...s, title } : s)),
      )
    } catch {
      // keep the placeholder title
    }
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
      s.id === activeId ? { ...s, messages: [...s.messages, userMsg], updatedAt: Date.now() } : s,
    )
    let active = updated.find((s) => s.id === activeId)
    if (!active) {
      active = newSession()
      updated.push(active)
      setActiveId(active.id)
    }
    const isFirstExchange = active.messages.length === 1
    const activeSessionId = active.id

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
    streamTextRef.current = ''
    streamSourcesRef.current = []
    streamRagErrorRef.current = undefined

    streamProjectChat(
      project.id,
      { messages: chatMessages, useRag },
      {
        onToken: (t) => {
          streamTextRef.current += t
          setStreamText((prev) => prev + t)
        },
        onSources: (src, ragError) => {
          streamSourcesRef.current = src
          streamRagErrorRef.current = ragError
        },
        onError: (msg) => {
          finalize(msg)
        },
        onDone: () => {
          const assistantText = streamTextRef.current
          finalize()
          if (isFirstExchange && assistantText.trim()) {
            void maybeGenerateTitle(activeSessionId, text, assistantText)
          }
        },
      },
      controller.signal,
    ).catch((err) => {
      if (!controller.signal.aborted) {
        finalize(err instanceof Error ? err.message : String(err))
      }
    })
  }

  function stop() {
    abortRef.current?.abort()
    setStreaming(false)
    setStreamText('')
    streamTextRef.current = ''
    streamSourcesRef.current = []
    streamRagErrorRef.current = undefined
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
    const skipped: string[] = []
    Array.from(files).forEach((file) => {
      if (IMAGE_TYPES.has(file.type)) {
        const reader = new FileReader()
        // Functional update: several readers finish in arbitrary order, and
        // reading `images` from this closure would drop all but the last file.
        reader.onload = () => setImages((prev) => [...prev, String(reader.result)])
        reader.readAsDataURL(file)
      } else if (isTextLike(file)) {
        const reader = new FileReader()
        reader.onload = () =>
          setAttachments((prev) => [...prev, { name: file.name, text: String(reader.result) }])
        reader.readAsText(file)
      } else {
        skipped.push(file.name)
      }
    })
    // Previously these vanished without a word, so a dropped .docx looked like
    // the drop itself had failed.
    if (skipped.length > 0) {
      toast.error(
        `Can't attach ${skipped.join(', ')} — images (PNG/JPEG/WebP) and text documents only.`,
      )
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /** Only react to real file drags — dragging selected text must not arm the drop zone. */
  function isFileDrag(event: DragEvent<HTMLElement>): boolean {
    return Array.from(event.dataTransfer.types).includes('Files')
  }

  function onDragEnter(event: DragEvent<HTMLElement>) {
    if (!isFileDrag(event)) return
    event.preventDefault()
    // dragenter/dragleave also fire when crossing child elements, so a plain
    // boolean would flicker off mid-drag; depth counting tracks the real exit.
    dragDepth.current += 1
    setDragging(true)
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    if (!isFileDrag(event)) return
    event.preventDefault() // without this the drop event never fires
    event.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave(event: DragEvent<HTMLElement>) {
    if (!isFileDrag(event)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    if (!isFileDrag(event)) return
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    handleFiles(event.dataTransfer.files)
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
    // Fills the height AppShell hands down (no viewport arithmetic here), so
    // each pane scrolls on its own and the page itself never does.
    <div className="flex h-full overflow-hidden">
      {/* Main panel */}
      {/* min-h-0 on every column flex child: without it they keep min-height:auto,
          refuse to shrink below their content, and the inner overflow-y-auto
          panes never scroll — the whole page grows instead.
          The drop zone is this whole column, not just the composer: a file
          dropped anywhere else would otherwise hit the browser's default and
          navigate away from the conversation. */}
      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-10 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand bg-background/85">
            <Paperclip className="size-5 text-brand" />
            <p className="text-sm font-medium">Drop files to attach</p>
            <p className="text-xs text-muted-foreground">
              Images (PNG/JPEG/WebP) and text documents — several at once is fine
            </p>
          </div>
        )}
        <div className="flex items-center gap-2 border-b px-4 py-3 sm:px-6 lg:px-10">
          <h2 className="min-w-0 truncate text-sm font-medium">
            {activeSession?.title ?? 'Chat'}
          </h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-10">
          {activeSession && activeSession.messages.length === 0 && !streaming && (
            <div className="mx-auto flex h-full max-w-5xl flex-col items-center justify-center gap-3">
              <h2 className="font-heading text-3xl font-semibold tracking-tight">
                Ask about {project.name}
              </h2>
              <p className="text-sm text-muted-foreground">
                Answers are grounded in this project&apos;s indexed documents. Start with one of these:
              </p>
              <div className="mt-4 grid w-full gap-3 sm:grid-cols-2">
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
            </div>
          )}

          {/* Only the user's own turns get a bubble. Assistant replies read as
              page content — they carry tables, code blocks and source lists that
              a constrained bubble would squeeze. */}
          {activeSession && activeSession.messages.length > 0 && (
            <div className="mx-auto flex max-w-5xl flex-col gap-6">
              {activeSession.messages.map((msg, i) => {
                if (msg.role === 'user') {
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl bg-brand px-4 py-2.5 text-brand-foreground">
                        {renderUserExtras(msg)}
                        <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                      </div>
                    </div>
                  )
                }
                if (msg.error) {
                  return (
                    <div
                      key={i}
                      className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive"
                    >
                      <p className="whitespace-pre-wrap text-sm">
                        <span className="font-medium">Error:</span> {msg.content}
                      </p>
                    </div>
                  )
                }
                return (
                  <div key={i} className="text-foreground">
                    <FormattedChatMessage text={msg.content} />
                    {msg.ragError && (
                      <div className="mt-2 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                        <p>
                          <span className="font-medium">RAG lookup failed</span> — answered without project context.{' '}
                          <span className="text-muted-foreground">{msg.ragError}</span>
                        </p>
                      </div>
                    )}
                    {msg.sources && msg.sources.length > 0 && <SourcesList sources={msg.sources} />}
                  </div>
                )
              })}

              {streaming && (
                <div className="text-foreground">
                  {streamText ? (
                    <>
                      <FormattedChatMessage text={streamText} />
                      <span className="animate-pulse text-brand">▍</span>
                    </>
                  ) : (
                    <ThinkingDots />
                  )}
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

        {/* Input area — centred on the same 3xl column as the message feed. */}
        <div className="border-t px-4 py-3 sm:px-6 lg:px-10">
          <div className="mx-auto w-full max-w-5xl">
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

          {/* No drop handlers here — the whole conversation column owns them,
              and a second handler would bubble and attach every file twice. */}
          <div className="rounded-2xl border border-input p-3 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={2}
              placeholder="Ask about this project… (Enter to send, Shift+Enter for newline)"
              className="max-h-48 w-full resize-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
            />

            <div className="mt-2 flex items-center justify-between gap-2">
              {/* Scope control sits where the reference puts its source picker:
                  bottom-left of the composer, beside the send actions. */}
              <Label
                htmlFor="use-rag-toggle"
                className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border px-2.5 py-1 text-xs text-muted-foreground"
              >
                <Switch
                  id="use-rag-toggle"
                  checked={useRag}
                  onCheckedChange={setUseRag}
                  aria-label="Use RAG"
                />
                Use RAG
              </Label>

              <div className="flex shrink-0 items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                  <Paperclip className="size-3.5" />
                  Attach
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => handleFiles(e.target.files)}
                  />
                </label>
                {streaming ? (
                  <Button variant="outline" size="sm" className="gap-1.5 rounded-full" onClick={stop}>
                    <Square className="size-3.5" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="gap-1.5 rounded-full"
                    onClick={() => send()}
                    disabled={!input.trim() && images.length === 0 && attachments.length === 0}
                  >
                    <ArrowUp className="size-3.5" />
                    Send
                  </Button>
                )}
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>

      {/* Session rail — kept to the right of the conversation so the app
          sidebar and this list don't stack into two competing left columns. */}
      <aside className="hidden w-64 shrink-0 flex-col border-l border-sidebar-border bg-sidebar md:flex">
        <div className="flex items-center gap-2 px-3 py-3">
          <Link
            to="/chat"
            title="All chats"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <p className="min-w-0 flex-1 truncate text-sm font-medium" title={project.repository}>
            {project.name}
          </p>
        </div>
        <div className="px-3 pb-3">
          <Button variant="outline" size="sm" className="w-full" onClick={createSession}>
            <Plus className="size-3.5" />
            New session
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {sessionGroups.map((group) => (
            <div key={group.label} className="mb-2">
              <p className="px-1 pb-1.5 pt-1 text-xs text-muted-foreground">{group.label}</p>
              <div className="space-y-1">
                {group.sessions.map((s) => (
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
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}

function ChatPanel({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getProject(projectId)
      .then((p) => {
        if (!cancelled) {
          setProject(p)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-4 p-4">
        <Skeleton className="h-8 w-48 shrink-0" />
        <Skeleton className="min-h-0 flex-1" />
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="m-4 rounded-lg border border-dashed px-6 py-12 text-center">
        <p className="font-medium">Could not load this project</p>
        <p className="mt-1 text-sm text-destructive">{error ?? 'Unknown error'}</p>
        <Link to="/chat" className="mt-4 inline-block text-sm text-brand hover:underline">
          ← All chats
        </Link>
      </div>
    )
  }

  return (
    <div className="animate-fade-up h-full">
      <ChatWithProject project={project} />
    </div>
  )
}

export function AiChat() {
  const { projectId } = useParams<{ projectId?: string }>()
  if (!projectId) return <ChatPicker />
  return <ChatPanel projectId={projectId} />
}
