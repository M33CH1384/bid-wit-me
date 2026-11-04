/**
 * PROTOTYPE (proto/nemotron-dialogue): production wiring for the
 * generated-dialogue director — binds the real clock, prefs, voice path
 * and adapters, and exposes the two hooks offlineTalk calls.
 *
 * Everything is behind the prototype flag: VITE_GEN_DIALOGUE=1 at build
 * time, or localStorage 'bwm.genDialogue' = '1' on the device. With the
 * flag off (the default), the hooks are inert and the game behaves
 * exactly as master. Adapter selection with the flag on:
 *   - VITE_GEN_DIALOGUE_URL set → the Nemotron adapter calls that
 *     endpoint directly (LOCAL DEV ONLY — the env key is a dev
 *     convenience and must never ship in a production bundle);
 *   - VITE_GEN_DIALOGUE_MOCK=1 (or localStorage 'bwm.genDialogueMock')
 *     → the MOCK adapter drives the pipeline (labeled 'mock' on every
 *     line it wins) — the no-endpoint proof path;
 *   - otherwise → RELAY mode: the Nemotron adapter posts payloads to the
 *     game's own server (/api/gen-dialogue), which holds the key. The
 *     relay 404s unless the server enables it, and any failure fails
 *     closed to the curated line, as everywhere in this prototype.
 * The speech stage defaults to the labeled mock (text-only)
 * unless VITE_GEN_SPEECH_URL points at the studio service.
 */
import {
  GEN_PROTO_PERSONA, banterContextFor, botTalk, sideOfSeat,
  type BanterContext, type GenEventKind, type TalkEvent, type TalkKind, type TalkLine, type TalkState, type TalkTable,
} from '@spades/bots';
import type { GameState } from '@spades/rules';
import { sound } from '../audio';
import { storyVoiceScope, talkPrefs } from '../talkPrefs';
import { MockDialogueAdapter, NemotronDialogueAdapter, type DialogueAdapter } from './adapter';
import { ChatterboxSpeechAdapter, MockSpeechAdapter, type SpeechAdapter } from './speech';
import { GenDirector } from './director';

function env(key: string): string | undefined {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string> }).env?.[key];
    return v || undefined;
  } catch { return undefined; }
}

export function genDialogueEnabled(): boolean {
  if (env('VITE_GEN_DIALOGUE') === '1') return true;
  try { return localStorage.getItem('bwm.genDialogue') === '1'; } catch { return false; }
}

let director: GenDirector | null = null;
export function genDirector(): GenDirector {
  if (director) return director;
  const url = env('VITE_GEN_DIALOGUE_URL');
  let mockOptIn = env('VITE_GEN_DIALOGUE_MOCK') === '1';
  if (!mockOptIn) { try { mockOptIn = localStorage.getItem('bwm.genDialogueMock') === '1'; } catch { /* no storage */ } }
  const adapter: DialogueAdapter = url
    ? new NemotronDialogueAdapter({ url, model: env('VITE_GEN_DIALOGUE_MODEL'), key: env('VITE_GEN_DIALOGUE_KEY') })
    : mockOptIn
      ? new MockDialogueAdapter()
      : new NemotronDialogueAdapter({ relayPath: '/api/gen-dialogue' });
  const speechUrl = env('VITE_GEN_SPEECH_URL');
  const speech: SpeechAdapter = speechUrl
    ? new ChatterboxSpeechAdapter({
        url: speechUrl,
        key: env('VITE_GEN_SPEECH_KEY'),
        decode: async (bytes) => {
          const ctx = sound.audioContext();
          if (!ctx) throw new Error('no-audio-context');
          return ctx.decodeAudioData(bytes.slice(0));
        },
      })
    : new MockSpeechAdapter();
  director = new GenDirector({
    adapter,
    speech,
    prefs: () => {
      const p = talkPrefs.get();
      return { botTalk: p.botTalk, voices: p.voices, voiceVolume: p.voiceVolume, voiceMuted: (n) => sound.voiceMuted(n) };
    },
    playSpeech: (buf, name, gain) => sound.playVoiceCrossTalk(buf, gain, [0, buf.duration], undefined, 4, name, { defer: true }),
    now: () => performance.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (h) => window.clearTimeout(h as number),
    log: (e) => { try { console.info('[genDialogue]', e.t, e.eventId ?? '', e.reason ?? '', e.ms !== undefined ? `${e.ms}ms` : ''); } catch { /* ignore */ } },
  });
  return director;
}

/** the engine kind of a banter TalkLine, from its line id (`<pool>.<kind>.<index>`) */
function lineKindOf(line: TalkLine): TalkKind | null {
  const seg = line.line?.split('.')[1];
  return seg ? (seg as TalkKind) : null;
}

const KIND_FOR: Partial<Record<TalkKind, GenEventKind>> = { setThem: 'set', gotSet: 'set', nilBust: 'nilBust' };

/**
 * Hand-end hook (offlineTalk.banter): if this banter line is the
 * prototype persona reacting to a set or a busted Nil, the director
 * takes ownership of it (returns true — the caller excludes it from the
 * immediate banter delivery; the director emits exactly one line for
 * the moment through the sink path).
 */
export function genBanterHook(line: TalkLine, after: GameState, table: TalkTable, emit: (l: TalkLine) => boolean): boolean {
  if (!genDialogueEnabled()) return false;
  if (storyVoiceScope()) return false; // story mode is out of prototype scope — its surfaces keep the cast-recording fence untouched
  if (line.persona !== GEN_PROTO_PERSONA) return false;
  const lineKind = lineKindOf(line);
  const kind = lineKind ? KIND_FOR[lineKind] : undefined;
  if (!lineKind || !kind) return false;
  const ctx: BanterContext | null = banterContextFor(after);
  if (!ctx) return false;
  const speakerSide = sideOfSeat(table, line.seat);
  let subjectSeat: number | undefined;
  let subjectSide: number | undefined;
  if (lineKind === 'setThem') {
    subjectSide = ctx.setSides.find((s) => s !== speakerSide) ?? ctx.setSides[0];
    if (subjectSide === undefined) return false;
    subjectSeat = ctx.contractSeat[subjectSide];
  } else if (lineKind === 'gotSet') {
    subjectSide = speakerSide;
    subjectSeat = ctx.contractSeat[subjectSide];
  } else {
    // nilBust: the subject is the busted Nil seat (on the other side when there is one)
    const seat = ctx.nilBustSeats.find((s) => sideOfSeat(table, s) !== speakerSide) ?? ctx.nilBustSeats[0];
    if (seat === undefined) return false;
    subjectSeat = seat;
    subjectSide = sideOfSeat(table, seat);
  }
  void genDirector().compete({ state: after, table, curated: line, kind, lineKind, subjectSeat, subjectSide, emit });
  return true;
}

/**
 * Match-end hook (offlineTalk.step): claims the step's win event before
 * the generic loop reaches it. The curated line is drawn from the
 * engine itself (botTalk, all gates) — if the engine awards it to the
 * prototype persona, the director races a generated wording for it.
 * Returns true when the event is claimed (the caller skips it).
 */
export function genMatchEndHook(args: {
  state: TalkState; table: TalkTable; ev: TalkEvent; after: GameState;
  now: number; rnd: () => number; emit: (l: TalkLine) => boolean;
}): boolean {
  if (!genDialogueEnabled()) return false;
  if (storyVoiceScope()) return false; // story mode out of scope (see genBanterHook)
  // From here the event is CLAIMED (return true on every path): the hook
  // calls botTalk itself, and the generic loop must never run the same
  // event a second time (a second call would re-roll and double-stamp).
  const curated = botTalk(args.state, args.table, args.ev, args.now, args.rnd);
  if (!curated) return true; // the engine awarded no line — the moment stays silent, exactly as today
  if (curated.persona !== GEN_PROTO_PERSONA) {
    // not the prototype's moment: deliver the engine's line through the normal emit path
    args.emit(curated);
    return true;
  }
  const winnerSide = args.ev.side ?? 0;
  void genDirector().compete({
    state: args.after, table: args.table, curated, kind: 'matchEnd', lineKind: lineKindOf(curated) ?? 'win',
    subjectSide: winnerSide, emit: args.emit,
  });
  return true;
}
