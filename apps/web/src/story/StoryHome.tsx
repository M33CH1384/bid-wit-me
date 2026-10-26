/**
 * Story Mode home (Phase 1 — the solo route): the map of the block, stop by
 * stop, plus the solo run itself. Flow per stop:
 *   map → intro script → game (you + Dee vs the stop's pair, at their venue,
 *   under their twist) → outro script → map (next stop unlocked).
 *
 * Progress and rewards are server-side (/api/story/*): the map renders the
 * stored facts, a finished game posts its result once (idempotent per game),
 * and a loss is a free retry with nothing lost.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { secureSeed } from '@spades/rules';
import {
  STORY_SECRETS, STORY_STOPS, STORY_CHARACTERS, STORY_TIER_LABEL, STORY_TIER_SKILL, beatsFor, deeSkillForStop,
  kingDoubleBeats, mannerBandOf, storyClearReward, targetForStop, type MannerBand, type StoryBeatFacts, type StoryGameFacts, type StoryStop,
} from '@spades/bots';
import Table from '../Table';
import { usePresence } from '../social/Social';
import SettingsSheetHost from '../SettingsSheetHost';
import { NowPlaying } from '../SoundControls';
import { CoinIcon } from '../RepBlock';
import { sound } from '../audio';
import { type TipsPref, loadTips } from '../tips';
import { type Settings, loadSettings, saveSettings } from '../settings';
import { navigate } from '../online/nav';
import { coverThen } from '../spray';
import { useAccount } from '../account/api';
import { storyRulesFor, storySettingsFor } from './storySettings';
import { storyBackdropUrl } from './storyBackdrop';
import { STORY_OWNER_ONLY, createStoryRoom, fetchStoryAccess, fetchStoryDev, fetchStoryProgress, fetchStoryTracks, joinStoryRoom, postStoryFound, postStoryResetStop, postStoryResult, routeFactsFor, storyLockedFor, type StoryNewFind, type StoryProgress, type StoryResult, type StoryTracks } from './storyApi';
import CoopPartner from './CoopPartner';
import StoryRoom from './StoryRoom';
import { deckUnlockNotice, invalidateStoryProgress } from '../storyDecks';
import { setAnimForStop, setAnimUnlockNotice } from '../setAnims';
import { deckForStop, type DeckDef } from '../decks';
import { DeckViewer } from '../DeckGallery';
import { deckBackUrl } from '../three/cardTextures';
import { clearStoryGame, loadStoryGame, storySaveSummary, storySaveValidFor, type StorySavedGame } from './storySave';
import { railCastForAttempt, rundownFor, storyBadgesFor } from '@spades/bots';
import ScriptPlayer, { type SceneEgg } from './ScriptPlayer';
import { livingMoodFor } from './storyLiving';
import { SceneAudio } from './SceneAudio';
import StoryTape from './StoryTape';
import StoryFace from './StoryFace';
import StoryBadges, { StoryBadgeReveal, badgeFactsOf } from './StoryBadges';
import { FindDetail, SetAnimDetail } from './StoryDetailSheet';
import './story.css';

type Screen =
  | { k: 'map' }
  | { k: 'tape'; stop: StoryStop }
  | { k: 'intro'; stop: StoryStop }
  | { k: 'game'; stop: StoryStop; seed: string; resumeSave?: StorySavedGame }
  | { k: 'outro'; stop: StoryStop; won: boolean };

/**
 * The rewards screen's Rematch button lands a finished story match back
 * here with ?rematch=<stopId> (Table stashes the stop's identity in the
 * rewards payload — see RewardsPage.rematchPathFor). Parse + validate the
 * directive: an id that names no stop is not a directive, just the map.
 */
/** How long a story sub-screen gets to settle before its top position is
 *  re-asserted once (see the settle effect in StoryHome). Long enough for
 *  portrait/backdrop decode and the Rundown panel's clip resolution on a
 *  phone; short enough that a displaced opening is corrected before the
 *  player reaches for the scroll themselves. */
export const STORY_SCROLL_SETTLE_MS = 900;

export function storyRematchStopId(search: string): string | null {
  try {
    const id = new URLSearchParams(search).get('rematch');
    return id && STORY_STOPS.some((s) => s.id === id) ? id : null;
  } catch { return null; }
}

/**
 * The Home screen's story row deep-links a player with a match in progress
 * here with ?resume=<stopId> (the save's own stop — see Setup). Same
 * discipline as the rematch directive: an id that names no stop is not a
 * directive, just the map. Consuming it never trusts the param alone —
 * the local save must exist, name the same stop, and still validate
 * against server progress (storySaveValidFor) before anything resumes.
 */
export function storyResumeStopId(search: string): string | null {
  try {
    const id = new URLSearchParams(search).get('resume');
    return id && STORY_STOPS.some((s) => s.id === id) ? id : null;
  } catch { return null; }
}

/**
 * The mode gate's answer, remembered for the tab session (owner,
 * 2026-10-22 22:29: "if I hit play on a story mode game the entire
 * game flashes and takes me back to the menu asking if I want to
 * play solo or co-op — if I try a second time it works").
 *
 * The flash is the chunk self-heal doing its job: a deploy deletes
 * the previous build's hashed chunks (chunkLoad.ts), so a page
 * opened before the deploy — his predated f07f2131, which changed
 * Table.tsx + beatPacing.ts inside this route's chunk graph — asks
 * for a chunk that no longer exists, and importChunk reloads the
 * document once onto the new build. The reload is correct. What it
 * destroyed was this: the gate's answer was in-memory state, and
 * `mode` is never set back to null inside the component, so the
 * gate can only reappear through a fresh mount — the heal's reload
 * re-asked a question the player had already answered, and the
 * retry then worked because the new boot's chunks all resolve.
 *
 * The answer now lives in sessionStorage — the same tab-scoped
 * lifetime as the heal's own reload flag — and a heal reload that
 * lands back on this screen restores it instead of re-asking (see
 * initialStoryMode below).
 *
 * What the remembered answer is NOT (owner, 2026-10-24): a pass for
 * the rest of the session. Reading it back on every mount made
 * co-op unreachable from the front door — start a solo run, go
 * Home, tap Story Mode again, and the remembered 'solo' rode
 * straight to the solo map; with a match in progress, Home's only
 * story row was Resume, so the pair run had no door at all. The
 * answer is now read back in exactly one case: this document is a
 * reload of the story screen itself (the heal's landing, or the
 * player's own refresh mid-visit). Every deliberate entry is asked
 * at the gate like a first visit, solo run or no solo run.
 */
export const STORY_MODE_KEY = 'bwm.storyMode.v1';

export function storedStoryMode(storage: Pick<Storage, 'getItem'> | null | undefined): 'solo' | 'coop' | null {
  try {
    const v = storage?.getItem(STORY_MODE_KEY);
    return v === 'solo' || v === 'coop' ? v : null;
  } catch { return null; }
}

export function loadStoryMode(): 'solo' | 'coop' | null {
  try { return storedStoryMode(typeof sessionStorage !== 'undefined' ? sessionStorage : null); }
  catch { return null; }
}

export function saveStoryMode(m: 'solo' | 'coop'): void {
  try { sessionStorage.setItem(STORY_MODE_KEY, m); } catch { /* private mode: the gate just asks again */ }
}

/**
 * Is this document a reload of the story screen itself? The
 * navigation entry carries both facts: its type is 'reload' only
 * when the document itself was reloaded (the chunk heal's landing,
 * or the player's own refresh mid-visit), and its name is the URL
 * that document loaded at — so a reload at Home followed by a tap
 * into Story Mode is an ENTRY, not a reload of /story, and it asks.
 * Anything unknown (no entry, an unparseable name, an environment
 * without the API) reads as an entry: the gate asking one extra
 * time is a tap; the gate never asking was a trap.
 */
export function storyReloadEntry(entries: readonly { type?: string; name?: string }[] | undefined): boolean {
  const e = entries?.[0];
  if (!e || e.type !== 'reload' || !e.name) return false;
  try { return new URL(e.name).pathname === '/story'; }
  catch { return e.name.split(/[?#]/)[0]!.endsWith('/story'); }
}

export function storyDocumentReload(): boolean {
  try {
    const perf = (globalThis as { performance?: { getEntriesByType?: (t: string) => unknown } }).performance;
    const entries = perf?.getEntriesByType?.('navigation') as { type?: string; name?: string }[] | undefined;
    return storyReloadEntry(entries);
  } catch { return false; }
}

/**
 * The mode a fresh StoryHome mount starts with: the remembered
 * answer when this document is a reload of the story screen itself
 * (the heal must land on the map, not re-ask); no answer — the
 * gate — on every deliberate entry.
 */
export function initialStoryMode(): 'solo' | 'coop' | null {
  return storyDocumentReload() ? loadStoryMode() : null;
}

export default function StoryHome() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [tips, setTips] = useState<TipsPref>(loadTips);
  const applySettings = (s: Settings) => { setSettings(s); saveSettings(s); };
  const [screen, setScreen] = useState<Screen>({ k: 'map' });
  // Screen transitions (transitions.ts): story's own screen changes
  // ride the spray/ink — except anything touching the table ('game'
  // on either side): the seats hold owns entering a match, and a
  // finished match's outro keeps its own ceremony, so game-adjacent
  // swaps stay exactly as they were. One class is its own program:
  // stepping from the map INTO a stop's screens (its tape or its
  // intro) walks through THE DOORWAY — warm light, story register.
  // Every setScreen call site routes through here so the rule lives
  // in one place.
  const goScreen = (next: Screen) => {
    if (next.k !== screen.k && next.k !== 'game' && screen.k !== 'game') {
      const throughDoor = screen.k === 'map' && (next.k === 'tape' || next.k === 'intro');
      coverThen(() => setScreen(next), throughDoor ? 'story-entry' : 'screen');
    }
    else setScreen(next);
  };
  // Friend presence (owner, 2026-10-22): the story surfaces report Story
  // mode · Solo — browsing the map/scenes is story time; the match itself
  // reports as the (offline) story table. activityOf reads `story` first,
  // so friends never see a story run as a plain bot game.
  const [room, setRoom] = useState<{ code: string; track: string | null } | null>(null);
  usePresence(screen.k === 'game' ? { kind: 'table', offline: true, story: 'solo' } : { kind: 'online', story: 'solo' });
  // The sit-down opens on the Tale of the Tape, then the scene plays.
  const [introStep, setIntroStep] = useState<'tape' | 'scene'>('tape');
  useEffect(() => { if (screen.k === 'intro') setIntroStep('tape'); }, [screen]);
  const [progress, setProgress] = useState<StoryProgress | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Owner-only lock (STORY_OWNER_ONLY): undefined = access flag still
  // loading. The lock keys off storyAccess (admins + the server's named
  // player allowlist) — dev is fetched separately and now gates ONLY
  // the owner reset tool below, so an allowlisted player gets the full
  // player experience with no dev surface.
  const [dev, setDev] = useState<boolean | null | undefined>(undefined);
  const [storyAccess, setStoryAccess] = useState<boolean | null | undefined>(undefined);
  const [lockedByServer, setLockedByServer] = useState(false);

  // ---- Story co-op (Phases 1–2) ----
  // The mode gate stands at the entry, after the lock/checking screens
  // and before the map, for signed-in players with story access. Every
  // deliberate entry is asked (initialStoryMode): a solo run in
  // progress, or an answer remembered earlier in the session, must
  // never swallow the Solo/Co-op choice. The one mount that restores
  // the remembered answer instead is a reload of the story document
  // itself — the chunk self-heal landing mid-visit. Deep links
  // (?rematch= / ?resume=) are solo business and bypass it; ?coop=<code> is
  // an invite landing and goes straight to the room. Solo stays the default
  // path and renders exactly as before once chosen.
  const [mode, setMode] = useState<'solo' | 'coop' | null>(() => initialStoryMode());
  /** Every deliberate mode choice is remembered for the tab session
   *  (storedStoryMode): a chunk-heal reload restarts this component,
   *  and the player must land on their map, not back at the gate. */
  const chooseMode = useCallback((m: 'solo' | 'coop') => { saveStoryMode(m); setMode(m); }, []);
  const [coopSel, setCoopSel] = useState<{ track: string; partnerUid: string; partnerHandle: string | null } | null>(null);
  const [coopProgress, setCoopProgress] = useState<StoryProgress | null>(null);
  const [coopMapError, setCoopMapError] = useState<string | null>(null);
  const [coopBusyStop, setCoopBusyStop] = useState<string | null>(null);
  const [coopJoinError, setCoopJoinError] = useState<string | null>(null);
  const [coopCodeParam] = useState<string | null>(() => {
    try { return new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('coop'); } catch { return null; }
  });
  const coopFired = useRef(false);
  useEffect(() => {
    if (coopCodeParam) history.replaceState(null, '', location.pathname);
  }, [coopCodeParam]);
  // The gate's co-op facts: the caller's pair runs, fetched while the
  // gate is the standing question so the Co-op card can carry the
  // player's real state (a run in progress, a route finished together).
  // A failed fetch leaves it null and the card simply carries no state
  // line — the gate never invents progress it does not hold.
  const [gateTracks, setGateTracks] = useState<StoryTracks | null>(null);
  useEffect(() => {
    if (mode !== null || !progress || signedOut) return;
    let live = true;
    void fetchStoryTracks().then((t) => { if (live) setGateTracks(t); });
    return () => { live = false; };
  }, [mode, progress, signedOut]);
  // The partner step's hero facts: the same pair tracks, fetched while
  // the partner step stands so its hero can stand at the focus run's
  // stop. A failed fetch leaves it null and the hero stays the Porch
  // with no state line — every pair starts there, so the image is
  // honest either way; the screen never invents a run it does not hold.
  const [coopTracks, setCoopTracks] = useState<StoryTracks | null>(null);
  useEffect(() => {
    if (mode !== 'coop' || coopSel || room) return;
    let live = true;
    void fetchStoryTracks().then((t) => { if (live) setCoopTracks(t); });
    return () => { live = false; };
  }, [mode, coopSel, room]);
  useEffect(() => {
    if (!coopCodeParam || coopFired.current || !progress || signedOut) return;
    if (STORY_OWNER_ONLY && (lockedByServer || storyAccess === undefined || storyLockedFor(storyAccess))) return;
    coopFired.current = true;
    void joinStoryRoom(coopCodeParam).then((r) => {
      chooseMode('coop');
      if (r.ok) setRoom({ code: r.code || coopCodeParam, track: r.track });
      else setCoopJoinError(r.error);
    });
  }, [coopCodeParam, progress, signedOut, storyAccess, lockedByServer, chooseMode]);
  // The selected pair run's progress (the co-op map's facts). Refetched when
  // a room closes, so a finished match shows up on the map.
  useEffect(() => {
    if (!coopSel) { setCoopProgress(null); return; }
    let live = true;
    void fetchStoryProgress(coopSel.track).then((r) => { if (live && r.status === 'ok') setCoopProgress(r.progress); });
    return () => { live = false; };
  }, [coopSel, room]);
  const playCoopStop = async (stop: StoryStop) => {
    if (!coopSel || coopBusyStop) return;
    setCoopBusyStop(stop.id);
    setCoopMapError(null);
    const r = await createStoryRoom(stop.id, coopSel.partnerUid);
    setCoopBusyStop(null);
    if (r.ok) setRoom({ code: r.code, track: r.track ?? coopSel.track });
    else setCoopMapError(r.error);
  };

  // ---- Screen scroll discipline (owner, 2026-10-21) ----
  // StoryHome swaps its screens inside ONE document: the window is the
  // scroll container and a state swap moves nothing, so a sub-screen
  // opened from a scrolled map inherited the map's offset — the Tale of
  // the Tape "opened already scrolled down". The discipline, applied in
  // layout effects (before paint — never a delayed scrollTo the eye can
  // catch): every sub-screen — the stand-alone tape, the intro (its
  // tape → scene step included), the table, the outro — opens at the
  // very top. The MAP is the one exception: it opens positioned at the
  // player's current stop, on first load and on every return to it.
  // Only the OPENING position is governed: the positioning is armed
  // once per map arrival and spent by the positioning itself, so once a
  // screen is open the player's own scrolling is never touched.
  // Positioning is instant (behavior 'auto') everywhere, so reduced
  // motion needs no separate branch — there is never an animated
  // scroll to suppress.
  const mapScrollPending = useRef(true); // the mount itself is a map arrival
  useLayoutEffect(() => {
    if (screen.k !== 'map') window.scrollTo(0, 0);
  }, [screen.k, introStep]);
  // Settle re-assertion (owner regression, 2026-10-22): the layout effect
  // above fires before first paint, but a sub-screen's content keeps
  // settling AFTER mount — portrait and backdrop decode, the Rundown
  // panel growing as its reveal ran (its text wrap followed the typed
  // text until the constant-height fix in story.css) — and on a real
  // phone that settling left the viewport displaced from the top the
  // layout effect had just set: the meet-them screen "opened already
  // scrolled down" again, the day the panel joined it. So once a
  // sub-screen has had a moment to settle, the top is re-asserted ONCE —
  // unless the player has already taken the scroll into their own hands
  // (a touch, a wheel turn, a scroll key), in which case their scroll
  // is never fought. The map is exempt: its parked position is the
  // deliberate exception above.
  useEffect(() => {
    if (screen.k === 'map') return;
    let userTookScroll = false;
    const mark = () => { userTookScroll = true; };
    const keyMark = (e: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'End', 'Home'].includes(e.key)) userTookScroll = true;
    };
    window.addEventListener('touchstart', mark, { passive: true });
    window.addEventListener('wheel', mark, { passive: true });
    window.addEventListener('keydown', keyMark);
    const t = window.setTimeout(() => { if (!userTookScroll) window.scrollTo(0, 0); }, STORY_SCROLL_SETTLE_MS);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('touchstart', mark);
      window.removeEventListener('wheel', mark);
      window.removeEventListener('keydown', keyMark);
    };
  }, [screen.k, introStep]);
  useLayoutEffect(() => {
    if (screen.k === 'map') mapScrollPending.current = true;
  }, [screen.k]);
  useLayoutEffect(() => {
    if (screen.k !== 'map' || !mapScrollPending.current) return;
    if (!progress && !signedOut && !loadError) return; // facts still loading — position when they land
    const mapEl = document.querySelector('[data-testid="story-map"]');
    if (!mapEl) return; // the locked / checking screens stand in for the map — wait for the real one
    mapScrollPending.current = false;
    if (progress?.completed) { window.scrollTo(0, 0); return; } // route complete: the top of the map is the view
    const current = STORY_STOPS.find((s) => s.n === (progress?.currentStop ?? 1)) ?? STORY_STOPS[0]!;
    const el = mapEl.querySelector(`[data-testid="story-stop-${current.id}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'auto' });
    else window.scrollTo(0, 0);
    // `mode` rides along: arriving at the solo map THROUGH the co-op mode
    // gate is still a map arrival — the gate stood in for the map (testid
    // absent) while the pending flag stayed armed, and choosing Solo is
    // what finally renders the real map.
  }, [screen.k, progress, signedOut, loadError, mode]);
  // Re-read whenever the signed-in identity changes (same convergence as
  // the Home story row): the account store invalidates the profile cache
  // at the transition, so these fetches return the new identity's flags.
  // Both reset to undefined first — unknown renders locked (fail closed)
  // until the fresh flags land.
  const storyUserId = useAccount().user?.id ?? null;
  useEffect(() => {
    let live = true;
    setDev(undefined);
    setStoryAccess(undefined);
    void fetchStoryDev().then((d) => { if (live) setDev(d); });
    void fetchStoryAccess().then((a) => { if (live) setStoryAccess(a); });
    return () => { live = false; };
  }, [storyUserId]);
  const [lastResult, setLastResult] = useState<StoryResult | null>(null);
  /** The deck being looked through from the outro's unlock card (owner,
   *  2026-10-25): the viewer is an overlay — opening it touches no screen
   *  state, and closing it lands back on this exact outro. */
  const [viewDeck, setViewDeck] = useState<DeckDef | null>(null);
  /** The outro detail sheet being read (owner, 2026-10-25: the rest of
   *  the unlock stack became doors too) — the set-animation card and the
   *  find cards open their details as overlays, same discipline as the
   *  deck viewer: no screen state moves, closing returns here. */
  const [detail, setDetail] = useState<{ kind: 'setanim'; stopId: string } | { kind: 'find'; find: StoryNewFind } | null>(null);
  const finishedRef = useRef<{ seed: string; won: boolean } | null>(null);
  /** The game just played, manner included (word travels fast): the
   *  outro's replay swap reads this game's band (the Porch reacts to
   *  how THIS one went) — set at game over, beside finishedRef. */
  const justPlayedRef = useRef<{ stopId: string; band: MannerBand | null } | null>(null);

  // Story save slot: a match in progress (own key; the normal save is untouched).
  const [saved, setSaved] = useState<StorySavedGame | null>(() => loadStoryGame());
  // Progress as it stood when the current game started — the outro diffs
  // badges against it to light the ones THIS win unlocked.
  const progressBeforeRef = useRef<StoryProgress | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetchStoryProgress();
    if (r.status === 'ok') {
      setProgress(r.progress); setSignedOut(false); setLoadError(false);
      // Stale-save validation: a save whose stop moved on without it
      // (cleared/attempted elsewhere, or the stop locked) drops silently.
      setSaved((cur) => {
        const s = cur ?? loadStoryGame();
        if (s && !storySaveValidFor(s, r.progress)) { clearStoryGame(); return null; }
        return s;
      });
    }
    else if (r.status === 'signedOut') { setSignedOut(true); setProgress(null); }
    else if (r.status === 'locked') { setLockedByServer(true); }
    else setLoadError(true);
  }, []);
  useEffect(() => { void refresh(); }, [refresh, screen.k === 'map']);
  // An in-page sign-in/out while sitting on /story converges the progress
  // state too: a signed-out preview (disabled stops, sign-in note) must not
  // outlive the sign-in that unlocks it, and vice versa. The mount effect
  // above already refreshed for the identity this page loaded with, so
  // only later identity changes re-run it.
  const seenStoryUserId = useRef(storyUserId);
  useEffect(() => {
    if (seenStoryUserId.current === storyUserId) return;
    seenStoryUserId.current = storyUserId;
    void refresh();
  }, [refresh, storyUserId]);

  const factsFor = (stop: StoryStop): StoryBeatFacts & { clears: number; attemptsAtPorch: number; doublePending: boolean } => {
    const row = progress?.stops.find((s) => s.stopId === stop.id);
    return {
      attempts: row?.attempts ?? 0,
      clears: row?.clears ?? 0,
      cleared: (row?.clears ?? 0) > 0,
      // The King's double or nothing, live from the server's progress row.
      doublePending: row?.doublePending ?? false,
      clearedStopIds: progress?.stops.filter((s) => s.clears > 0).map((s) => s.stopId) ?? [],
      // Railbird Ray's memory is keyed to HIS stop — the Porch (stored fact).
      attemptsAtPorch: progress?.stops.find((s) => s.stopId === 'porch')?.attempts ?? 0,
      // This attempt's drawn rail cast (per-attempt, seeded — storyRail):
      // the intro scene acknowledges only the faces that showed up.
      railCast: railCastForAttempt(stop.id, (row?.attempts ?? 0) + 1),
      // WORD TRAVELS FAST: his real route position + the manner facts
      // (heat of the advancing win, the previous stop's latest result).
      ...routeFactsFor(progress, stop),
    };
  };
  /** The scene's egg prop for a stop's intro (null when found or match-earned). */
  const eggFor = (stop: StoryStop): SceneEgg | null => {
    const secret = STORY_SECRETS[stop.id];
    if (!secret || (progress?.finds?.eggs ?? []).includes(secret.egg.id)) return null;
    const t = secret.egg.trigger;
    if (t.type === 'matchEvent') return null; // earned in the game, granted by the server from result facts
    const beats = (secret.egg.beat ?? []).map((x) => ({ speaker: x.speaker, line: x.line }));
    if (t.type === 'chain') {
      const fromEgg = STORY_SECRETS[t.fromStopId]?.egg;
      return { trigger: 'chain', ready: !!fromEgg && (progress?.finds?.eggs ?? []).includes(fromEgg.id), beats };
    }
    return { trigger: t.type, ready: false, beats };
  };
  const handleEggFound = (stop: StoryStop) => {
    const secret = STORY_SECRETS[stop.id];
    if (!secret) return;
    sound.storySting('unlock');
    void postStoryFound(secret.egg.id).then((p) => { if (p) setProgress(p); });
  };
  const stateFor = (stop: StoryStop): 'cleared' | 'current' | 'locked' => {
    const row = progress?.stops.find((s) => s.stopId === stop.id);
    if (row) return row.state;
    return stop.n === 1 ? 'current' : 'locked'; // signed-out preview: nothing is recorded, nothing is promised
  };

  // The rail cast drawn for the attempt in flight: the intro, the table
  // session and the outro all show the SAME faces. Set when an attempt
  // starts (fresh draw from the attempt number) or resumes (the save's
  // own cast — a resumed match never re-draws its room).
  const attemptRailRef = useRef<{ stopId: string; cast: readonly string[] } | null>(null);

  const startGame = (stop: StoryStop) => {
    finishedRef.current = null;
    setLastResult(null);
    progressBeforeRef.current = progress;
    attemptRailRef.current = { stopId: stop.id, cast: factsFor(stop).railCast ?? [] };
    goScreen({ k: 'game', stop, seed: secureSeed() });
  };

  /** Resume the saved match: straight to the table — no tape, no intro. */
  const resumeStop = (stop: StoryStop, save: StorySavedGame) => {
    finishedRef.current = null;
    setLastResult(null);
    progressBeforeRef.current = progress;
    attemptRailRef.current = {
      stopId: stop.id,
      cast: save.story.session.railCast ?? railCastForAttempt(stop.id, save.story.attemptsAtStart + 1),
    };
    goScreen({ k: 'game', stop, seed: save.seed, resumeSave: save });
  };

  /** Abandon the saved match and start the stop fresh. No result is posted
   *  and no attempt is counted for a discarded save — attempts only ever
   *  count finished matches. */
  const restartStop = (stop: StoryStop) => {
    clearStoryGame();
    setSaved(null);
    goScreen({ k: 'intro', stop });
  };

  // Owner-only stop reset (dev tool): which stop's confirm is armed, and
  // whether a reset call is in flight. Rendered only for dev accounts and
  // only on stops that have anything recorded to wipe.
  const [armedReset, setArmedReset] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const stopHasFacts = (stop: StoryStop): boolean => {
    const row = progress?.stops.find((s) => s.stopId === stop.id);
    const secret = STORY_SECRETS[stop.id];
    return (row?.attempts ?? 0) > 0 || (row?.clears ?? 0) > 0 || (row?.doublePending ?? false)
      || (!!secret && (progress?.finds?.eggs ?? []).includes(secret.egg.id))
      || (!!secret && (progress?.finds?.feats ?? []).includes(secret.unlockable.itemId));
  };
  /** Wipe one stop server-side so its next win presents as a first clear
   *  again (see postStoryResetStop). Mirrors the wipe locally: the cached
   *  cleared-set behind the deck / set-animation pickers is dropped, and a
   *  local save for this stop belongs to the wiped run, so it goes too.
   *  XP and coins already earned stay (no clawback, server-side either). */
  const doReset = async (stop: StoryStop) => {
    setResetBusy(true);
    const p = await postStoryResetStop(stop.id);
    setResetBusy(false);
    setArmedReset(null);
    if (!p) return;
    invalidateStoryProgress();
    setProgress(p);
    setSaved((cur) => {
      const s = cur ?? loadStoryGame();
      if (s && s.story.stopId === stop.id) { clearStoryGame(); return null; }
      return s ?? cur;
    });
  };

  const handleGameOver = (stop: StoryStop, seed: string) => (won: boolean, facts: StoryGameFacts) => {
    finishedRef.current = { seed, won };
    justPlayedRef.current = { stopId: stop.id, band: mannerBandOf({ won, margin: facts.margin, endReason: facts.endReason }, targetForStop(stop)) };
    void postStoryResult(stop.id, won, `story-${seed}`, facts).then((r) => {
      if (r) {
        // A fresh clear unlocks the stop's deck — drop the deck picker's
        // cached progress so the new deck shows up without a reload.
        invalidateStoryProgress();
        setLastResult(r); setProgress(r);
        // The motif answers the moment: cleared → the clear bloom; any new
        // egg/collectible from this game → the unlock rise.
        if (won) sound.storySting('clear');
        if (r.newFinds.length) sound.storySting('unlock');
      }
    });
  };

  // Rematch directive (?rematch=<stopId>, from the rewards screen): start
  // the SAME stop again — story-scoped via startGame, exactly like the
  // in-table Play again. The attempt context comes from the progress this
  // mount just fetched, which already counts the finished match, so the
  // new attempt's bands advance the same as a map-initiated retry. The
  // finished game's save was cleared at game over and its session closed;
  // the new Table opens a fresh save + session for the new attempt.
  // Consumed exactly once, and the param is stripped on sight so a
  // refresh or a later return to the map can never re-fire it.
  const [rematchStopId] = useState<string | null>(() => storyRematchStopId(typeof location !== 'undefined' ? location.search : ''));
  const rematchFired = useRef(false);
  useEffect(() => {
    if (rematchStopId) history.replaceState(null, '', location.pathname);
  }, [rematchStopId]);
  useEffect(() => {
    if (!rematchStopId || rematchFired.current || !progress) return;
    if (STORY_OWNER_ONLY && (lockedByServer || storyAccess === undefined || storyLockedFor(storyAccess))) return;
    rematchFired.current = true;
    const stop = STORY_STOPS.find((s) => s.id === rematchStopId);
    if (!stop) return;
    const row = progress.stops.find((s) => s.stopId === rematchStopId);
    if (row?.state === 'locked') return; // a stop just played is never locked — belt and braces
    startGame(stop);
  }, [rematchStopId, progress, storyAccess, lockedByServer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resume directive (?resume=<stopId>, from the Home screen's story row):
  // the player tapped Resume on Home because a story save exists on this
  // device. Home is only the signpost — the resume itself is THIS screen's
  // own machinery (resumeStop, the same one the map card's Resume button
  // calls), fired once the progress this mount fetched proves the save is
  // still live: the save must exist, name the directive's stop, and pass
  // storySaveValidFor. Anything else — no save, a different stop's save, a
  // stale save refresh() is dropping — is not an error and not a dead end:
  // the directive is simply spent and the map renders as usual.
  const [resumeStopId] = useState<string | null>(() => storyResumeStopId(typeof location !== 'undefined' ? location.search : ''));
  const resumeFired = useRef(false);
  useEffect(() => {
    if (resumeStopId) history.replaceState(null, '', location.pathname);
  }, [resumeStopId]);
  useEffect(() => {
    if (!resumeStopId || resumeFired.current || !progress) return;
    if (STORY_OWNER_ONLY && (lockedByServer || storyAccess === undefined || storyLockedFor(storyAccess))) return;
    resumeFired.current = true;
    const s = loadStoryGame();
    if (!s || s.story.stopId !== resumeStopId) return;
    if (!storySaveValidFor(s, progress)) return;
    const stop = STORY_STOPS.find((x) => x.id === resumeStopId);
    if (!stop) return;
    resumeStop(stop, s);
  }, [resumeStopId, progress, storyAccess, lockedByServer]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Solo started" for THIS player, from the two signals this screen
  // already holds: the solo track's server progress (any recorded
  // attempt or clear at any stop — a finished route included) and the
  // device save slot (a solo match in progress; refresh() keeps `saved`
  // validated against that same progress, so a stale save can never
  // disagree with the server for long). Both co-op screens below — the
  // partner step and the pair map — offer "Run it solo instead" only to
  // a player who has NOT started solo: for a player mid-route the run
  // already exists — behind the gate's Solo branch and the Home resume
  // signpost — and the escape hatch is noise on a co-op screen (owner,
  // 2026-10-24). One derivation serves both screens.
  const soloStarted = saved !== null
    || (progress?.stops.some((s) => s.attempts > 0 || s.clears > 0) ?? false);

  let body: React.ReactNode;
  if (STORY_OWNER_ONLY && (lockedByServer || (storyAccess !== undefined && storyLockedFor(storyAccess)))) {
    // Locked while story mode is being finished — everyone except admins
    // and the server's named player allowlist. Same screen in both
    // themes; the server enforces the same gate (403).
    body = (
      <div className="story-shell" data-testid="story-locked">
        <div className="story-topbar">
          <button type="button" className="btn ghost" data-testid="story-home" onClick={() => navigate('/')}>← Home</button>
          <div className="story-title-block">
            <h1 className="story-title">Story Mode</h1>
            <p className="story-sub">Run the block — porch to the King.</p>
          </div>
          <span className="dock-slot" aria-hidden />
        </div>
        <div className="story-lock-card">
          <p className="story-lock-icon" aria-hidden>🔒</p>
          <p className="story-lock-title">Story mode is being finished</p>
          <p className="story-lock-line">The route is built, but it is not ready for the whole block yet. It unlocks here the moment it is done — no update needed.</p>
        </div>
      </div>
    );
  } else if (STORY_OWNER_ONLY && storyAccess === undefined) {
    body = (
      <div className="story-shell" data-testid="story-checking">
        <div className="story-title-block">
          <h1 className="story-title">Story Mode</h1>
          <p className="story-sub">One moment…</p>
        </div>
      </div>
    );
  } else if (screen.k === 'map' && room) {
    body = <StoryRoom code={room.code} track={room.track} onExit={() => setRoom(null)} />;
  } else if (screen.k === 'map' && mode === null && progress && !signedOut && !rematchStopId && !resumeStopId && !coopCodeParam) {
    // The mode gate (spec §1.1): once per visit, signed-in and access-cleared,
    // before the map. Solo is the established run; co-op is the pair run.
    //
    // The gate's composition (owner, 2026-10-24: "This screen is pretty
    // dry."): story mode's front door is built from the story's own
    // shipped surfaces — the map's hero (a stop backdrop behind the
    // title), Dee's portrait on the cards, and the route itself as a
    // thread along the bottom — never the pro game's broadcast chrome.
    // Every fact it shows is a real payload fact (solo progress, pair
    // tracks, the validated device save) or it shows nothing: a fresh
    // player gets the run's promise, never invented progress.
    const gateStop = progress.completed
      ? STORY_STOPS[STORY_STOPS.length - 1]!
      : (STORY_STOPS.find((s) => s.n === (progress.currentStop ?? 1)) ?? STORY_STOPS[0]!);
    const clearedCount = progress.stops.filter((s) => s.clears > 0).length;
    const gateSave = storySaveSummary(saved);
    const heroLine = progress.completed
      ? 'Route complete — you made it out.'
      : soloStarted
        ? `${clearedCount} of ${STORY_STOPS.length} stops cleared — you\u2019re at ${gateStop.name}`
        : `${clearedCount} of ${STORY_STOPS.length} stops cleared — it starts at the Porch`;
    const soloState = gateSave
      ? `A match is waiting at ${gateSave.stop.name} — hand ${gateSave.handNo}, against ${gateSave.pairNames.join(' & ')}.`
      : progress.completed
        ? 'Route complete — you made it out. Replays stay open for upkeep.'
        : soloStarted
          ? `You\u2019re at ${gateStop.name} — stop ${gateStop.n} of ${STORY_STOPS.length}.`
          : 'It starts at the Porch — Dee\u2019s first real table.';
    const pairRuns = gateTracks?.pairs ?? null;
    const runsByRecency = pairRuns
      ? [...pairRuns].sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
      : [];
    const focusRun = runsByRecency.find((p) => !p.completed) ?? runsByRecency[0] ?? null;
    const moreRuns = pairRuns && pairRuns.length > 1
      ? ` ${pairRuns.length - 1} more ${pairRuns.length - 1 === 1 ? 'run' : 'runs'} on the books.`
      : '';
    const coopState = !pairRuns
      ? null
      : pairRuns.length === 0
        ? 'No pair runs yet — a new pair starts together at the Porch.'
        : focusRun!.completed
          ? `You and ${focusRun!.partnerHandle ?? 'your partner'} made it out together.${moreRuns}`
          : focusRun!.currentStop != null
            ? `With ${focusRun!.partnerHandle ?? 'your partner'} — at stop ${focusRun!.currentStop}, ${STORY_STOPS.find((x) => x.n === focusRun!.currentStop)?.name ?? 'the Porch'}.${moreRuns}`
            : `With ${focusRun!.partnerHandle ?? 'your partner'} — the run hasn\u2019t started yet.${moreRuns}`;
    const routeLine = progress.completed
      ? 'You made it out — porch to King, the whole route.'
      : soloStarted
        ? `You\u2019re on the route — stop ${gateStop.n} of ${STORY_STOPS.length}: ${gateStop.name}.`
        : 'Eleven stops, porch to the King. It starts on Ray\u2019s porch.';
    body = (
      <div className="story-shell story-gate-shell" data-testid="story-mode-gate">
        <div className="story-hero story-gate-hero">
          <div className="story-hero-bg" style={{ backgroundImage: `url(${storyBackdropUrl(gateStop)})` }} aria-hidden />
          <div className="story-topbar">
            <button type="button" className="btn ghost" data-testid="story-home" onClick={() => navigate('/')}>← Home</button>
            <div className="story-title-block">
              <h1 className="story-title">Story Mode</h1>
              <p className="story-sub">Run the block — porch to the King.</p>
              <p className="story-hero-progress" data-testid="story-gate-hero-line">{heroLine}</p>
            </div>
            <span className="dock-slot" aria-hidden />
          </div>
        </div>
        <p className="story-gate-lede">How are you running it?</p>
        <div className="story-gate">
          <button type="button" className="story-gate-card" data-testid="story-gate-solo" onClick={() => chooseMode('solo')}>
            <span className="story-gate-faces">
              <StoryFace characterId="dee" name="Dee" className="dee-face" />
            </span>
            <span className="story-gate-card-text">
              <span className="story-gate-name">Solo</span>
              <span className="story-gate-line">You &amp; Dee against the block — the run as it has always been.</span>
              <span className="story-gate-state" data-testid="story-gate-solo-state">{soloState}</span>
            </span>
          </button>
          <button type="button" className="story-gate-card" data-testid="story-gate-coop" onClick={() => chooseMode('coop')}>
            <span className="story-gate-faces">
              <StoryFace characterId="dee" name="Dee" className="dee-face" />
              <span className="story-gate-seat-open" aria-hidden>+</span>
            </span>
            <span className="story-gate-card-text">
              <span className="story-gate-name">Co-op</span>
              <span className="story-gate-line">Two players, one run. Bring a partner — you take the seats across from each other, and the pair advances together.</span>
              {coopState && <span className="story-gate-state" data-testid="story-gate-coop-state">{coopState}</span>}
            </span>
          </button>
        </div>
        <div className="story-gate-route" data-testid="story-gate-route">
          <div className="story-gate-thread" aria-hidden>
            {STORY_STOPS.map((stop, i) => {
              const st = stateFor(stop);
              return (
                <Fragment key={stop.id}>
                  {i > 0 && <span className="story-gate-link" />}
                  <span className={`story-gate-node state-${st}${stop.id === 'king' ? ' is-king' : ''}`}>{st === 'cleared' ? '✓' : stop.n}</span>
                </Fragment>
              );
            })}
          </div>
          <p className="story-gate-route-line">{routeLine}</p>
        </div>
      </div>
    );
  } else if (screen.k === 'map' && mode === 'coop') {
    // The partner step's composition (owner, 2026-10-24: "This screen is
    // still trash but I like the next screen that stages the players"):
    // the title stands in a hero over a stop backdrop, in the gate's and
    // the room lobby's language — the Porch for a player with no pair
    // run yet (every pair starts there), the focus run's current stop
    // when a run is further along, the King for a route finished
    // together. The hero line is the focus run's real standing or it
    // does not render: while the tracks load (or if they failed) the
    // hero is the Porch and carries no line.
    const coopPairRuns = coopTracks?.pairs ?? null;
    const coopRunsByRecency = coopPairRuns
      ? [...coopPairRuns].sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
      : [];
    const coopFocusRun = coopRunsByRecency.find((p) => !p.completed) ?? coopRunsByRecency[0] ?? null;
    const coopHeroStop = !coopFocusRun
      ? STORY_STOPS[0]!
      : coopFocusRun.completed
        ? STORY_STOPS[STORY_STOPS.length - 1]!
        : (STORY_STOPS.find((x) => x.n === coopFocusRun.currentStop) ?? STORY_STOPS[0]!);
    const coopHeroLine = !coopPairRuns
      ? null
      : coopPairRuns.length === 0
        ? 'No pair runs yet — a new pair starts together at the Porch.'
        : coopFocusRun!.completed
          ? `You and ${coopFocusRun!.partnerHandle ?? 'your partner'} made it out together.`
          : coopFocusRun!.currentStop != null
            ? `With ${coopFocusRun!.partnerHandle ?? 'your partner'} — at stop ${coopFocusRun!.currentStop}, ${STORY_STOPS.find((x) => x.n === coopFocusRun!.currentStop)?.name ?? 'the Porch'}.`
            : `With ${coopFocusRun!.partnerHandle ?? 'your partner'} — the run hasn\u2019t started yet.`;
    body = coopSel ? (
      <CoopMap
        progress={coopProgress}
        partnerHandle={coopSel.partnerHandle}
        busyStop={coopBusyStop}
        error={coopMapError}
        onPlay={(stop) => void playCoopStop(stop)}
        onBack={() => { setCoopSel(null); setCoopMapError(null); }}
        onSolo={() => chooseMode('solo')}
        soloStarted={soloStarted}
      />
    ) : (
      <div className="story-shell story-coop-shell" data-testid="story-coop-home">
        <div className="story-hero story-coop-hero">
          <div className="story-hero-bg" style={{ backgroundImage: `url(${storyBackdropUrl(coopHeroStop)})` }} aria-hidden />
          <div className="story-topbar">
            <button type="button" className="btn ghost" data-testid="story-home" onClick={() => navigate('/')}>← Home</button>
            <div className="story-title-block">
              <h1 className="story-title">Story Mode — Co-op</h1>
              <p className="story-sub">Two players, one run up the block.</p>
              {coopHeroLine && <p className="story-hero-progress" data-testid="story-coop-hero-line">{coopHeroLine}</p>}
            </div>
            <span className="dock-slot" aria-hidden />
          </div>
        </div>
        <CoopPartner
          onSelectRun={(track, partnerUid, partnerHandle) => setCoopSel({ track, partnerUid, partnerHandle })}
          onEnterRoom={(code, track) => setRoom({ code, track })}
          joinError={coopJoinError}
        />
        {!soloStarted && (
          <div className="story-mode-toggle">
            <button type="button" className="btn ghost" data-testid="story-mode-solo" onClick={() => chooseMode('solo')}>Run it solo instead</button>
          </div>
        )}
      </div>
    );
  } else if (screen.k === 'tape') {
    const stop = screen.stop;
    body = (
      <div className="story-shell">
        <StoryHeader stop={stop} />
        {/* SceneAudio is this surface's audio contract (enterTable +
            story bed + score): the intro's tape step and the outro mount
            it, this stand-alone tape did not — until the Rundown panel
            joined it (2026-10-22) it had nothing to say, so the omission
            was invisible. With the panel here, the missing mount left
            every recorded voice refused at the engine's table gate:
            Dee's words paced themselves by her clip while the clip
            itself never sounded (owner, the meet-them screen). Same
            screen, same contract. */}
        <SceneAudio stop={stop} />
        <StoryTape stop={stop} facts={factsFor(stop)} cta="Back to the map" onDone={() => goScreen({ k: 'map' })} rundown={rundownFor(stop, factsFor(stop))} rundownTrack="solo" rundownAutoplay={false} />
      </div>
    );
  } else if (screen.k === 'intro') {
    const stop = screen.stop;
    body = (
      <div className="story-shell">
        <StoryHeader stop={stop} />
        <SceneAudio stop={stop} />
        {introStep === 'tape' ? (
          <StoryTape stop={stop} facts={factsFor(stop)} cta="Play the scene" onDone={() => setIntroStep('scene')} rundown={rundownFor(stop, factsFor(stop))} rundownTrack="solo" />
        ) : (
          <ScriptPlayer
            beats={beatsFor(stop, 'intro', factsFor(stop))}
            cta="To the table"
            onDone={() => startGame(stop)}
            bgUrl={storyBackdropUrl(stop)}
            living livingMood={livingMoodFor(stop.id)}
            cast={[stop.pair[0], 'dee', stop.pair[1]]}
            rail={railCastForAttempt(stop.id, factsFor(stop).attempts + 1)}
            egg={eggFor(stop)}
            onEggFound={() => handleEggFound(stop)}
          />
        )}
        {/* The way OUT of the intro (owner, 2026-10-21): both forward
            paths here start the game — the tape's "Play the scene" and
            the scene's Skip/"To the table" — so without this row the
            only way off the intro was to start a match. Back to map
            abandons to the map: it posts no result, starts no game and
            consumes no attempt (attempts count finished matches only). */}
        <div className="story-intro-actions">
          <button type="button" className="btn ghost" data-testid="story-intro-map" onClick={() => goScreen({ k: 'map' })}>Back to map</button>
        </div>
      </div>
    );
  } else if (screen.k === 'game') {
    const stop = screen.stop;
    const pair = stop.pair.map((id) => STORY_CHARACTERS[id]!) as [typeof STORY_CHARACTERS[string], typeof STORY_CHARACTERS[string]];
    const gameSettings = storySettingsFor(stop, settings);
    const tierSkill = STORY_TIER_SKILL[stop.tier];
    body = (
      <Table
        key={screen.seed}
        rules={storyRulesFor(stop, settings)}
        seed={screen.seed}
        settings={gameSettings}
        resume={screen.resumeSave}
        story={{
          names: ['You', pair[0].name, 'Dee', pair[1].name],
          levelFor: (seat) => (seat === 2 ? deeSkillForStop(stop.n) : tierSkill),
          onGameOver: handleGameOver(stop, screen.seed),
          scene: { stop, facts: factsFor(stop) },
          saveCtx: screen.resumeSave
            ? {
              attemptsAtStart: screen.resumeSave.story.attemptsAtStart,
              clearsAtStart: screen.resumeSave.story.clearsAtStart,
              resumed: true,
              initialSession: screen.resumeSave.story.session,
            }
            : {
              attemptsAtStart: factsFor(stop).attempts,
              clearsAtStart: factsFor(stop).clears,
              resumed: false,
              railCast: attemptRailRef.current?.stopId === stop.id
                ? [...attemptRailRef.current.cast]
                : railCastForAttempt(stop.id, factsFor(stop).attempts + 1),
            },
        }}
        onExit={() => goScreen(finishedRef.current?.seed === screen.seed ? { k: 'outro', stop, won: finishedRef.current.won } : { k: 'map' })}
        onMainMenu={() => goScreen(finishedRef.current?.seed === screen.seed ? { k: 'outro', stop, won: finishedRef.current.won } : { k: 'map' })}
        onSuspend={() => goScreen({ k: 'map' })}
        onRematch={() => startGame(stop)}
        onQuality={(quality) => applySettings({ ...settings, quality })}
        onView={(view) => applySettings({ ...settings, view })}
        onTurnUp={(turnUp) => applySettings({ ...settings, turnUp })}
      />
    );
  } else if (screen.k === 'outro') {
    const stop = screen.stop;
    const r = lastResult && lastResult.stopId === stop.id ? lastResult : null;
    // The King's double or nothing lands here twice: a leg-1 win is NOT an
    // outro — it is the between-legs moment (nothing banked, run it back);
    // a leg-2 loss is an outro with the double's own honest accounting.
    const dblStarted = !!r && stop.doubleOrNothing === true && r.won && !r.firstClear
      && (r.doubleOutcome === 'started' || r.doublePending === true);
    const dblLost = !!r && stop.doubleOrNothing === true && !r.won && r.doubleOutcome === 'lost';
    body = (
      <div className="story-shell">
        <StoryHeader stop={stop} />
        <SceneAudio stop={stop} />
        {/* The reward stack (presentation overhaul, owner 2026-10-21:
            "these achievements should have a badge or something visible
            and visually stimulating — this is dry"). The stack used to
            be a column of near-identical outlined text pills. Now: the
            reward line is a gold HERO card with the amounts as stats,
            each unlock is a card carrying its own art (the deck's real
            back thumbnail, a medallion emblem for the set animation,
            a trophy medallion for finds), and the badge case reveals
            as medallions. Every card pops in on a stagger (--i) and
            HOLDS at its settled state; reduced motion collapses the
            reveal to settled (story.css). Amounts, copy, posting flow
            and exits are untouched — this is presentation only. */}
        <div className="story-rewards">
        {r && r.won && !dblStarted && (
          <div className="story-reward-hero story-reward-line story-reveal" data-testid="story-reward-line" style={{ ['--i' as string]: 0 } as CSSProperties}>
            <p className="story-reward-kicker">{r.firstClear ? 'First clear!' : 'Replay upkeep'}</p>
            <div className="story-reward-stats">
              <span className="story-reward-stat"><b>+{r.rewards.xp} XP</b></span>
              <span className="story-reward-stat"><b>+{r.rewards.coins}</b> <CoinIcon size={17} /></span>
            </div>
            {r.completed && <p className="story-reward-note">Route complete — the solo mark is yours.</p>}
          </div>
        )}
        {dblStarted && (
          <div className="story-reward-card double story-reward-line story-reveal" data-testid="story-double-line" style={{ ['--i' as string]: 0 } as CSSProperties}>
            <span className="story-medal emblem" aria-hidden><span className="story-medal-glyph">✦</span></span>
            <div className="story-reward-card-body">
              <p className="story-reward-card-title">Double or nothing</p>
              <p className="story-reward-card-sub">You beat the King once — and banked <b>nothing</b>. Double or nothing: one more win takes the crown and double the clear. Lose, and both wins are gone.</p>
            </div>
          </div>
        )}
        {r && r.won && r.firstClear && deckUnlockNotice(r.stopId) && deckForStop(r.stopId) && (
          <button type="button" className="story-reward-card story-deck-line story-reveal story-deck-tap" data-testid="story-deck-notice" style={{ ['--i' as string]: 1 } as CSSProperties}
            onClick={() => setViewDeck(deckForStop(r.stopId)!)}>
            <img className="story-reward-deckart" src={deckBackUrl(deckForStop(r.stopId)!.id)} alt="" aria-hidden />
            <span className="story-reward-card-body">
              <span className="story-reward-card-title">{deckUnlockNotice(r.stopId)}</span>
              <span className="story-reward-card-sub">Yours for good — find it in the deck picker, at any table.</span>
              <span className="story-reward-card-view">Tap to look through the deck →</span>
            </span>
          </button>
        )}
        {r && r.won && r.firstClear && setAnimUnlockNotice(r.stopId) && (
          <button type="button" className="story-reward-card story-deck-line story-reveal story-card-tap" data-testid="story-setanim-notice" style={{ ['--i' as string]: 2 } as CSSProperties}
            onClick={() => setDetail({ kind: 'setanim', stopId: r.stopId })}>
            <span className="story-medal emblem" aria-hidden><span className="story-medal-glyph">✦</span></span>
            <span className="story-reward-card-body">
              <span className="story-reward-card-title">{setAnimUnlockNotice(r.stopId)}</span>
              {setAnimForStop(r.stopId)?.blurb && <span className="story-reward-card-sub">{setAnimForStop(r.stopId)!.blurb}</span>}
              <span className="story-reward-card-view">Tap to preview →</span>
            </span>
          </button>
        )}
        {r && !r.won && !dblLost && (
          <div className="story-reward-hero consolation story-reward-line story-reveal" data-testid="story-reward-line" style={{ ['--i' as string]: 0 } as CSSProperties}>
            {r.rewards.xp > 0
              ? <>
                  <div className="story-reward-stats"><span className="story-reward-stat"><b>+{r.rewards.xp} XP</b></span></div>
                  <p className="story-reward-note">The effort counts — for seeing it through. No coins on a loss, and no penalty. The retry is free.</p>
                </>
              : <p className="story-reward-note">No clear — and no penalty. The retry is free.</p>}
          </div>
        )}
        {dblLost && (
          <div className="story-reward-card double story-reward-line story-reveal" data-testid="story-double-lost-line" style={{ ['--i' as string]: 0 } as CSSProperties}>
            <span className="story-medal emblem" aria-hidden><span className="story-medal-glyph">✦</span></span>
            <div className="story-reward-card-body">
              <p className="story-reward-card-title">Nothing banked</p>
              <p className="story-reward-card-sub">Double or nothing — and it came up nothing. The first win is wiped with it: no clear, nothing banked for either leg.{r && r.rewards.xp > 0 ? <> The effort still counts: <b>+{r.rewards.xp} XP</b>.</> : ''} The King stays current.</p>
            </div>
          </div>
        )}
        {r && (r.newFinds?.length ?? 0) > 0 && (
          <div className="story-find-line" data-testid="story-new-finds">
            {r.newFinds.map((f, j) => (
              <button key={f.id} type="button" className="story-reward-card find story-reveal story-card-tap" style={{ ['--i' as string]: 3 + j } as CSSProperties}
                onClick={() => setDetail({ kind: 'find', find: f })}>
                <span className="story-medal" aria-hidden><span className="story-medal-glyph">{f.kind === 'feat' ? '🏆' : '🥚'}</span></span>
                <span className="story-reward-card-body">
                  <span className="story-reward-card-title">{f.kind === 'feat' ? 'Unlocked' : 'Found'}: {f.name}</span>
                  <span className="story-reward-card-sub">{f.kind === 'feat' ? 'Feat collectible — recorded on this stop’s map card.' : 'Hidden egg — recorded on this stop’s map card.'}</span>
                  <span className="story-reward-card-view">Tap to look →</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {screen.won && !dblStarted && (() => {
          const before = new Set(storyBadgesFor(badgeFactsOf(progressBeforeRef.current)).filter((b) => b.earned).map((b) => b.id));
          const after = storyBadgesFor(badgeFactsOf(r ?? progress));
          const fresh = new Set(after.filter((b) => b.earned && !before.has(b.id)).map((b) => b.id));
          return <>{fresh.size > 0 && <StoryBadgeReveal facts={badgeFactsOf(r ?? progress)} fresh={fresh} />}<StoryBadges facts={badgeFactsOf(r ?? progress)} highlight={fresh} title="Badges" celebrate /></>;
        })()}
        </div>
        <ScriptPlayer
          beats={dblStarted ? kingDoubleBeats('started') : dblLost ? kingDoubleBeats('lost') : beatsFor(stop, screen.won ? 'outroWin' : 'outroLose', {
            ...factsFor(stop),
            // The outro's truth inputs (word travels fast): was THIS win
            // a first clear, and how did THIS game go — a replay's scene
            // swaps its onward beats for the real current stop.
            firstClear: r ? r.firstClear : undefined,
            justBand: justPlayedRef.current?.stopId === stop.id ? justPlayedRef.current.band : null,
          })}
          cta="Back to the map"
          onDone={() => goScreen({ k: 'map' })}
          bgUrl={storyBackdropUrl(stop)}
          cast={[stop.pair[0], 'dee', stop.pair[1]]}
          rail={attemptRailRef.current?.stopId === stop.id
            ? [...attemptRailRef.current.cast]
            : railCastForAttempt(stop.id, (progressBeforeRef.current?.stops.find((s) => s.stopId === stop.id)?.attempts ?? 0) + 1)}
        />
        {/* The outro's own exits, on the screen from first paint (owner,
            2026-10-21): the loss outro used to show only "Retry this
            stop" under the scene — the scene's Skip reached the map but
            nothing SAID so, so the screen read as a trap whose only door
            was the rematch. Now every outro carries a labeled map exit
            beside its primary, visible while the scene plays and after:
            a loss pairs "To the map" with Retry, the King's between-legs
            moment pairs it with the run-it-back, and a win terminates at
            the map, so "To the map" IS its primary. The exit is the same
            setScreen the scene's own onDone makes — the result already
            posted once at game over, so leaving can neither re-post it
            nor lose it, and a pending double stays pending on the map,
            where its card and Resume already carry it. */}
        <div className="story-outro-actions">
          {dblStarted ? (
            <button type="button" className="btn primary story-retry" data-testid="story-double-runback" onClick={() => startGame(stop)}>Run it back — leg 2</button>
          ) : !screen.won ? (
            <button type="button" className="btn primary story-retry" data-testid="story-retry" onClick={() => goScreen({ k: 'intro', stop })}>Retry this stop</button>
          ) : null}
          <button type="button" className={`btn ${screen.won && !dblStarted ? 'primary' : 'ghost'}`} data-testid="story-outro-map" onClick={() => goScreen({ k: 'map' })}>To the map</button>
        </div>
      </div>
    );
  } else {
    const currentStop = STORY_STOPS.find((s) => s.n === (progress?.currentStop ?? 1)) ?? STORY_STOPS[0]!;
    const clearedCount = progress?.stops.filter((s) => s.clears > 0).length ?? 0;
    // The in-progress facts come from the ONE shared derivation (the Home
    // screen's resume row renders the same summary from the same save).
    const savedSummary = storySaveSummary(saved);
    body = (
      <div className="story-shell" data-testid="story-map">
        <div className="story-hero">
          <div className="story-hero-bg" style={{ backgroundImage: `url(${storyBackdropUrl(currentStop)})` }} aria-hidden />
          <div className="story-topbar">
            <button type="button" className="btn ghost" data-testid="story-home" onClick={() => navigate('/')}>← Home</button>
            <div className="story-title-block">
              <h1 className="story-title">Story Mode</h1>
              <p className="story-sub">The come-up — porch to the King. Solo, with Dee riding shotgun. You&apos;re making it out, together.</p>
              <p className="story-hero-progress">{progress?.completed ? 'Route complete — you made it out.' : `${clearedCount} of ${STORY_STOPS.length} stops cleared`}</p>
            </div>
            <span className="dock-slot" aria-hidden />
          </div>
        </div>
        {!signedOut && (
          <div className="story-mode-toggle">
            <span className="story-mode-current">Running solo</span>
            <button type="button" className="btn ghost" data-testid="story-mode-coop" onClick={() => chooseMode('coop')}>Run it with a partner</button>
          </div>
        )}
        {signedOut && <p className="story-note" data-testid="story-signed-out">Sign in to run the route — your stops, rewards and the solo completion mark live on your account. The map below is a preview.</p>}
        {loadError && !signedOut && <p className="story-note">Couldn&apos;t load your progress just now. <button type="button" className="link" onClick={() => void refresh()}>Retry</button></p>}
        {progress?.completed && <p className="story-note story-done" data-testid="story-complete">YOU MADE IT OUT — porch to King, the whole route. ✓ The block is behind you; the league is ahead. Replays stay open for upkeep.</p>}
        <div className="story-dee-card">
          <StoryFace characterId="dee" name="Dee" className="dee-face" />
          <div>
            <p className="story-dee-name">Running with Dee</p>
            <p className="story-dee-line">Your partner for the whole route. She starts green and levels up stop to stop — by the Pj&apos;s, she calls shots. You&apos;re not just running a route. You&apos;re making it out — together.</p>
          </div>
        </div>
        <StoryBadges facts={badgeFactsOf(progress)} variant="strip" />
        <ol className="story-route">
          {STORY_STOPS.map((stop) => {
            const state = stateFor(stop);
            const pair = stop.pair.map((id) => STORY_CHARACTERS[id]!);
            const reward = storyClearReward(stop);
            const facts = factsFor(stop);
            const stopSave = savedSummary && savedSummary.stop.id === stop.id ? savedSummary : null;
            return (
              <li key={stop.id} className={`story-stop state-${state}${stop.id === 'king' ? ' is-king' : ''}`} data-testid={`story-stop-${stop.id}`}>
                <span className="story-node" aria-hidden>{state === 'cleared' ? '✓' : state === 'locked' ? '🔒' : stop.n}</span>
                <div className="story-card">
                  <div className="story-card-art" style={{ backgroundImage: `url(${storyBackdropUrl(stop)})` }} aria-hidden>
                    <span className="story-card-faces">
                      <StoryFace characterId={stop.pair[0]} name={pair[0].name} className="card-face" />
                      <StoryFace characterId={stop.pair[1]} name={pair[1].name} className="card-face" />
                    </span>
                    {state === 'cleared' && <span className="story-card-state">✓ CLEARED</span>}
                    {state === 'current' && !stopSave && <span className="story-card-state here">{facts.doublePending ? 'DOUBLE OR NOTHING' : 'YOU ARE HERE'}</span>}
                    {stopSave && <span className="story-card-state here">MATCH IN PROGRESS</span>}
                  </div>
                  <div className="story-stop-body">
                    <p className="story-stop-name">{stop.name} <span className="story-tier">{STORY_TIER_LABEL[stop.tier]}</span></p>
                    <p className="story-stop-pair">{pair[0].name} &amp; {pair[1].name}</p>
                    <p className="story-stop-flavor">{stop.flavor}</p>
                    <p className="story-stop-twist">{stop.twist.label} · First clear: +{reward.xp} XP · +{reward.coins} coins</p>
                    {facts.attempts > 0 && <p className="story-stop-facts">{facts.clears > 0 ? `Cleared ${facts.clears}×` : `${facts.attempts} attempt${facts.attempts === 1 ? '' : 's'} — not cleared yet`}</p>}
                    {facts.doublePending && <p className="story-stop-facts" data-testid="story-double-pending">You beat him once — double or nothing: one more win takes the crown.</p>}
                    {stopSave && <p className="story-stop-facts" data-testid={`story-inprogress-${stop.id}`}>Match in progress — hand {stopSave.handNo}. Pick it up right where you left it.</p>}
                    <StopSecrets stop={stop} cleared={facts.clears > 0} finds={progress?.finds} />
                  </div>
                  {state !== 'locked' && (
                    <div className="story-stop-actions">
                      <button
                        type="button"
                        className="btn ghost story-meet"
                        data-testid={`story-meet-${stop.id}`}
                        disabled={signedOut}
                        onClick={() => goScreen({ k: 'tape', stop })}
                      >Meet them</button>
                      {stopSave ? (
                        <>
                          <button
                            type="button"
                            className="btn primary story-play"
                            data-testid={`story-resume-${stop.id}`}
                            disabled={signedOut}
                            onClick={() => resumeStop(stop, stopSave.save)}
                          >Resume</button>
                          <button
                            type="button"
                            className="btn ghost story-restart"
                            data-testid={`story-restart-${stop.id}`}
                            disabled={signedOut}
                            onClick={() => restartStop(stop)}
                          >Restart</button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn primary story-play"
                          data-testid={`story-play-${stop.id}`}
                          disabled={signedOut}
                          onClick={() => goScreen({ k: 'intro', stop })}
                        >{state === 'cleared' ? 'Replay' : facts.doublePending ? 'Finish the double' : 'Play'}</button>
                      )}
                    </div>
                  )}
                  {dev === true && stopHasFacts(stop) && (
                    <div className="story-reset" data-testid={`story-reset-${stop.id}`}>
                      {armedReset === stop.id ? (
                        <>
                          <p className="story-reset-copy">
                            Reset {stop.name}? This wipes its attempts and clear, plus this stop&apos;s egg and feat finds — the next win presents as a first clear again. XP and coins already earned stay.
                          </p>
                          <div className="story-reset-actions">
                            <button type="button" className="btn ghost" data-testid={`story-reset-confirm-${stop.id}`} disabled={resetBusy} onClick={() => void doReset(stop)}>Reset it</button>
                            <button type="button" className="btn ghost" data-testid={`story-reset-cancel-${stop.id}`} disabled={resetBusy} onClick={() => setArmedReset(null)}>Keep it</button>
                          </div>
                        </>
                      ) : (
                        <button type="button" className="btn ghost story-reset-arm" data-testid={`story-reset-arm-${stop.id}`} onClick={() => setArmedReset(stop.id)}>Reset stop (owner)</button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <>
      <NowPlaying />
      {body}
      <SettingsSheetHost settings={settings} onChange={applySettings} tips={tips} onTips={setTips} />
      {viewDeck && <DeckViewer deck={viewDeck} onClose={() => setViewDeck(null)} />}
      {detail?.kind === 'setanim' && <SetAnimDetail stopId={detail.stopId} onClose={() => setDetail(null)} />}
      {detail?.kind === 'find' && <FindDetail find={detail.find} onClose={() => setDetail(null)} />}
    </>
  );
}

/**
 * The co-op map: one pair's route. Same stops, same order, facts from the
 * PAIR track only — a stop shows what the two of you have done together,
 * never what either did solo or with anyone else. Play opens a story room
 * at that stop with the partner named; the room takes it from there.
 */
function CoopMap({ progress, partnerHandle, busyStop, error, onPlay, onBack, onSolo, soloStarted }: {
  progress: StoryProgress | null;
  partnerHandle: string | null;
  busyStop: string | null;
  error: string | null;
  onPlay: (stop: StoryStop) => void;
  onBack: () => void;
  onSolo: () => void;
  soloStarted: boolean;
}) {
  const clearedCount = progress?.stops.filter((s) => s.clears > 0).length ?? 0;
  return (
    <div className="story-shell" data-testid="story-coop-map">
      <div className="story-topbar">
        <button type="button" className="btn ghost" data-testid="story-coop-back" onClick={onBack}>← Partners</button>
        <div className="story-title-block">
          <h1 className="story-title">Running with {partnerHandle ?? 'your partner'}</h1>
          <p className="story-sub">One run, together — the pair advances or nobody does.</p>
          <p className="story-hero-progress">{progress?.completed ? 'Route complete — you made it out, together.' : `${clearedCount} of ${STORY_STOPS.length} stops cleared together`}</p>
        </div>
        <span className="dock-slot" aria-hidden />
      </div>
      {error && <p className="story-note story-coop-err" role="alert">{error}</p>}
      {progress?.completed && <p className="story-note story-done" data-testid="story-coop-complete">YOU MADE IT OUT — together. ✓ Replays stay open for upkeep.</p>}
      <ol className="story-route">
        {STORY_STOPS.map((stop) => {
          const row = progress?.stops.find((s) => s.stopId === stop.id);
          const state = row?.state ?? (stop.n === 1 ? 'current' : 'locked');
          const pair = stop.pair.map((id) => STORY_CHARACTERS[id]!);
          const reward = storyClearReward(stop);
          return (
            <li key={stop.id} className={`story-stop state-${state}${stop.id === 'king' ? ' is-king' : ''}`} data-testid={`story-coop-stop-${stop.id}`}>
              <span className="story-node" aria-hidden>{state === 'cleared' ? '✓' : state === 'locked' ? '🔒' : stop.n}</span>
              <div className="story-card">
                <div className="story-card-art" style={{ backgroundImage: `url(${storyBackdropUrl(stop)})` }} aria-hidden>
                  <span className="story-card-faces">
                    <StoryFace characterId={stop.pair[0]} name={pair[0].name} className="card-face" />
                    <StoryFace characterId={stop.pair[1]} name={pair[1].name} className="card-face" />
                  </span>
                  {state === 'cleared' && <span className="story-card-state">✓ CLEARED TOGETHER</span>}
                  {state === 'current' && <span className="story-card-state here">{row?.doublePending ? 'DOUBLE OR NOTHING' : 'YOU ARE HERE'}</span>}
                </div>
                <div className="story-stop-body">
                  <p className="story-stop-name">{stop.name} <span className="story-tier">{STORY_TIER_LABEL[stop.tier]}</span></p>
                  <p className="story-stop-pair">{pair[0].name} &amp; {pair[1].name}</p>
                  <p className="story-stop-flavor">{stop.flavor}</p>
                  <p className="story-stop-twist">{stop.twist.label} · First clear: +{reward.xp} XP · +{reward.coins} coins — each</p>
                  {(row?.attempts ?? 0) > 0 && <p className="story-stop-facts">{(row?.clears ?? 0) > 0 ? `Cleared ${row!.clears}× together` : `${row!.attempts} attempt${row!.attempts === 1 ? '' : 's'} together — not cleared yet`}</p>}
                  {row?.doublePending && <p className="story-stop-facts" data-testid="story-coop-double-pending">You beat him once, together — double or nothing: one more win takes the crown.</p>}
                </div>
                {state !== 'locked' && (
                  <div className="story-stop-actions">
                    <button
                      type="button"
                      className="btn primary story-play"
                      data-testid={`story-coop-play-${stop.id}`}
                      disabled={busyStop !== null}
                      onClick={() => onPlay(stop)}
                    >{busyStop === stop.id ? 'Opening…' : state === 'cleared' ? 'Replay together' : row?.doublePending ? 'Finish the double' : 'Play together'}</button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!soloStarted && (
        <div className="story-mode-toggle">
          <button type="button" className="btn ghost" data-testid="story-mode-solo" onClick={onSolo}>Run it solo instead</button>
        </div>
      )}
    </div>
  );
}

function StoryHeader({ stop }: { stop: StoryStop }) {
  const pair = stop.pair.map((id) => STORY_CHARACTERS[id]!);
  return (
    <div className="story-topbar">
      <div className="story-title-block">
        <p className="story-crumb">Stop {stop.n} of {STORY_STOPS.length}</p>
        <h1 className="story-title">{stop.name}</h1>
        <p className="story-sub">{pair[0].name} &amp; {pair[1].name} · {stop.twist.label}</p>
      </div>
      <span className="dock-slot" aria-hidden />
    </div>
  );
}

/**
 * A stop's secrets on its map card — strictly post-discovery. Before a stop
 * is cleared the card shows nothing about the egg at all; after clearing,
 * an unfound egg shows only its subtle hint. The feat is the public chase:
 * its text and the collectible's name show from the start, the earned
 * state once the server records it.
 */
function StopSecrets({ stop, cleared, finds }: { stop: StoryStop; cleared: boolean; finds?: { eggs: string[]; feats: string[] } }) {
  const secret = STORY_SECRETS[stop.id];
  if (!secret) return null;
  const eggFound = (finds?.eggs ?? []).includes(secret.egg.id);
  const featEarned = (finds?.feats ?? []).includes(secret.unlockable.itemId);
  return (
    <>
      {eggFound
        ? <p className="story-stop-secret" data-testid={`story-egg-${stop.id}`}>🥚 {secret.egg.name} — {secret.egg.tale}</p>
        : cleared ? <p className="story-stop-hint" data-testid={`story-egg-hint-${stop.id}`}>{secret.egg.hint}</p> : null}
      <p className={`story-stop-feat${featEarned ? ' earned' : ''}`} data-testid={`story-feat-${stop.id}`}>
        {featEarned ? '🏆 ' : ''}Feat: {secret.unlockable.featText} → <b>{secret.unlockable.name}</b>{featEarned ? ' ✓' : ''}
      </p>
    </>
  );
}
