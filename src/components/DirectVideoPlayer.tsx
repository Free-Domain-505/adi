import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

export interface DirectSubtitleTrack {
  file: string;
  label: string;
  default?: boolean;
}

interface DirectVideoPlayerProps {
  src: string;
  format?: 'hls' | 'file' | string;
  subtitles?: DirectSubtitleTrack[];
  onErrorFallback?: () => void;
}

export function DirectVideoPlayer({
  src,
  format = 'hls',
  subtitles = [],
  onErrorFallback,
}: DirectVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setFailed(false);
    let hls: Hls | null = null;
    const isHlsStream = format === 'hls' || src.includes('.m3u8') || src.includes('playlist=1') || src.includes('/proxy');

    if (isHlsStream && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setFailed(true);
          onErrorFallback?.();
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl') || !isHlsStream) {
      video.src = src;
      video.play().catch(() => {});
    } else {
      video.src = src;
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [src, format, onErrorFallback]);

  if (failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-black px-4 text-center text-xs text-muted">
        <p className="font-semibold text-ink">Direct stream unavailable for this episode.</p>
        <p className="mt-1">Please select another server below.</p>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      controls
      playsInline
      autoPlay
      crossOrigin="anonymous"
      className="h-full w-full bg-black object-contain"
    >
      {subtitles
        .filter((s) => Boolean(s?.file))
        .map((sub, i) => (
          <track
            key={`${sub.label}-${i}`}
            kind="subtitles"
            src={sub.file}
            label={sub.label || 'English'}
            srcLang="en"
            default={Boolean(sub.default || i === 0)}
          />
        ))}
    </video>
  );
}
