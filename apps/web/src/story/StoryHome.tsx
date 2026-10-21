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
  STORY_STOPS, STORY_CHARACTERS, STORY_TIER_LABEL, STORY_TIER_SKILL, beatsFor, deeSkillForStop,
  storyReward, type StoryStop,
} from '@spades/bots';
import Table from '../Table';
import SettingsSheetHost from '../SettingsSheetHost';
import { NowPlaying } from '../SoundControls';
import { CoinIcon } from '../RepBlock';
import { type TipsPref, loadTips } from '../tips';
import { type Settings, loadSettings, saveSettings } from '../settings';
import { navigate } from '../online/nav';
import { storyRulesFor, storySettingsFor } from './storySettings';
import { fetchStoryProgress, postStoryResult, type StoryProgress, type StoryResult } from './storyApi';
import ScriptPlayer from './ScriptPlayer';
import './story.css';

type Screen =
  | { k: 'map' }
  | { k: 'intro'; stop: StoryStop }
  | { k: 'game'; stop: StoryStop; seed: string }
  | { k: 'outro'; stop: StoryStop; won: boolean };

export default function StoryHome() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [tips, setTips] = useState<TipsPref>(loadTips);
  const applySettings = (s: Settings) => { setSettings(s); saveSettings(s); };
  const [screen, setScreen] = useState<Screen>({ k: 'map' });
  const [progress, setProgress] = useState<StoryProgress | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [lastResult, setLastResult] = useState<StoryResult | null>(null);
  const finishedRef = useRef<{ seed: string; won: boolean } | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetchStoryProgress();
    if (r.status === 'ok') { setProgress(r.progress); setSignedOut(false); setLoadError(false); }
    else if (r.status === 'signedOut') { setSignedOut(true); setProgress(null); }
    else setLoadError(true);
  }, []);
  useEffect(() => { void refresh(); }, [refresh, screen.k === 'map']);

  const factsFor = (stop: StoryStop) => {
    const row = progress?.stops.find((s) => s.stopId === stop.id);
    return { attempts: row?.attempts ?? 0, clears: row?.clears ?? 0, cleared: (row?.clears ?? 0) > 0 };
  };
  const stateFor = (stop: StoryStop): 'cleared' | 'current' | 'locked' => {
    const row = progress?.stops.find((s) => s.stopId === stop.id);
    if (row) return row.state;
    return stop.n === 1 ? 'current' : 'locked'; // signed-out preview: nothing is recorded, nothing is promised
  };

  const startGame = (stop: StoryStop) => {
    finishedRef.current = null;
    setLastResult(null);
    setScreen({ k: 'game', stop, seed: secureSeed() });
  };

  const handleGameOver = (stop: StoryStop, seed: string) => (won: boolean) => {
    finishedRef.current = { seed, won };
    void postStoryResult(stop.id, won, `story-${seed}`).then((r) => {
      if (r) { setLastResult(r); setProgress(r); }
    });
  };

  let body: React.ReactNode;
  if (screen.k === 'intro') {
    const stop = screen.stop;
    body = (
      <div className="story-shell">
        <StoryHeader stop={stop} />
        <ScriptPlayer
          beats={beatsFor(stop, 'intro', factsFor(stop))}
          cta="To the table"
          onDone={() => startGame(stop)}
        />
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
        story={{
          names: ['You', pair[0].name, 'Dee', pair[1].name],
          levelFor: (seat) => (seat === 2 ? deeSkillForStop(stop.n) : tierSkill),
          onGameOver: handleGameOver(stop, screen.seed),
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
    body = (
      <div className="story-shell">
        <StoryHeader stop={stop} />
        {r && r.won && (
          <p className="story-reward-line" data-testid="story-reward-line">
            {r.firstClear ? <>First clear! <b>+{r.rewards.xp} XP</b> · <b>+{r.rewards.coins}</b> <CoinIcon size={14} /></> : <>Replay upkeep: <b>+{r.rewards.xp} XP</b> · <b>+{r.rewards.coins}</b> <CoinIcon size={14} /></>}
            {r.completed ? ' · Route complete — the solo mark is yours.' : ''}
          </p>
        )}
        {r && !r.won && <p className="story-reward-line">No rewards on a loss — and no penalty. The retry is free.</p>}
        <ScriptPlayer
          beats={beatsFor(stop, screen.won ? 'outroWin' : 'outroLose', factsFor(stop))}
          cta="Back to the map"
          onDone={() => setScreen({ k: 'map' })}
        />
        {!screen.won && (
          <button type="button" className="btn primary story-retry" data-testid="story-retry" onClick={() => setScreen({ k: 'intro', stop })}>Retry this stop</button>
        )}
      </div>
    );
  } else {
    body = (
      <div className="story-shell" data-testid="story-map">
        <div className="story-topbar">
          <button type="button" className="btn ghost" data-testid="story-home" onClick={() => navigate('/')}>← Home</button>
          <div className="story-title-block">
            <h1 className="story-title">Story Mode</h1>
            <p className="story-sub">Run the block — porch to the King. Solo, with Dee riding shotgun.</p>
          </div>
        </div>
        {signedOut && <p className="story-note" data-testid="story-signed-out">Sign in to run the route — your stops, rewards and the solo completion mark live on your account. The map below is a preview.</p>}
        {loadError && !signedOut && <p className="story-note">Couldn&apos;t load your progress just now. <button type="button" className="link" onClick={() => void refresh()}>Retry</button></p>}
        {progress?.completed && <p className="story-note story-done" data-testid="story-complete">ROUTE COMPLETE — you ran it solo, porch to King. ✓ Replays stay open for upkeep.</p>}
        <div className="story-dee-card">
          <div className="story-script-face" aria-hidden>D</div>
          <div>
            <p className="story-dee-name">Running with Dee</p>
            <p className="story-dee-line">Your partner for the whole route. She starts green and levels up stop to stop — by the Pj&apos;s, she calls shots.</p>
          </div>
        </div>
        <ol className="story-route">
          {STORY_STOPS.map((stop) => {
            const state = stateFor(stop);
            const pair = stop.pair.map((id) => STORY_CHARACTERS[id]!);
            const reward = storyReward(stop.n, true);
            const facts = factsFor(stop);
            return (
              <li key={stop.id} className={`story-stop state-${state}`} data-testid={`story-stop-${stop.id}`}>
                <div className="story-stop-badge" aria-hidden>{state === 'cleared' ? '✓' : state === 'locked' ? '🔒' : stop.n}</div>
                <div className="story-stop-body">
                  <p className="story-stop-name">{stop.name} <span className="story-tier">{STORY_TIER_LABEL[stop.tier]}</span></p>
                  <p className="story-stop-pair">{pair[0].name} &amp; {pair[1].name}</p>
                  <p className="story-stop-flavor">{stop.flavor}</p>
                  <p className="story-stop-twist">{stop.twist.label} · First clear: +{reward.xp} XP · +{reward.coins} coins</p>
                  {facts.attempts > 0 && <p className="story-stop-facts">{facts.clears > 0 ? `Cleared ${facts.clears}×` : `${facts.attempts} attempt${facts.attempts === 1 ? '' : 's'} — not cleared yet`}</p>}
                </div>
                {state !== 'locked' && (
                  <button
                    type="button"
                    className="btn primary story-play"
                    data-testid={`story-play-${stop.id}`}
                    disabled={signedOut}
                    onClick={() => setScreen({ k: 'intro', stop })}
                  >{state === 'cleared' ? 'Replay' : 'Play'}</button>
                )}
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
    </div>
  );
}
