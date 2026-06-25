import { useEffect, useState } from 'react';

/**
 * useReducedMotion — subscribes to the `(prefers-reduced-motion: reduce)`
 * media query and re-renders when it changes.
 *
 * Lego-piece rule: this is the single source of truth for motion preference
 * across the build. Components that branch on it (BrainBoard, ProbeController,
 * useViewBoxTween, DieShot) all read from here rather than calling matchMedia
 * directly.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    // Safari < 14 only supports addListener/removeListener.
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    setReduced(mq.matches);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  return reduced;
}
