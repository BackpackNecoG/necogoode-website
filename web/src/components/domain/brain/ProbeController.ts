import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardLayout } from './boardLayout';

/**
 * ProbeController — the probe-state machine for the NECO-1 board.
 *
 * Ports the v5 reference's `probe()` / `release()` lifecycle into a React hook.
 * It owns the single piece of mutable choreography state — which build is
 * probed, which traces are focused, and which of those traces have finished
 * energizing — plus the staggered timers that drive the energize sequence.
 *
 * The board (BrainBoard) is a pure render of this state: it subscribes by
 * reading the returned snapshot and renders accordingly. Parent routes are
 * notified through the onProbe/onRelease callbacks so Stream B's ScopeView can
 * mount.
 *
 * Reduced-motion branch: when `reduced` is true every step fires synchronously
 * (no setTimeout), so the board lands in its final probed state in one frame.
 */

export type ProbeState = {
  /** The probed build id, or null when the board is idle. */
  probedId: string | null;
  /** Keys (TraceLayout.key) of the traces belonging to the probed build. */
  focusedKeys: string[];
  /** Subset of focusedKeys that have completed their energize animation —
   *  their cap LED is lit and the capchip should read "lit". */
  energizedKeys: string[];
  /** Cap ids whose controller LED is currently lit. */
  litCapIds: string[];
};

export type UseProbeOptions = {
  layout: BoardLayout;
  reduced: boolean;
  /** Fired when a build becomes probed (after state is set). */
  onProbe?: (buildId: string) => void;
  /** Fired when the probe is released back to idle. */
  onRelease?: () => void;
};

export type UseProbe = ProbeState & {
  /** Probe a build chip by id. Re-probing a different build re-runs the seq. */
  probe: (buildId: string) => void;
  /** Release back to the idle board. Safe to call when already idle. */
  release: () => void;
};

// Timing constants ported from the v5 energize sequence.
const ENERGIZE_START = 480; // ms before the first trace begins energizing
const ENERGIZE_STAGGER = 300; // ms between successive traces
const ENERGIZE_TRAVEL = 520; // ms a single trace takes to fill

export function useProbe({ layout, reduced, onProbe, onRelease }: UseProbeOptions): UseProbe {
  const [state, setState] = useState<ProbeState>({
    probedId: null,
    focusedKeys: [],
    energizedKeys: [],
    litCapIds: [],
  });

  const timers = useRef<number[]>([]);
  // Keep callbacks fresh without re-creating probe/release each render.
  const onProbeRef = useRef(onProbe);
  const onReleaseRef = useRef(onRelease);
  useEffect(() => {
    onProbeRef.current = onProbe;
    onReleaseRef.current = onRelease;
  }, [onProbe, onRelease]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }, []);

  // schedule honors reduced-motion: synchronous when reduced.
  const schedule = useCallback(
    (fn: () => void, ms: number) => {
      if (reduced) {
        fn();
        return;
      }
      const id = window.setTimeout(fn, ms);
      timers.current.push(id);
    },
    [reduced],
  );

  const release = useCallback(() => {
    clearTimers();
    setState((prev) => {
      if (prev.probedId === null) return prev;
      return { probedId: null, focusedKeys: [], energizedKeys: [], litCapIds: [] };
    });
    onReleaseRef.current?.();
  }, [clearTimers]);

  const probe = useCallback(
    (buildId: string) => {
      const build = layout.buildById[buildId];
      if (!build) return;
      clearTimers();

      const focused = layout.traces.filter((t) => t.chipId === buildId);
      const focusedKeys = focused.map((t) => t.key);

      // Initial probed state: chip selected, traces focused, nothing energized.
      setState({ probedId: buildId, focusedKeys, energizedKeys: [], litCapIds: [] });
      onProbeRef.current?.(buildId);

      // Energize sequence — each focused trace lights its cap LED in turn.
      focused.forEach((tr, i) => {
        const land = () =>
          setState((prev) => {
            if (prev.probedId !== buildId) return prev; // released / re-probed
            const energizedKeys = prev.energizedKeys.includes(tr.key)
              ? prev.energizedKeys
              : [...prev.energizedKeys, tr.key];
            const litCapIds = prev.litCapIds.includes(tr.capId)
              ? prev.litCapIds
              : [...prev.litCapIds, tr.capId];
            return { ...prev, energizedKeys, litCapIds };
          });
        schedule(land, ENERGIZE_START + i * ENERGIZE_STAGGER + ENERGIZE_TRAVEL);
      });
    },
    [layout, clearTimers, schedule],
  );

  // Clean up timers on unmount.
  useEffect(() => clearTimers, [clearTimers]);

  return useMemo(
    () => ({ ...state, probe, release }),
    [state, probe, release],
  );
}

/**
 * energizeTiming — exposed so the board can drive the CSS stroke-dashoffset
 * transition with the same cadence the controller uses to flip LED state.
 * Returns the per-trace transition-delay (ms) for the i-th focused trace.
 */
export function energizeDelay(i: number): number {
  return ENERGIZE_START + i * ENERGIZE_STAGGER;
}

export const ENERGIZE_DURATION = ENERGIZE_TRAVEL;
