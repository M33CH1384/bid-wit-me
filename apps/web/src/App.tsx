import { saveSeries } from './Series';
import { useEffect, useState } from 'react';
import { preloadTable } from './three/preload';
import { secureSeed } from '@spades/rules';
import Setup from './Setup';
import { NowPlaying } from './SoundControls';
import Table from './Table';
import { MODES, type Settings, loadSettings, saveSettings, settingsToRules } from './settings';
import { type SavedGame, loadGame } from './save';

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [game, setGame] = useState<{ seed: string; settings: Settings; resume?: SavedGame; dealer?: number } | null>(() => {
    const p = new URLSearchParams(location.search);
    if (p.get('autostart')) {
      history.replaceState(null, '', location.pathname); // a later refresh resumes instead of restarting
      return { seed: p.get('seed') ?? secureSeed(), settings: loadSettings() };
    }
    // refresh / reopen: drop straight back into an in-progress game
    const saved = loadGame();
    return saved ? { seed: saved.seed, settings: saved.settings, resume: saved } : null;
  });

  // splash / wizard: fetch the 3D table (Scene chunk, textures, HDRI) in the background so "Deal me in" lands on it
  useEffect(() => { preloadTable(settings.quality); }, [settings.quality]);

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
