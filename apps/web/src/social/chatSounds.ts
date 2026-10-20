/**
 * Chat notification sounds (owner ask 2026-10-20): a DM should ding no matter where you are in
 * the app; a global-chat message should blip only while you're actually looking at the chat.
 * The sounds themselves are synthesized in the audio engine ('dmChime' / 'chatBlip', SFX bus);
 * this module is the pure gating + throttle decision and the tiny stateful player the social
 * store calls on each live arrival.
 */
import { chatSoundsOn, sound } from '../audio';

export type ChatSoundKind = 'dm' | 'global';

/** At most one play per kind inside this window, so a burst of messages can't machine-gun. */
export const CHAT_SOUND_THROTTLE_MS = 1500;

export interface ChatSoundGate {
  kind: ChatSoundKind;
  /** the arriving message is my own (echo) — never ding for myself */
  own: boolean;
  /** document is visible; when hidden, Web Push covers notifications instead */
  pageVisible: boolean;
  /** global only: the Social panel is open on the chat tab */
  chatViewOpen: boolean;
  /** master sound on + the chat-sounds setting on (see chatSoundsOn in audio.ts) */
  enabled: boolean;
  now: number;
  /** last time this kind actually played (ms epoch, 0 = never) */
  lastPlayedAt: number;
}

export function chatSoundDecision(g: ChatSoundGate): boolean {
  if (g.own) return false;
  if (!g.enabled) return false;
  if (!g.pageVisible) return false;
  if (g.kind === 'global' && !g.chatViewOpen) return false;
  if (g.now - g.lastPlayedAt < CHAT_SOUND_THROTTLE_MS) return false;
  return true;
}

const lastPlayed: Record<ChatSoundKind, number> = { dm: 0, global: 0 };

/**
 * Called by the social store on LIVE arrivals only (the 'dm' / 'chat' socket cases — history
 * backfill arrives via 'hello' / 'dmHistory' and never reaches here). Returns whether it played.
 * The engine still applies its own gates (unlock state, master volume, SFX category volume).
 */
export function playChatSound(kind: ChatSoundKind, opts: { own: boolean; chatViewOpen?: boolean }): boolean {
  const now = Date.now();
  const ok = chatSoundDecision({
    kind,
    own: opts.own,
    pageVisible: typeof document === 'undefined' || document.visibilityState === 'visible',
    chatViewOpen: !!opts.chatViewOpen,
    enabled: chatSoundsOn(sound.settings),
    now,
    lastPlayedAt: lastPlayed[kind],
  });
  if (!ok) return false;
  lastPlayed[kind] = now;
  sound.play(kind === 'dm' ? 'dmChime' : 'chatBlip');
  return true;
}

/** Test seam: clear the throttle state. */
export function resetChatSoundThrottle(): void {
  lastPlayed.dm = 0;
  lastPlayed.global = 0;
}
