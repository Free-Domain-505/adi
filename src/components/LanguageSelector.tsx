import { Languages } from 'lucide-react';

interface LanguageSelectorProps {
  language: 'hindi' | 'english';
  onChange: (lang: 'hindi' | 'english') => void;
  hindiAvailable?: boolean;
}

export function LanguageSelector({
  language,
  onChange,
  hindiAvailable = false,
}: LanguageSelectorProps) {
  return (
    <div className="inline-flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-canvas/85 px-3 py-1.5 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
        <Languages className="size-3.5 text-sky-400" />
        <span>Audio</span>
      </div>

      <div
        role="group"
        aria-label="Audio Language"
        className="inline-flex items-center gap-1 rounded-lg border border-line/80 bg-surface p-0.5"
      >
        <button
          type="button"
          onClick={() => onChange('hindi')}
          aria-pressed={language === 'hindi'}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-bold transition-all ${
            language === 'hindi'
              ? 'bg-gradient-to-r from-amber-400 to-orange-400 text-slate-950 shadow-sm'
              : 'text-muted hover:text-ink'
          }`}
        >
          <span>Hindi</span>
          <span
            className={`rounded px-1 py-0.5 text-[9px] font-extrabold uppercase leading-none ${
              language === 'hindi'
                ? 'bg-slate-950/20 text-slate-950'
                : 'bg-surface-2 text-muted'
            }`}
          >
            DUB
          </span>
        </button>

        <button
          type="button"
          onClick={() => onChange('english')}
          aria-pressed={language === 'english'}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-bold transition-all ${
            language === 'english'
              ? 'bg-sky-500 text-slate-950 shadow-sm'
              : 'text-muted hover:text-ink'
          }`}
        >
          <span>English</span>
        </button>
      </div>

      {language === 'hindi' && hindiAvailable && (
        <span className="hidden text-[11px] font-semibold text-teal sm:inline">
          Hindi Dub Ready
        </span>
      )}
    </div>
  );
}
