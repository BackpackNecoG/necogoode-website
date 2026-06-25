import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Build, Pin } from '../../../data/brainBoard';
import { BrainImage } from './BrainImage';

type TabKey = 'build' | 'story';

/**
 * TourStop — the two-tab tour stop overlay for a single pin within a build.
 *
 * Tab "THE BUILD": unique capture + WHAT IT DOES / HOW IT'S BUILT — IN PLAIN
 * TERMS / WHY IT MATTERS (pin.tour) + a stack chip row (pin.tour.stack).
 *
 * Tab "THE STORY": WHY I BUILT THIS / WHO IT'S FOR / WHAT MAKES THIS UNIQUE /
 * CHALLENGES I FACED (pin.story) — but ONLY when pin.story.storyApproved === true.
 * Otherwise the entire STORY tab renders the calm "Story coming soon" state
 * (hard rule 2 — never show unapproved first-person draft copy).
 *
 * PREV / NEXT wrap within the current build's stops. CLOSE returns to the board.
 * Everything is accented with build.accent (COLOR-VARIATION DIRECTIVE).
 *
 * Stateless re: which stop is shown — the parent owns `index` and supplies
 * onNavigate/onClose so the same component drives ScopeView and BrainMobile.
 */
export function TourStop({
  build,
  index,
  onNavigate,
  onClose,
}: {
  build: Build;
  /** 0-based index into build.pins. */
  index: number;
  onNavigate: (nextIndex: number) => void;
  onClose: () => void;
}) {
  const pins = build.pins;
  const count = pins.length;
  const safeIndex = ((index % count) + count) % count;
  const pin: Pin = pins[safeIndex];
  const accent = build.accent;

  const [tab, setTab] = useState<TabKey>('build');
  // Reset to THE BUILD tab whenever the stop changes.
  useEffect(() => setTab('build'), [build.id, safeIndex]);

  // ESC closes; ←/→ navigate stops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onNavigate((safeIndex - 1 + count) % count);
      else if (e.key === 'ArrowRight') onNavigate((safeIndex + 1) % count);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [safeIndex, count, onNavigate, onClose]);

  const storyApproved = pin.story.storyApproved === true;

  return (
    <div
      className="grid gap-5 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"
      style={{ ['--accent' as string]: accent.color, ['--accent-glow' as string]: accent.glow }}
    >
      {/* THE BUILD capture frame */}
      <div
        className="self-start overflow-hidden rounded-[10px] border"
        style={{ background: '#1A1E25', borderColor: accent.color }}
      >
        <div
          className="px-3 py-[7px] text-[9.5px] tracking-[0.12em] border-b"
          style={{
            color: accent.color,
            background: '#16130C',
            borderColor: 'rgba(255,255,255,0.08)',
          }}
        >
          FEATURE VIGNETTE · {build.pn} {build.name}
        </div>
        <div className="relative h-[300px] overflow-hidden">
          <BrainImage image={pin.image} accent={accent} alt={`${build.name} — ${pin.title}`} />
        </div>
      </div>

      {/* Meta column */}
      <div className="flex min-w-0 flex-col gap-3">
        <div className="text-[10px] tracking-[0.16em] text-[var(--brain-mute,#5C6470)]">
          {build.pn} {build.name} — TOUR STOP {safeIndex + 1} OF {count}
        </div>
        <div className="text-[18px] tracking-[0.05em]" style={{ color: accent.color }}>
          {pin.title}
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 border-b border-[rgba(255,255,255,0.1)]">
          <Tab active={tab === 'build'} accent={accent.color} onClick={() => setTab('build')}>
            THE BUILD
          </Tab>
          <Tab active={tab === 'story'} accent={accent.color} onClick={() => setTab('story')}>
            SEE MORE — THE STORY
          </Tab>
        </div>

        {tab === 'build' ? (
          <div className="flex flex-col gap-[13px]">
            <Section accent={accent.color} kicker="WHAT IT DOES" body={pin.tour.what} />
            <Section
              accent={accent.color}
              kicker="HOW IT'S BUILT — IN PLAIN TERMS"
              body={pin.tour.how}
            />
            <Section accent={accent.color} kicker="WHY IT MATTERS" body={pin.tour.why} />
            <div className="flex flex-wrap gap-[7px]">
              {pin.tour.stack.map((s) => (
                <StackChip key={s} accent={accent}>
                  {s}
                </StackChip>
              ))}
            </div>
          </div>
        ) : storyApproved ? (
          <div className="flex flex-col gap-[13px]">
            <Section accent={accent.color} kicker="WHY I BUILT THIS" body={pin.story.built} />
            <Section accent={accent.color} kicker="WHO IT'S FOR" body={pin.story.who} />
            <Section accent={accent.color} kicker="WHAT MAKES THIS UNIQUE" body={pin.story.unique} />
            <Section accent={accent.color} kicker="CHALLENGES I FACED" body={pin.story.challenges} />
          </div>
        ) : (
          <div
            className="flex flex-col items-start gap-2 rounded-[8px] border border-dashed p-5"
            style={{ borderColor: accent.color, background: accent.glow }}
          >
            <div className="text-[10px] tracking-[0.16em]" style={{ color: accent.color }}>
              STORY COMING SOON
            </div>
            <p className="text-[12.5px] leading-relaxed text-[#B9B4AB]">
              Neco&rsquo;s voice pass is still pending for this stop. The first-person story
              publishes here once it&rsquo;s approved — the technical build is on the{' '}
              <button
                type="button"
                className="underline underline-offset-2"
                style={{ color: accent.color }}
                onClick={() => setTab('build')}
              >
                THE BUILD
              </button>{' '}
              tab.
            </p>
          </div>
        )}

        {/* Nav */}
        <div className="mt-1 flex flex-wrap gap-[9px]">
          <NavButton accent={accent.color} onClick={() => onNavigate((safeIndex - 1 + count) % count)}>
            ← PREV STOP
          </NavButton>
          <NavButton accent={accent.color} onClick={() => onNavigate((safeIndex + 1) % count)}>
            NEXT STOP →
          </NavButton>
          <NavButton accent={accent.color} onClick={onClose}>
            CLOSE TOUR ✕
          </NavButton>
        </div>
      </div>
    </div>
  );
}

function Tab({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  accent: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mb-px cursor-pointer border-0 border-b-2 bg-transparent px-[13px] py-2 font-mono text-[10.5px] tracking-[0.1em] transition-colors"
      style={{
        color: active ? accent : 'var(--brain-mute,#5C6470)',
        borderBottomColor: active ? accent : 'transparent',
      }}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function Section({ accent, kicker, body }: { accent: string; kicker: string; body: string }) {
  return (
    <div>
      <div className="mb-[5px] text-[9.5px] tracking-[0.16em]" style={{ color: accent }}>
        {kicker}
      </div>
      <p className="text-[12.5px] leading-[1.75] text-[#B9B4AB]">{body}</p>
    </div>
  );
}

function StackChip({ accent, children }: { accent: { color: string }; children: ReactNode }) {
  return (
    <span
      className="rounded-[4px] border px-[9px] py-1 font-mono text-[10px] tracking-[0.1em]"
      style={{ borderColor: accent.color, color: accent.color, background: 'rgba(255,255,255,0.03)' }}
    >
      {children}
    </span>
  );
}

function NavButton({
  accent,
  onClick,
  children,
}: {
  accent: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-[6px] border bg-[#12161D] px-[14px] py-2 font-mono text-[10.5px] tracking-[0.1em] text-[var(--brain-silk,#D7D3CA)] transition-colors hover:[color:var(--accent-hover)] hover:[border-color:var(--accent-hover)]"
      style={{ borderColor: '#39414E', ['--accent-hover' as string]: accent }}
    >
      {children}
    </button>
  );
}

export default TourStop;
