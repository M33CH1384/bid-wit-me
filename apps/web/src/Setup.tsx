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
import { deckName } from './decks';
import { DeckGallery } from './DeckGallery';
import { VENUE_DEFS, savePendingVenue, type VenueChoice } from './venues';
import { VenueSelect } from './VenueSelect';
import GearIcon from './GearIcon';
import { AccountEntry } from './account/AccountUI';
import { useAccount } from './account/api';
import { SocialButton } from './social/Social';
import { OpenTables } from './social/OpenTables';
import { OFFLINE_PAIR_KEY, TeamNameField, pairTeamNames, useTeamNameFor } from './TeamName';
import { STORY_OWNER_ONLY, fetchStoryAccess, storyLockedFor } from './story/storyApi';
import { loadStoryGame, storySaveSummary, type StorySaveSummary } from './story/storySave';
import { storyPairLabel } from './story/storySettings';

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

/**
 * Bottom-anchored commit bar for the table step (owner, 2026-10-23 setup
 * rework): the step's create action plus a live one-line summary of the
 * choices, fixed to the bottom of the screen (safe-area aware) while the
 * section cards scroll under it. Rendered inline with position:fixed — the
 * wizard step's slide animation settles at transform:none, so the bar
 * anchors to the viewport like the app's other fixed UI (sound dock, coach).
 */
export function SetupBar({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <div className="setup-bar" data-testid="setup-bar">
      <p className="setup-bar-summary" data-testid="setup-bar-summary">{summary}</p>
      <div className="setup-bar-actions">{children}</div>
    </div>
  );
}

/**
 * One collapsible section card on the table step (owner, 2026-10-23): the
 * header is a tap target that folds/unfolds the body (smooth height
 * transition; instant under reduced motion). Every card folds independently
 * — no accordion — so the Rules card is always reachable without unfolding
 * anything else first. All cards start open: same first-visit layout as
 * before, folding is the player's choice. The chevron is CSS-drawn so the
 * header's text stays exactly the card title.
 */
export function SetupCard({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`setup-card${open ? '' : ' is-closed'}`} aria-label={title}>
      <h3 className="setup-card-h">
        <button type="button" className="setup-card-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span>{title}</span>
          <span className="setup-card-chevron" aria-hidden="true" />
        </button>
      </h3>
      <div className="setup-card-body"><div className="setup-card-body-in">{children}</div></div>
    </section>
  );
}

/** What the bottom bar commits to, from the same settings the form edits:
 *  "Joker Spades · Harlem · Grandma's Kitchen" (+ "· Play to 500" vs bots,
 *  where the target is chosen on this step). */
export function setupBarSummary(s: Settings, withTarget: boolean): string {
  const r = settingsToRules(s);
  const venue = !s.venue || s.venue === 'random' ? 'Random venue' : (VENUE_DEFS[s.venue as keyof typeof VENUE_DEFS]?.name ?? 'Random venue');
  const parts = [modeTitle(r), deckName(s.deck), venue];
  if (withTarget) parts.push(`Play to ${r.targetScore}`);
  return parts.join(' · ');
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
  // Story-mode owner lock: the home row is locked until the story-access
  // flag says otherwise (admins + the server's named player allowlist —
  // keyed off storyAccess, never dev, so an allowlisted player gets the
  // player row with no dev surface anywhere).
  const [storyAccess, setStoryAccess] = useState<boolean | null | undefined>(undefined);
  // Re-read whenever the signed-in identity changes: the flag rides the
  // profile fetch, which the account store invalidates at the same
  // transition, so an in-page sign-in (passkey) converges to the server's
  // truth without a restart. Until the fresh flag lands the state resets
  // to undefined, which renders locked — fail closed, never a stale open.
  const storyUserId = useAccount().user?.id ?? null;
  useEffect(() => {
    let live = true;
    setStoryAccess(undefined);
    void fetchStoryAccess().then((a) => { if (live) setStoryAccess(a); });
    return () => { live = false; };
  }, [storyUserId]);
  // A story match in progress on this device (owner, 2026-10-21): the home
  // story row becomes its resume signpost. The facts come from the SAME
  // summary derivation the /story map card renders (storySaveSummary over
  // the story save slot) so Home and the map can never disagree about the
  // game that's waiting. Re-read on mount and whenever the app returns to
  // the front — finishing, discarding, or resetting the match (the reset
  // tool clears this same slot) must never leave a ghost resume behind.
  const [storySave, setStorySave] = useState<StorySaveSummary | null>(() => storySaveSummary(loadStoryGame()));
  useEffect(() => {
    const reread = () => setStorySave(storySaveSummary(loadStoryGame()));
    const onVisibility = () => { if (document.visibilityState === 'visible') reread(); };
    window.addEventListener('focus', reread);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', reread);
      document.removeEventListener('visibilitychange', onVisibility);
    };
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
        {STORY_OWNER_ONLY && storyLockedFor(storyAccess === undefined ? null : storyAccess) ? (
          <button type="button" className="quiet-row" data-testid="story-mode-locked" disabled aria-disabled="true"><span>🔒 Story mode</span><span className="value-chip">Coming soon</span></button>
        ) : storySave ? (
          <button type="button" className="quiet-row story-resume-row" data-testid="story-mode" data-resume-stop={storySave.stop.id} onClick={() => navigate(`/story?resume=${storySave.stop.id}`)}><span>Resume — {storySave.stop.name}</span><span className="value-chip">{storyPairLabel(storySave.stop)} · Hand {storySave.handNo}</span></button>
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
          <div className="ess ess-barred">
            {!cut && (
              <SetupCard title="Your team">
                <div className="ess-row stack">
                  <span className="ess-label">Team name<small>for you + your bot partner — saved for this pairing</small></span>
                  <TeamNameField value={offlineTeamName} placeholder="You & your partner" onSave={(v) => pairTeamNames.set(OFFLINE_PAIR_KEY, v)} testId="setup-team-name" />
                </div>
              </SetupCard>
            )}
            <SetupCard title="Bots & score">
              <div className="ess-row stack" data-testid="bots-row">
                <span className="ess-label">Bots</span>
                <Seg label="Bot skill" value={s.botLevel} options={[['mixed', 'Mixed'], ['novice', 'Novice'], ['regular', 'Regular'], ['pro', 'Pro'], ['shark', 'Shark']]} onChange={(v) => set('botLevel', v)} />
              </div>
              <div className="ess-row">
                <span className="ess-label">Play to</span>
                <Seg label="Target score" value={s.targetScore} options={[250, 300, 500].map((x) => (x === (cut ? 300 : 500) ? ['default', String(x)] : [x, String(x)])) as [number | 'default', string][]} onChange={(v) => set('targetScore', v)} />
              </div>
            </SetupCard>
            <SetupCard title="Deck & venue">
              {deck}
              <div className="ess-row stack"><span className="ess-label">Pick your deck — tap a deck to browse its cards</span><DeckGallery value={s.deck} onChange={(v) => set('deck', v)} /></div>
              <VenueSetupRow value={s.venue ?? 'classic'} onChange={(v) => set('venue', v)} />
            </SetupCard>
            <SetupCard title="Rules">
              <button type="button" className="quiet-row" data-testid="house-rules" onClick={() => requestSettingsSheet()}><span>HOUSE RULES</span><span className="value-chip">Standard</span><i className="corner-tab" aria-hidden /></button>
              {cutRules}
              <RulesStatLine settings={s} />
              {summary}
              {tipsRow}
            </SetupCard>
            <SetupBar summary={setupBarSummary(s, true)}><button type="button" className="primary big go" data-testid="start-bots" onClick={onStart}>DEAL ME IN</button><p className="sticky-note">No seating step vs bots — bots fill the table</p></SetupBar>
          </div>
        ) : (
          <OnlineStep settings={s} venue={s.venue ?? 'classic'} onVenue={(v) => set('venue', v)} deck={deck} deckGallery={<DeckGallery value={s.deck} onChange={(v) => set('deck', v)} />} barSummary={setupBarSummary(s, false)} onHouseRules={() => requestSettingsSheet()} summary={summary} tipsRow={tipsRow} view={view} onOpenCreate={() => go('table', 'online', kind, 'create')} />
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
function OnlineStep({ settings, venue, onVenue, deck, deckGallery, barSummary, onHouseRules, summary, tipsRow, view, onOpenCreate }: {
  settings: Settings; venue: VenueChoice; onVenue: (v: VenueChoice) => void; deck: ReactNode; deckGallery: ReactNode;
  barSummary: string; onHouseRules: () => void; summary: ReactNode; tipsRow: ReactNode; view: TableView; onOpenCreate: () => void;
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
      <div className="ess ess-barred" key="create">
        <SetupCard title="Table">
          {nameRow}
        </SetupCard>
        <SetupCard title="Deck & venue">
          {deck}
          <div className="ess-row stack"><span className="ess-label">Pick your deck — tap a deck to browse its cards</span>{deckGallery}</div>
          <VenueSetupRow value={venue} onChange={onVenue} />
        </SetupCard>
        <SetupCard title="Rules">
          <RulesStatLine settings={settings} />
          {summary}
          <button type="button" className="quiet-row" data-testid="house-rules" onClick={onHouseRules}><span>HOUSE RULES</span><span className="value-chip">Standard</span><i className="corner-tab" aria-hidden /></button>
          {tipsRow}
        </SetupCard>
        <SetupCard title="Sound">
          <SetupMusicPicker value={music} onChange={setMusic} />
        </SetupCard>
        {err && <div className="err" role="alert">{err}</div>}
        <SetupBar summary={barSummary}><button type="button" className="primary big go" disabled={busy} onClick={create} data-testid="create-table">CREATE TABLE</button></SetupBar>
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
