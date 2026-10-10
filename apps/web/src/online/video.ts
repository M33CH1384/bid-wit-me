/**
 * Optional per-player video: a WebRTC peer-to-peer mesh between the seated humans (max 3 peers each), with
 * signaling relayed through the table's Durable Object ({t:'rtc'} messages). Media never touches our servers.
 *
 * - Off by default. getUserMedia is only called from a tap on the camera/mic button (iOS requires a gesture),
 *   and only for what was turned on (camera and mic are separate permissions).
 * - Every pair negotiates once up front with one audio + one video transceiver (sendrecv, no tracks), so turning
 *   a camera/mic on or off is just `replaceTrack` — no renegotiation, no glare.
 * - "Perfect negotiation" (polite/impolite by player id) plus a per-page-load session id: if a peer reloads,
 *   their new session id tells us to rebuild that connection.
 * - Remote videos start muted (iOS autoplay policy); the first tap anywhere unmutes them.
 * - ICE: public STUN (Cloudflare + Google). Strict NATs/corporate networks need TURN; see config.ts `iceServers()`.
 */
import { iceServers } from './config';
import type { TableConnection } from './connection';

interface Signal { sid: string; hello?: boolean; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit | null }

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  remoteSid: string | null;
  stream: MediaStream;
  state: RTCPeerConnectionState;
}

export interface VideoState {
  cam: boolean;
  mic: boolean;
  local: MediaStream | null;
  /** playerId → remote stream (tracks may be muted until the peer turns something on) */
  remote: Record<string, MediaStream>;
  conn: Record<string, RTCPeerConnectionState>;
  /** remote audio is held muted until the user taps once (autoplay policy) */
  needsTap: boolean;
  /** players whose audio I muted / whose video I hid (local only) */
  muted: string[];
  /** voice anti-cheat: players my mic is not sent to and whose mic I don't play (partners during bidding / play) */
  limited: string[];
  /** playerId → host-music stream (the third transceiver), when that player streams music */
  music: Record<string, MediaStream>;
  hidden: string[];
  error: string | null;
  busy: boolean;
}

const VIDEO: MediaTrackConstraints = { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 320 }, frameRate: { ideal: 15, max: 20 } };
const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export class VideoMesh {
  state: VideoState = { cam: false, mic: false, local: null, remote: {}, conn: {}, needsTap: true, muted: [], limited: [], music: {}, hidden: [], error: null, busy: false };
  private peers = new Map<string, Peer>();
  private listeners = new Set<() => void>();
  private sid = Math.random().toString(36).slice(2, 10);
  private videoTrack: MediaStreamTrack | null = null;
  private audioTrack: MediaStreamTrack | null = null;
  private ice: RTCIceServer[] | null = null;
  private offRtc: () => void;
  private wanted: string[] = [];
  private disposed = false;
  /** signals that arrived before we were ready for that peer (ICE config loading / room state lagging) */
  private pending: [string, Signal][] = [];
  private stats: Record<string, { candOut: number; candIn: number; candErr: number }> = {};
  private stat(id: string) { return (this.stats[id] ??= { candOut: 0, candIn: 0, candErr: 0 }); }

  constructor(private conn: TableConnection, private me: string) {
    this.offRtc = conn.onRtc((from, data) => this.enqueue(from, data as Signal));
    void iceServers().then((s) => { this.ice = s; this.setPeers(this.wanted); });
    this.onFirstTap = this.onFirstTap.bind(this);
    window.addEventListener('pointerdown', this.onFirstTap, { capture: true });
    (window as unknown as { __bwmVideo?: VideoMesh }).__bwmVideo = this; // for automated tests / debugging
  }

  /** Debug snapshot (tests). */
  debug() {
    return {
      me: this.me, sid: this.sid, wanted: this.wanted, ice: !!this.ice, pending: this.pending.length,
      peers: [...this.peers.values()].map((p) => ({ id: p.id, polite: p.polite, remoteSid: p.remoteSid, signaling: p.pc.signalingState, gathering: p.pc.iceGatheringState, stats: this.stats[p.id], conn: p.pc.connectionState, ice: p.pc.iceConnectionState, tracks: p.stream.getTracks().map((t) => `${t.kind}:${t.readyState}:${t.muted ? 'muted' : 'live'}`), tx: p.pc.getTransceivers().map((t) => `${t.receiver.track?.kind}:${t.direction}:${t.currentDirection}:${t.sender.track ? 'track' : '-'}`) })),
    };
  }

  /** signaling is processed strictly in order (a candidate must not race ahead of its description) */
  private chain: Promise<void> = Promise.resolve();
  private enqueue(from: string, s: Signal): void {
    this.chain = this.chain.then(() => this.onSignal(from, s)).catch(() => {});
  }

  subscribe = (f: () => void) => { this.listeners.add(f); return () => this.listeners.delete(f); };
  getState = () => this.state;
  private set(p: Partial<VideoState>) { this.state = { ...this.state, ...p }; this.listeners.forEach((f) => f()); }

  private onFirstTap(): void {
    if (!this.state.needsTap) return;
    this.set({ needsTap: false });
    window.removeEventListener('pointerdown', this.onFirstTap, { capture: true });
  }

  /** Keep one connection per other seated, connected human. */
  setPeers(ids: string[]): void {
    this.wanted = ids.filter((x) => x !== this.me);
    if (!this.ice || this.disposed) return;
    for (const id of [...this.peers.keys()]) if (!this.wanted.includes(id)) this.dropPeer(id);
    for (const id of this.wanted) if (!this.peers.has(id)) this.makePeer(id, null);
    const q = this.pending.splice(0);
    for (const [from, sig] of q) this.enqueue(from, sig);
  }

  private signal(to: string, s: Omit<Signal, 'sid'>): void {
    this.conn.send({ t: 'rtc', to, data: { sid: this.sid, ...s } });
  }

  private makePeer(id: string, remoteSid: string | null): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.ice ?? [], bundlePolicy: 'max-bundle' });
    const p: Peer = { id, pc, polite: this.me > id, makingOffer: false, ignoreOffer: false, remoteSid, stream: new MediaStream(), state: 'new' };
    this.peers.set(id, p);
    pc.onicecandidate = (e) => { this.stat(id).candOut++; this.signal(id, { candidate: e.candidate ? e.candidate.toJSON() : null }); };
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(id, { description: pc.localDescription!.toJSON() });
      } catch (e) {
        console.warn('rtc offer', e);
      } finally {
        p.makingOffer = false;
      }
    };
    pc.ontrack = (e) => {
      // transceiver #3 (audio) carries host music, separate from the voice track so partner-muting never cuts it
      if (pc.getTransceivers().indexOf(e.transceiver) === 2) {
        const ms = new MediaStream([e.track]);
        const upd = () => this.set({ music: { ...this.state.music, [id]: ms } });
        e.track.onunmute = upd; e.track.onmute = upd; upd();
        return;
      }
      if (!p.stream.getTracks().includes(e.track)) p.stream.addTrack(e.track);
      const update = () => this.set({ remote: { ...this.state.remote, [id]: p.stream } });
      e.track.onunmute = update;
      e.track.onmute = update;
      update();
    };
    pc.onconnectionstatechange = () => {
      p.state = pc.connectionState;
      this.set({ conn: { ...this.state.conn, [id]: pc.connectionState } });
      if (pc.connectionState === 'failed') pc.restartIce();
    };
    // the impolite side opens the negotiation with both transceivers
    if (!p.polite) {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
      pc.addTransceiver('audio', { direction: 'sendrecv' }); // host music
      this.attachTracks(p);
    }
    this.signal(id, { hello: true });
    return p;
  }

  private dropPeer(id: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    this.peers.delete(id);
    const remote = { ...this.state.remote };
    delete remote[id];
    const conn = { ...this.state.conn };
    delete conn[id];
    const music = { ...this.state.music };
    delete music[id];
    this.set({ remote, conn, music });
  }

  private async onSignal(from: string, s: Signal): Promise<void> {
    if (this.disposed || !s || typeof s.sid !== 'string') return;
    if (!this.ice || !this.wanted.includes(from)) {
      if (this.pending.length < 200) this.pending.push([from, s]);
      return;
    }
    let p = this.peers.get(from);
    // a new session on their side (reload / new tab): start over with them
    if (p && p.remoteSid !== null && p.remoteSid !== s.sid) { this.dropPeer(from); p = undefined; }
    if (!p) p = this.makePeer(from, s.sid);
    p.remoteSid = s.sid;
    const pc = p.pc;
    try {
      if (s.description) {
        const collision = s.description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription(s.description);
        if (s.description.type === 'offer') {
          for (const t of pc.getTransceivers()) if (t.direction !== 'stopped' && t.direction !== 'sendrecv') t.direction = 'sendrecv';
          this.attachTracks(p);
          await pc.setLocalDescription();
          this.signal(from, { description: pc.localDescription!.toJSON() });
        }
      } else if (s.candidate !== undefined) {
        this.stat(from).candIn++;
        try { await pc.addIceCandidate(s.candidate ?? undefined); } catch (e) { this.stat(from).candErr++; if (!p.ignoreOffer) console.warn('ice', e); }
      }
    } catch (e) {
      console.warn('rtc signal', e);
    }
  }

  private transceiver(p: Peer, kind: 'audio' | 'video'): RTCRtpTransceiver | undefined {
    return p.pc.getTransceivers().find((t) => t.receiver.track?.kind === kind && t.direction !== 'stopped');
  }

  private attachTracks(p: Peer): void {
    const a = this.transceiver(p, 'audio');
    const v = this.transceiver(p, 'video');
    // partner-limited: don't even send my voice to them (send-side), so a modified client can't listen in
    void a?.sender.replaceTrack(this.state.limited.includes(p.id) ? null : this.audioTrack).catch(() => {});
    const m = p.pc.getTransceivers()[2];
    if (m && m.direction !== 'stopped') void m.sender.replaceTrack(this.musicTrack).catch(() => {});
    if (v) {
      void v.sender.replaceTrack(this.videoTrack).catch(() => {});
      try {
        const params = v.sender.getParameters();
        params.encodings = params.encodings?.length ? params.encodings : [{}];
        params.encodings[0]!.maxBitrate = 300_000;
        void v.sender.setParameters(params).catch(() => {});
      } catch { /* not supported */ }
    }
  }

  private localStream(): MediaStream | null {
    const tracks = [this.videoTrack, this.audioTrack].filter((t): t is MediaStreamTrack => !!t);
    return tracks.length ? new MediaStream(tracks) : null;
  }

  /** Must be called from a tap/click handler (iOS). */
  async setCam(on: boolean): Promise<void> {
    if (on === this.state.cam || this.state.busy) return;
    this.set({ busy: true, error: null });
    try {
      if (on) {
        const s = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: false });
        this.videoTrack = s.getVideoTracks()[0] ?? null;
      } else {
        this.videoTrack?.stop();
        this.videoTrack = null;
      }
      for (const p of this.peers.values()) this.attachTracks(p);
      this.set({ cam: on, local: this.localStream() });
      this.conn.send({ t: 'media', media: { cam: on, mic: this.state.mic } });
    } catch (e) {
      console.warn('camera failed', e); this.set({ error: permissionMessage(e, 'camera') });
    } finally {
      this.set({ busy: false });
    }
  }

  async setMic(on: boolean): Promise<void> {
    if (on === this.state.mic || this.state.busy) return;
    this.set({ busy: true, error: null });
    try {
      if (on) {
        const s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: false });
        this.audioTrack = s.getAudioTracks()[0] ?? null;
      } else {
        this.audioTrack?.stop();
        this.audioTrack = null;
      }
      for (const p of this.peers.values()) this.attachTracks(p);
      this.set({ mic: on, local: this.localStream() });
      this.conn.send({ t: 'media', media: { cam: this.state.cam, mic: on } });
    } catch (e) {
      console.warn('microphone failed', e); this.set({ error: permissionMessage(e, 'microphone') });
    } finally {
      this.set({ busy: false });
    }
  }

  /** Voice anti-cheat (partners during bidding and trick play). Same list = no-op. */
  setLimited(ids: string[]): void {
    const cur = this.state.limited;
    if (cur.length === ids.length && ids.every((x) => cur.includes(x))) return;
    this.set({ limited: [...ids] });
    for (const p of this.peers.values()) this.attachTracks(p);
  }

  /** Host music track (a file or device audio), sent to every peer on its own transceiver. */
  musicTrack: MediaStreamTrack | null = null;
  setMusicTrack(t: MediaStreamTrack | null): void {
    this.musicTrack = t;
    for (const p of this.peers.values()) this.attachTracks(p);
  }

  toggleMuted(id: string): void {
    const m = this.state.muted;
    this.set({ muted: m.includes(id) ? m.filter((x) => x !== id) : [...m, id], needsTap: false });
  }
  clearError(): void { if (this.state.error) this.set({ error: null }); }

  toggleHidden(id: string): void {
    const h = this.state.hidden;
    this.set({ hidden: h.includes(id) ? h.filter((x) => x !== id) : [...h, id] });
  }

  dispose(): void {
    this.disposed = true;
    this.offRtc();
    window.removeEventListener('pointerdown', this.onFirstTap, { capture: true });
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.videoTrack?.stop();
    this.audioTrack?.stop();
    this.listeners.clear();
  }
}

function permissionMessage(e: unknown, what: string): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError') {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const Cap = `${what[0]!.toUpperCase()}${what.slice(1)}`;
    const safari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS/.test(ua);
    if (safari && /iPhone|iPad/.test(ua)) return `${Cap} blocked. Tap aA in the address bar › Website Settings › ${Cap} › Allow, then try again.`;
    if (safari) return `${Cap} blocked. In Safari choose Safari › Settings… › Websites › ${Cap}, set this site to Allow, then tap the button again. (Also check System Settings › Privacy & Security › ${Cap}.)`;
    return `${Cap} blocked. Click the camera icon / lock in the address bar to allow it, then try again.`;
  }
  if (name === 'NotReadableError') return `Your ${what} is busy in another app (Zoom, FaceTime…). Close it and try again.`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${what} found on this device. Plug one in (or reconnect your phone/Continuity Camera), make sure no other app is using it, then tap the button again. You can keep playing without it.`;
  if (typeof navigator !== 'undefined' && !navigator.mediaDevices) return 'Video needs a secure (https) page.';
  return `Couldn't start the ${what}.`;
}
