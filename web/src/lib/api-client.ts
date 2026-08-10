export interface Project {
  id: string
  name: string
  repository: string
  paths: string[]
  indexedFileCount: number
  chunkCount: number
  uploadCount: number
  hookInstalled: boolean
  lastRunAt: string | null
}

export interface SearchResult {
  file: string
  section: string
  score: number
  content: string
}

export type DocumentSource = 'repository' | 'upload'

export interface IndexedDocument {
  file: string
  source: DocumentSource
  documentType: string
  chunkCount: number
  title: string
}

export interface KnowledgeResponse {
  files: string[]
  documents: IndexedDocument[]
  chunkCount: number
}

export type UploadDocumentType = 'markdown' | 'text' | 'csv' | 'pdf' | 'docx' | 'xlsx'

export interface UploadedDocument {
  file: string
  name: string
  sizeBytes: number
  uploadedAt: string
  documentType: UploadDocumentType
}

export type RunKind = 'ingest' | 'sync' | 'upload' | 'upload-remove'
export type RunTrigger = 'cli' | 'web' | 'hook'

export interface RunRecord {
  id: string
  project: string
  kind: RunKind
  status: 'success' | 'error'
  trigger: RunTrigger
  startedAt: string
  durationMs: number
  summary: Record<string, number | string | boolean>
  error?: string
}

export interface RuntimeConfig {
  qdrantUrl: string
  qdrantCollection: string
  ragTopK: number
  dataDir: string
  nodePath: string
  cliEntrypoint: string
  embeddingProvider: string
  embeddingModel: string
  embeddingBaseUrl: string
  embeddingApiKeyConfigured: boolean
  projectRegistryPath: string
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

async function expectNoContent(res: Response): Promise<void> {
  if (!res.ok) await parseJsonResponse(res)
}

export function listProjects(): Promise<Project[]> {
  return fetch('/api/projects').then(parseJsonResponse<Project[]>)
}

export function getProject(id: string): Promise<Project> {
  return fetch(`/api/projects/${id}`).then(parseJsonResponse<Project>)
}

export interface RegisterProjectInput {
  id: string
  repository: string
  name?: string
  paths?: string[]
}

export function registerProject(input: RegisterProjectInput): Promise<Project> {
  return fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then(parseJsonResponse<Project>)
}

export function removeProject(id: string): Promise<void> {
  return fetch(`/api/projects/${id}`, { method: 'DELETE' }).then(expectNoContent)
}

export function getKnowledge(id: string): Promise<KnowledgeResponse> {
  return fetch(`/api/projects/${id}/knowledge`).then(parseJsonResponse<KnowledgeResponse>)
}

export function searchProject(id: string, query: string): Promise<{ results: SearchResult[] }> {
  return fetch(`/api/projects/${id}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  }).then(parseJsonResponse<{ results: SearchResult[] }>)
}

export function installHook(id: string): Promise<void> {
  return fetch(`/api/projects/${id}/hook`, { method: 'POST' }).then(expectNoContent)
}

export function uninstallHook(id: string): Promise<void> {
  return fetch(`/api/projects/${id}/hook`, { method: 'DELETE' }).then(expectNoContent)
}

export function listUploads(id: string): Promise<{ uploads: UploadedDocument[] }> {
  return fetch(`/api/projects/${id}/uploads`).then(parseJsonResponse<{ uploads: UploadedDocument[] }>)
}

export interface UploadResult {
  file: string
  name: string
  chunksIndexed: number
  replaced: boolean
  documentType: UploadDocumentType
  truncated: boolean
}

/**
 * Everything is sent base64-encoded so PDF/Word/Excel travel byte-for-byte
 * over the same JSON endpoint plain text uses — no multipart handling needed.
 */
export function uploadDocument(id: string, filename: string, data: string): Promise<UploadResult> {
  return fetch(`/api/projects/${id}/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, data }),
  }).then(parseJsonResponse<UploadResult>)
}

export function removeUpload(id: string, filename: string): Promise<void> {
  return fetch(`/api/projects/${id}/uploads/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  }).then(expectNoContent)
}

export function getHistory(id: string, limit = 50): Promise<{ runs: RunRecord[] }> {
  return fetch(`/api/projects/${id}/history?limit=${limit}`).then(parseJsonResponse<{ runs: RunRecord[] }>)
}

export function getActivity(limit = 20): Promise<{ runs: RunRecord[] }> {
  return fetch(`/api/activity?limit=${limit}`).then(parseJsonResponse<{ runs: RunRecord[] }>)
}

export function getRuntimeConfig(): Promise<RuntimeConfig> {
  return fetch('/api/config').then(parseJsonResponse<RuntimeConfig>)
}

export type ChatProvider = 'ollama' | 'openai'

export interface ChatSettings {
  provider: ChatProvider
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
}

export interface ChatSettingsUpdate {
  provider: ChatProvider
  baseUrl: string
  model: string
  /** Blank/omitted keeps whatever key is already saved — this field is write-only. */
  apiKey?: string
}

export type ChatConnectionTestResult = { ok: true; latencyMs: number } | { ok: false; error: string }

export function getChatSettings(): Promise<ChatSettings> {
  return fetch('/api/settings/chat').then(parseJsonResponse<ChatSettings>)
}

export function updateChatSettings(update: ChatSettingsUpdate): Promise<ChatSettings> {
  return fetch('/api/settings/chat', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  }).then(parseJsonResponse<ChatSettings>)
}

export function testChatConnection(update: ChatSettingsUpdate): Promise<ChatConnectionTestResult> {
  return fetch('/api/settings/chat/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  }).then(parseJsonResponse<ChatConnectionTestResult>)
}

export interface FsEntry {
  name: string
  path: string
  isGitRepo: boolean
}

export interface FsListResult {
  path: string
  parent: string | null
  isGitRepo: boolean
  entries: FsEntry[]
}

export function listFsRoots(): Promise<{ roots: string[]; home: string }> {
  return fetch('/api/fs/roots').then(parseJsonResponse<{ roots: string[]; home: string }>)
}

export function listFsDir(dirPath: string): Promise<FsListResult> {
  return fetch(`/api/fs/list?path=${encodeURIComponent(dirPath)}`).then(parseJsonResponse<FsListResult>)
}

export interface StreamHandlers {
  onLog: (message: string) => void
  onDone: (result: unknown) => void
  onError: (message: string) => void
}

/**
 * The ingest/sync endpoints are SSE streams triggered by POST, so the native
 * `EventSource` (GET-only, no body) can't consume them — this parses the
 * `event:`/`data:` wire format directly off a streamed `fetch` response body.
 */
async function streamRun(path: string, handlers: StreamHandlers): Promise<void> {
  const res = await fetch(path, { method: 'POST' })
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    handlers.onError(body.error ?? res.statusText)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const lines = frame.split('\n')
      const eventLine = lines.find((line) => line.startsWith('event: '))
      const dataLine = lines.find((line) => line.startsWith('data: '))
      if (!eventLine || !dataLine) continue

      const event = eventLine.slice('event: '.length)
      const data = JSON.parse(dataLine.slice('data: '.length))

      if (event === 'log') handlers.onLog(data)
      else if (event === 'done') handlers.onDone(data)
      else if (event === 'error') handlers.onError(data.message)
    }
  }
}

export function ingestProject(id: string, handlers: StreamHandlers): Promise<void> {
  return streamRun(`/api/projects/${id}/ingest`, handlers)
}

export function syncProject(id: string, handlers: StreamHandlers): Promise<void> {
  return streamRun(`/api/projects/${id}/sync`, handlers)
}

export type ChatRole = 'user' | 'assistant'

export interface ChatContentImage {
  type: 'image_url'
  image_url: { url: string }
}

export interface ChatContentText {
  type: 'text'
  text: string
}

export type ChatContentPart = ChatContentText | ChatContentImage

export interface ChatMessage {
  role: ChatRole
  content: string | ChatContentPart[]
}

export interface ChatSource {
  file: string
  section: string
  score: number
}

export interface ChatStreamHandlers {
  onToken: (text: string) => void
  onSources: (sources: ChatSource[]) => void
  onError: (message: string) => void
  onDone: () => void
}

/**
 * SSE chat stream. Follows the same `event:`/`data:` wire format as streamRun,
 * but sends a JSON body and accepts an AbortSignal so the UI can stop mid-stream.
 * On abort it resolves cleanly instead of throwing.
 */
export async function streamProjectChat(
  id: string,
  body: { messages: ChatMessage[]; useRag: boolean },
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const res = await fetch(`/api/projects/${id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok || !res.body) {
      const parsed = await res.json().catch(() => ({ error: res.statusText }))
      handlers.onError(parsed.error ?? res.statusText)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const lines = frame.split('\n')
        const eventLine = lines.find((line) => line.startsWith('event: '))
        const dataLine = lines.find((line) => line.startsWith('data: '))
        if (!eventLine || !dataLine) continue

        const event = eventLine.slice('event: '.length)
        const data = JSON.parse(dataLine.slice('data: '.length))

        if (event === 'token') handlers.onToken(data.text)
        else if (event === 'sources') handlers.onSources(data.sources)
        else if (event === 'error') handlers.onError(data.message)
        else if (event === 'done') handlers.onDone()
      }
    }
  } catch (err) {
    // Abort is a clean stop, not an error.
    if (signal?.aborted) return
    throw err
  }
}
