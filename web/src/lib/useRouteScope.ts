import { useEffect } from 'react';

export type Scope = 'splash' | 'tech' | 'bus' | 'floor' | 'console';

/**
 * Sets `body.scope-{name}` so theme.css can scope background/font to the active route.
 * Removes the previous scope class on unmount so route transitions don't leak palettes.
 */
export function useRouteScope(scope: Scope): void {
  useEffect(() => {
    const cls = `scope-${scope}`;
    document.body.classList.add(cls);
    return () => {
      document.body.classList.remove(cls);
    };
  }, [scope]);
}
