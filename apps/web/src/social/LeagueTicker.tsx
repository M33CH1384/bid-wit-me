/**
 * The BottomLine, app-wide (league data wave, item 6a — owner: "this ticker
 * should be consistent across the app"). ONE shared component, previously a
 * leaderboard-local footer:
 *
 *  - LeagueTickerRoot mounts it at the app root as a fixed bottom bar on
 *    the main surfaces: home/wizard, the online entry + lobby screens,
 *    /profile and /rewards. While it shows lines, <html> carries
 *    `bwm-ticker-on` and each surface gives the bar's height back out of
 *    its own box (extra bottom padding inside its full-height frame —
 *    see social.css), so no document grows and the bar never covers
 *    content: home stays exactly one viewport tall. A surface whose own
 *    bottom bar is viewport-fixed (the setup wizard's .setup-bar) takes
 *    the same height as a bottom offset instead — padding cannot move a
 *    fixed bar (owner, 2026-10-24; rules in social.css).
 *  - While the Social panel is open, the root bar steps aside and the
 *    panel renders the same component as its footer (variant "panel"),
 *    pinned flush to the sheet's bottom edge — one visible instance at
 *    a time. The panel footer hides on the chat / messages tabs, where
 *    the composer owns the bottom.
 *  - At a live table (html.bwm-in-game, set while a Table is mounted) the
 *    ticker does NOT render: the table's cards and action bar own the
 *    bottom edge and there is no safe slot. It returns the moment the
 *    table screen unmounts.
 *  - On /story the ticker does NOT render either (owner guardrail,
 *    2026-10-21): story mode is the come-up — its surfaces keep the warm
 *    neighborhood register and never carry the professional chapter's
 *    broadcast chrome. The fixed bar sliced across the Tale of the Tape
 *    mid-card; the story shell reserves no ticker height, in any phase.
 *
 * The bug is the full BWM wordmark lockup on an opaque block (item 5) and
 * the marquee runs ~25% faster than the original loop (owner tweak).
 * Lines are built strictly from real payloads — recent results, live
 * highlights, the rating board, power top, presence, the viewer's own
 * stats — never fabricated; with nothing real to say the bar is absent.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { statusLabel } from '@spades/protocol';
import { fx, useReduceEffects } from '../fx';
import { useSocial } from './store';

const get = (u: string) => fetch(u, { credentials: 'same-origin' }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`); return j; });

export type TickerKind = 'team' | 'cutthroat';
export interface TickerTopRow { name: string; value: number }
export interface TickerModeStats { games: number; elo: number | null; winPct: number | null; accuracy: number | null }
export interface TickerMine { team: TickerModeStats; cutthroat: TickerModeStats }
/** One online player for the ticker: a name plus what they're doing. */
export interface TickerOnline { name: string; detail: string }

/** One finished match from GET /api/social/results (league data wave). */
export interface RecentResult {
  id: string; at: number; kind: TickerKind; mode: string; code: string;
  sides: { names: string[]; score: number; won: boolean }[];
  wheels: boolean;
}

/** One live highlight from GET /api/social/highlights (item 6b). */
export interface LiveHighlight {
  id: string; at: number; type: string; name: string; text: string; code: string; hand: number | null;
}

const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
const RESULT_MODE: Record<string, string> = { joker: 'Joker', aceDown: 'Ace Down', cutthroat: 'Cutthroat', cutthroat4: 'Cutthroat' };

/**
 * One results line for the ticker, from the feed's stored facts only:
 * "Alpha + Bravo def. Char + Delta 500–320 · Joker". Cutthroat names the
 * winner and the full score line; a tie (more than one winning side) is
 * called a tie rather than inventing a loser.
 */
export function resultTickerLine(r: RecentResult): string {
  const mode = RESULT_MODE[r.mode] ?? r.mode;
  const won = r.sides.filter((s) => s.won);
  const lost = r.sides.filter((s) => !s.won);
  const names = (s: RecentResult['sides'][number]) => s.names.join(' + ');
  const flags = r.wheels ? ' · Wheels' : '';
  const scoresDesc = [...r.sides].sort((a, b) => b.score - a.score).map((s) => s.score).join('–');
  if (won.length !== 1) return `${won.map(names).join(' & ')} tied · ${mode} ${scoresDesc}${flags}`;
  if (r.kind === 'cutthroat') return `${names(won[0]!)} won ${mode} ${scoresDesc}${flags}`;
  if (!lost.length) return '';
  return `${names(won[0]!)} def. ${names(lost[0]!)} ${won[0]!.score}–${lost[0]!.score} · ${mode}${flags}`;
}

/** A ticker line: plain text, or a LIVE highlight (styled + badged). */
export interface TickerLine { text: string; live?: boolean }

/**
 * The ticker's lines, built STRICTLY from payloads that already exist
 * (owner's data rule, 2026-10-20 — never fabricate a result):
 *  - live highlights from games in progress (GET /api/social/highlights),
 *  - the recent-results feed (GET /api/social/results — finished online
 *    matches the server recorded; empty until real games finish),
 *  - the all-time Rating board for the current kind (top 3, with numbers),
 *  - the live presence list (who's online / at a table right now),
 *  - the signed-in viewer's own stat line (/api/social/me/stats).
 */
export function buildTickerLines(o: {
  kind: TickerKind; top: TickerTopRow[]; online: TickerOnline[]; mine: TickerMine | null;
  power?: { name: string; power: number }[]; results?: RecentResult[]; highlights?: LiveHighlight[];
}): TickerLine[] {
  const lines: TickerLine[] = [];
  for (const h of (o.highlights ?? []).slice(0, 3)) lines.push({ text: `LIVE — ${h.text}`, live: true });
  for (const r of (o.results ?? []).slice(0, 3)) {
    const line = resultTickerLine(r);
    if (line) lines.push({ text: line });
  }
  const kindLabel = o.kind === 'team' ? 'Partnership' : 'Cutthroat';
  if (o.top.length) {
    lines.push({ text: `Top rated · ${kindLabel} — ${o.top.slice(0, 3).map((r) => `${r.name} ${r.value}`).join(' · ')}` });
  }
  if (o.power?.length) {
    lines.push({ text: `Power Rankings — ${o.power.slice(0, 3).map((r, i) => `#${i + 1} ${r.name} (${r.power})`).join(' · ')}` });
  }
  if (o.online.length) {
    lines.push({ text: `Online now — ${o.online.slice(0, 6).map((p) => (p.detail && p.detail !== 'Online' ? `${p.name} (${p.detail.toLowerCase()})` : p.name)).join(' · ')}` });
  }
  const m = o.mine?.[o.kind];
  if (m && m.games > 0) {
    lines.push({ text: `You — ${m.elo == null ? 'Unrated' : `Rating ${m.elo}`} · ${m.games} games · Win ${pct(m.winPct)}${m.accuracy !== null ? ` · Bid accuracy ${pct(m.accuracy)}` : ''}` });
  }
  return lines;
}

/** Surface rule for the root mount, kept pure for tests. */
export function tickerRootVisible(s: { inGame: boolean; panelOpen: boolean; storyRoute?: boolean }): boolean {
  return !s.inGame && !s.panelOpen && !s.storyRoute;
}

/** True while a Table is mounted (html.bwm-in-game, set by antiPan.lockBody). */
export function useInGame(): boolean {
  const [on, setOn] = useState<boolean>(() => typeof document !== 'undefined' && document.documentElement.classList.contains('bwm-in-game'));
  useEffect(() => {
    const el = document.documentElement;
    const check = () => setOn(el.classList.contains('bwm-in-game'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return on;
}

/** The current route path, tracked across the app's popstate navigation. */
export function useLocationPath(): string {
  const [path, setPath] = useState<string>(() => (typeof location !== 'undefined' ? location.pathname : '/'));
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return path;
}

/**
 * The shared ticker bar. Self-contained: it polls the rating board, power
 * top, results feed and highlights feed on the ticker's 60s cadence, takes
 * presence live from the social store, and reads the viewer's own stats
 * (whose bigger pool picks the ticker's kind — the same default the
 * leaderboard opens with). `variant="bar"` is the fixed root bar;
 * `variant="panel"` is the in-flow Social panel footer.
 */
export function LeagueTicker({ variant, onHasLines }: { variant: 'bar' | 'panel'; onHasLines?: (b: boolean) => void }) {
  const s = useSocial();
  const reduceFx = useReduceEffects();
  const [osReduced, setOsReduced] = useState<boolean>(() => fx.osReducedMotion);
  const [kind, setKind] = useState<TickerKind>('team');
  const [top, setTop] = useState<TickerTopRow[]>([]);
  const [powerTop, setPowerTop] = useState<{ name: string; power: number }[]>([]);
  const [results, setResults] = useState<RecentResult[]>([]);
  const [highlights, setHighlights] = useState<LiveHighlight[]>([]);
  const [mine, setMine] = useState<TickerMine | null>(null);
  const [held, setHeld] = useState(false);
  const [step, setStep] = useState(0);
  const kindPicked = useRef(false);

  useEffect(() => {
    let stop = false;
    const load = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      get(`/api/social/leaderboard?board=rating&kind=${kind}&scope=global&period=all`)
        .then((j) => { if (!stop) setTop((j.rows ?? []) as TickerTopRow[]); })
        .catch(() => { /* ticker is garnish — a failed poll just keeps the last lines */ });
      get(`/api/social/power?kind=${kind}`)
        .then((j) => { if (!stop) setPowerTop(((j.rows ?? []) as { name: string; power: number }[]).map((r) => ({ name: r.name, power: r.power }))); })
        .catch(() => { /* same */ });
      get('/api/social/results?limit=10')
        .then((j) => { if (!stop) setResults((j.results ?? []) as RecentResult[]); })
        .catch(() => { /* same */ });
      get('/api/social/highlights')
        .then((j) => { if (!stop) setHighlights((j.highlights ?? []) as LiveHighlight[]); })
        .catch(() => { /* same — the endpoint lands with the highlights feed */ });
      get('/api/social/me/stats')
        .then((j) => {
          if (stop) return;
          const m = j as TickerMine;
          setMine(m);
          if (!kindPicked.current && m.cutthroat.games > m.team.games) { kindPicked.current = true; setKind('cutthroat'); }
        })
        .catch(() => { /* guests have no stats — the You line just stays out */ });
    };
    load();
    const iv = setInterval(load, 60_000);
    return () => { stop = true; clearInterval(iv); };
  }, [kind]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setOsReduced(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const online = useMemo<TickerOnline[]>(() => Object.values(s.users)
    .filter((u) => !u.guest)
    .map((u) => ({ name: u.name, detail: statusLabel(u.status) }))
    .sort((a, b) => Number(a.detail === 'Online') - Number(b.detail === 'Online') || a.name.localeCompare(b.name)), [s.users]);
  const lines = useMemo(() => buildTickerLines({ kind, top, online, mine, power: powerTop, results, highlights }), [kind, top, online, mine, powerTop, results, highlights]);
  const reduced = reduceFx || osReduced;

  useEffect(() => {
    if (!reduced || lines.length < 2) return;
    const iv = setInterval(() => setStep((x) => x + 1), 4000);
    return () => clearInterval(iv);
  }, [reduced, lines.length]);

  const has = lines.length > 0;
  useEffect(() => { onHasLines?.(has); }, [has, onHasLines]);

  if (!has) return null;
  // Owner tweak (2026-10-20): ~25% faster than the original 0.32 s/char
  // loop — the duration is cut to 0.8× (0.256 s/char, 13s floor vs 16s).
  const duration = Math.max(13, Math.round(lines.map((l) => l.text).join(' ').length * 0.256));
  const still = lines[step % lines.length]!;
  return (
    <div className={`ranks-ticker league-ticker ${variant}${held ? ' held' : ''}`} data-testid="ranks-ticker"
      onPointerDown={() => setHeld(true)} onPointerUp={() => setHeld(false)}
      onPointerLeave={() => setHeld(false)} onPointerCancel={() => setHeld(false)}>
      <span className="ticker-bug" aria-hidden="true">
        <img src="/assets/bwm-wordmark-white.svg" alt="" />
        <span className="ticker-beta">BETA</span>
      </span>
      <span className="sr-only" role="status">{lines.map((l) => l.text).join(' ')}</span>
      <div className="ticker-viewport">
        {reduced
          ? <div className={`ticker-still${still.live ? ' live' : ''}`} aria-hidden="true">{still.live && <i className="ticker-live-dot" />}{still.text}</div>
          : (
            <div className="ticker-track" aria-hidden="true" style={{ animationDuration: `${duration}s` }}>
              {[0, 1].map((copy) => (
                <span key={copy} className="ticker-copy">
                  {lines.map((l, i) => <span key={i} className={`ticker-line${l.live ? ' live' : ''}`}>{l.live && <i className="ticker-live-dot" />}{l.text}<i className="ticker-sep">♠</i></span>)}
                </span>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

/**
 * The root mount: a fixed bottom bar across the app's main surfaces.
 * Hidden at a live table (no safe bottom slot — the cards and action bar
 * own it), while the Social panel is open (the panel carries its own
 * footer instance), and on /story (story surfaces never carry broadcast
 * chrome — the bar sliced across the Tale of the Tape). While it shows
 * lines, <html> carries bwm-ticker-on so each surface reserves the bar's
 * height inside its own box instead of being covered by it.
 */
export function LeagueTickerRoot() {
  const s = useSocial();
  const inGame = useInGame();
  const storyRoute = useLocationPath() === '/story';
  const [hasLines, setHasLines] = useState(false);
  const show = tickerRootVisible({ inGame, panelOpen: s.open, storyRoute });
  useEffect(() => {
    document.documentElement.classList.toggle('bwm-ticker-on', show && hasLines);
    return () => { document.documentElement.classList.remove('bwm-ticker-on'); };
  }, [show, hasLines]);
  if (!show) return null;
  return <LeagueTicker variant="bar" onHasLines={setHasLines} />;
}
