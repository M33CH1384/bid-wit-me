import { useState } from 'react';
import { secureSeed } from '@spades/rules';
import Setup from './Setup';
import Table from './Table';
import { type Settings, loadSettings, saveSettings, settingsToRules } from './settings';

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [game, setGame] = useState<{ seed: string; settings: Settings } | null>(() => {
    const p = new URLSearchParams(location.search);
    return p.get('autostart') ? { seed: p.get('seed') ?? secureSeed(), settings: loadSettings() } : null;
  });

  if (!game) {
    return (
      <Setup
        settings={settings}
        onChange={(s) => { setSettings(s); saveSettings(s); }}
        onStart={() => setGame({ seed: secureSeed(), settings })}
      />
    );
  }
  return (
    <Table
      key={game.seed}
      rules={settingsToRules(game.settings)}
      seed={game.seed}
      settings={game.settings}
      onExit={() => setGame(null)}
      onRematch={() => setGame({ seed: secureSeed(), settings: game.settings })}
      onQuality={(quality) => { const s = { ...game.settings, quality }; setGame({ ...game, settings: s }); setSettings(s); saveSettings(s); }}
    />
  );
}
