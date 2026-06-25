import type { PinImage } from '../../../data/brainBoard';

/**
 * Shared image-source resolution for /brain captures (lego piece — ScopeView,
 * TourStop and BrainMobile all import this rather than re-deriving paths).
 *
 * Resolution order per the brief:
 *   manual override  ->  /brain/manual/<file>
 *   live capture     ->  /brain/captures/<file>
 *   authored asset   ->  /brain/assets/<file>   (type === 'asset', e.g. PIP svgs)
 *
 * We return the ordered candidate list so the consumer can fall back through
 * them on <img> error and finally land on a tasteful accent-tinted placeholder
 * instead of a broken image (rule 3: no unlabeled placeholders, never a broken
 * <img>).
 */
export function imageCandidates(image: PinImage): string[] {
  const file = image.file;
  if (!file) return [];
  if (image.type === 'asset') {
    // Authored assets (PIP) live under /assets first, but still allow a manual
    // override to win if one was dropped in.
    return [`/brain/manual/${file}`, `/brain/assets/${file}`];
  }
  // capture / manual screen types
  return [`/brain/manual/${file}`, `/brain/captures/${file}`, `/brain/assets/${file}`];
}
