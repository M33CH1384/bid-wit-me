import { type FormEvent, useEffect, useState } from 'react';
import { CODE_LENGTH, isRoomCode, normalizeRoomCode } from '@spades/protocol';
import { NowPlaying } from '../SoundControls';
import { type Settings, loadSettings, saveSettings, settingsToRules } from '../settings';
import { serverUrl } from './config';
import { TableConnection, createTable, tableInfo } from './connection';
import { forgetToken, loadName, saveName } from './identity';
import Lobby from './Lobby';
import { codeFromPath, navigate } from './nav';
import OnlineTable from './OnlineTable';
import { useConn } from './useOnline';
import { VideoMesh } from './video';
import './online.css';

/** /online (create or join) and /t/CODE (a table). */
export default function OnlineApp({ path }: { path: string }) {
  const code = codeFromPath(path);
  // "/online" itself is the wizard's online step on the start screen
  useEffect(() => { if (!code) navigate('/', true, { wiz: 'setup', path: 'online' }); }, [code]);
  const [name, setName] = useState(loadName);
  const [ready, setReady] = useState(() => !!code && !!loadName());
  if (!code) return null;
  if (!ready) {
    return <Entry code={code} name={name} onName={setName} onGo={(c) => { saveName(name.trim()); setReady(true); if (c !== code) navigate(`/t/${c}`); }} />;
  }
  return <TableRoom key={code} code={code} name={name.trim() || 'Player'} />;
}

function Entry({ code, name, onName, onGo }: { code: string | null; name: string; onName: (n: string) => void; onGo: (code: string) => void }) {
  const [join, setJoin] = useState(code ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof tableInfo>> | null>(null);
  const nameOk = name.trim().length >= 1;

  useEffect(() => {
    if (!code) return;
    tableInfo(serverUrl(), code).then(setInfo).catch(() => setErr("Can't reach the game server."));
  }, [code]);

  const create = async () => {
    if (!nameOk) { setErr('Enter your name first'); return; }
    setBusy(true); setErr(null);
    try {
      const c = await createTable(serverUrl());
      sessionStorage.setItem(`bwm.created.${c}`, '1');
      onGo(c);
    } catch (e) {
      setErr((e as Error).message || "Can't reach the game server.");
    } finally { setBusy(false); }
  };
  const doJoin = async (e?: FormEvent) => {
    e?.preventDefault();
    const c = normalizeRoomCode(join);
    if (!nameOk) { setErr('Enter your name first'); return; }
    if (!isRoomCode(c)) { setErr(`Table codes are ${CODE_LENGTH} letters/numbers`); return; }
    setBusy(true); setErr(null);
    try {
      const i = await tableInfo(serverUrl(), c);
      if (!i.exists) { setErr(`No table with code ${c}`); return; }
      onGo(c);
    } catch { setErr("Can't reach the game server."); } finally { setBusy(false); }
  };

  return (
    <div className="setup online-entry" data-testid="online-entry">
      <header className="setup-hero">
        <img className="logo" src="/assets/bwm-wordmark-white.svg" alt="" />
        <h1 className="sr-only">Bid Wit Me online</h1>
        <p className="tagline">Play online with friends</p>
        {code && info?.exists && <p>You're invited to table <b>{code}</b>{info.host ? ` (host: ${info.host})` : ''} · {info.mode === 'joker' ? 'Joker Spades' : info.mode === 'aceDown' ? 'Ace Down' : 'Cutthroat'}</p>}
        {code && info && !info.exists && <p className="err">Table {code} doesn't exist (or has expired).</p>}
      </header>
      <section className="panel">
        <label className="row"><span className="row-label">Your name<small>shown at the table</small></span>
          <span className="row-control"><input className="name-input" value={name} maxLength={20} autoComplete="nickname" placeholder="e.g. Meech" onChange={(e) => onName(e.target.value)} aria-label="Your name" /></span>
        </label>
      </section>
      {code && info?.exists ? (
        <button type="button" className="primary big" disabled={!nameOk || busy} onClick={() => { void doJoin(); }}>Join table {code}</button>
      ) : (
        <>
          <button type="button" className="primary big" disabled={busy} onClick={create} data-testid="create-table">Create a table</button>
          <form className="panel join-row" onSubmit={doJoin}>
            <input value={join} onChange={(e) => setJoin(e.target.value.toUpperCase())} placeholder="TABLE CODE" maxLength={8} aria-label="Table code" autoCapitalize="characters" />
            <button type="submit" className="primary" disabled={busy}>Join</button>
          </form>
        </>
      )}
      {err && <div className="err" role="alert">{err}</div>}
      <button type="button" className="link" onClick={() => navigate('/')}>← Back to the start screen</button>
    </div>
  );
}

function TableRoom({ code, name }: { code: string; name: string }) {
  // created in an effect (not useMemo) so StrictMode's mount/unmount/mount doesn't leave a closed socket behind
  const [conn, setConn] = useState<TableConnection | null>(null);
  useEffect(() => {
    const c = new TableConnection(code, name);
    setConn(c);
    return () => c.close();
  }, [code, name]);
  return conn ? <TableRoomInner conn={conn} code={code} /> : null;
}

function TableRoomInner({ conn, code }: { conn: TableConnection; code: string }) {
  const cs = useConn(conn);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [lobbyOpen, setLobbyOpen] = useState(false);
  const [mesh, setMesh] = useState<VideoMesh | null>(null);

  // one video mesh per page/session once we know our player id
  useEffect(() => {
    if (!cs.you) return;
    const m = new VideoMesh(conn, cs.you);
    setMesh(m);
    return () => m.dispose();
  }, [conn, cs.you]);

  // peers = the other seated, connected humans
  const peerKey = (cs.room?.seats ?? []).map((s) => (s.kind === 'human' && s.connected ? s.playerId : '')).join(',');
  useEffect(() => {
    if (!mesh) return;
    mesh.setPeers(cs.seat === null ? [] : peerKey.split(',').filter(Boolean));
  }, [mesh, peerKey, cs.seat]);

  // first arrival: the creator configures + takes seat 1; guests auto-sit in the first open seat
  const [autoDone, setAutoDone] = useState(false);
  useEffect(() => {
    if (autoDone || !cs.room || !cs.you) return;
    setAutoDone(true);
    const room = cs.room;
    const created = sessionStorage.getItem(`bwm.created.${code}`) === '1';
    if (created && room.hostId === cs.you && room.phase === 'lobby') {
      sessionStorage.removeItem(`bwm.created.${code}`);
      conn.send({ t: 'config', rules: settingsToRules(settings), botLevel: settings.botLevel });
    }
    if (cs.seat === null && room.phase === 'lobby') {
      const free = room.seats.findIndex((s) => s.kind === 'empty');
      if (free >= 0) conn.send({ t: 'sit', seat: free });
    }
  }, [cs.room, cs.you, cs.seat, autoDone, code, conn, settings]);

  // game (re)started → leave the lobby view
  const game = cs.room?.game ?? 0;
  useEffect(() => { setLobbyOpen(false); }, [game]);

  if (!cs.room) {
    return (
      <div className="setup online-entry">
        <p className="muted">{cs.status === 'reconnecting' ? `Can't reach table ${code}. Retrying…` : `Joining table ${code}…`}</p>
        <button type="button" className="link" onClick={() => navigate('/online')}>← Back</button>
      </div>
    );
  }
  const leave = (to = '/online') => {
    conn.send({ t: 'leave' });
    forgetToken(code);
    setTimeout(() => navigate(to, false, to === '/' ? { wiz: 'home' } : null), 50);
  };
  const inGame = cs.room.phase !== 'lobby' && cs.seat !== null && !!cs.view;
  return (
    <>
      <NowPlaying />
      {inGame && !lobbyOpen ? (
        <OnlineTable conn={conn} cs={cs} mesh={mesh} onLobby={() => setLobbyOpen(true)} onMainMenu={() => leave('/')} />
      ) : (
        <Lobby
          conn={conn} cs={cs} mesh={mesh} settings={settings}
          onSettings={(s) => { setSettings(s); saveSettings(s); }}
          onBackToGame={inGame ? () => setLobbyOpen(false) : null}
          onLeave={() => leave()}
        />
      )}
    </>
  );
}

