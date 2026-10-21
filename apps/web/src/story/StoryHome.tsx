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
import { useCallback, useEffect, useRef, useState } from 'react';
import { secureSeed } from '@spades/rules';
import {
  STORY_SECRETS, STORY_STOPS, STORY_CHARACTERS, STORY_TIER_LABEL, STORY_TIER_SKILL, beatsFor, deeSkillForStop,
  kingDoubleBeats, storyClearReward, type StoryBeatFacts, type StoryGameFacts, type StoryStop,
} from '@spades/bots';
import Table from '../Table';
import SettingsSheetHost from '../SettingsSheetHost';
import { NowPlaying } from '../SoundControls';
import { CoinIcon } from '../RepBlock';
import { sound } from '../audio';
import { type TipsPref, loadTips } from '../tips';
import { type Settings, loadSettings, saveSettings } from '../settings';
import { navigate } from '../online/nav';
import { storyRulesFor, storySettingsFor } from './storySettings';
import { storyBackdropUrl } from './storyBackdrop';
import { STORY_OWNER_ONLY, fetchStoryAccess, fetchStoryDev, fetchStoryProgress, postStoryFound, postStoryResetStop, postStoryResult, storyLockedFor, type StoryProgress, type StoryResult } from './storyApi';
import { deckUnlockNotice, invalidateStoryProgress } from '../storyDecks';
import { setAnimUnlockNotice } from '../setAnims';
import { clearStoryGame, loadStoryGame, storySaveSummary, storySaveValidFor, type StorySavedGame } from './storySave';
import { railFor, storyBadgesFor } from '@spades/bots';
import ScriptPlayer, { type SceneEgg } from './ScriptPlayer';
import StoryTape from './StoryTape';
import StoryFace from './StoryFace';
import StoryBadges, { badgeFactsOf } from './StoryBadges';
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

export default function StoryHome() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [tips, setTips] = useState<TipsPref>(loadTips);
  const applySettings = (s: Settings) => { setSettings(s); saveSettings(s); };
  const [screen, setScreen] = useState<Screen>({ k: 'map' });
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
  useEffect(() => {
    let live = true;
    void fetchStoryDev().then((d) => { if (live) setDev(d); });
    void fetchStoryAccess().then((a) => { if (live) setStoryAccess(a); });
    return () => { live = false; };
  }, []);
  const [lastResult, setLastResult] = useState<StoryResult | null>(null);
  const finishedRef = useRef<{ seed: string; won: boolean } | null>(null);
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

  const startGame = (stop: StoryStop) => {
    finishedRef.current = null;
    setLastResult(null);
    progressBeforeRef.current = progress;
    setScreen({ k: 'game', stop, seed: secureSeed() });
  };

  /** Resume the saved match: straight to the table — no tape, no intro. */
  const resumeStop = (stop: StoryStop, save: StorySavedGame) => {
    finishedRef.current = null;
    setLastResult(null);
    progressBeforeRef.current = progress;
    setScreen({ k: 'game', stop, seed: save.seed, resumeSave: save });
  };

  /** Abandon the saved match and start the stop fresh. No result is posted
   *  and no attempt is counted for a discarded save — attempts only ever
   *  count finished matches. */
  const restartStop = (stop: StoryStop) => {
    clearStoryGame();
    setSaved(null);
    setScreen({ k: 'intro', stop });
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
  } else if (screen.k === 'tape') {
    const stop = screen.stop;
    body = (
      <div className="story-shell">
        <StoryHeader stop={stop} />
        <StoryTape stop={stop} facts={factsFor(stop)} cta="Back to the map" onDone={() => setScreen({ k: 'map' })} />
      </div>
    );
  } else if (screen.k === 'intro') {
    const stop = screen.stop;
    body = (
      <div className="story-shell">
        <StoryHeader stop={stop} />
        <SceneAudio stop={stop} />
        {introStep === 'tape' ? (
          <StoryTape stop={stop} facts={factsFor(stop)} cta="Play the scene" onDone={() => setIntroStep('scene')} />
        ) : (
          <ScriptPlayer
            beats={beatsFor(stop, 'intro', factsFor(stop))}
            cta="To the table"
            onDone={() => startGame(stop)}
            bgUrl={storyBackdropUrl(stop)}
            cast={[stop.pair[0], 'dee', stop.pair[1]]}
            rail={railFor(stop.id)}
            egg={eggFor(stop)}
            onEggFound={() => handleEggFound(stop)}
          />
        )}
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
            },
        }}
        onExit={() => setScreen(finishedRef.current?.seed === screen.seed ? { k: 'outro', stop, won: finishedRef.current.won } : { k: 'map' })}
        onMainMenu={() => setScreen(finishedRef.current?.seed === screen.seed ? { k: 'outro', stop, won: finishedRef.current.won } : { k: 'map' })}
        onSuspend={() => setScreen({ k: 'map' })}
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
        {r && r.won && !dblStarted && (
          <p className="story-reward-line" data-testid="story-reward-line">
            {r.firstClear ? <>First clear! <b>+{r.rewards.xp} XP</b> · <b>+{r.rewards.coins}</b> <CoinIcon size={14} /></> : <>Replay upkeep: <b>+{r.rewards.xp} XP</b> · <b>+{r.rewards.coins}</b> <CoinIcon size={14} /></>}
            {r.completed ? ' · Route complete — the solo mark is yours.' : ''}
          </p>
        )}
        {dblStarted && (
          <p className="story-reward-line" data-testid="story-double-line">
            You beat the King once — and banked <b>nothing</b>. Double or nothing: one more win takes the crown and double the clear. Lose, and both wins are gone.
          </p>
        )}
        {r && r.won && r.firstClear && deckUnlockNotice(r.stopId) && (
          <p className="story-deck-line" data-testid="story-deck-notice">{deckUnlockNotice(r.stopId)}</p>
        )}
        {r && r.won && r.firstClear && setAnimUnlockNotice(r.stopId) && (
          <p className="story-deck-line" data-testid="story-setanim-notice">{setAnimUnlockNotice(r.stopId)}</p>
        )}
        {r && !r.won && !dblLost && <p className="story-reward-line">No rewards on a loss — and no penalty. The retry is free.</p>}
        {dblLost && (
          <p className="story-reward-line" data-testid="story-double-lost-line">
            Double or nothing — and it came up nothing. The first win is wiped with it: no clear, no rewards for either leg. The King stays current.
          </p>
        )}
        {r && (r.newFinds?.length ?? 0) > 0 && (
          <p className="story-find-line" data-testid="story-new-finds">
            {r.newFinds.map((f) => <span key={f.id} className="story-find-chip">{f.kind === 'feat' ? '🏆' : '🥚'} {f.kind === 'feat' ? 'Unlocked' : 'Found'}: {f.name}</span>)}
          </p>
        )}
        {screen.won && !dblStarted && (() => {
          const before = new Set(storyBadgesFor(badgeFactsOf(progressBeforeRef.current)).filter((b) => b.earned).map((b) => b.id));
          const after = storyBadgesFor(badgeFactsOf(r ?? progress));
          const fresh = new Set(after.filter((b) => b.earned && !before.has(b.id)).map((b) => b.id));
          return <StoryBadges facts={badgeFactsOf(r ?? progress)} highlight={fresh} title="Badges" />;
        })()}
        <ScriptPlayer
          beats={dblStarted ? kingDoubleBeats('started') : dblLost ? kingDoubleBeats('lost') : beatsFor(stop, screen.won ? 'outroWin' : 'outroLose', factsFor(stop))}
          cta="Back to the map"
          onDone={() => setScreen({ k: 'map' })}
          bgUrl={storyBackdropUrl(stop)}
          cast={[stop.pair[0], 'dee', stop.pair[1]]}
          rail={railFor(stop.id)}
        />
        {dblStarted && (
          <button type="button" className="btn primary story-retry" data-testid="story-double-runback" onClick={() => startGame(stop)}>Run it back — leg 2</button>
        )}
        {!screen.won && (
          <button type="button" className="btn primary story-retry" data-testid="story-retry" onClick={() => setScreen({ k: 'intro', stop })}>Retry this stop</button>
        )}
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
        <StoryBadges facts={badgeFactsOf(progress)} />
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
                        onClick={() => setScreen({ k: 'tape', stop })}
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
                          onClick={() => setScreen({ k: 'intro', stop })}
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
    </>
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
 * Scene audio (audio-pass contract, 2026-10-21): the stop's venue bed +
 * original score mood start WITH the scene — you hear the place before
 * the first line — via sound.setStoryStop(stop.id) (theme / sparse /
 * danger / king per stop, plus the Rec Center's gym bed), and the story
 * motif stings the scene in. On unmount the stop clears (setStoryStop
 * null + the menu context, which also clears it) so nothing bleeds onto
 * other screens; the table mounts the same venue when play begins.
 */
function SceneAudio({ stop }: { stop: StoryStop }) {
  useEffect(() => {
    sound.enterContext('game');
    sound.enterTable();
    sound.setStoryStop(stop.id);
    sound.storySting('scene');
    return () => {
      sound.setStoryStop(null);
      sound.leaveTable();
      sound.enterContext('menu');
    };
  }, [stop.id]);
  return null;
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
