import { useState, type FormEvent } from 'react'
import { FileTextIcon, SearchIcon, SparklesIcon, UploadIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/empty-state'
import { searchProject, type SearchResult } from '@/lib/api-client'
import { cn } from '@/lib/utils'

/** Turns a 0..1 cosine score into the colour the score chip uses. */
function scoreTone(score: number): string {
  if (score >= 0.75) return 'bg-success/12 text-success'
  if (score >= 0.5) return 'bg-warning/12 text-warning'
  return 'bg-muted text-muted-foreground'
}

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
        <Button type="submit" disabled={loading} className="gap-1.5">
          <SparklesIcon className={cn('size-4', loading && 'animate-pulse')} />
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

      <div className="stagger flex flex-col gap-3">
        {results.map((result, i) => (
          <div
            key={`${result.file}-${i}`}
            style={{ '--stagger-index': i } as React.CSSProperties}
            className="surface-glow rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-shadow hover:shadow-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {result.file.startsWith('uploads/') ? (
                  <UploadIcon className="size-4 shrink-0 text-brand" />
                ) : (
                  <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate font-mono text-xs">{result.file}</span>
                {result.section && <Badge variant="outline">{result.section}</Badge>}
              </div>
              <span className={cn('rounded-md px-2 py-0.5 font-mono text-xs tabular-nums', scoreTone(result.score))}>
                {result.score.toFixed(4)}
              </span>
            </div>
            <p className="mt-2 line-clamp-6 text-sm whitespace-pre-wrap text-muted-foreground">{result.content}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
