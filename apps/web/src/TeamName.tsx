/** Team names: the offline "your team" name (saved locally) and the name editor used offline and online. */
import { type FormEvent, useEffect, useState, useSyncExternalStore } from 'react';
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
