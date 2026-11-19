import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface SeasonOption {
  number: number;
  name?: string;
  episodes?: number;
}

interface SeasonDropdownProps {
  seasons: SeasonOption[];
  selectedSeason: number;
  onChange: (seasonNumber: number) => void;
  className?: string;
}

export function SeasonDropdown({
  seasons,
  selectedSeason,
  onChange,
  className = '',
}: SeasonDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  if (!seasons || seasons.length === 0) return null;

  const activeSeason = seasons.find((s) => s.number === selectedSeason) || seasons[0];
  const activeLabel = activeSeason.name || `Season ${activeSeason.number}`;

  return (
    <div ref={containerRef} className={`relative inline-block text-left ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select Season"
        className={`inline-flex min-h-[40px] items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all sm:text-sm ${
          open
            ? 'border-sky-400 bg-surface-2 text-ink shadow-lg shadow-sky-500/10'
            : 'border-line bg-surface text-ink hover:border-sky-400/50 hover:bg-surface-2/80'
        }`}
      >
        <span className="max-w-[180px] truncate whitespace-nowrap">{activeLabel}</span>
        {typeof activeSeason.episodes === 'number' && activeSeason.episodes > 0 && (
          <span className="hidden font-mono text-[11px] text-muted tabular-nums sm:inline">
            ({activeSeason.episodes} eps)
          </span>
        )}
        <ChevronDown
          className={`size-4 shrink-0 text-muted transition-transform duration-200 ${
            open ? 'rotate-180 text-sky-400' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Available Seasons"
          className="absolute left-0 z-50 mt-2 max-h-72 w-64 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-2xl ring-1 ring-black/20 backdrop-blur-xl"
        >
          {seasons.map((s) => {
            const isSelected = s.number === selectedSeason;
            const label = s.name || `Season ${s.number}`;
            return (
              <button
                key={s.number}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(s.number);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition-colors sm:text-sm ${
                  isSelected
                    ? 'bg-sky-500/15 font-semibold text-sky-400'
                    : 'text-ink hover:bg-surface-2'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate">{label}</p>
                  {typeof s.episodes === 'number' && s.episodes > 0 && (
                    <p className="font-mono text-[11px] text-muted tabular-nums">
                      {s.episodes} Episode{s.episodes === 1 ? '' : 's'}
                    </p>
                  )}
                </div>
                {isSelected && <Check className="size-4 shrink-0 text-sky-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
