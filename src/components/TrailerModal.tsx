import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { AnimeMedia } from '../types';
import { pickTitle } from '../lib/api';

interface TrailerModalProps {
  media: AnimeMedia | null;
  onClose: () => void;
}

export function TrailerModal({ media, onClose }: TrailerModalProps) {
  useEffect(() => {
    if (!media) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [media, onClose]);

  if (!media || !media.trailer?.id) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="line-clamp-1 font-display text-sm font-bold text-ink">
            {pickTitle(media.title)} — Official Trailer
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close trailer"
            className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="relative aspect-video w-full bg-black">
          <iframe
            src={`https://www.youtube.com/embed/${media.trailer.id}?autoplay=1&rel=0`}
            title={`${pickTitle(media.title)} Trailer`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full border-0"
          />
        </div>
      </div>
    </div>
  );
}
