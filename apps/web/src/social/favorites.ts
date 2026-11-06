/**
 * BWM Central Phase 2 — favorite partners (client): the Phase 1 server
 * endpoints (GET/POST/DELETE /api/social/favorites, signed-in only) plus
 * a tiny shared store so every surface (Crew list, friends rows, recent
 * players, profile pair block) stars the same list. The endpoint speaks
 * RAW account ids; social surfaces carry 'u:'-prefixed pids — ids are
 * normalized at this boundary and nowhere else.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';

export interface FavoritePartner { userId: string; name: string }

/** 'u:abc' and 'abc' are the same partner — the raw account id. */
export function normalizeUserId(id: string): string {
  return id.startsWith('u:') ? id.slice(2) : id;
}
export const sameUserId = (a: string, b: string): boolean => normalizeUserId(a) === normalizeUserId(b);

/** Add/remove one favorite in a list, by normalized id, no duplicates. */
export function toggleFavoriteList(list: FavoritePartner[], fav: FavoritePartner, on: boolean): FavoritePartner[] {
  const id = normalizeUserId(fav.userId);
  const has = list.some((f) => normalizeUserId(f.userId) === id);
  if (on) return has ? list : [...list, { userId: id, name: fav.name }];
  return has ? list.filter((f) => normalizeUserId(f.userId) !== id) : list;
}

export async function fetchFavoritesList(): Promise<FavoritePartner[]> {
  const r = await fetch('/api/social/favorites', { credentials: 'same-origin' });
  const j = (await r.json().catch(() => ({}))) as { favorites?: FavoritePartner[] };
  if (!r.ok) throw new Error('favorites unavailable');
  return (j.favorites ?? []).map((f) => ({ userId: normalizeUserId(f.userId), name: f.name }));
}

/** Star (POST) / unstar (DELETE) one partner on the server. */
export async function setFavoriteRemote(id: string, on: boolean): Promise<void> {
  const url = `/api/social/favorites/${encodeURIComponent(normalizeUserId(id))}`;
  const r = on
    ? await fetch(url, { method: 'POST', credentials: 'same-origin' })
    : await fetch(url, { method: 'DELETE', credentials: 'same-origin' });
  if (!r.ok) throw new Error('favorite update failed');
}

/* ------------------------------------------------------------ shared store */

let favList: FavoritePartner[] | null = null;
let favLoading = false;
const favSubs = new Set<() => void>();
const emitFavs = () => favSubs.forEach((f) => f());

export function ensureFavorites(): void {
  if (favList !== null || favLoading) return;
  favLoading = true;
  fetchFavoritesList()
    .then((l) => { favList = l; })
    .catch(() => { favList = []; })
    .finally(() => { favLoading = false; emitFavs(); });
}

/** The shared favorites state for any surface: the list (null until the
 *  first load lands), an optimistic toggle that reverts if the server
 *  refuses, and an isFavorite check across id forms. */
export function useFavorites(): {
  favorites: FavoritePartner[] | null;
  toggleFavorite: (fav: FavoritePartner, on: boolean) => Promise<void>;
  isFavorite: (id: string) => boolean;
} {
  const favorites = useSyncExternalStore(
    (f) => { favSubs.add(f); return () => { favSubs.delete(f); }; },
    () => favList,
    () => favList,
  );
  useEffect(() => { ensureFavorites(); }, []);
  const toggleFavorite = useCallback(async (fav: FavoritePartner, on: boolean) => {
    const prev = favList;
    favList = toggleFavoriteList(favList ?? [], fav, on);
    emitFavs();
    try { await setFavoriteRemote(fav.userId, on); }
    catch { favList = prev; emitFavs(); }
  }, []);
  const isFavorite = useCallback(
    (id: string) => (favList ?? []).some((f) => sameUserId(f.userId, id)),
    // favList identity changes on every emit, so the check stays fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [favorites],
  );
  return { favorites, toggleFavorite, isFavorite };
}
