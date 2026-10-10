/**
 * Host music (online tables). Three ways for the host to set the vibe for everyone:
 *  (a) beat   — one of the 5 built-in tracks; the server stamps a start time and every client plays the same
 *               track from the same position (corrected for clock skew), looping.
 *  (b) link   — a Spotify / Apple Music "now playing" link shown as a tappable card for everyone.
 *  (c) stream — the host streams device audio (tab / system audio via getDisplayMedia, or a local file played
 *               into a MediaStream) over the table's existing WebRTC mesh, on its own audio transceiver.
 * Each player has their own "Host music" volume (localStorage), separate from game sounds and personal music.
 */
import { useSyncExternalStore } from 'react';
import type { HostMusic as HostMusicState } from '@spades/protocol';
import { TRACKS, sound } from './audio';

const KEY = 'bwm.hostMusic';
export interface HostSource { kind: 'file' | 'device'; title: string }
export interface HostMusicRoom { isHost: boolean; music: HostMusicState | null; send: (m: HostMusicState) => void; setTrack: (t: MediaStreamTrack | null) => void }

class HostMusicStore {
  volume = (() => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}').volume; return typeof v === 'number' ? v : 0.6; } catch { return 0.6; } })();
  room: HostMusicRoom | null = null;
  source: HostSource | null = null;
  status: 'idle' | 'loading' | 'playing' | 'blocked' | 'error' = 'idle';
  private beat: HTMLAudioElement | null = null;
  private beatKey = '';
  private beatTimer = 0;
  private srcStop: (() => void) | null = null;
  private srcGain: GainNode | null = null;
  private pausedPersonal = false;
  private listeners = new Set<() => void>();
  snap = { volume: this.volume, room: this.room, source: this.source, status: this.status };

  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  get = () => this.snap;
  private emit() { this.snap = { volume: this.volume, room: this.room, source: this.source, status: this.status }; this.listeners.forEach((f) => f()); }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    try { localStorage.setItem(KEY, JSON.stringify({ volume: this.volume })); } catch { /* ignore */ }
    if (this.beat) this.beat.volume = this.volume;
    if (this.srcGain) this.srcGain.gain.value = this.volume;
    this.emit();
  }

  /** Called by the online table / lobby whenever the room changes (null when leaving). */
  setRoom(room: HostMusicRoom | null, skew = 0) {
    this.room = room;
    const m = room?.music ?? null;
    if (m?.mode === 'beat') this.playBeat(m.track, m.startAt, skew);
    else this.stopBeat();
    // personal music pauses while the table has host music, and comes back after
    const hostOn = !!m && m.mode !== 'link';
    if (hostOn && sound.settings.music) { this.pausedPersonal = true; sound.set({ music: false }); }
    if (!hostOn && this.pausedPersonal) { this.pausedPersonal = false; sound.set({ music: true }); }
    if (!room || (m?.mode !== 'stream' && this.source)) this.stopSource(false);
    this.emit();
  }

  private playBeat(track: number, startAt: number, skew: number) {
    const key = `${track}:${startAt}`;
    if (key === this.beatKey) return;
    this.stopBeat();
    this.beatKey = key;
    const t = TRACKS[track % TRACKS.length]!;
    const el = new Audio(`/audio/music/${t.file}.mp3`);
    el.loop = true; el.volume = this.volume; el.preload = 'auto';
    el.setAttribute('playsinline', '');
    this.beat = el;
    this.status = 'loading'; this.emit();
    const start = () => {
      if (this.beat !== el) return;
      const pos = (Date.now() + skew - startAt) / 1000;
      if (pos < 0) { this.beatTimer = window.setTimeout(start, -pos * 1000); return; }
      el.currentTime = el.duration && isFinite(el.duration) ? pos % el.duration : 0;
      el.play().then(() => { this.status = 'playing'; this.emit(); }).catch(() => { this.status = 'blocked'; this.emit(); });
    };
    el.addEventListener('loadedmetadata', start, { once: true });
    el.addEventListener('error', () => { if (this.beat === el) { this.status = 'error'; this.emit(); } }, { once: true });
  }
  /** Autoplay was blocked: resume from a tap. */
  resume() { if (this.beat) { const [tr, at] = this.beatKey.split(':').map(Number); this.beatKey = ''; this.playBeat(tr!, at!, 0); } }
  private stopBeat() {
    clearTimeout(this.beatTimer);
    if (this.beat) { this.beat.pause(); this.beat.src = ''; this.beat = null; }
    this.beatKey = '';
    if (this.status !== 'idle') this.status = 'idle';
  }

  /** Host: pick for the table. */
  pickBeat(track: number) { this.room?.send({ mode: 'beat', track, startAt: 0 }); }
  shareLink(url: string, title: string) { this.room?.send({ mode: 'link', url, title }); }
  off() { this.stopSource(true); this.room?.send({ mode: 'off' }); }

  /** Host (c): stream a local audio file — played into a MediaStream (and to the host's own speakers). */
  async streamFile(file: File) {
    this.stopSource(false);
    const ctx = new AudioContext();
    const el = new Audio(URL.createObjectURL(file));
    el.loop = true;
    const src = ctx.createMediaElementSource(el);
    const dest = ctx.createMediaStreamDestination();
    const monitor = ctx.createGain(); monitor.gain.value = this.volume;
    src.connect(dest); src.connect(monitor); monitor.connect(ctx.destination);
    await el.play();
    this.srcGain = monitor;
    this.startSource(dest.stream.getAudioTracks()[0]!, { kind: 'file', title: file.name.replace(/\.[^.]+$/, '') }, () => { el.pause(); URL.revokeObjectURL(el.src); void ctx.close(); });
  }
  /** Host (c): stream device / tab audio (desktop browsers; the picker must include audio). */
  async streamDevice() {
    this.stopSource(false);
    const s = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true } as DisplayMediaStreamOptions);
    s.getVideoTracks().forEach((t) => t.stop());
    const a = s.getAudioTracks()[0];
    if (!a) throw new Error('No audio was shared — tick "Share audio" in the picker.');
    a.addEventListener('ended', () => this.off());
    this.startSource(a, { kind: 'device', title: a.label || 'Device audio' }, () => a.stop());
  }
  get canStreamDevice() { return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && !/iPhone|iPad|Android/i.test(navigator.userAgent); }
  private startSource(track: MediaStreamTrack, info: HostSource, stop: () => void) {
    this.srcStop = stop;
    this.source = info;
    this.room?.setTrack(track);
    this.room?.send({ mode: 'stream', by: '', title: info.title });
    this.emit();
  }
  stopSource(announce: boolean) {
    if (!this.srcStop) return;
    this.srcStop(); this.srcStop = null; this.srcGain = null;
    this.source = null;
    this.room?.setTrack(null);
    if (announce) this.room?.send({ mode: 'off' });
    this.emit();
  }
}

export const hostMusic = new HostMusicStore();
export function useHostMusic() { return useSyncExternalStore(hostMusic.subscribe, hostMusic.get, hostMusic.get); }
