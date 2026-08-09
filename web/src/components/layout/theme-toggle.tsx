import { useTheme } from 'next-themes'
import { MoonStarIcon, SunIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
        >
          <SunIcon className="size-4 scale-100 rotate-0 transition-transform duration-300 dark:scale-0 dark:-rotate-90" />
          <MoonStarIcon className="absolute size-4 scale-0 rotate-90 transition-transform duration-300 dark:scale-100 dark:rotate-0" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{isDark ? 'Light mode' : 'Dark mode'}</TooltipContent>
    </Tooltip>
  )
}

/** Segmented Light/Dark pill for the sidebar footer — the collapsed rail
 * falls back to the single-icon `ThemeToggle` above (no room for two labels). */
export function ThemeToggleSegmented() {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  return (
    <div className="flex rounded-lg border p-0.5">
      <button
        type="button"
        aria-label="Switch to light theme"
        onClick={() => setTheme('light')}
        className={cn(
          'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
          !isDark ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <SunIcon className="size-3.5" />
        Light
      </button>
      <button
        type="button"
        aria-label="Switch to dark theme"
        onClick={() => setTheme('dark')}
        className={cn(
          'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
          isDark ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <MoonStarIcon className="size-3.5" />
        Dark
      </button>
    </div>
  )
}
