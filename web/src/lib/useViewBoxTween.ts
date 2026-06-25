import { useCallback, useEffect, useRef, useState } from 'react';

/** An SVG viewBox expressed as [minX, minY, width, height]. */
export type ViewBox = [number, number, number, number];

/** Serialize a viewBox rect to the string SVG expects. */
export function viewBoxString(vb: ViewBox): string {
  return vb.join(' ');
}

/** Cubic ease-in-out — matches the v5 reference tween curve. */
function easeInOutCubic(u: number): number {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/**
 * useViewBoxTween — animates an SVG viewBox between rects with cubic easing.
 *
 * Ports the `animateVB` choreography from the v5 reference into a reusable hook.
 * When `reduced` is true (prefers-reduced-motion), targets are applied instantly
 * with no rAF loop.
 *
 * @param initial  the resting viewBox (the full board frame)
 * @param reduced  when true, animateTo sets the viewBox immediately
 * @returns the current viewBox plus an `animateTo(target, ms)` driver
 */
export function useViewBoxTween(
  initial: ViewBox,
  reduced: boolean,
): { viewBox: ViewBox; animateTo: (target: ViewBox, ms: number) => void } {
  const [viewBox, setViewBox] = useState<ViewBox>(initial);
  const currentRef = useRef<ViewBox>(initial);
  const rafRef = useRef<number | null>(null);

  // Keep the imperative ref in sync with state so a new tween starts from the
  // genuinely-current frame even mid-animation.
  const commit = useCallback((vb: ViewBox) => {
    currentRef.current = vb;
    setViewBox(vb);
  }, []);

  const animateTo = useCallback(
    (target: ViewBox, ms: number) => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (reduced || ms <= 0) {
        commit([...target] as ViewBox);
        return;
      }
      const from = [...currentRef.current] as ViewBox;
      const t0 = performance.now();
      const step = (now: number) => {
        const u = Math.min(1, (now - t0) / ms);
        const e = easeInOutCubic(u);
        const next: ViewBox = [
          from[0] + (target[0] - from[0]) * e,
          from[1] + (target[1] - from[1]) * e,
          from[2] + (target[2] - from[2]) * e,
          from[3] + (target[3] - from[3]) * e,
        ];
        commit(next);
        if (u < 1) rafRef.current = requestAnimationFrame(step);
        else rafRef.current = null;
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [reduced, commit],
  );

  // Cancel any in-flight tween on unmount.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return { viewBox, animateTo };
}
