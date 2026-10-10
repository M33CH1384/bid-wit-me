import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { CODE_LENGTH, isRoomCode, normalizeRoomCode } from '@spades/protocol';
import MoreOptions, { Seg, Toggle } from './MoreOptions';
import { type ModeKey, type Settings, MODES } from './settings';
import { type TipsPref, isFirstVisit, loadTips, saveTips } from './tips';
import { serverUrl } from './online/config';
import { createTable, tableInfo } from './online/connection';
import { loadName, saveName } from './online/identity';
import { navigate } from './online/nav';

/**
 * Start flow as a wizard: splash (logo + Play Online / Play vs Bots + Resume) → mode → essentials → go.
 * Each step slides in; the browser / phone back gesture goes back a step (history.state.wiz).
 * Everything else lives behind the gear ("More options").
 */
type Step = 'home' | 'mode' | 'setup';
type Path = 'bots' | 'online';
const ORDER: Step[] = ['home', 'mode', 'setup'];

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onStart: () => void;
  /** Offline game in progress (save in localStorage). */
  onResume?: (() => void) | null;
  resumeLabel?: string;
}

const ONE_LINERS: Record<ModeKey, string> = {
  joker: 'Partners · jokers are the top trumps',
  cutthroat4: 'Every player for themselves',
  cutthroat3: '3 players · 17 cards each',
  aceDown: 'Partners · classic deck, aces high',
};
const MODE_TAG: Record<ModeKey, string> = { joker: '2 v 2', cutthroat4: '4 players', cutthroat3: '3 players', aceDown: '2 v 2' };

function readWiz(): { step: Step; path: Path } {
  const w = (history.state ?? {}) as { wiz?: Step; path?: Path };
  return { step: w.wiz && ORDER.includes(w.wiz) ? w.wiz : 'home', path: w.path ?? 'bots' };
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

export default function Setup({ settings: s, onChange, onStart, onResume, resumeLabel }: Props) {
  const [{ step, path }, setWiz] = useState(readWiz);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [more, setMore] = useState(false);
  const [tips, setTips] = useState<TipsPref>(loadTips);
  const [ask, setAsk] = useState(isFirstVisit);
  const onlineSeat = useOnlineSeat();
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });

  useEffect(() => {
    if (!(history.state as { wiz?: Step } | null)?.wiz) history.replaceState({ ...(history.state ?? {}), wiz: 'home' }, '');
    const on = () => {
      const w = readWiz();
      setWiz((cur) => { setDir(ORDER.indexOf(w.step) < ORDER.indexOf(cur.step) ? 'back' : 'fwd'); return w; });
    };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  const go = (next: Step, p: Path = path) => {
    history.pushState({ wiz: next, path: p }, '');
    setDir('fwd');
    setWiz({ step: next, path: p });
  };
  const back = () => history.back();
  const setTipsPref = (on: boolean) => { const t = { on, asked: true }; saveTips(t); setTips(t); };

  let body: ReactNode;
  if (step === 'home') {
    body = (
      <div className="wiz-home">
        <div className="splash">
          <img className="logo splash-logo" src="/assets/bwm-wordmark-white.svg" alt="" />
          <h1 className="sr-only">Bid Wit Me</h1>
          <p className="tagline">Spades with the crew</p>
        </div>
        <div className="wiz-actions">
          <button type="button" className="big-choice online" data-testid="play-online" onClick={() => go('mode', 'online')}>
            <span className="bc-icon" aria-hidden>👥</span><span className="bc-text"><b>Play Online</b><small>with friends</small></span>
          </button>
          <button type="button" className="big-choice bots" data-testid="play-bots" onClick={() => go('mode', 'bots')}>
            <span className="bc-icon" aria-hidden>🤖</span><span className="bc-text"><b>Play vs Bots</b><small>solo, any time</small></span>
          </button>
          {(onResume || onlineSeat) && (
            <div className="resume-row">
              {onResume && <button type="button" className="resume-btn" data-testid="resume" onClick={onResume}>▶ Resume {resumeLabel ?? 'game'}</button>}
              {onlineSeat && <button type="button" className="resume-btn" data-testid="resume-online" onClick={() => navigate(`/t/${onlineSeat}`)}>▶ Rejoin table {onlineSeat}</button>}
            </div>
          )}
        </div>
      </div>
    );
  } else if (step === 'mode') {
    body = (
      <>
        <h2 className="wiz-title">Pick a game</h2>
        <div className="mode-cards">
          {MODES.map((m) => (
            <button key={m.key} type="button" className={`mode-card ${s.mode === m.key ? 'selected' : ''}`} data-testid={`mode-${m.key}`} onClick={() => { set('mode', m.key as ModeKey); go('setup'); }}>
              <span className="mc-title">{m.title}</span>
              <span className="mc-tag">{MODE_TAG[m.key as ModeKey]}</span>
              <span className="mc-line">{ONE_LINERS[m.key as ModeKey]}</span>
            </button>
          ))}
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
    const tipsRow = (
      <div className="ess-row tips-row">
        <span className="ess-label">Show me how to play<small>tips during the first hand</small></span>
        <Toggle label="Show me how to play (tips during first hand)" value={tips.on} onChange={setTipsPref} />
      </div>
    );
    body = (
      <>
        <h2 className="wiz-title">{mode.title}<small>{path === 'online' ? 'online with friends' : 'vs bots'}</small></h2>
        {path === 'bots' ? (
          <div className="ess">
            <div className="ess-row">
              <span className="ess-label">Bots</span>
              <Seg label="Bot level" value={s.botLevel} options={[['easy', 'Easy'], ['normal', 'Normal']]} onChange={(v) => set('botLevel', v)} />
            </div>
            <div className="ess-row">
              <span className="ess-label">Play to</span>
              <Seg label="Target score" value={s.targetScore} options={[250, 300, 500].map((x) => (x === (cut ? 300 : 500) ? ['default', String(x)] : [x, String(x)])) as [number | 'default', string][]} onChange={(v) => set('targetScore', v)} />
            </div>
            {deck}
            {tipsRow}
            <button type="button" className="primary big go" data-testid="start-bots" onClick={onStart}>Deal me in</button>
          </div>
        ) : (
          <OnlineEssentials settings={s} deck={deck} tipsRow={tipsRow} />
        )}
      </>
    );
  }

  return (
    <div className={`wizard step-${step}`} data-testid="wizard">
      <header className="wiz-bar">
        {step !== 'home' ? <button type="button" className="icon-btn back" aria-label="Back" data-testid="wiz-back" onClick={back}>←</button> : <span />}
        <div className="wiz-dots" aria-hidden>{ORDER.map((x) => <i key={x} className={x === step ? 'on' : ''} />)}</div>
        <button type="button" className="icon-btn" aria-label="More options" data-testid="more" onClick={() => setMore(true)}>⚙</button>
      </header>
      <main key={step} className={`wiz-step slide-${dir}`}>{body}</main>
      {more && <MoreOptions settings={s} onChange={onChange} tips={tips} onTips={setTips} onClose={() => setMore(false)} />}
      {ask && (
        <div className="modal-backdrop">
          <div className="modal glass slant tips-ask" role="dialog" aria-label="New to Spades?">
            <div className="panel-title big">NEW TO SPADES?</div>
            <p>Turn on tips? I'll coach you through your first hand. You can switch them off any time.</p>
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

function OnlineEssentials({ settings, deck, tipsRow }: { settings: Settings; deck: ReactNode; tipsRow: ReactNode }) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameOk = name.trim().length > 0;
  void settings;
  const create = async () => {
    if (!nameOk) { setErr('Enter your name first'); return; }
    setBusy(true); setErr(null);
    try {
      const c = await createTable(serverUrl());
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
  return (
    <div className="ess">
      <label className="ess-row">
        <span className="ess-label">Your name</span>
        <input className="name-input" value={name} maxLength={20} autoComplete="nickname" placeholder="e.g. Meech" onChange={(e) => setName(e.target.value)} aria-label="Your name" />
      </label>
      {deck}
      {tipsRow}
      <button type="button" className="primary big go" disabled={busy} onClick={create} data-testid="create-table">Create table</button>
      <form className="join-row" onSubmit={join}>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="TABLE CODE" maxLength={8} aria-label="Table code" autoCapitalize="characters" />
        <button type="submit" className="primary" disabled={busy} data-testid="join-code">Join</button>
      </form>
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
