import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, CircleOff, CirclePlay, Loader2 } from 'lucide-react'
import type { WatchServerSlot } from '../lib/servers'
import { toast } from '../lib/toast'
import { cn } from '../lib/utils'

interface ServerCategoryDropdownProps {
  title: string
  icon: ReactNode
  placeholder: string
  slots: WatchServerSlot[]
  activeSlotKey: string
  loading?: boolean
  checking?: boolean
  available?: boolean
  unavailableLabel?: string
  onSelect: (slot: WatchServerSlot) => void
}

/** Professional custom themed dropdown for each server category (SUB / DUB / MULTI AUDIO). */
export function ServerCategoryDropdown({
  title,
  icon,
  placeholder,
  slots,
  activeSlotKey,
  loading = false,
  checking = false,
  available = true,
  unavailableLabel = 'Not Available',
  onSelect,
}: ServerCategoryDropdownProps) {
  const id = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [box, setBox] = useState({ left: 0, top: 0, width: 220, maxHeight: 320, up: false })

  const isChecking = Boolean(checking)
  const isAvailable = !isChecking && available && slots.length > 0
  const selectedSlot = isAvailable ? slots.find((s) => s.key === activeSlotKey) : undefined
  const isCategoryActive = Boolean(selectedSlot)

  const openMenu = () => {
    if (!isAvailable || isChecking) return
    const idx = slots.findIndex((s) => s.key === activeSlotKey)
    setActiveIndex(idx >= 0 ? idx : 0)
    setOpen(true)
  }

  const pick = (slot: WatchServerSlot) => {
    onSelect(slot)
    setOpen(false)
    btn.current?.focus()
  }

  const updateBox = useCallback(() => {
    if (!btn.current) return
    const r = btn.current.getBoundingClientRect()
    const spaceBelow = Math.max(0, Math.floor(window.innerHeight - r.bottom - 12))
    const spaceAbove = Math.max(0, Math.floor(r.top - 12))
    const ideal = slots.length * 44 + 20
    const up = spaceBelow < Math.min(ideal, 300) && spaceAbove > spaceBelow
    const maxHeight = Math.max(160, Math.min(360, up ? spaceAbove : spaceBelow))
    const maxWidth = Math.max(200, window.innerWidth - 16)
    const width = Math.min(Math.max(r.width, 200), maxWidth)
    setBox({
      left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8)),
      top: up ? r.top - 8 : r.bottom + 8,
      width,
      maxHeight,
      up,
    })
  }, [slots.length])

  useLayoutEffect(() => {
    if (!open) return
    updateBox()
  }, [open, updateBox])

  useEffect(() => {
    if (!isAvailable && open) setOpen(false)
  }, [isAvailable, open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (list.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onScroll = (e: Event) => {
      if (list.current?.contains(e.target as Node)) return
      const r = btn.current?.getBoundingClientRect()
      if (!r || r.bottom < 0 || r.top > window.innerHeight) {
        setOpen(false)
        return
      }
      updateBox()
    }
    const onResize = () => updateBox()
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, updateBox])

  useEffect(() => {
    if (!open || !list.current) return
    const container = list.current
    const el = container.querySelector<HTMLElement>(`[data-i="${activeIndex}"]`)
    if (!el) return
    const top = el.offsetTop
    const bottom = top + el.offsetHeight
    if (top < container.scrollTop) {
      container.scrollTop = top
    } else if (bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = bottom - container.clientHeight
    }
  }, [open, activeIndex])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openMenu()
      }
      return
    }
    if (e.key === 'ArrowDown') setActiveIndex((a) => Math.min(slots.length - 1, a + 1))
    else if (e.key === 'ArrowUp') setActiveIndex((a) => Math.max(0, a - 1))
    else if (e.key === 'Home') setActiveIndex(0)
    else if (e.key === 'End') setActiveIndex(slots.length - 1)
    else if ((e.key === 'Enter' || e.key === ' ') && slots[activeIndex]) pick(slots[activeIndex])
    else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false)
    else return
    e.preventDefault()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
          <span className={cn(isChecking ? 'text-accent/80' : isAvailable ? 'text-accent' : 'text-muted/50')}>{icon}</span>
          <span className={cn(isCategoryActive && 'text-foreground', !isAvailable && !isChecking && 'text-muted/60')}>{title}</span>
        </div>
        <span className={cn('text-[10px] font-semibold', isChecking ? 'animate-pulse text-muted/80' : isAvailable ? 'text-muted/80' : 'text-muted/50')}>
          {isChecking ? 'Loading…' : isAvailable ? `${slots.length} ${slots.length === 1 ? 'server' : 'servers'}` : 'Not Available'}
        </span>
      </div>

      <button
        ref={btn}
        type="button"
        role="combobox"
        aria-label={`${title} server selector`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={isChecking || (loading && isCategoryActive)}
        aria-disabled={!isAvailable}
        aria-controls={isAvailable ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-${activeIndex}` : undefined}
        onClick={() => {
          if (isChecking) {
            toast('Loading available servers, please wait…', 'info')
            return
          }
          if (!isAvailable) {
            toast(`${title} is not available for this title`, 'info')
            return
          }
          open ? setOpen(false) : openMenu()
        }}
        onKeyDown={isAvailable ? onKeyDown : undefined}
        className={cn(
          'group flex h-11 w-full items-center justify-between gap-2.5 rounded-2xl border px-3.5 text-left text-xs font-semibold outline-none transition-all duration-150 sm:text-[13px]',
          isChecking
            ? 'border-white/10 bg-white/[0.03] text-muted cursor-wait select-none'
            : !isAvailable
              ? 'border-white/5 bg-white/[0.02] text-muted/50 cursor-not-allowed opacity-75 select-none'
              : isCategoryActive
                ? 'border-red-500/80 bg-red-500/10 text-foreground shadow-sm shadow-red-500/20 ring-1 ring-red-500/40 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-red-500/60'
                : 'border-white/10 bg-black/80 text-muted hover:border-white/25 hover:bg-black hover:text-foreground active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-red-500/60',
          open && 'border-red-500 ring-2 ring-red-500/30',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {isChecking ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
          ) : !isAvailable ? (
            <CircleOff className="size-4 shrink-0 text-muted/40" />
          ) : loading && isCategoryActive ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
          ) : (
            <CirclePlay
              className={cn(
                'size-4 shrink-0 transition-colors',
                isCategoryActive ? 'text-accent' : 'text-muted group-hover:text-foreground',
              )}
            />
          )}
          <span className={cn('truncate', isChecking ? 'font-medium text-muted/80' : !isAvailable ? 'font-medium text-muted/60' : isCategoryActive ? 'font-bold tracking-wide text-foreground' : '')}>
            {isChecking ? 'Loading servers…' : !isAvailable ? unavailableLabel : (selectedSlot ? selectedSlot.label : placeholder)}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1.5">
          {isAvailable && isCategoryActive && (
            <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.75)]" />
          )}
          <ChevronDown
            className={cn(
              'size-4 shrink-0 transition-transform duration-200',
              isChecking || !isAvailable ? 'text-muted/30 opacity-40' : isCategoryActive ? 'text-accent' : 'text-muted group-hover:text-foreground',
              open && 'rotate-180',
            )}
          />
        </span>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={list}
              id={`${id}-list`}
              role="listbox"
              aria-label={`${title} servers`}
              initial={{ opacity: 0, y: box.up ? 6 : -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: box.up ? 6 : -6, scale: 0.98 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
              style={{
                position: 'fixed',
                left: box.left,
                top: box.top,
                width: box.width,
                maxHeight: box.maxHeight,
                transformOrigin: box.up ? 'bottom' : 'top',
                translate: box.up ? '0 -100%' : undefined,
              }}
              className="no-scrollbar z-[120] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-1.5 text-foreground shadow-2xl shadow-black/60"
            >
              <div className="mb-1 flex items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                <span className="text-accent">{icon}</span>
                <span>{title}</span>
              </div>
              {slots.map((slot, i) => {
                const isSelected = slot.key === activeSlotKey
                return (
                  <div
                    key={slot.key}
                    id={`${id}-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={isSelected}
                    onPointerEnter={() => setActiveIndex(i)}
                    onClick={() => pick(slot)}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold tracking-wide transition-colors sm:text-[13px]',
                      i === activeIndex && !isSelected && 'bg-card-2 text-foreground',
                      isSelected
                        ? 'bg-accent text-accent-fg font-bold shadow-sm'
                        : 'text-muted hover:bg-card-2 hover:text-foreground',
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <CirclePlay className={cn('size-4 shrink-0', isSelected ? 'text-accent-fg' : 'text-muted')} />
                      <span>{slot.label}</span>
                    </span>
                    {isSelected && <Check className="size-4 shrink-0" />}
                  </div>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}
