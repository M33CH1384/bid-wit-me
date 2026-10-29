import { saveSeries } from './Series';
import { clearTableChatOpen } from './chatView';
import { useEffect, useState } from 'react';
import { preloadTable } from './three/preload';
import { secureSeed } from '@spades/rules';
import Setup from './Setup';
import SettingsSheetHost from './SettingsSheetHost';
import { type TipsPref, loadTips } from './tips';
import { usePresence } from './social/Social';
import { NowPlaying } from './SoundControls';
import { sound } from './audio';
import Table from './Table';
import { MODES, type Settings, loadSettings, saveSettings, settingsToRules } from './settings';
import { type SavedGame, confirmReplaceSave, loadGame, markInGame, resumeOnLoad, wasInGame } from './save';
import { flushLocalGames, watchLocalGames } from './localStats';
import { holdIdleExemption } from './inactivity';
import { coverTableEntry, coverThen } from './transitions';

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  // Tips prefs live here (not in Setup) so the one Settings sheet — hosted below for
  // both the wizard and the table — and the wizard's own tips toggle share one copy.
  const [tips, setTips] = useState<TipsPref>(loadTips);
  const applySettings = (s: Settings) => { setSettings(s); saveSettings(s); };
  const [game, setGame] = useState<{ seed: string; settings: Settings; resume?: SavedGame; dealer?: number; continueSeries?: boolean } | null>(() => {
    const p = new URLSearchParams(location.search);
    if (p.get('autostart')) {
      history.replaceState(null, '', location.pathname); // a later refresh opens the menu, not this game
      saveSeries(null); // a test start is a fresh game: 0–0, same as Deal me in
      return { seed: p.get('seed') ?? secureSeed(), settings: loadSettings(), continueSeries: false };
    }
    // Opening the app and refreshing land on the menu. A saved bot game is not resumed.
    // Leave (including a spectator leaving an online table) also sets wiz:home.
    const saved = resumeOnLoad(history.state, loadGame(), false, wasInGame());
    if (!saved) markInGame(false);
    return saved ? { seed: saved.seed, settings: saved.settings, resume: saved, continueSeries: true } : null;
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

  // Offline bot games NEVER idle-log-out: hold the exemption for the whole game.
  useEffect(() => { if (!game) return; return holdIdleExemption(); }, [game !== null]);
  // Refresh at the table returns to it; refresh anywhere else keeps that screen (history.state holds the wizard step).
  useEffect(() => { markInGame(game !== null); }, [game]);
  // Sound context at the root: no game on screen = menus (ambience by default). A mounted
  // Table switches to 'game' itself; this covers boot, lobby and setup screens.
  useEffect(() => { if (!game) sound.enterContext('menu'); }, [game === null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!game) {
    const saved = loadGame();
    return (
      <>
      <NowPlaying />
      <Setup
        settings={settings}
        onChange={applySettings}
        tips={tips}
        onTips={setTips}
        onStart={() => { if (!confirmReplaceSave(saved, (m) => window.confirm(m))) return; history.replaceState({ wiz: 'home', d: 0 }, '', location.pathname); saveSettings(settings); saveSeries(null); coverTableEntry(); setGame({ seed: secureSeed(), settings, continueSeries: false }); }}
        onResume={saved ? () => { history.replaceState({ wiz: 'home', d: 0 }, '', location.pathname); coverTableEntry(); setGame({ seed: saved.seed, settings: saved.settings, resume: saved, continueSeries: true }); } : null}
        resumeLabel={saved ? `${MODES.find((m) => m.key === saved.settings.mode)?.title ?? 'game'} · hand ${saved.state.handNo}` : undefined}
      />
      <SettingsSheetHost settings={settings} onChange={applySettings} tips={tips} onTips={setTips} />
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
      continueSeries={game.continueSeries}
      settings={game.settings}
      onExit={() => coverThen(() => { clearTableChatOpen(); history.replaceState({ wiz: 'home', d: 0 }, '', '/'); setGame(null); }, 'table-exit')}
      onSuspend={() => coverThen(() => { clearTableChatOpen(); history.replaceState({ wiz: 'home', d: 0 }, '', '/'); setGame(null); }, 'table-exit')}
      onRematch={(dealer) => setGame({ seed: secureSeed(), settings: game.settings, dealer, continueSeries: true })}
      startDealer={game.dealer}
      onQuality={(quality) => { const s = { ...game.settings, quality }; setGame({ ...game, settings: s }); setSettings(s); saveSettings(s); }}
      onView={(view) => { const s = { ...game.settings, view }; setGame({ ...game, settings: s }); setSettings(s); saveSettings(s); }}
      onViewAdjust={(viewAdjust) => { const s = { ...game.settings, viewAdjust }; setGame({ ...game, settings: s }); setSettings(s); saveSettings(s); }}
      onTurnUp={(turnUp) => { const s = { ...game.settings, turnUp }; setGame({ ...game, settings: s }); setSettings(s); saveSettings(s); }}
    />
    {/* the speaker at the table opens the same one Settings sheet (sound landing);
        edits land on the saved settings — the live hand keeps its snapshot, exactly
        like the rules it was dealt under */}
    <SettingsSheetHost settings={settings} onChange={applySettings} tips={tips} onTips={setTips} />
    </>
  );
}
