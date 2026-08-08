import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
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
    <div className="flex flex-col gap-3">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search this project's docs..."
        />
        <Button type="submit" disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {searched && !error && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No results found.</p>
      )}
      {results.length > 0 && (
        <ScrollArea className="h-64 rounded-lg border">
          <div className="flex flex-col divide-y">
            {results.map((result, i) => (
              <div key={`${result.file}-${i}`} className="p-3">
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>
                    {result.file} — {result.section}
                  </span>
                  <span className="text-muted-foreground">{result.score.toFixed(4)}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{result.content}</p>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
