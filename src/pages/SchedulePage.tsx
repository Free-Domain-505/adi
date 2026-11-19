import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar } from 'lucide-react';
import type { AiringItem } from '../types';
import { fetchWeeklySchedule, formatRelativeTime, pickTitle } from '../lib/api';
import { HubBar } from '../components/HubBar';
import { MediaImage } from '../components/MediaImage';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function SchedulePage() {
  const [items, setItems] = useState<AiringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number>(new Date().getDay());

  useEffect(() => {
    document.title = 'Airing Schedule — Anime by Adi 💀';
    fetchWeeklySchedule()
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load schedule'))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<number, AiringItem[]>();
    for (let d = 0; d < 7; d++) map.set(d, []);
    for (const item of items) {
      const day = new Date(item.airingAt * 1000).getDay();
      map.get(day)?.push(item);
    }
    return map;
  }, [items]);

  const activeList = grouped.get(selectedDay) || [];

  return (
    <main className="min-h-screen bg-canvas pt-20 pb-16">
      <HubBar />

      <div className="mx-auto mt-8 max-w-7xl px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Calendar className="size-6 text-accent" />
          <div>
            <p className="text-xs font-semibold text-teal">Weekly Simulcast Calendar</p>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
              Airing Schedule
            </h1>
          </div>
        </div>

        <div className="no-scrollbar mt-6 flex items-center gap-2 overflow-x-auto pb-2">
          {DAYS.map((day, idx) => {
            const count = grouped.get(idx)?.length || 0;
            const active = selectedDay === idx;
            return (
              <button
                key={day}
                type="button"
                onClick={() => setSelectedDay(idx)}
                className={`rounded-lg px-4 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors tabular-nums ${
                  active
                    ? 'bg-accent text-accent-ink'
                    : 'border border-line bg-surface text-muted hover:text-ink'
                }`}
              >
                {day} · {count}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-line bg-surface p-6 text-center text-sm text-muted">
            {error}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading
            ? Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="flex animate-pulse gap-3 rounded-xl border border-line bg-surface p-3">
                  <div className="h-24 w-16 shrink-0 rounded-lg bg-surface-2" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-4 w-3/4 rounded bg-surface-2" />
                    <div className="h-3 w-1/2 rounded bg-surface-2" />
                  </div>
                </div>
              ))
            : activeList.map((entry) => {
                const title = pickTitle(entry.media.title);
                const airDate = new Date(entry.airingAt * 1000);
                const timeStr = airDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return (
                  <Link
                    key={entry.id}
                    to={`/watch/${entry.media.id}?ep=${entry.episode}`}
                    className="group flex gap-3.5 rounded-xl border border-line bg-surface p-3 transition-colors hover:border-accent/50"
                  >
                    <div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                      <MediaImage
                        src={entry.media.coverImage?.large || entry.media.coverImage?.extraLarge}
                        alt={title}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                      <div>
                        <p className="font-mono text-xs font-semibold text-teal tabular-nums">
                          Episode {entry.episode} · {timeStr}
                        </p>
                        <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-ink group-hover:text-accent">
                          {title}
                        </h3>
                      </div>
                      <p className="text-xs text-muted tabular-nums">
                        {formatRelativeTime(entry.airingAt)}
                      </p>
                    </div>
                  </Link>
                );
              })}
        </div>

        {!loading && activeList.length === 0 && !error && (
          <p className="mt-12 text-center text-sm text-muted">
            No scheduled episodes listed for {DAYS[selectedDay]}.
          </p>
        )}
      </div>
    </main>
  );
}
