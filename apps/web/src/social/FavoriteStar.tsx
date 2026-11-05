/**
 * BWM Central Phase 2 — the favorite-partner star: one toggle button
 * used on friends rows, recent players, and the pair block on profiles.
 * State is the shared favorites store (favorites.ts); the click never
 * bubbles (rows that carry it are themselves tappable profile links).
 */
import { normalizeUserId, useFavorites } from './favorites';

export function FavoriteStar({ userId, name, testid }: { userId: string; name: string; testid?: string }) {
  const { favorites, toggleFavorite } = useFavorites();
  const fav = (favorites ?? []).some((f) => f.userId === normalizeUserId(userId));
  return (
    <button type="button" className={`fav-star${fav ? ' on' : ''}`} data-testid={testid ?? `fav-star-${name}`}
      aria-pressed={fav} aria-label={fav ? `Unstar ${name}` : `Star ${name} as a favorite partner`}
      title={fav ? `${name} is a favorite partner — tap to unstar` : `Star ${name} as a favorite partner`}
      onClick={(e) => { e.stopPropagation(); void toggleFavorite({ userId: normalizeUserId(userId), name }, !fav); }}>
      {fav ? '★' : '☆'}
    </button>
  );
}
