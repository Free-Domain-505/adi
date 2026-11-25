import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../lib/utils'

export interface SeasonOption {
  value: string
  label: string
  subtitle?: string
  meta?: string
}

/** Custom-built season dropdown menu (no native <select>, no backdrop blur). */
export function SeasonDropdown({
  value,
  options,
  onChange,
  disabled = false,
  align = 'left',
  className,
}: {
  value: string
  options: SeasonOption[]
  onChange: (value: string) => void
  disabled?: boolean
  align?: 'left' | 'right'
  className?: string
}) {
  const id = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [box, setBox] = useState({ left: 0, top: 0, width: 260, maxWidth: 360, maxHeight: 360, up: false })

  const selected = options.find((o) => o.value === value) ?? options[0]

  const openedAtRef = useRef(0)

  const openMenu = () => {
    if (disabled || options.length === 0) return
    openedAtRef.current = Date.now()
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }

  const pick = (v: string) => {
    setOpen(false)
    if (v !== value) onChange(v)
    btn.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const spaceBelow = Math.max(0, Math.floor(window.innerHeight - r.bottom - 12))
    const spaceAbove = Math.max(0, Math.floor(r.top - 12))
    const ideal = options.length * 54 + 16
    const up = spaceBelow < Math.min(ideal, 360) && spaceAbove > spaceBelow
    const maxHeight = Math.max(180, Math.min(420, up ? spaceAbove : spaceBelow))
    const maxWidth = Math.max(240, Math.min(360, window.innerWidth - 16))
    const width = Math.min(Math.max(r.width, 250), maxWidth)
    const rawLeft = align === 'right' ? r.right - width : r.left
    setBox({
      left: Math.min(Math.max(8, rawLeft), Math.max(8, window.innerWidth - width - 8)),
      top: up ? r.top - 8 : r.bottom + 8,
      width,
      maxWidth,
      maxHeight,
      up,
    })
  }, [open, options.length, align])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e.type === 'scroll' && Date.now() - openedAtRef.current < 200) return
      if (e.type === 'scroll' && list.current?.contains(e.target as Node)) return
      if (e.type === 'pointerdown' && (list.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  useEffect(() => {
    if (!open || !list.current) return
    const container = list.current
    const el = container.querySelector<HTMLElement>(`[data-i="${active}"]`)
    if (!el) return
    const top = el.offsetTop
    const bottom = top + el.offsetHeight
    if (top < container.scrollTop) {
      container.scrollTop = top
    } else if (bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = bottom - container.clientHeight
    }
  }, [open, active])

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openMenu()
      }
      return
    }
    if (e.key === 'ArrowDown') setActive((a) => Math.min(options.length - 1, a + 1))
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1))
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(options.length - 1)
    else if (e.key === 'Enter' || e.key === ' ') {
      const opt = options[active]
      if (opt) pick(opt.value)
    } else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false)
    else return
    e.preventDefault()
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-label="Select season"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKey}
        className={cn(
          'inline-flex h-10 shrink-0 items-center justify-between gap-3 rounded-xl border bg-card px-3.5 text-sm font-semibold text-foreground outline-none transition hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60',
          open ? 'border-accent ring-2 ring-accent/20' : 'border-border',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{selected?.label ?? 'Season 1'}</span>
          {selected?.meta && (
            <span className="hidden rounded-full bg-card-2 px-2 py-0.5 text-[11px] font-semibold text-muted sm:inline-block">
              {selected.meta}
            </span>
          )}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform duration-200', open && 'rotate-180 text-accent')} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={list}
              id={`${id}-list`}
              role="listbox"
              aria-label="Seasons"
              initial={{ opacity: 0, y: box.up ? 6 : -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: box.up ? 6 : -6, scale: 0.97 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
              style={{
                position: 'fixed',
                left: box.left,
                top: box.top,
                width: box.width,
                maxWidth: box.maxWidth,
                maxHeight: box.maxHeight,
                transformOrigin: box.up ? 'bottom' : 'top',
                translate: box.up ? '0 -100%' : undefined,
              }}
              className="no-scrollbar z-[100] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-1.5 text-foreground shadow-2xl shadow-black/50"
            >
              {options.map((o, i) => {
                const on = o.value === value
                return (
                  <div
                    key={o.value}
                    id={`${id}-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={on}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => pick(o.value)}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors',
                      i === active && !on && 'bg-card-2',
                      on && 'bg-accent/15 text-foreground',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn('text-sm font-bold', on ? 'text-accent' : 'text-foreground')}>
                          {o.label}
                        </span>
                        {o.meta && (
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[10px] font-bold',
                              on ? 'bg-accent text-accent-fg' : 'bg-card-2 text-muted',
                            )}
                          >
                            {o.meta}
                          </span>
                        )}
                      </div>
                      {o.subtitle && (
                        <p className="mt-0.5 truncate text-xs text-muted">{o.subtitle}</p>
                      )}
                    </div>
                    {on && <Check className="size-4 shrink-0 text-accent" />}
                  </div>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
