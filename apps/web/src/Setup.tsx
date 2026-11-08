import { type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { CODE_LENGTH, isRoomCode, normalizeRoomCode } from '@spades/protocol';
import { Seg, Toggle } from './MoreOptions';
import { requestSettingsSheet } from './settingsSheet';
import { type ModeKey, type Settings, MODES, houseRulesDiff, modeTitle, rulesSummary, settingsToRules, targetScoreOptions } from './settings';
import { type TipsPref, isFirstVisit, saveTips } from './tips';
import { splashAction } from './splashTap';
import { coverThen } from './spray';
import { serverUrl } from './online/config';
import { createTable, tableInfo } from './online/connection';
import { type PendingMusic, SetupMusicPicker, savePendingMusic } from './online/HostMusic';
import { isMusicLink } from '@spades/protocol';
import { loadName, saveName } from './online/identity';
import { navigate } from './online/nav';
import { deckName } from './decks';
import { DeckGallery } from './DeckGallery';
import { SetupPreview } from './SetupPreview';
import { VENUE_DEFS, savePendingVenue, type VenueChoice } from './venues';
import { VenueSelect } from './VenueSelect';
import GearIcon from './GearIcon';
import { AccountEntry } from './account/AccountUI';
import { useAccount } from './account/api';
import { SocialButton } from './social/Social';
import { OpenTables } from './social/OpenTables';
import { OFFLINE_PAIR_KEY, PreviousTeamSelect, TeamNameField, TeamNameInput, pairTeamNames, savePendingTeamName, useTeamNameFor } from './TeamName';
import { STORY_OWNER_ONLY, fetchStoryAccess, storyLockedFor } from './story/storyApi';
import FireCanvas from './fire/FireCanvas';
import EmblemSmoke from './neon/EmblemSmoke';
import { HOME_FIRE_TIERS, fetchHomeStreak, homeFireLabel, homeFireTier, menuMusicBend, type HomeStreak } from './streakFire';
import { sound } from './audio';
import { homeBlizzardLabel, homeBlizzardTier } from './blizzard';
import BlizzardLayer from './snow/BlizzardLayer';
import { fx, useReduceEffects } from './fx';
import { FIRE_CALM_FADE_MS, entranceDecision, useEntranceElapsedMs, useIgnitedFireParams } from './homeEntrance';
import { whenBootRevealed } from './bootSplash';

/** Streak-fire band heights (px) by tier: T1 licks the bottom edge, T4
 *  earns the tall wall. The flames stay BEHIND the home column (the
 *  splash/actions are lifted above the band in fire.css). */
const HOME_BAND_HEIGHTS: Record<number, number> = { 1: 118, 2: 148, 3: 184, 4: 224 };
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

/**
 * The HOUSE RULES row shared by the bots setup and the online create form
 * (Finding E, responsive audit 2026-11-05 — the two sites used to carry a
 * hardcoded "Standard" literal each). The chip is derived, never stored:
 * houseRulesDiff(settings) is empty only when the effective rules match
 * the mode's defaults. When custom, the differing facets list under the
 * row in the rules-summary idiom, capped at three with a "+N more" tail
 * (the full set is one tap away in the sheet the row opens). The
 * commit-bar summary line is owner-locked and deliberately untouched —
 * a target-score-only difference still reads Custom here, because Target
 * score is a House rules row in the sheet.
 */
export function HouseRulesRow({ settings, onOpen }: { settings: Settings; onOpen: () => void }) {
  const diff = houseRulesDiff(settings);
  const shown = diff.slice(0, 3);
  const more = diff.length - shown.length;
  return (
    <>
      <button type="button" className="quiet-row" data-testid="house-rules" onClick={onOpen}><span>HOUSE RULES</span><span className="value-chip">{diff.length === 0 ? 'Standard' : 'Custom'}</span><i className="corner-tab" aria-hidden /></button>
      {diff.length > 0 && (
        <p className="rules-summary" data-testid="house-rules-diff">{`Custom: ${shown.join(' · ')}${more > 0 ? ` · +${more} more` : ''}`}</p>
      )}
    </>
  );
}

/** What the bottom bar commits to, from the same settings the form edits:
 *  "Joker Spades · Harlem · Grandma's Kitchen" (+ "· Play to 500" — the
 *  target is chosen on this step on both paths in the Rules card, the
 *  score's only home on the setup screens: owner, 2026-11-05 — it used
 *  to sit vs bots in Bots & score). */
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
  // The signpost is a SHORTCUT, never the only door (owner, 2026-10-24):
  // while a save stood here alone, the front door offered nothing but
  // resuming the solo match — no way into the mode gate, no way to
  // start a co-op run. So a plain Story Mode entry row stands beside
  // the signpost whenever it shows: it opens /story itself, where the
  // Solo/Co-op gate asks like it does for everyone else.
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
  // Streak fire (owner, 2026-10-27): the signed-in player's REAL current
  // win streak (server: cred_totals via /api/profile/me's streakFire
  // field). Signed out or no streak data → null → no fire, honestly.
  // Re-read when the identity changes, like the story flag above.
  const [homeStreak, setHomeStreak] = useState<HomeStreak | null>(null);
  const reduceFx = useReduceEffects();
  useEffect(() => {
    let live = true;
    void fetchHomeStreak().then((hs) => {
      if (!live) return;
      setHomeStreak(hs);
      // The same streak bends the menu theme (owner, 2026-11-05): the
      // engine holds it as state and applies it through its menu-gated
      // chain insert; no payload (guest / signed out) derives neutral.
      sound.setMenuStreakBend(menuMusicBend(hs));
    });
    return () => { live = false; };
  }, [storyUserId]);
  // The home atmosphere's tiers, from the one payload (fire + blizzard
  // are independent signals — different kinds can run hot and cold at
  // once; each renders on its own truth).
  const fireTier = homeStreak ? homeFireTier(homeStreak.streak) : 0;
  const blizTier = homeStreak ? homeBlizzardTier(homeStreak.lossStreak) : 0;
  const calmHome = reduceFx || fx.osReducedMotion;
  // MENU WEATHER / FIRE ENTRANCE (owner, 2026-11-05): the atmosphere
  // must ARRIVE, not snap on. The gate (homeEntrance.ts owns the
  // decision + curves): once per arrival, keyed to the streak state's
  // first presentation with an active atmosphere, and only once Home
  // is actually revealed — on the cold-open path the entrance waits
  // for the boot gate's reveal mark (the slam seam), so it never
  // starts under the splash or against the sting. Leaving the home
  // step resets the gate: a return is a new arrival and replays.
  const [entranceAt, setEntranceAt] = useState<number | null>(null);
  // The layers mount only once the gate has DECIDED for this arrival —
  // before that (payload in flight, or the reveal still pending on the
  // cold-open path) they simply aren't on screen yet, so the fire can
  // never flash at full strength for a frame and then drop to kindling.
  const [entranceDecided, setEntranceDecided] = useState(false);
  const entrancePlayedRef = useRef(false);
  useEffect(() => {
    if (step !== 'home') { entrancePlayedRef.current = false; setEntranceAt(null); setEntranceDecided(false); return; }
    if (!homeStreak) return; // payload pending: nothing presented yet, nothing armed
    if (entranceDecision(entrancePlayedRef.current, fireTier > 0 || blizTier > 0) !== 'play') { setEntranceDecided(true); return; }
    let live = true;
    void whenBootRevealed().then(() => {
      if (!live) return;
      entrancePlayedRef.current = true;
      setEntranceDecided(true);
      setEntranceAt(performance.now());
      // The ignition cue: once, at the build's first frame, and never
      // under calm (the fireOut hiss's reduce-effects gate). The
      // engine's own SFX settings rule it from there (off = silent).
      // The sustained crackle bed starts beside it under the same
      // gate (owner, 2026-11-07: the fire sound should persist, not
      // stop when the build ends) — the engine fades it in behind the
      // cue's settle and holds it for the fire band's whole lifetime.
      if (fireTier > 0 && !calmHome) { sound.play('fireIgnite'); sound.menuFireStart(true); }
    });
    return () => { live = false; };
  }, [step, homeStreak, fireTier, blizTier, calmHome]);
  // The fire bed's lifetime is the fire band's lifetime: it stops when
  // Home is left, when the streak state changes off fire, or when calm
  // applies — and if calm clears mid-arrival after the entrance has
  // played, the bed (only the bed; the ignite moment has passed)
  // starts plain. The engine reconciles the rest (the sound/music
  // switches, backgrounding, context rebuilds) against the same want.
  useEffect(() => {
    if (step !== 'home' || fireTier === 0 || calmHome) { sound.menuFireStop(); return; }
    if (entranceDecided && entrancePlayedRef.current) sound.menuFireStart(false);
  }, [step, fireTier, calmHome, entranceDecided]);
  useEffect(() => () => { sound.menuFireStop(); }, []);
  // The band's live params: kindling → tier row across the entrance
  // (settled / calm read the tier row as-is; calm fades the band in
  // instead — the reduced-motion fallback).
  const ignitedFireParams = useIgnitedFireParams(HOME_FIRE_TIERS[fireTier], entranceAt, !calmHome);
  const calmFireElapsed = useEntranceElapsedMs(calmHome ? entranceAt : null, FIRE_CALM_FADE_MS);
  const fireBandOpacity = calmHome && entranceAt != null ? Math.min(1, calmFireElapsed / FIRE_CALM_FADE_MS) : 1;
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

  // Spray-paint transitions (spray.ts): the wizard's steps are one screen's
  // flow and already slide step to step; the paint covers only the boundary
  // that is a true screen change — home (the start screen) <-> the setup
  // steps, in either direction, however it was crossed (the go/home/back
  // buttons below, or the back gesture in the popstate listener).
  const stepRef = useRef(step);
  stepRef.current = step;
  const crossesHome = (to: Step) => (stepRef.current === 'home') !== (to === 'home');
  const swapWiz = (apply: () => void, to: Step) => { if (crossesHome(to)) coverThen(apply); else apply(); };

  useEffect(() => {
    if (!(history.state as { wiz?: Step } | null)?.wiz) history.replaceState({ ...(history.state ?? {}), wiz: 'home' }, '');
    const on = () => {
      if (location.pathname !== '/') return; // a route popstate: Root owns it; the wizard is unmounting
      const w = readWiz();
      const apply = () => setWiz((cur) => { setDir(ORDER.indexOf(w.step) < ORDER.indexOf(cur.step) || (w.step === cur.step && cur.view === 'create' && w.view === 'lobby') ? 'back' : 'fwd'); return w; });
      if (crossesHome(w.step)) coverThen(apply);
      else apply();
    };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  // Wizard history: steps pushed by the wizard carry a depth `d`. The back arrow only uses history.back() when the
  // entry before is one of ours (d > 0); otherwise (we arrived from a finished / left game, or a deep link) it steps
  // to the previous wizard step in place — it can never land back on a table.
  const go = (next: Step, p: Path = path, k: Kind = kind, v: TableView = 'lobby') => {
    const apply = () => {
      const d = ((history.state as { d?: number } | null)?.d ?? 0) + 1;
      history.pushState({ wiz: next, path: p, kind: k, view: v, d }, '');
      setDir('fwd');
      setWiz({ step: next, path: p, kind: k, view: v });
    };
    swapWiz(apply, next);
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
    const apply = () => {
      history.replaceState({ wiz: prev, path, kind, view: 'lobby', d: 0 }, '', '/');
      setDir('back');
      setWiz({ step: prev, path, kind, view: 'lobby' });
    };
    swapWiz(apply, prev);
  };
  const home = () => {
    const apply = () => {
      history.replaceState({ wiz: 'home', path, kind, view: 'lobby', d: 0 }, '', '/');
      setDir('back');
      setWiz({ step: 'home', path, kind, view: 'lobby' });
    };
    swapWiz(apply, 'home');
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
    // fireTier / blizTier are computed at component level (the entrance
    // gate and its hooks need them outside this branch): the fire from
    // the payload's win half, the blizzard its loss half — the fire
    // read backwards (owner, 2026-11-04).
    const actions = (
      <div className="wiz-actions">
        {fireTier > 0 && homeStreak && (
          <div className="home-streak-chip" data-testid="home-streak-chip">{homeFireLabel(homeStreak.streak)}</div>
        )}
        {blizTier > 0 && homeStreak && (
          <div className="home-blizzard-chip" data-testid="home-blizzard-chip">{homeBlizzardLabel(homeStreak.lossStreak)}</div>
        )}
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
          <>
            <button type="button" className="quiet-row story-resume-row" data-testid="story-mode" data-resume-stop={storySave.stop.id} onClick={() => navigate(`/story?resume=${storySave.stop.id}`)}><span>Resume — {storySave.stop.name}</span><span className="value-chip">{storyPairLabel(storySave.stop)} · Hand {storySave.handNo}</span></button>
            <button type="button" className="quiet-row" data-testid="story-mode-entry" onClick={() => navigate('/story')}><span>Story mode</span><span className="value-chip">Solo or co-op</span></button>
          </>
        ) : (
          <button type="button" className="quiet-row" data-testid="story-mode" onClick={() => navigate('/story')}><span>Story mode</span><span className="value-chip">Run the block</span></button>
        )}
      </div>
    );
    body = (
      <div className="wiz-home">
        {/* Emblem smoke (owner, 2026-10-29): animated smoke inside the
            Neon emblem painting. Decoration in both themes' DOM (an
            identical, inert wrapper; the canvas exists only in Neon
            with motion allowed) — never a control, never a destination. */}
        <EmblemSmoke />
        {/* Blizzard weather (owner, 2026-11-04): an out-of-flow layer
            behind the splash and actions — flakes and frost around the
            content, never over a control. Calm (reduced motion) keeps
            the static frost and drops the falling snow. */}
        {blizTier > 0 && entranceDecided && (
          <BlizzardLayer tier={blizTier as 1 | 2 | 3} calm={calmHome} entranceStartedAt={entranceAt} />
        )}
        {fireTier > 0 && entranceDecided && (
          <div className="home-streak-fire" data-testid="home-streak-fire" style={{ height: HOME_BAND_HEIGHTS[fireTier], opacity: fireBandOpacity }}>
            <FireCanvas mode="band" params={ignitedFireParams} calm={calmHome} />
          </div>
        )}
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
        <div className="wiz-head">
          <p className="wiz-crumb">Play</p>
          <h2 className="wiz-title">What are we playing?</h2>
          <p className="wiz-stepno">Step 1 of 3</p>
        </div>
        <div className="decision-cards">
          <DecisionCard testid="door-team" title="TEAM GAME" sub="2v2 — partners across from each other" emblem="PARTNERS" onPick={() => go('branch', path, 'team')} />
          <DecisionCard testid="door-cutthroat" title="CUTTHROAT" sub="4 players — every player for themselves" emblem="SOLO" onPick={() => { set('mode', 'cutthroat4'); go('opponent', path, 'cut'); }} />
        </div>
      </>
    );
  } else if (step === 'branch' && kind === 'team') {
    body = (
      <>
        <div className="wiz-head">
          <p className="wiz-crumb">Team Game</p>
          <h2 className="wiz-title">Team Game — which kind?</h2>
          <p className="wiz-stepno">Step 2 of 3</p>
        </div>
        <div className="decision-cards">
          <DecisionCard testid="mode-joker" title="JOKERS" sub="Joker Spades — jokers high, partners" emblem="JOKERS HIGH" onPick={() => { set('mode', 'joker'); go('opponent'); }} />
          <DecisionCard testid="mode-aceDown" title="ACE DOWN" sub="Ace Down — aces lead, partners" emblem="ACES LEAD" onPick={() => { set('mode', 'aceDown'); go('opponent'); }} />
        </div>
      </>
    );
  } else if (step === 'opponent' || step === 'branch') {
    body = (
      <>
        <div className="wiz-head">
          <p className="wiz-crumb">{MODE_CRUMB[s.mode]}</p>
          <h2 className="wiz-title">Who are you playing?</h2>
          <p className="wiz-stepno">{kind === 'cut' ? 'Step 2 of 2' : 'Step 3 of 3'}</p>
        </div>
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
        <div className="wiz-head">
          <p className="wiz-crumb">{MODE_CRUMB[s.mode]} · {path === 'online' ? 'Play Online' : 'Vs Bots'}</p>
          <h2 className="wiz-title">{path === 'online' ? (view === 'create' ? 'Create a table' : 'Find a table') : 'Your Table'}<small>{mode.title}</small></h2>
        </div>
        {path === 'bots' ? (
          <div className="ess ess-barred">
            {!cut && (
              <SetupCard title="Your team">
                <div className="ess-row stack">
                  <span className="ess-label">Team name<small>for you + your bot partner — saved for this pairing</small></span>
                  <TeamNameField value={offlineTeamName} placeholder="You & your partner" onSave={(v) => pairTeamNames.set(OFFLINE_PAIR_KEY, v)} testId="setup-team-name" />
                  <PreviousTeamSelect current={offlineTeamName} onPick={(v) => pairTeamNames.set(OFFLINE_PAIR_KEY, v)} testId="setup-team-prev" />
                </div>
              </SetupCard>
            )}
            <SetupCard title="Bots & score">
              <div className="ess-row stack" data-testid="bots-row">
                <span className="ess-label">Bots</span>
                <Seg label="Bot skill" value={s.botLevel} options={[['mixed', 'Mixed'], ['novice', 'Novice'], ['regular', 'Regular'], ['pro', 'Pro'], ['shark', 'Shark']]} onChange={(v) => set('botLevel', v)} />
              </div>
            </SetupCard>
            <SetupCard title="Deck & venue">
              {deck}
              <div className="ess-row stack"><span className="ess-label">Pick your deck — tap to choose it; tap it again, or tap the eye, to browse its cards</span><DeckGallery value={s.deck} onChange={(v) => set('deck', v)} /></div>
              <VenueSetupRow value={s.venue ?? 'classic'} onChange={(v) => set('venue', v)} />
            </SetupCard>
            <SetupCard title="Rules">
              <HouseRulesRow settings={s} onOpen={() => requestSettingsSheet()} />
              {cutRules}
              <RulesStatLine settings={s} />
              <div className="ess-row">
                <span className="ess-label">Play to<small>the end score for this table</small></span>
                <Seg label="Target score" value={s.targetScore} options={targetScoreOptions(s)} onChange={(v) => set('targetScore', v)} />
              </div>
              {summary}
              {tipsRow}
            </SetupCard>
            <SetupPreview deck={s.deck} venue={s.venue ?? 'classic'} />
            <SetupBar summary={setupBarSummary(s, true)}><button type="button" className="primary big go" data-testid="start-bots" onClick={onStart}>DEAL ME IN</button><p className="sticky-note">No seating step vs bots — bots fill the table</p></SetupBar>
          </div>
        ) : (
          <OnlineStep settings={s} venue={s.venue ?? 'classic'} onVenue={(v) => set('venue', v)} deck={deck} deckId={s.deck} deckGallery={<DeckGallery value={s.deck} onChange={(v) => set('deck', v)} />} barSummary={setupBarSummary(s, true)} onHouseRules={() => requestSettingsSheet()} onTargetScore={(v) => set('targetScore', v)} summary={summary} tipsRow={tipsRow} view={view} onOpenCreate={() => go('table', 'online', kind, 'create')} />
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
 * define the table at a glance — mode, target, players, timers — over the
 * full rules summary's fine print. Since 2026-11-05 (owner) the four facts
 * STACK as full-width rows, label left / value right: the old 4-across grid
 * ellipsized the values ("Joker Spa…", "30s bid · 3…") at phone widths.
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
 * The lobby comes first — your name (guests only: a signed-in player sits
 * under their account name, owner 2026-11-06), join with a code, the open
 * tables, and exactly ONE "Create a table" entry. The create form is its own
 * step (the wizard's Back returns here), regrouped ESPN-style into cards.
 * Name and music state live here so moving between the two screens keeps
 * what you typed.
 */
function OnlineStep({ settings, venue, onVenue, deck, deckId, deckGallery, barSummary, onHouseRules, onTargetScore, summary, tipsRow, view, onOpenCreate }: {
  settings: Settings; venue: VenueChoice; onVenue: (v: VenueChoice) => void; deck: ReactNode; deckId: string; deckGallery: ReactNode;
  barSummary: string; onHouseRules: () => void; onTargetScore: (v: Settings['targetScore']) => void; summary: ReactNode; tipsRow: ReactNode; view: TableView; onOpenCreate: () => void;
}) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [music, setMusic] = useState<PendingMusic | null>(null);
  /* Create-a-table (owner, 2026-11-05): the form's first question at a team
   * table is the TEAM name — typed new, or one tap on a previous team. It
   * rides the pending handoff into the room (savePendingTeamName) and the
   * lobby names the creator's side with it, through the TeamChip's own
   * message + roster validation. Nothing is blocked here: no partner is
   * seated yet. Cutthroat has no team names — no row, no pending. */
  const [teamName, setTeamName] = useState('');
  const partnerships = settingsToRules(settings).partnerships;
  const acct = useAccount();
  /* The 'Your name' field is REMOVED from both online screens for signed-in
   * players (owner, 2026-11-06: "if it's a guest it can appear, but if the
   * user is signed in it's just in the way"). While signed in, the seat
   * name is the account username, full stop — the per-table override dies
   * with the field, and the account layer syncs the stored name to the
   * username so every downstream reader (OnlineApp hello, presence) sees
   * the account name. Guests keep the field exactly as before — it is
   * their only name. A signed-in account with no username yet has no
   * account name to sit under, so it keeps the field until it has one. */
  const accountName = acct.user?.username?.trim() ?? '';
  const useAccountName = accountName.length > 0;
  const effectiveName = useAccountName ? accountName : name;
  const nameOk = effectiveName.trim().length > 0;
  const create = async () => {
    if (!nameOk) { setErr('Enter your name first'); return; }
    if (music?.mode === 'link' && !isMusicLink(music.url.trim())) { setErr('Paste an open.spotify.com or music.apple.com link (or set Table music to Off)'); return; }
    setBusy(true); setErr(null);
    try {
      const c = await createTable(serverUrl());
      savePendingVenue(c, venue);
      savePendingMusic(c, music?.mode === 'link' ? { ...music, url: music.url.trim() } : music);
      if (partnerships) savePendingTeamName(c, teamName);
      saveName(effectiveName.trim());
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
      saveName(effectiveName.trim());
      navigate(`/t/${c}`);
    } catch { setErr("Can't reach the game server."); } finally { setBusy(false); }
  };
  const nameRow = (sub?: string) => (
    <label className="ess-row">
      <span className="ess-label">Your name{sub && <small>{sub}</small>}</span>
      <input className="name-input" value={name} maxLength={20} autoComplete="nickname" placeholder="e.g. Meech" onChange={(e) => setName(e.target.value)} aria-label="Your name" />
    </label>
  );
  if (view === 'create') {
    return (
      <div className="ess ess-barred" key="create">
        {/* The TABLE card exists only while it has a question to ask: the
            team name (partnership) and/or a guest's name. A signed-in
            cutthroat creator has neither — no empty card shell. */}
        {(partnerships || !useAccountName) && (
          <SetupCard title="Table">
            {partnerships && (
              <div className="ess-row stack">
                <span className="ess-label">Team name<small>your side plays under it — you can change it in the lobby</small></span>
                <TeamNameInput value={teamName} placeholder="e.g. Homies" onChange={setTeamName} testId="create-team-name" />
                <PreviousTeamSelect current={teamName} onPick={setTeamName} testId="create-team-prev" />
              </div>
            )}
            {/* Guests only — a signed-in player sits under their account
                name and is never asked (owner, 2026-11-06). */}
            {!useAccountName && nameRow('shown at the table')}
          </SetupCard>
        )}
        <SetupCard title="Deck & venue">
          {deck}
          <div className="ess-row stack"><span className="ess-label">Pick your deck — tap to choose it; tap it again, or tap the eye, to browse its cards</span>{deckGallery}</div>
          <VenueSetupRow value={venue} onChange={onVenue} />
          {/* The same live preview the bots setup shows (owner 2026-11-05,
              audit G5): one SetupPreview, two hosts — here it rides inside
              the card, driven by this form's own venue/deck picks. Locked
              venues stay unpickable in VenueSelect, so they can never be
              the previewed selection here either. */}
          <SetupPreview deck={deckId} venue={venue} />
        </SetupCard>
        <SetupCard title="Rules">
          <RulesStatLine settings={settings} />
          <div className="ess-row">
            <span className="ess-label">Play to<small>the end score for this table</small></span>
            <Seg label="Target score" value={settings.targetScore} options={targetScoreOptions(settings)} onChange={onTargetScore} />
          </div>
          {summary}
          <HouseRulesRow settings={settings} onOpen={onHouseRules} />
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
      {/* The "You" card held ONLY the name field, so for a signed-in
          player (account name is the seat name) the whole card goes —
          guests keep it exactly as it was (owner, 2026-11-06). */}
      {!useAccountName && (
        <section className="setup-card" aria-label="You">
          <h3 className="setup-card-h">You</h3>
          {nameRow()}
        </section>
      )}
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
