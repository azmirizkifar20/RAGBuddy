import {
  CheckCircle2Icon,
  DownloadCloudIcon,
  GitCommitVerticalIcon,
  GlobeIcon,
  RefreshCwIcon,
  TerminalIcon,
  Trash2Icon,
  UploadIcon,
  XCircleIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDateTime, formatDuration, timeAgo } from '@/lib/format'
import type { RunKind, RunRecord, RunTrigger } from '@/lib/api-client'
import { cn } from '@/lib/utils'

const KIND_META: Record<RunKind, { icon: LucideIcon; label: string }> = {
  ingest: { icon: DownloadCloudIcon, label: 'Full ingest' },
  sync: { icon: RefreshCwIcon, label: 'Sync' },
  upload: { icon: UploadIcon, label: 'Upload' },
  'upload-remove': { icon: Trash2Icon, label: 'Upload removed' },
}

const TRIGGER_META: Record<RunTrigger, { icon: LucideIcon; label: string }> = {
  hook: { icon: GitCommitVerticalIcon, label: 'git commit' },
  web: { icon: GlobeIcon, label: 'dashboard' },
  cli: { icon: TerminalIcon, label: 'CLI' },
}

/** Renders the per-kind counters the backend stored, skipping the zero ones. */
function summaryChips(run: RunRecord) {
  const entries = Object.entries(run.summary).filter(([, value]) => value !== 0 && value !== false && value !== '')
  return entries.map(([key, value]) => (
    <Badge key={key} variant="outline" className="font-mono">
      {key}: {String(value)}
    </Badge>
  ))
}

export function RunList({ runs, showProject = false }: { runs: RunRecord[]; showProject?: boolean }) {
  return (
    <div className="relative flex flex-col">
      {/* Timeline spine */}
      <span aria-hidden className="absolute top-2 bottom-2 left-[17px] w-px bg-border" />

      <div className="stagger flex flex-col gap-2">
        {runs.map((run, i) => {
          const kind = KIND_META[run.kind] ?? KIND_META.sync
          const trigger = TRIGGER_META[run.trigger] ?? TRIGGER_META.cli
          const failed = run.status === 'error'

          return (
            <div
              key={run.id}
              style={{ '--stagger-index': Math.min(i, 12) } as React.CSSProperties}
              className="relative flex gap-3 rounded-xl bg-card p-3 pl-3 ring-1 ring-foreground/10 transition-shadow hover:shadow-sm"
            >
              <div
                className={cn(
                  'z-10 flex size-9 shrink-0 items-center justify-center rounded-lg',
                  failed ? 'bg-destructive/12 text-destructive' : 'bg-success/12 text-success',
                )}
              >
                <kind.icon className="size-4" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{kind.label}</span>
                  {showProject && (
                    <Badge variant="secondary" className="font-mono">
                      {run.project}
                    </Badge>
                  )}
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <trigger.icon className="size-3" />
                    {trigger.label}
                  </span>
                  {failed ? (
                    <span className="flex items-center gap-1 text-xs text-destructive">
                      <XCircleIcon className="size-3" /> failed
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-success">
                      <CheckCircle2Icon className="size-3" /> ok
                    </span>
                  )}
                </div>

                {failed && run.error && (
                  <p className="mt-1 rounded-md bg-destructive/8 px-2 py-1 font-mono text-xs break-all text-destructive">
                    {run.error}
                  </p>
                )}

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{summaryChips(run)}</div>

                <p className="mt-1.5 text-xs text-muted-foreground" title={formatDateTime(run.startedAt)}>
                  {timeAgo(run.startedAt)} · took {formatDuration(run.durationMs)}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
