/** Team names: per-pairing names (owner, 2026-10-20), the retired global offline
 *  name it migrates from, and the name editors used at setup and online. */
import { type FormEvent, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { TEAM_NAME_MAX, cleanTeamName } from '@spades/protocol';

const KEY = 'bwm.teamName';
const subs = new Set<() => void>();
const read = () => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };
let cur = read();
export const myTeamName = {
  get: () => cur,
  set(v: string) { cur = v; try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* ignore */ } subs.forEach((f) => f()); },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};
export function useMyTeamName(): string { return useSyncExternalStore(myTeamName.subscribe, myTeamName.get, myTeamName.get); }

/* ------------------------------------------------------- per-pairing names */

/**
 * Per-pairing team names (owner, 2026-10-20): a team name belongs to a
 * PAIRING and is set at table setup when the partner is picked — it is no
 * longer a global Settings field. Keys: 'offline' (you + your bot partner,
 * picked at the bots table step) and 'user:<username>' (an account partner,
 * picked in the Big Bank challenge flows). Stored on this device; account
 * pairings also ride the account progress blob (account/api.ts), so they
 * follow the account, and the Big Bank flows carry the name on the challenge
 * itself so the match table is seeded with it. The retired global name
 * (myTeamName) is the migration source: a pairing with no saved name falls
 * back to it (that is where the old "Homies" lives now).
 */
const PAIR_KEY = 'bwm.teamNames.v1';
export const OFFLINE_PAIR_KEY = 'offline';
/** Pairing key for a user partner; slugified so it always matches the key
 *  shape the server's progress sanitize accepts ([a-z0-9:._-]). */
export const pairKeyForUser = (username: string): string => `user:${username.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`;

const readPairMap = (): Record<string, string> => {
  try {
    const j = JSON.parse(localStorage.getItem(PAIR_KEY) ?? '{}') as unknown;
    if (!j || typeof j !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) if (typeof v === 'string' && v) out[k] = v;
    return out;
  } catch { return {}; }
};
let pairMap: Record<string, string> = readPairMap();
const pairSubs = new Set<() => void>();
const emitPair = () => pairSubs.forEach((f) => f());
const writePairMap = () => { try { localStorage.setItem(PAIR_KEY, JSON.stringify(pairMap)); } catch { /* ignore */ } };

export const pairTeamNames = {
  /** The pairing's own saved name ('' when none) — no legacy fallback. */
  get: (key: string): string => pairMap[key] ?? '',
  /** All saved pairings (for the account progress sync). */
  all: (): Record<string, string> => ({ ...pairMap }),
  set(key: string, name: string) {
    const v = cleanTeamName(name);
    if (v === null) return;
    if (v) pairMap = { ...pairMap, [key]: v };
    else { const next = { ...pairMap }; delete next[key]; pairMap = next; }
    writePairMap();
    emitPair();
  },
  /** Merge names pulled from the account (account wins per key, device fills gaps). */
  merge(incoming: Record<string, string>) {
    let changed = false;
    const next = { ...pairMap };
    for (const [k, v] of Object.entries(incoming)) {
      const c = typeof v === 'string' ? cleanTeamName(v) : null;
      if (c && next[k] !== c) { next[k] = c; changed = true; }
    }
    if (changed) { pairMap = next; writePairMap(); emitPair(); }
  },
  subscribe(f: () => void) { pairSubs.add(f); return () => { pairSubs.delete(f); }; },
};

/** The name a pairing plays under: its saved name, else the retired global name, else ''. */
export const teamNameFor = (key: string): string => pairTeamNames.get(key) || myTeamName.get();

export function useTeamNameFor(key: string): string {
  const subscribe = useCallback((f: () => void) => {
    const offPair = pairTeamNames.subscribe(f);
    const offLegacy = myTeamName.subscribe(f);
    return () => { offPair(); offLegacy(); };
  }, []);
  const get = useCallback(() => teamNameFor(key), [key]);
  return useSyncExternalStore(subscribe, get, get);
}

/** Controlled, form-free team-name input for flows that submit as part of a
 *  bigger form (Big Bank create / accept). Validates on blur; the caller
 *  cleans + saves on submit. */
export function TeamNameInput({ value, placeholder, onChange, label = 'Team name', testId }: {
  value: string; placeholder: string; onChange: (v: string) => void; label?: string; testId: string;
}) {
  const [err, setErr] = useState('');
  return (
    <span className="team-name-input">
      <input value={value} maxLength={TEAM_NAME_MAX} placeholder={placeholder} aria-label={label} data-testid={testId}
        onChange={(e) => { setErr(''); onChange(e.target.value); }}
        onBlur={() => { if (value.trim() && cleanTeamName(value) === null) setErr("That name isn't allowed"); }} />
      {err && <small className="err" role="alert">{err}</small>}
    </span>
  );
}

/** Name editor: trims, max 20 (emoji ok), filtered. '' resets to the partner names. */
export function TeamNameField({ value, placeholder, onSave, label = 'Team name', testId = 'team-name' }: { value: string; placeholder: string; onSave: (name: string) => void; label?: string; testId?: string }) {
  const [text, setText] = useState(value);
  const [err, setErr] = useState('');
  useEffect(() => setText(value), [value]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = cleanTeamName(text);
    if (v === null) { setErr("That name isn't allowed"); return; }
    setErr('');
    setText(v);
    onSave(v);
  };
  return (
    <form className="team-name-edit" onSubmit={submit} data-testid={testId}>
      <label className="sr-only" htmlFor={`${testId}-in`}>{label}</label>
      <input id={`${testId}-in`} value={text} maxLength={TEAM_NAME_MAX} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={submit} aria-label={label} />
      <button type="submit" className="small">Save</button>
      {err && <small className="err" role="alert">{err}</small>}
    </form>
  );
}
