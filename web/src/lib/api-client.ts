export interface Project {
  id: string
  name: string
  repository: string
  paths: string[]
  indexedFileCount: number
  hookInstalled: boolean
}

export interface SearchResult {
  file: string
  section: string
  score: number
  content: string
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? res.statusText)
  }
  return res.json() as Promise<T>
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

export async function removeProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
  if (!res.ok) await parseJsonResponse(res)
}

export function getKnowledge(id: string): Promise<{ files: string[] }> {
  return fetch(`/api/projects/${id}/knowledge`).then(parseJsonResponse<{ files: string[] }>)
}

export function searchProject(id: string, query: string): Promise<{ results: SearchResult[] }> {
  return fetch(`/api/projects/${id}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  }).then(parseJsonResponse<{ results: SearchResult[] }>)
}

export async function installHook(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}/hook`, { method: 'POST' })
  if (!res.ok) await parseJsonResponse(res)
}

export async function uninstallHook(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}/hook`, { method: 'DELETE' })
  if (!res.ok) await parseJsonResponse(res)
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
