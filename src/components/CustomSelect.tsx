import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../lib/utils'

export interface Option {
  value: string
  label: string
}

/** Themed dropdown (replaces the native select). Portaled so the scrolling filter bar never clips it; keyboard + screen-reader friendly. */
export function CustomSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Option[]
  placeholder: string
}) {
  const id = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, maxWidth: 320, maxHeight: 420, up: false })
  const selected = options.find((o) => o.value === value)

  const openMenu = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    btn.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const spaceBelow = Math.max(0, Math.floor(window.innerHeight - r.bottom - 12))
    const spaceAbove = Math.max(0, Math.floor(r.top - 12))
    const ideal = options.length * 40 + 16
    const up = spaceBelow < Math.min(ideal, 420) && spaceAbove > spaceBelow
    const maxHeight = Math.max(180, Math.min(520, up ? spaceAbove : spaceBelow))
    const maxWidth = Math.max(200, window.innerWidth - 16)
    const width = Math.min(Math.max(r.width, 176), maxWidth)
    setBox({
      left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8)),
      top: up ? r.top - 8 : r.bottom + 8,
      width,
      maxWidth,
      maxHeight,
      up,
    })
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
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
    else if (e.key === 'Enter' || e.key === ' ') pick(options[active].value)
    else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false)
    else return
    e.preventDefault()
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKey}
        className={cn(
          'inline-flex h-10 shrink-0 items-center gap-2 rounded-full border bg-card pl-4 pr-3 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent',
          value ? 'border-accent/60 text-foreground' : 'border-border text-muted',
          open && 'border-accent',
        )}
      >
        <span className="whitespace-nowrap">{value && selected ? selected.label : placeholder}</span>
        <ChevronDown className={cn('size-4 transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={list}
              id={`${id}-list`}
              role="listbox"
              aria-label={label}
              initial={{ opacity: 0, y: box.up ? 6 : -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: box.up ? 6 : -6, scale: 0.97 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
              style={{
                position: 'fixed',
                left: box.left,
                top: box.top,
                minWidth: box.width,
                maxWidth: box.maxWidth,
                maxHeight: box.maxHeight,
                transformOrigin: box.up ? 'bottom' : 'top',
                translate: box.up ? '0 -100%' : undefined,
              }}
              className="no-scrollbar z-[100] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-1.5 text-foreground shadow-2xl shadow-black/40"
            >
              {options.map((o, i) => {
                const on = o.value === value
                return (
                  <div
                    key={o.value || '__none'}
                    id={`${id}-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={on}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => pick(o.value)}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-6 whitespace-nowrap rounded-xl px-3 py-2 text-sm transition-colors',
                      i === active && 'bg-card-2',
                      on && 'font-semibold text-accent',
                    )}
                  >
                    {o.label}
                    {on && <Check className="size-4" />}
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
