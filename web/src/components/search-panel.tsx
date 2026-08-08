import { useState, type FormEvent } from 'react'
import { SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/empty-state'
import { searchProject, type SearchResult } from '@/lib/api-client'

export function SearchPanel({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    try {
      const { results } = await searchProject(projectId, query)
      setResults(results)
      setSearched(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ask the same way an agent would — e.g. how does auto-sync work?"
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {searched && !error && results.length === 0 && (
        <EmptyState
          icon={SearchIcon}
          title="No results"
          description="Nothing matched that query. Try different wording, or run a sync if the docs changed recently."
        />
      )}

      {results.length > 0 && (
        <ol className="flex flex-col divide-y rounded-lg border">
          {results.map((result, i) => (
            <li key={`${result.file}-${i}`} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <span className="truncate font-mono text-xs">{result.file}</span>
                  {result.section && (
                    <span className="truncate text-xs text-muted-foreground">— {result.section}</span>
                  )}
                </div>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {result.score.toFixed(4)}
                </span>
              </div>
              <p className="mt-2 line-clamp-6 text-sm whitespace-pre-wrap text-muted-foreground">{result.content}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
