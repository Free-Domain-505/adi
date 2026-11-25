import { Moon } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

import { cn } from '../lib/utils'

/** Theme toggle button — keeps Dark mode active and notifies user that White mode is not available. */
export function ThemeToggle({ className }: { className?: string }) {
  const { toggle } = useTheme()

  return (
    <button
      type="button"
      onClick={toggle}
      title="White mode is not available"
      aria-label="Theme (Dark mode only)"
      className={cn(
        'relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-card text-foreground transition-[color,background-color,border-color,transform] duration-150 hover:border-foreground/30 hover:bg-card-2 active:scale-90 active:border-accent/60 active:bg-card-2',
        className,
      )}
    >
      <span className="grid place-items-center">
        <Moon className="size-4" />
      </span>
    </button>
  )
}
