/**
 * Tiny cookie helpers — no dependency required.
 * Used to remember the splash-door choice (`ng_path=tech|bus`) for 30 days.
 */

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

export function setCookie(name: string, value: string, maxAgeSeconds = THIRTY_DAYS_SECONDS): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSeconds}; path=/; SameSite=Lax`;
}

export function getCookie(name: string): string | null {
  const prefix = `${name}=`;
  const found = document.cookie
    .split('; ')
    .find((c) => c.startsWith(prefix));
  if (!found) return null;
  return decodeURIComponent(found.substring(prefix.length));
}
