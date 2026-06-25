import { useEffect, useState } from 'react';
import type { Accent, PinImage } from '../../../data/brainBoard';
import { imageCandidates } from './resolveImage';

/**
 * Captured-screen renderer with graceful fallback (lego piece shared by the
 * ScopeView stage and the TourStop "THE BUILD" stage).
 *
 * Tries each candidate path in order; if every source fails (or there are none)
 * it shows an accent-tinted "capture pending" placeholder rather than a broken
 * <img>. The placeholder is tinted with build.accent so the board still reads as
 * the per-build palette (COLOR-VARIATION DIRECTIVE).
 */
export function BrainImage({
  image,
  accent,
  alt,
}: {
  image: PinImage | undefined;
  accent: Accent;
  alt: string;
}) {
  const candidates = image ? imageCandidates(image) : [];
  const [idx, setIdx] = useState(0);
  // Reset to first candidate whenever the target file changes (stop navigation).
  useEffect(() => setIdx(0), [image?.file]);

  const src = candidates[idx];
  const exhausted = !src;

  if (exhausted) {
    return (
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6"
        style={{
          background: `radial-gradient(circle at 50% 40%, ${accent.glow}, transparent 70%), #10131A`,
        }}
        role="img"
        aria-label={`${alt} — capture pending`}
      >
        <div
          className="text-[2rem] leading-none"
          style={{ color: accent.color }}
          aria-hidden="true"
        >
          ◍
        </div>
        <div
          className="text-[0.7rem] tracking-[0.16em] uppercase"
          style={{ color: accent.color }}
        >
          Capture pending
        </div>
        <div className="text-[0.62rem] tracking-[0.06em] text-[var(--brain-mute,#5C6470)] max-w-[16rem] leading-relaxed">
          {image?.route
            ? `Annotated screenshot of ${image.route}${image.authRequired ? ' (auth)' : ''} is queued.`
            : 'Authored render is queued for this stop.'}
        </div>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="absolute inset-0 h-full w-full object-cover object-top"
      loading="lazy"
      onError={() => setIdx((i) => i + 1)}
      style={{ background: '#10131A' }}
    />
  );
}
