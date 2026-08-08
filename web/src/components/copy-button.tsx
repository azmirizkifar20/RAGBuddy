import { useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function CopyButton({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // navigator.clipboard is unavailable outside secure contexts — tell the
      // user rather than silently doing nothing.
      toast.error('Clipboard is unavailable in this browser context. Select and copy manually.')
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size={label ? 'sm' : 'icon'}
      onClick={handleCopy}
      aria-label={`Copy ${label ?? 'to clipboard'}`}
      className={cn('gap-1.5', className)}
    >
      {copied ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5" />}
      {label && <span>{copied ? 'Copied' : label}</span>}
    </Button>
  )
}

/** A code block with a copy affordance — used all over the MCP setup page. */
export function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <div className={cn('group relative overflow-hidden rounded-lg bg-muted/60 ring-1 ring-foreground/10', className)}>
      <pre className="overflow-x-auto p-3 pr-11 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <CopyButton
        value={code}
        className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      />
    </div>
  )
}
