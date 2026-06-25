import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useRouteScope } from '../lib/useRouteScope';
import { NavigationWheel } from '../components/domain/NavigationWheel';
import { buildById } from '../data/brainBoard';
import BrainBoard, { brainMeta } from '../components/domain/brain/BrainBoard';
import { ScopeView } from '../components/domain/brain/ScopeView';
import { TourStop } from '../components/domain/brain/TourStop';
import { BrainMobile, useIsBrainMobile } from '../components/domain/brain/BrainMobile';

/**
 * /brain — NECO-1, the circuit-board view of Neco Goode's five personal builds.
 *
 * Desktop: the responsive SVG BrainBoard (Stream A) drives a probe state machine.
 * Probing a chip mounts Stream B's ScopeView (browser-framed capture + pin list);
 * opening a pin mounts the two-tab TourStop. Below 500px the SVG is swapped for
 * BrainMobile's static tap-through fallback.
 *
 * State ownership: the route holds (probedId, stopIndex). BrainBoard is
 * uncontrolled (manages its own probe from clicks/ESC) and reports through
 * onProbe/onRelease; the route mirrors that into probedId so ScopeView/TourStop
 * stay in sync. All copy/metrics come from brainBoard.json via the typed loader.
 */
export default function Brain() {
  useRouteScope('brain');
  const isMobile = useIsBrainMobile();

  // probedId: which build chip is currently probed (null = idle board).
  const [probedId, setProbedId] = useState<string | null>(null);
  // stopIndex: which tour stop is open (null = scope only, no tour overlay).
  const [stopIndex, setStopIndex] = useState<number | null>(null);

  const build = probedId ? buildById(probedId) : undefined;

  if (isMobile) {
    return (
      <div className="min-h-screen">
        <BrainMobile />
        <NavigationWheel active="brain" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Page header */}
      <header className="mx-auto max-w-[1180px] px-6 pt-8 pb-4">
        <div className="flex items-center justify-between gap-4">
          <Link
            to="/"
            className="flex items-center gap-3 no-underline text-[var(--brain-silk)] text-[0.85rem]"
          >
            <span className="flex h-6 w-6 items-center justify-center bg-[var(--brain-copper-lit)] text-[var(--brain-surface)] font-bold text-[0.75rem] tracking-tight rounded-[3px]">
              N
            </span>
            <span className="font-medium tracking-[0.04em]">
              NECOGOODE<span className="text-[var(--brain-mute)]">.COM</span> · NECO-1
            </span>
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--brain-mute)]">
            {brainMeta.rev}
          </span>
        </div>

        <h1 className="mt-6 text-[22px] font-semibold tracking-[0.05em] text-[var(--brain-copper-lit)]">
          NECO-1 — THE CIRCUIT BOARD
        </h1>
        <p className="mt-2 max-w-[760px] text-[13px] leading-[1.7] text-[var(--brain-mute)]">
          {brainMeta.intro}
        </p>
      </header>

      {/* The board */}
      <main className="mx-auto max-w-[1180px] px-6 pb-24">
        <BrainBoard
          onProbe={(id) => {
            setProbedId(id);
            setStopIndex(null);
          }}
          onRelease={() => {
            setProbedId(null);
            setStopIndex(null);
          }}
        />

        {build && (
          <section className="mt-8">
            <ScopeView build={build} onOpenStop={(i) => setStopIndex(i)} />
          </section>
        )}

        {build && stopIndex !== null && (
          <section className="mt-6">
            <TourStop
              build={build}
              index={stopIndex}
              onNavigate={setStopIndex}
              onClose={() => setStopIndex(null)}
            />
          </section>
        )}
      </main>

      <NavigationWheel active="brain" />
    </div>
  );
}
