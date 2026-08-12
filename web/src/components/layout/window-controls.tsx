import { useEffect, useState } from 'react'
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from 'lucide-react'
import { getElectronAPI } from '@/lib/electron'

/**
 * Custom titlebar controls for the frameless Electron window — renders nothing in a
 * normal browser tab. Deliberately raw `<button>`s, not the shared `Button` component:
 * OS window-chrome buttons are square, edge-to-edge, and full-height, none of which
 * match the app's own rounded/padded button style — this mimics OS chrome, not app UI.
 */
export function WindowControls() {
  const api = getElectronAPI()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!api) return
    return api.onMaximizedChange(setMaximized)
  }, [api])

  if (!api) return null

  // No explicit height here on purpose: an explicit height fights `self-stretch`
  // for the cross-axis size, which made the actual rendered box depend on
  // font-metric/layout timing at first paint — leaving it unset lets stretch
  // alone fill the header's height exactly, every time.
  return (
    <div className="app-no-drag-region -mr-4 flex self-stretch">
      <button
        type="button"
        onClick={api.minimizeWindow}
        aria-label="Minimize window"
        className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      >
        <MinusIcon className="size-4" />
      </button>
      <button
        type="button"
        onClick={api.toggleMaximizeWindow}
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
        className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      >
        {maximized ? <CopyIcon className="size-3.5" /> : <SquareIcon className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={api.closeWindow}
        aria-label="Close window"
        className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  )
}
