import { useMemo, useState } from 'react'
import { FilesIcon, SearchIcon, TriangleAlert } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
        <TabsTrigger value="indexed">Indexed ({documents.length})</TabsTrigger>
        <TabsTrigger value="upload">Upload ({uploads.length})</TabsTrigger>
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
          <div className="inline-flex items-center rounded-lg border p-0.5">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setSource(filter.value)}
                className={
                  source === filter.value
                    ? 'rounded-md bg-muted px-2.5 py-1 text-sm font-medium'
                    : 'rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground'
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
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>File</TableHead>
                  <TableHead className="w-48">Title</TableHead>
                  <TableHead className="w-20">Type</TableHead>
                  <TableHead className="w-28">Source</TableHead>
                  <TableHead className="w-20 text-right">Chunks</TableHead>
                  <TableHead className="w-32">Staleness</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((doc) => (
                  <TableRow key={doc.file}>
                    <TableCell className="font-mono text-xs">{doc.file}</TableCell>
                    <TableCell className="truncate text-muted-foreground">{doc.title || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{doc.documentType}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {doc.source === 'upload' ? 'uploaded' : 'repository'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{doc.chunkCount}</TableCell>
                    <TableCell>
                      {doc.stale ? (
                        <span
                          title={`The repo has moved ${doc.commitsBehind} commits since this file was last indexed — it may be out of date`}
                          className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                        >
                          <TriangleAlert className="size-3" />
                          {doc.commitsBehind} behind
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="upload">
        <UploadPanel projectId={project.id} uploads={uploads} onChanged={refresh} />
      </TabsContent>
    </Tabs>
  )
}
