const STORAGE_KEY = 'ragbuddy:api-key'

export function getStoredApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setStoredApiKey(key: string | null): void {
  if (key) localStorage.setItem(STORAGE_KEY, key)
  else localStorage.removeItem(STORAGE_KEY)
}

/** Once an API key is configured server-side, every `/api/*` request needs it — including the
 *  dashboard's own calls, since it's just another caller. Patching `fetch` once here means every
 *  existing `api-client.ts` call attaches the stored key automatically, with no per-call changes. */
export function installApiKeyHeader(): void {
  const originalFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const key = getStoredApiKey()
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
    if (key && url.startsWith('/api/')) {
      return originalFetch(input, { ...init, headers: { ...(init?.headers ?? {}), 'X-API-Key': key } })
    }
    return originalFetch(input, init)
  }
}
