import { saveSeries } from './Series';
import { useEffect, useState } from 'react';
import { preloadTable } from './three/preload';
import { secureSeed } from '@spades/rules';
import Setup from './Setup';
import { usePresence } from './social/Social';
import { NowPlaying } from './SoundControls';
import Table from './Table';
import { MODES, type Settings, loadSettings, saveSettings, settingsToRules } from './settings';
import { type SavedGame, loadGame, resumeOnLoad } from './save';
import { flushLocalGames, watchLocalGames } from './localStats';

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [game, setGame] = useState<{ seed: string; settings: Settings; resume?: SavedGame; dealer?: number } | null>(() => {
    const p = new URLSearchParams(location.search);
    if (p.get('autostart')) {
      history.replaceState(null, '', location.pathname); // a later refresh resumes instead of restarting
      return { seed: p.get('seed') ?? secureSeed(), settings: loadSettings() };
    }
    // refresh / reopen drops back in. Leave (including a spectator leaving an online table) sets
    // wiz:home and must land on the menu, not on the previous bot game.
    const saved = resumeOnLoad(history.state, loadGame(), false);
    return saved ? { seed: saved.seed, settings: saved.settings, resume: saved } : null;
  });

  // Release 9 presence: on the start screen = Online; in an offline game = At a table (vs bots)
  const offMode = game ? settingsToRules(game.settings).mode : undefined;
  usePresence(game ? { kind: 'table', mode: offMode === 'joker' || offMode === 'aceDown' ? offMode : 'cutthroat', offline: true } : { kind: 'online' });

  // splash / wizard: fetch the 3D table (Scene chunk, textures, HDRI) in the background so "Deal me in" lands on it
  // Splash keeps the idle delay (the first paint should not share the link with three). A resumed
  // game is already on screen, so the scene chunk starts as soon as that first paint has committed.
  useEffect(() => { preloadTable(settings.quality, settings.venue, { immediate: game !== null }); }, [settings.quality, settings.venue, game]);
  // a signed-in offline game that failed to upload stays in localStorage until the browser is online again
  useEffect(() => { watchLocalGames(); void flushLocalGames(); }, []);

  if (!game) {
    const saved = loadGame();
    return (
      <>
      <NowPlaying />
      <Setup
        settings={settings}
        onChange={(s) => { setSettings(s); saveSettings(s); }}
        onStart={() => { saveSettings(settings); saveSeries(null); setGame({ seed: secureSeed(), settings }); }}
        onResume={saved ? () => setGame({ seed: saved.seed, settings: saved.settings, resume: saved }) : null}
        resumeLabel={saved ? `${MODES.find((m) => m.key === saved.settings.mode)?.title ?? 'game'} · hand ${saved.state.handNo}` : undefined}
      />
      </>
    );
  }
  return (
    <>
    <NowPlaying />
    <Table
      key={game.seed}
      rules={settingsToRules(game.settings)}
      seed={game.seed}
      resume={game.resume}
      settings={game.settings}
      onExit={() => { history.replaceState({ wiz: 'home', d: 0 }, '', '/'); setGame(null); }}
      onSuspend={() => { history.replaceState({ wiz: 'home', d: 0 }, '', '/'); setGame(null); }}
      onRematch={(dealer) => setGame({ seed: secureSeed(), settings: game.settings, dealer })}
      startDealer={game.dealer}
      onQuality={(quality) => { const s = { ...game.settings, quality }; setGame({ ...game, settings: s }); setSettings(s); saveSettings(s); }}
    />
    </>
  );
}
