/**
 * Tappable profile pictures (Demetrius 2026-10-20): tapping a player's picture anywhere
 * in the app opens that player's profile. One entry point, two presentations:
 *   - away from a game → the Social panel's profile view (the same one player rows open);
 *   - at a table → a solid profile modal over the table (TableProfileModal), dismissed by
 *     tapping outside it, so the game never gets left behind a navigation.
 *
 * Who has a profile: account holders. Bots never do; guests (social 'g:…' ids, room seats
 * without an account uid) don't either — opening is a graceful no-op for them.
 */
import { useSyncExternalStore } from 'react';
import { accountUidOf } from './avatar';
import { social } from './social/store';

/** Who a face belongs to, in whatever id form the surface happens to hold. */
export interface ProfileWho {
  /** social pid ('u:<uid>'), raw account id ('<uid>'), guest id ('g:…') or room player id */
  id?: string | null;
  name: string;
  /** bots have no profile, ever */
  bot?: boolean;
}

/** A resolved, openable profile: canonical social pid + raw account id. */
export interface ProfileTarget { name: string; pid: string; uid: string }

/**
 * Resolve a face to a profile target, or null when there is nothing to open
 * (bot, guest, missing/garbled id, no name). Pure — the mode decision below and
 * every surface's "is this face tappable" check go through here.
 */
export function profileTargetOf(who: ProfileWho): ProfileTarget | null {
  if (who.bot) return null;
  const uid = accountUidOf(who.id ?? undefined);
  if (!uid) return null;
  const name = who.name?.trim();
  if (!name) return null;
  return { name, pid: `u:${uid}`, uid };
}

/* ------------------------------------------------- table-modal store */

/** The profile the table modal is showing (null = closed). Lives outside the Social
 *  panel state so any table surface (plates, video bubbles, talk tiles…) can open it. */
let target: ProfileTarget | null = null;
const subs = new Set<() => void>();
function emit() { subs.forEach((f) => f()); }

export function getTableProfileTarget(): ProfileTarget | null { return target; }
export function openTableProfile(t: ProfileTarget): void { target = t; emit(); }
export function closeTableProfile(): void { if (target) { target = null; emit(); } }
export function useTableProfileTarget(): ProfileTarget | null {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f); }; },
    () => target,
    () => target,
  );
}

/* ------------------------------------------------------ mode decision */

/** True while a Table screen is mounted (it registers itself): faces tapped anywhere
 *  then open the over-table modal instead of the Social panel, so a mid-game tap
 *  never swaps screens. */
let hostActive = false;
export function setTableProfileHost(active: boolean): void { hostActive = active; }
export function isTableProfileHostActive(): boolean { return hostActive; }

/** Pure mode decision: an explicit `atTable` wins; otherwise the mounted table decides. */
export function profileModeFor(atTable: boolean | undefined, host: boolean): 'modal' | 'page' {
  return (atTable ?? host) ? 'modal' : 'page';
}

/**
 * The one entry point every avatar tap calls. Returns false (a graceful no-op) when
 * the face has no profile — a bot, a guest, an unknown id. `opts.atTable` forces the
 * presentation; surfaces outside the table leave it unset and the mounted-table flag
 * decides, so the same face behaves the same way everywhere it's rendered.
 */
export function openPlayerProfile(who: ProfileWho, opts?: { atTable?: boolean }): boolean {
  const t = profileTargetOf(who);
  if (!t) return false;
  if (profileModeFor(opts?.atTable, hostActive) === 'modal') {
    openTableProfile(t);
  } else {
    social.open();
    social.showProfile(t.name, t.pid);
  }
  return true;
}
