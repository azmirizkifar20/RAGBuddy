import { useMemo, useState } from 'react'
import { FileTextIcon, FilesIcon, SearchIcon, UploadIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/empty-state'
import { UploadPanel } from '@/components/upload-panel'
import { useProjectContext } from '@/pages/project-layout'
import type { DocumentSource } from '@/lib/api-client'

const FILTERS: { value: DocumentSource | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'repository', label: 'Repository' },
  { value: 'upload', label: 'Uploaded' },
]

export function ProjectDocuments() {
  const { project, documents, uploads, refresh } = useProjectContext()
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<DocumentSource | 'all'>('all')

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return documents.filter(
      (doc) =>
        (source === 'all' || doc.source === source) &&
        (!needle || doc.file.toLowerCase().includes(needle) || doc.title.toLowerCase().includes(needle)),
    )
  }, [documents, query, source])

  return (
    <Tabs defaultValue="indexed">
      <TabsList>
        <TabsTrigger value="indexed">
          <FilesIcon /> Indexed ({documents.length})
        </TabsTrigger>
        <TabsTrigger value="upload">
          <UploadIcon /> Upload ({uploads.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="indexed" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by file name or title..."
              className="pl-9"
            />
          </div>
          <div className="inline-flex items-center gap-1 rounded-xl bg-muted/60 p-1">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setSource(filter.value)}
                className={
                  source === filter.value
                    ? 'rounded-lg bg-background px-3 py-1.5 text-sm font-medium shadow-sm transition-all'
                    : 'rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground'
                }
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={FilesIcon}
            title={documents.length === 0 ? 'Nothing indexed yet' : 'No documents match that filter'}
            description={
              documents.length === 0
                ? 'Run a full ingest from the Overview tab, or upload a document to get started.'
                : 'Try a different search term or switch the source filter.'
            }
          />
        ) : (
          <div className="stagger flex flex-col gap-1.5">
            {visible.map((doc, i) => (
              <div
                key={doc.file}
                style={{ '--stagger-index': Math.min(i, 12) } as React.CSSProperties}
                className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2.5 ring-1 ring-foreground/10 transition-all duration-200 hover:translate-x-0.5 hover:shadow-sm"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {doc.source === 'upload' ? (
                    <UploadIcon className="size-4 shrink-0 text-brand" />
                  ) : (
                    <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm">{doc.file}</p>
                    {doc.title && <p className="truncate text-xs text-muted-foreground">{doc.title}</p>}
                  </div>
                </div>
                <Badge variant="secondary" className="shrink-0 font-mono tabular-nums">
                  {doc.chunkCount} chunks
                </Badge>
              </div>
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="upload">
        <UploadPanel projectId={project.id} uploads={uploads} onChanged={refresh} />
      </TabsContent>
    </Tabs>
  )
}
