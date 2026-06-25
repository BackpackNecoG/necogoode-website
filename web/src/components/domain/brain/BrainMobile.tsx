import { useEffect, useState } from 'react';
import { brainBoard } from '../../../data/brainBoard';
import type { Build } from '../../../data/brainBoard';
import { TourStop } from './TourStop';

const MOBILE_QUERY = '(max-width: 499px)';

/**
 * useIsBrainMobile — true below 500px. The parent /brain route uses this to pick
 * BrainMobile (static tap-through) over the animated SVG board, which has no
 * viewBox tween on small screens. Stays live across resize/orientation change.
 */
export function useIsBrainMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MOBILE_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    setIsMobile(mq.matches);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  return isMobile;
}

type Selection = { buildId: string; index: number } | null;

/**
 * BrainMobile — the <500px static fallback for the /brain board.
 *
 * No SVG / no viewBox tween: a simple tap-through accordion of builds → stops.
 * Tapping a build expands its stop list; tapping a stop opens the same TourStop
 * component the desktop ScopeView uses, so copy/story-gating/accent behavior is
 * identical (lego-piece rule — one TourStop, two entry points).
 */
export function BrainMobile() {
  const builds = brainBoard.builds;
  const [openBuildId, setOpenBuildId] = useState<string | null>(builds[0]?.id ?? null);
  const [selection, setSelection] = useState<Selection>(null);

  const selectedBuild: Build | undefined = selection
    ? builds.find((b) => b.id === selection.buildId)
    : undefined;

  return (
    <div className="flex flex-col gap-4 px-4 pb-10">
      <header className="pt-5">
        <h1 className="text-[18px] font-semibold tracking-[0.06em]" style={{ color: 'var(--brain-copper-lit,#F2B23E)' }}>
          NECO-1{' '}
          <span className="text-[var(--brain-mute,#5C6470)]">{brainBoard.meta.rev}</span>
        </h1>
        <p className="mt-2 text-[12px] leading-[1.6] text-[var(--brain-mute,#5C6470)]">
          {brainBoard.meta.intro}
        </p>
      </header>

      {selectedBuild && selection ? (
        <div
          className="rounded-[10px] border p-4"
          style={{ borderColor: selectedBuild.accent.color, background: '#13161B' }}
        >
          <TourStop
            build={selectedBuild}
            index={selection.index}
            onNavigate={(next) => setSelection({ buildId: selectedBuild.id, index: next })}
            onClose={() => setSelection(null)}
          />
        </div>
      ) : (
        <ul className="flex list-none flex-col gap-2.5">
          {builds.map((build) => {
            const expanded = openBuildId === build.id;
            return (
              <li
                key={build.id}
                className="overflow-hidden rounded-[10px] border"
                style={{ borderColor: expanded ? build.accent.color : '#232A33', background: '#13161B' }}
              >
                <button
                  type="button"
                  onClick={() => setOpenBuildId(expanded ? null : build.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="font-mono text-[13px] tracking-[0.06em]" style={{ color: build.accent.color }}>
                      {build.pn} · {build.name}
                    </span>
                    <span className="text-[10.5px] tracking-[0.04em] text-[var(--brain-mute,#5C6470)]">
                      {build.pkg}
                    </span>
                  </span>
                  <span className="font-mono text-[14px]" style={{ color: build.accent.color }}>
                    {expanded ? '−' : '+'}
                  </span>
                </button>

                {expanded && (
                  <div className="border-t border-[rgba(255,255,255,0.06)] px-3 py-2.5">
                    <p className="mb-2.5 px-1 text-[11.5px] leading-[1.6] text-[#B9B4AB]">
                      {build.desc}
                    </p>
                    <ul className="flex list-none flex-col gap-1.5">
                      {build.pins.map((pin, i) => (
                        <li key={pin.n}>
                          <button
                            type="button"
                            onClick={() => setSelection({ buildId: build.id, index: i })}
                            className="flex w-full cursor-pointer gap-[10px] rounded-r-[6px] border-l-2 px-2.5 py-2 text-left"
                            style={{ borderLeftColor: build.accent.color, background: '#12161D' }}
                          >
                            <span
                              className="min-w-[14px] font-mono text-[11px] font-bold"
                              style={{ color: build.accent.color }}
                            >
                              {i + 1}
                            </span>
                            <span className="font-mono text-[11.5px] leading-[1.5] text-[#9CA4B0]">
                              <b className="block tracking-[0.05em] text-[var(--brain-silk,#D7D3CA)]">
                                {pin.title}
                              </b>
                              {pin.regions.length === 0
                                ? 'tour-only stop — all story.'
                                : pin.detail}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default BrainMobile;
