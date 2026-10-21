import { type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { CODE_LENGTH, isRoomCode, normalizeRoomCode } from '@spades/protocol';
import { Seg, Toggle } from './MoreOptions';
import { requestSettingsSheet } from './settingsSheet';
import { type ModeKey, type Settings, MODES, modeTitle, rulesSummary, settingsToRules } from './settings';
import { type TipsPref, isFirstVisit, saveTips } from './tips';
import { splashAction } from './splashTap';
import { serverUrl } from './online/config';
import { createTable, tableInfo } from './online/connection';
import { type PendingMusic, SetupMusicPicker, savePendingMusic } from './online/HostMusic';
import { isMusicLink } from '@spades/protocol';
import { loadName, saveName } from './online/identity';
import { navigate } from './online/nav';
import { DECKS } from './decks';
import { VENUE_DEFS, savePendingVenue, type VenueChoice } from './venues';
import { VenueSelect } from './VenueSelect';
import GearIcon from './GearIcon';
import { AccountEntry } from './account/AccountUI';
import { SocialButton } from './social/Social';
import { OpenTables } from './social/OpenTables';
import { OFFLINE_PAIR_KEY, TeamNameField, pairTeamNames, useTeamNameFor } from './TeamName';
import { STORY_OWNER_ONLY, fetchStoryDev, storyLockedFor } from './story/storyApi';

/**
 * Start flow as a wizard: splash (logo + Play Online / Play vs Bots + Resume) → mode → essentials → go.
 * Each step slides in; the browser / phone back gesture goes back a step (history.state.wiz).
 * Everything else lives behind the gear ("More options").
 */
type Step = 'home' | 'door' | 'branch' | 'opponent' | 'table';
type Path = 'bots' | 'online';
type Kind = 'team' | 'cut';
/** The online 'table' step has two screens (owner, 2026-10-20 lobby restructure):
 *  the lobby (join + open tables + one Create entry) and the create form as its
 *  own step. Kept in history.state next to the wizard step so the back gesture
 *  walks create → lobby → opponent like any other wizard transition. */
type TableView = 'lobby' | 'create';
const ORDER: Step[] = ['home', 'door', 'branch', 'opponent', 'table'];
/** Founder menu rework (Concept A): one decision per screen — format (Door 1), then the
 *  branch choice, then opponent, then table essentials. Mode payloads are the same
 *  settings.mode keys as before; only the asking order changed. */

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  /** Tips prefs live in App so the Settings sheet host and the wizard share one copy. */
  tips: TipsPref;
  onTips: (t: TipsPref) => void;
  onStart: () => void;
  /** Offline game in progress (save in localStorage). */
  onResume?: (() => void) | null;
  resumeLabel?: string;
}

const ONE_LINERS: Record<ModeKey, string> = {
  joker: 'Partners · Jokers beat every spade',
  cutthroat4: 'Every player for themselves',
  cutthroat3: '3 players · 17 cards each',
  aceDown: 'Partners · classic deck, aces high',
};
const MODE_TAG: Record<ModeKey, string> = { joker: '2 v 2', cutthroat4: '4 players', cutthroat3: '3 players', aceDown: '2 v 2' };

function readWiz(): { step: Step; path: Path; kind: Kind; view: TableView } {
  const w = (history.state ?? {}) as { wiz?: string; path?: Path; kind?: Kind; view?: TableView };
  // legacy wizard steps from before the rework land on their nearest new screen
  const legacy: Record<string, Step> = { mode: 'door', setup: 'table' };
  const step = (w.wiz && (ORDER.includes(w.wiz as Step) ? (w.wiz as Step) : legacy[w.wiz])) || 'home';
  return { step, path: w.path ?? 'bots', kind: w.kind ?? 'team', view: w.view === 'create' ? 'create' : 'lobby' };
}

/** Most recent online seat (token saved in the last 12 h) → offer to rejoin it if the table still exists. */
function useOnlineSeat(): string | null {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    try {
      const t = JSON.parse(localStorage.getItem('bwm.online.tokens') ?? '{}') as Record<string, { at: number }>;
      const recent = Object.entries(t).filter(([, v]) => Date.now() - v.at < 12 * 3600_000).sort((a, b) => b[1].at - a[1].at)[0];
      if (recent) {
        tableInfo(serverUrl(), recent[0])
          .then((i) => { if (alive && i.exists && i.phase !== 'over' && i.phase !== 'lobby') setCode(recent[0]); })
          .catch(() => {});
      }
    } catch { /* ignore */ }
    return () => { alive = false; };
  }, []);
  return code;
}

const MODE_CRUMB: Record<ModeKey, string> = { joker: 'Team Game · Jokers', aceDown: 'Team Game · Ace Down', cutthroat4: 'Cutthroat', cutthroat3: 'Cutthroat · 3 Players' };

/** Deck picker as real card thumbnails (founder menu rework): King of each deck, gold outline when picked. */
export function DeckThumbs({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="deck-thumbs" role="radiogroup" aria-label="Card deck">
      {DECKS.map((d) => (
        <button key={d.id} type="button" role="radio" aria-checked={value === d.id} className={`dt ${value === d.id ? 'on' : ''}`} aria-label={d.name} data-testid={`deck-${d.id}`} onClick={() => onChange(d.id)}>
          <img src={`/assets/decks/${d.id}/KS.jpg`} alt="" loading="lazy" /><span>{d.name}</span>
        </button>
      ))}
    </div>
  );
}

/** One big neutral decision card (gold only once selected — cards navigate on tap, per §8 no pre-selection). */
function DecisionCard({ testid, title, sub, emblem, onPick }: { testid: string; title: string; sub: string; emblem: string; onPick: () => void }) {
  return (
    <button type="button" className="decision-card" data-testid={testid} onClick={onPick}>
      <span className="dc-main"><b>{title}</b><small>{sub}</small></span>
      <span className="dc-emblem">{emblem}</span>
    </button>
  );
}

/**
 * Venue choice in Table essentials (founder: it must be pickable per game in setup,
 * not only buried in the Settings sheet). Feeds settings.venue unchanged: an explicit
 * pick wins in sessionRoom, Random keeps the per-game roll.
 */
export function VenueSetupRow({ value, onChange }: { value: VenueChoice; onChange: (v: VenueChoice) => void }) {
  return (
    <div className="ess-row stack" data-testid="venue-row">
      <span className="ess-label">Venue<small>{value === 'random' ? 'A different spot every game' : VENUE_DEFS[value].blurb}</small></span>
      <VenueSelect value={value} onChange={onChange} testId="venue-select-setup" randomLabel="🎲 Random — a different spot every game" />
    </div>
  );
}

export default function Setup({ settings: s, onChange, tips, onTips, onStart, onResume, resumeLabel }: Props) {
  const [{ step, path, kind, view }, setWiz] = useState(readWiz);
  // Story-mode owner lock: the home row is locked until the dev flag says otherwise.
  const [storyDev, setStoryDev] = useState<boolean | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void fetchStoryDev().then((d) => { if (live) setStoryDev(d); });
    return () => { live = false; };
  }, []);
  const offlineTeamName = useTeamNameFor(OFFLINE_PAIR_KEY);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [ask, setAsk] = useState(isFirstVisit);
  const onlineSeat = useOnlineSeat();
  const touchAt = useRef(0);
  const choose = (fn: () => void) => ({
    onPointerUp: (e: ReactPointerEvent) => {
      if (splashAction({ type: 'pointerup', pointerType: e.pointerType }, touchAt.current, performance.now()) === 'ignore') return;
      touchAt.current = performance.now();
      fn();
    },
    onClick: () => {
      if (splashAction({ type: 'click' }, touchAt.current, performance.now()) === 'ignore') return;
      fn();
    },
  });
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });

  useEffect(() => {
    if (!(history.state as { wiz?: Step } | null)?.wiz) history.replaceState({ ...(history.state ?? {}), wiz: 'home' }, '');
    const on = () => {
      const w = readWiz();
      setWiz((cur) => { setDir(ORDER.indexOf(w.step) < ORDER.indexOf(cur.step) || (w.step === cur.step && cur.view === 'create' && w.view === 'lobby') ? 'back' : 'fwd'); return w; });
    };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  // Wizard history: steps pushed by the wizard carry a depth `d`. The back arrow only uses history.back() when the
  // entry before is one of ours (d > 0); otherwise (we arrived from a finished / left game, or a deep link) it steps
  // to the previous wizard step in place — it can never land back on a table.
  const go = (next: Step, p: Path = path, k: Kind = kind, v: TableView = 'lobby') => {
    const d = ((history.state as { d?: number } | null)?.d ?? 0) + 1;
    history.pushState({ wiz: next, path: p, kind: k, view: v, d }, '');
    setDir('fwd');
    setWiz({ step: next, path: p, kind: k, view: v });
  };
  const back = () => {
    const d = (history.state as { d?: number } | null)?.d ?? 0;
    if (d > 0) { history.back(); return; }
    // Deep-linked straight into the create form (no wizard history under it):
    // back lands on the lobby, never out of the wizard.
    if (step === 'table' && view === 'create') {
      history.replaceState({ wiz: 'table', path, kind, view: 'lobby', d: 0 }, '', '/');
      setDir('back');
      setWiz({ step: 'table', path, kind, view: 'lobby' });
      return;
    }
    // Cutthroat has no branch step (Door 1 goes straight to Opponent): skip it on the in-place fallback.
    const prev = step === 'opponent' && kind === 'cut' ? 'door' : ORDER[Math.max(0, ORDER.indexOf(step) - 1)]!;
    history.replaceState({ wiz: prev, path, kind, view: 'lobby', d: 0 }, '', '/');
    setDir('back');
    setWiz({ step: prev, path, kind, view: 'lobby' });
  };
  const home = () => {
    history.replaceState({ wiz: 'home', path, kind, view: 'lobby', d: 0 }, '', '/');
    setDir('back');
    setWiz({ step: 'home', path, kind, view: 'lobby' });
  };
  const setTipsPref = (on: boolean) => { const t = { on, asked: true }; saveTips(t); onTips(t); };

  let body: ReactNode;
  if (step === 'home') {
    // ONE home composition for both themes (owner parity rule: switching
    // theme must never change what the app does or shows — Neon is a visual
    // treatment only). The splash and the primary actions below are the
    // single shared tree: same buttons, same testids, same splash-tap
    // guard. Neon's dressing on this screen is pure CSS (styles.css): the
    // ink behind the column, glass on the shared elements, and the
    // emblem/card art painted by .wiz-home::before/::after — decoration
    // layered behind the splash, never DOM, never a destination.
    const actions = (
      <div className="wiz-actions">
        {onResume ? (
          <>
            <button type="button" className="hero-btn gold" data-testid="resume" onClick={onResume}><b>RESUME GAME</b><small>{resumeLabel ?? 'your game in progress'}</small></button>
            <button type="button" className="hero-btn purple" data-testid="play" {...choose(() => go('door'))}><b>PLAY</b><small>start a new game</small></button>
          </>
        ) : (
          <button type="button" className="hero-btn gold" data-testid="play" {...choose(() => go('door'))}><b>PLAY</b><small>Team Game or Cutthroat</small></button>
        )}
        {onlineSeat && <button type="button" className="quiet-row" data-testid="resume-online" onClick={() => navigate(`/t/${onlineSeat}`)}><span>Rejoin your online table</span><span className="value-chip">{onlineSeat}</span></button>}
        {STORY_OWNER_ONLY && storyLockedFor(storyDev === undefined ? null : storyDev) ? (
          <button type="button" className="quiet-row" data-testid="story-mode-locked" disabled aria-disabled="true"><span>🔒 Story mode</span><span className="value-chip">Coming soon</span></button>
        ) : (
          <button type="button" className="quiet-row" data-testid="story-mode" onClick={() => navigate('/story')}><span>Story mode</span><span className="value-chip">Run the block</span></button>
        )}
      </div>
    );
    body = (
      <div className="wiz-home">
        <div className="splash">
          <div className="splash-logo-wrap"><img className="logo splash-logo" src="/assets/bwm-wordmark-white.svg" alt="" /><span className="beta-tag" data-testid="beta-tag">BETA</span></div>
          <h1 className="sr-only">Bid Wit Me</h1>
          <p className="tagline">Spades with the crew</p>
        </div>
        {actions}
      </div>
    );
  } else if (step === 'door') {
    body = (
      <>
        <p className="wiz-crumb">Play</p>
        <h2 className="wiz-title">What are we playing?</h2>
        <p className="wiz-stepno">Step 1 of 3</p>
        <div className="decision-cards">
          <DecisionCard testid="door-team" title="TEAM GAME" sub="2v2 — partners across from each other" emblem="PARTNERS" onPick={() => go('branch', path, 'team')} />
          <DecisionCard testid="door-cutthroat" title="CUTTHROAT" sub="4 players — every player for themselves" emblem="SOLO" onPick={() => { set('mode', 'cutthroat4'); go('opponent', path, 'cut'); }} />
        </div>
      </>
    );
  } else if (step === 'branch' && kind === 'team') {
    body = (
      <>
        <p className="wiz-crumb">Team Game</p>
        <h2 className="wiz-title">Team Game — which kind?</h2>
        <p className="wiz-stepno">Step 2 of 3</p>
        <div className="decision-cards">
          <DecisionCard testid="mode-joker" title="JOKERS" sub="Joker Spades — jokers high, partners" emblem="JOKERS HIGH" onPick={() => { set('mode', 'joker'); go('opponent'); }} />
          <DecisionCard testid="mode-aceDown" title="ACE DOWN" sub="Ace Down — aces lead, partners" emblem="ACES LEAD" onPick={() => { set('mode', 'aceDown'); go('opponent'); }} />
        </div>
      </>
    );
  } else if (step === 'opponent' || step === 'branch') {
    body = (
      <>
        <p className="wiz-crumb">{MODE_CRUMB[s.mode]}</p>
        <h2 className="wiz-title">Who are you playing?</h2>
        <p className="wiz-stepno">{kind === 'cut' ? 'Step 2 of 2' : 'Step 3 of 3'}</p>
        <div className="decision-cards">
          <DecisionCard testid="play-online" title="PLAY ONLINE" sub="Open tables, create or join with a code" emblem="TABLES" onPick={() => go('table', 'online')} />
          <DecisionCard testid="play-bots" title="VS BOTS" sub="Solo table — no seating step" emblem="SOLO TABLE" onPick={() => go('table', 'bots')} />
        </div>
      </>
    );
  } else {
    const mode = MODES.find((m) => m.key === s.mode)!;
    const cut = s.mode.startsWith('cutthroat');
    const deck = cut && (
      <div className="ess-row">
        <span className="ess-label">Deck</span>
        <Seg label="Deck" value={s.cutthroatDeck} options={[['joker54', 'Jokers'], ['standard52', 'Standard 52']]} onChange={(v) => set('cutthroatDeck', v)} />
      </div>
    );
    // Cutthroat bid rules (locked once the game starts) + the one-line table summary for every mode
    const cutRules = cut && (
      <>
        <div className="ess-row">
          <span className="ess-label">Minimum books / bid<small>Hand 1: fewer books is a shot. Nil is off.</small></span>
          <Seg label="Minimum books / bid" value={s.cutMinBid ?? 1} options={[[1, '1'], [2, '2'], [3, '3'], [4, '4']]} onChange={(v) => set('cutMinBid', v)} />
        </div>
        <div className="ess-row cut-toggles" data-testid="cut-toggles">
          <label><span>Bags</span><Toggle label="Bags and penalties" value={s.bagsOn !== false} onChange={(v) => set('bagsOn', v)} /></label>
        </div>
      </>
    );
    const summary = <p className="rules-summary" data-testid="rules-summary">{rulesSummary(settingsToRules(s))}</p>;
    const tipsRow = (
      <div className="ess-row tips-row">
        <span className="ess-label">Show me how to play<small>tips + a bid coach as you play</small></span>
        <Toggle label="Show me how to play (tips as you play)" value={tips.on} onChange={setTipsPref} />
      </div>
    );
    body = (
      <>
        <p className="wiz-crumb">{MODE_CRUMB[s.mode]} · {path === 'online' ? 'Play Online' : 'Vs Bots'}</p>
        <h2 className="wiz-title">{path === 'online' ? (view === 'create' ? 'Create a table' : 'Find a table') : 'Your Table'}<small>{mode.title}</small></h2>
        {path === 'bots' ? (
          <div className="ess">
            {!cut && (
              <section className="setup-card" aria-label="Your team">
                <h3 className="setup-card-h">Your team</h3>
                <div className="ess-row stack">
                  <span className="ess-label">Team name<small>for you + your bot partner — saved for this pairing</small></span>
                  <TeamNameField value={offlineTeamName} placeholder="You & your partner" onSave={(v) => pairTeamNames.set(OFFLINE_PAIR_KEY, v)} testId="setup-team-name" />
                </div>
              </section>
            )}
            <section className="setup-card" aria-label="Bots & score">
              <h3 className="setup-card-h">Bots &amp; score</h3>
              <div className="ess-row stack" data-testid="bots-row">
                <span className="ess-label">Bots</span>
                <Seg label="Bot skill" value={s.botLevel} options={[['mixed', 'Mixed'], ['novice', 'Novice'], ['regular', 'Regular'], ['pro', 'Pro'], ['shark', 'Shark']]} onChange={(v) => set('botLevel', v)} />
              </div>
              <div className="ess-row">
                <span className="ess-label">Play to</span>
                <Seg label="Target score" value={s.targetScore} options={[250, 300, 500].map((x) => (x === (cut ? 300 : 500) ? ['default', String(x)] : [x, String(x)])) as [number | 'default', string][]} onChange={(v) => set('targetScore', v)} />
              </div>
            </section>
            <section className="setup-card" aria-label="Deck & venue">
              <h3 className="setup-card-h">Deck &amp; venue</h3>
              {deck}
              <div className="ess-row stack"><span className="ess-label">Pick your deck — tap for the full card</span><DeckThumbs value={s.deck} onChange={(v) => set('deck', v)} /></div>
              <VenueSetupRow value={s.venue ?? 'classic'} onChange={(v) => set('venue', v)} />
            </section>
            <section className="setup-card" aria-label="Rules">
              <h3 className="setup-card-h">Rules</h3>
              <button type="button" className="quiet-row" data-testid="house-rules" onClick={() => requestSettingsSheet()}><span>HOUSE RULES</span><span className="value-chip">Standard</span><i className="corner-tab" aria-hidden /></button>
              {cutRules}
              <RulesStatLine settings={s} />
              {summary}
              {tipsRow}
            </section>
            <div className="sticky-primary"><button type="button" className="primary big go" data-testid="start-bots" onClick={onStart}>DEAL ME IN</button><p className="sticky-note">No seating step vs bots — bots fill the table</p></div>
          </div>
        ) : (
          <OnlineStep settings={s} venue={s.venue ?? 'classic'} onVenue={(v) => set('venue', v)} deck={deck} deckThumbs={<DeckThumbs value={s.deck} onChange={(v) => set('deck', v)} />} onHouseRules={() => requestSettingsSheet()} summary={summary} tipsRow={tipsRow} view={view} onOpenCreate={() => go('table', 'online', kind, 'create')} />
        )}
      </>
    );
  }

  return (
    <div className={`wizard step-${step}`} data-testid="wizard">
      <header className="wiz-bar">
        {step !== 'home' ? (
          <span className="wiz-nav">
            <button type="button" className="back-chip" aria-label="Back" data-testid="wiz-back" onClick={back}><svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><path d="M6 1 L1.5 6 L6 11 M2 6 H17" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="square"/></svg>BACK</button>
            <button type="button" className="icon-btn home" aria-label="Home" title="Home" data-testid="wiz-home" onClick={home}><img src="/assets/bwm-wordmark-white.svg" alt="" /></button>
          </span>
        ) : <AccountEntry showChip />}
        <div className="wiz-dots" aria-hidden>{ORDER.map((x) => <i key={x} className={x === step ? 'on' : ''} />)}</div>
        <span className="wiz-right">
          <SocialButton className="wiz-social" />
          <button type="button" className="icon-btn gear" aria-label="More options" data-testid="more" onClick={() => requestSettingsSheet()}><GearIcon /></button>
          <span className="dock-slot" aria-hidden />
        </span>
      </header>
      <main key={step} className={`wiz-step slide-${dir}`}>{body}</main>
      {/* the Settings sheet itself is rendered by App's SettingsSheetHost (one sheet for
          the whole app); the gear + House Rules buttons above file the request */}
      {ask && (
        <div className="modal-backdrop">
          <div className="modal glass slant tips-ask" role="dialog" aria-label="New to Spades?">
            <div className="panel-title big">NEW TO SPADES?</div>
            <p>Turn on tips? I'll coach you as you play, and help you count your books at bid time. You can switch them off any time.</p>
            <div className="bid-row">
              <button type="button" onClick={() => { setTipsPref(false); setAsk(false); }}>No thanks</button>
              <button type="button" className="primary" data-testid="tips-yes" onClick={() => { setTipsPref(true); setAsk(false); }}>Yes, tips on</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The house-rules stat line (ESPN pattern, owner 2026-10-20): the numbers that
 * define the table at a glance — mode, target, players, timers — as strong
 * cells over the full rules summary's fine print.
 */
export function RulesStatLine({ settings }: { settings: Settings }) {
  const r = settingsToRules(settings);
  const cells: [string, string][] = [
    ['Mode', modeTitle(r)],
    ['Play to', String(r.targetScore)],
    ['Players', String(r.playerCount)],
    ['Timers', `${r.turnTimerSec.bid}s bid · ${r.turnTimerSec.play}s play`],
  ];
  return (
    <div className="rules-stats" data-testid="rules-stats" role="list" aria-label="Table rules at a glance">
      {cells.map(([k, v]) => (
        <div key={k} className="rules-stat" role="listitem"><b>{v}</b><small>{k}</small></div>
      ))}
    </div>
  );
}

/**
 * The online 'table' step (owner, 2026-10-20 lobby restructure): TWO screens.
 * The lobby comes first — your name, join with a code, the open tables, and
 * exactly ONE "Create a table" entry. The create form is its own step (the
 * wizard's Back returns here), regrouped ESPN-style into cards. Name and music
 * state live here so moving between the two screens keeps what you typed.
 */
function OnlineStep({ settings, venue, onVenue, deck, deckThumbs, onHouseRules, summary, tipsRow, view, onOpenCreate }: {
  settings: Settings; venue: VenueChoice; onVenue: (v: VenueChoice) => void; deck: ReactNode; deckThumbs: ReactNode;
  onHouseRules: () => void; summary: ReactNode; tipsRow: ReactNode; view: TableView; onOpenCreate: () => void;
}) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [music, setMusic] = useState<PendingMusic | null>(null);
  const nameOk = name.trim().length > 0;
  const create = async () => {
    if (!nameOk) { setErr('Enter your name first'); return; }
    if (music?.mode === 'link' && !isMusicLink(music.url.trim())) { setErr('Paste an open.spotify.com or music.apple.com link (or set Table music to Off)'); return; }
    setBusy(true); setErr(null);
    try {
      const c = await createTable(serverUrl());
      savePendingVenue(c, venue);
      savePendingMusic(c, music?.mode === 'link' ? { ...music, url: music.url.trim() } : music);
      saveName(name.trim());
      sessionStorage.setItem(`bwm.created.${c}`, '1');
      navigate(`/t/${c}`);
    } catch (e) { setErr((e as Error).message || "Can't reach the game server."); } finally { setBusy(false); }
  };
  const join = async (e?: FormEvent) => {
    e?.preventDefault();
    const c = normalizeRoomCode(code);
    if (!nameOk) { setErr('Enter your name first'); return; }
    if (!isRoomCode(c)) { setErr(`Table codes are ${CODE_LENGTH} letters/numbers`); return; }
    setBusy(true); setErr(null);
    try {
      const i = await tableInfo(serverUrl(), c);
      if (!i.exists) { setErr(`No table with code ${c}`); return; }
      saveName(name.trim());
      navigate(`/t/${c}`);
    } catch { setErr("Can't reach the game server."); } finally { setBusy(false); }
  };
  const nameRow = (
    <label className="ess-row">
      <span className="ess-label">Your name</span>
      <input className="name-input" value={name} maxLength={20} autoComplete="nickname" placeholder="e.g. Meech" onChange={(e) => setName(e.target.value)} aria-label="Your name" />
    </label>
  );
  if (view === 'create') {
    return (
      <div className="ess" key="create">
        <section className="setup-card" aria-label="Table">
          <h3 className="setup-card-h">Table</h3>
          {nameRow}
        </section>
        <section className="setup-card" aria-label="Deck & venue">
          <h3 className="setup-card-h">Deck &amp; venue</h3>
          {deck}
          <div className="ess-row stack"><span className="ess-label">Pick your deck — tap for the full card</span>{deckThumbs}</div>
          <VenueSetupRow value={venue} onChange={onVenue} />
        </section>
        <section className="setup-card" aria-label="Rules">
          <h3 className="setup-card-h">Rules</h3>
          <RulesStatLine settings={settings} />
          {summary}
          <button type="button" className="quiet-row" data-testid="house-rules" onClick={onHouseRules}><span>HOUSE RULES</span><span className="value-chip">Standard</span><i className="corner-tab" aria-hidden /></button>
          {tipsRow}
        </section>
        <section className="setup-card" aria-label="Sound">
          <h3 className="setup-card-h">Sound</h3>
          <SetupMusicPicker value={music} onChange={setMusic} />
        </section>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="sticky-primary"><button type="button" className="primary big go" disabled={busy} onClick={create} data-testid="create-table">CREATE TABLE</button></div>
      </div>
    );
  }
  return (
    <div className="ess" key="lobby">
      <section className="setup-card" aria-label="You">
        <h3 className="setup-card-h">You</h3>
        {nameRow}
      </section>
      <section className="setup-card" aria-label="Join with a code">
        <h3 className="setup-card-h">Join with a code</h3>
        <form className="join-row quiet-join" onSubmit={join}>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="TABLE CODE" maxLength={8} aria-label="Table code" autoCapitalize="characters" />
          <button type="submit" className="micro-action" disabled={busy} data-testid="join-code">JOIN</button>
        </form>
      </section>
      <button type="button" className="primary big go lobby-create" data-testid="create-open" onClick={onOpenCreate}>CREATE A TABLE</button>
      <OpenTables selected={settings.mode} />
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
