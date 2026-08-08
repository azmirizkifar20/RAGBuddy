import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowUpIcon, FolderIcon, FolderOpenIcon, GitBranchIcon, HardDriveIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { listFsDir, listFsRoots, type FsEntry } from '@/lib/api-client'
import { cn } from '@/lib/utils'

/** Splits an absolute path into clickable breadcrumb segments, on Windows or POSIX. */
function breadcrumbs(dirPath: string): { label: string; path: string }[] {
  const isWindowsDrive = /^[A-Za-z]:/.test(dirPath)
  const sep = dirPath.includes('\\') ? '\\' : '/'
  const parts = dirPath.split(/[/\\]+/).filter(Boolean)

  return parts.map((part, i) => {
    if (isWindowsDrive && i === 0) return { label: part, path: `${part}${sep}` }
    const path = isWindowsDrive
      ? `${parts[0]}${sep}${parts.slice(1, i + 1).join(sep)}`
      : `${sep}${parts.slice(0, i + 1).join(sep)}`
    return { label: part, path }
  })
}

export function FolderPicker({
  initialPath,
  onSelect,
}: {
  /** Seeds the browser at this location if it still exists; falls back to home. */
  initialPath?: string
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [parent, setParent] = useState<string | null>(null)
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [roots, setRoots] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function navigate(dirPath: string) {
    setLoading(true)
    setError(null)
    try {
      const result = await listFsDir(dirPath)
      setCurrentPath(result.path)
      setParent(result.parent)
      setEntries(result.entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleOpen() {
    setOpen(true)
    if (currentPath) return // already browsed this session — keep where the user left off
    try {
      const { roots, home } = await listFsRoots()
      setRoots(roots)
      await navigate(initialPath?.trim() || home)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleSelect() {
    if (!currentPath) return
    onSelect(currentPath)
    setOpen(false)
    toast.success('Repository path filled in.')
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={handleOpen} className="gap-1.5">
        <FolderOpenIcon className="size-3.5" />
        Browse
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose a repository folder</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {currentPath && (
              <div className="flex flex-wrap items-center gap-1 overflow-x-auto text-xs">
                {breadcrumbs(currentPath).map((crumb, i, arr) => (
                  <span key={crumb.path} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => navigate(crumb.path)}
                      className={cn(
                        'rounded px-1 py-0.5 hover:bg-muted',
                        i === arr.length - 1 && 'font-medium text-foreground',
                      )}
                    >
                      {crumb.label}
                    </button>
                    {i < arr.length - 1 && <span className="text-muted-foreground/50">/</span>}
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={!parent || loading}
                onClick={() => parent && navigate(parent)}
                aria-label="Go up one level"
              >
                <ArrowUpIcon className="size-3.5" />
              </Button>
              <div className="flex flex-1 gap-1 overflow-x-auto">
                {roots.map((root) => (
                  <Button
                    key={root}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 gap-1"
                    onClick={() => navigate(root)}
                  >
                    <HardDriveIcon className="size-3.5" />
                    {root}
                  </Button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <ScrollArea className="h-64 rounded-lg border">
              {loading ? (
                <div className="flex flex-col gap-1 p-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-8" />
                  ))}
                </div>
              ) : entries.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No subfolders here.</p>
              ) : (
                <div className="flex flex-col p-1">
                  {entries.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      onDoubleClick={() => navigate(entry.path)}
                      onClick={() => navigate(entry.path)}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      {entry.isGitRepo && (
                        <span className="flex shrink-0 items-center gap-1 text-xs text-success">
                          <GitBranchIcon className="size-3" /> git
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>

            <p className="truncate font-mono text-xs text-muted-foreground" title={currentPath ?? ''}>
              {currentPath ?? 'Loading…'}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={!currentPath} onClick={handleSelect}>
              Use this folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
