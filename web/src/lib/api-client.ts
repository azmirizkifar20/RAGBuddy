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

export interface UploadStreamHandlers {
  onLog: (message: string) => void
  /** Structured tick during the embedding stage — the only stage worth a real percentage. */
  onProgress: (done: number, total: number) => void
  onDone: (result: UploadResult) => void
  onError: (message: string) => void
}

/**
 * Everything is sent base64-encoded so PDF/Word/Excel travel byte-for-byte over the same JSON
 * endpoint plain text uses — no multipart handling needed. SSE (`event: log`/`done`/`error`,
 * same wire format as ingest/sync) so a slow extract → chunk → embed pipeline can report its
 * progress instead of leaving the UI blank until the whole thing finishes.
 */
export async function streamUploadDocument(
  id: string,
  filename: string,
  data: string,
  handlers: UploadStreamHandlers,
): Promise<void> {
  const res = await fetch(`/api/projects/${id}/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, data }),
  })
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
      else if (event === 'progress') handlers.onProgress(data.done, data.total)
      else if (event === 'done') handlers.onDone(data)
      else if (event === 'error') handlers.onError(data.message)
    }
  }
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

export type CredentialProvider = 'ollama' | 'openai'

export interface Credential {
  id: string
  name: string
  provider: CredentialProvider
  baseUrl: string
  apiKeyConfigured: boolean
  models: string[]
}

export interface CredentialsList {
  credentials: Credential[]
  activeCredentialId: string | null
  activeModel: string | null
}

export interface CredentialInput {
  name: string
  provider: CredentialProvider
  baseUrl: string
  /** Blank/omitted on update keeps whatever key is already saved — write-only in the UI. */
  apiKey?: string
  models: string[]
}

export interface ConnectionTestInput {
  /** Test an already-saved credential's key without retyping it. */
  id?: string
  provider: CredentialProvider
  baseUrl: string
  model: string
  apiKey?: string
}

export type ConnectionTestResult = { ok: true; latencyMs: number } | { ok: false; error: string }

/** Both embedding and chat credentials use the same shape — `kind` picks which list. */
function credentialsBasePath(kind: 'embedding' | 'chat'): string {
  return `/api/settings/${kind}`
}

export function getCredentials(kind: 'embedding' | 'chat'): Promise<CredentialsList> {
  return fetch(credentialsBasePath(kind)).then(parseJsonResponse<CredentialsList>)
}

export function addCredential(kind: 'embedding' | 'chat', input: CredentialInput): Promise<Credential> {
  return fetch(credentialsBasePath(kind), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then(parseJsonResponse<Credential>)
}

export function updateCredential(kind: 'embedding' | 'chat', id: string, input: Partial<CredentialInput>): Promise<Credential> {
  return fetch(`${credentialsBasePath(kind)}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then(parseJsonResponse<Credential>)
}

export function removeCredential(kind: 'embedding' | 'chat', id: string): Promise<void> {
  return fetch(`${credentialsBasePath(kind)}/${id}`, { method: 'DELETE' }).then(expectNoContent)
}

export function activateCredential(kind: 'embedding' | 'chat', id: string, model: string): Promise<CredentialsList> {
  return fetch(`${credentialsBasePath(kind)}/${id}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  }).then(parseJsonResponse<CredentialsList>)
}

export function testCredentialConnection(kind: 'embedding' | 'chat', input: ConnectionTestInput): Promise<ConnectionTestResult> {
  return fetch(`${credentialsBasePath(kind)}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then(parseJsonResponse<ConnectionTestResult>)
}

export interface QdrantCollectionInfo {
  collection: string
  exists: boolean
  vectorSize?: number
  pointsCount?: number
  /** Every registered project — the collection is shared, not per-project. */
  affectedProjectIds: string[]
}

export function getQdrantInfo(): Promise<QdrantCollectionInfo> {
  return fetch('/api/settings/qdrant').then(parseJsonResponse<QdrantCollectionInfo>)
}

/** Destructive across every registered project — the collection is shared. */
export function dropQdrantCollection(): Promise<{ dropped: boolean; affectedProjectIds: string[] }> {
  return fetch('/api/settings/qdrant/drop-collection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  }).then(parseJsonResponse<{ dropped: boolean; affectedProjectIds: string[] }>)
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
  /** `ragError` is set only when retrieval itself threw — never for "found nothing relevant". */
  onSources: (sources: ChatSource[], ragError?: string) => void
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
        else if (event === 'sources') handlers.onSources(data.sources, data.ragError)
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

/** Best-effort — callers should swallow failures and keep the placeholder title. */
export function generateChatTitle(projectId: string, userMessage: string, assistantMessage: string): Promise<{ title: string }> {
  return fetch(`/api/projects/${projectId}/chat/title`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userMessage, assistantMessage }),
  }).then(parseJsonResponse<{ title: string }>)
}
