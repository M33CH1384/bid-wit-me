/**
 * PROTOTYPE (proto/nemotron-dialogue): the generated-dialogue director.
 *
 * The talk engine decides WHO speaks and WHEN (all of its gates stand).
 * When the engine awards a line to the prototype persona for one of the
 * three prototype moments, the director races a generated wording
 * against that curated line under a deadline — the deliverBotLine
 * discipline, generalized from a clip race to a generation race:
 *
 *   - exactly ONE text is ever delivered for the moment: the winner's;
 *   - if generation misses the deadline, the curated line owns the
 *     moment and the late generated line is DISCARDED (stale-drop),
 *     never delivered after;
 *   - a generated line displays only after schema validation (in the
 *     adapter), the output FACT-CHECK, and the repeat check — a failure
 *     at any gate hands the moment to the curated line, with the reason
 *     logged;
 *   - a line that fails the fact-check is NEVER spoken: speech synthesis
 *     starts only after the line has passed every text gate;
 *   - speech, when it comes, is the persona's own studio voice only
 *     (speech.ts); it plays through the game's voice path as the text
 *     emits. No clip in time → the generated line still lands, text-only
 *     (the fence default);
 *   - duplicate events are single-flight: the first call owns the
 *     moment, later calls for the same event id do nothing.
 *
 * All effects are injected (clock, timers, emit, speech playback, prefs)
 * so the whole discipline is unit-testable without a browser.
 */
import {
  GEN_PROTO_PERSONA, buildGenPayload, factCheckLine, genRepeatsRecent,
  type GenEventKind, type TalkKind, type TalkLine, type TalkTable,
} from '@spades/bots';
import type { GameState } from '@spades/rules';
import type { DialogueAdapter } from './adapter';
import type { SpeechAdapter } from './speech';

export interface GenPrefs { botTalk: boolean; voices: boolean; voiceVolume: number; voiceMuted(name: string): boolean }

export interface GenLogEvent {
  t: 'gen-win' | 'fallback' | 'stale-drop' | 'duplicate' | 'gated' | 'speech';
  eventId?: string;
  reason?: string;
  /** end-to-end ms from event to delivery */
  ms?: number;
}

export interface GenDirectorDeps {
  adapter: DialogueAdapter;
  speech: SpeechAdapter;
  prefs(): GenPrefs;
  /** play a studio clip through the voice path (sound.playVoiceCrossTalk in wiring); false = the path refused */
  playSpeech(buf: AudioBuffer, name: string, gain: number): boolean;
  onAnimate?(seat: number, cue: string): void;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  log(e: GenLogEvent): void;
  /** hand-end deadline: the collection window is 5.2 s; a generated line must land inside it */
  deadlineMs?: number;
  /** match-end deadline: the game-over screen lingers, so the window is longer */
  matchDeadlineMs?: number;
}

export type GenOutcome = 'gen' | 'gen-voiced' | 'curated' | 'duplicate' | 'gated' | 'no-line';

export interface CompeteArgs {
  state: GameState;
  table: TalkTable;
  /** the engine's curated line for this moment (null = the engine awarded no line: generation never freelances) */
  curated: TalkLine | null;
  kind: GenEventKind;
  /** the engine kind of the curated line (setThem / gotSet / nilBust / win / lose) */
  lineKind: TalkKind;
  subjectSeat?: number;
  subjectSide: number;
  emit(line: TalkLine): boolean;
}

export class GenDirector {
  private inflight = new Map<string, Promise<GenOutcome>>();
  private done = new Set<string>();
  private recentTexts: string[] = [];
  /** measured runs for the report: outcome + end-to-end ms */
  readonly runs: { eventId: string; outcome: GenOutcome; ms: number }[] = [];

  constructor(private deps: GenDirectorDeps) {}

  /**
   * Ownership contract: called with a non-null curated line, the director
   * delivers EXACTLY ONE line for the moment — the generated winner or
   * the curated line — on every path, including the gated ones (a gated
   * call emits the curated line immediately; generation never silently
   * swallows a line the engine awarded).
   */
  compete(a: CompeteArgs): Promise<GenOutcome> {
    if (!a.curated) return Promise.resolve('no-line');
    if (a.curated.persona !== GEN_PROTO_PERSONA) {
      this.deps.log({ t: 'gated', reason: 'not-prototype-persona' });
      a.emit(a.curated);
      return Promise.resolve('gated');
    }
    if (!this.deps.prefs().botTalk) {
      this.deps.log({ t: 'gated', reason: 'bottalk-off' });
      a.emit(a.curated);
      return Promise.resolve('gated');
    }
    const payload = buildGenPayload({
      state: a.state, table: a.table, speakerSeat: a.curated.seat,
      kind: a.kind, lineKind: a.lineKind,
      subjectSeat: a.subjectSeat, subjectSide: a.subjectSide,
      recentLines: this.recentTexts,
    });
    const eventId = payload.event.id;
    if (this.inflight.has(eventId) || this.done.has(eventId)) {
      this.deps.log({ t: 'duplicate', eventId });
      return Promise.resolve('duplicate');
    }
    const run = this.runRace(a, payload, eventId);
    this.inflight.set(eventId, run);
    return run;
  }

  private async runRace(a: CompeteArgs, payload: ReturnType<typeof buildGenPayload>, eventId: string): Promise<GenOutcome> {
    const deps = this.deps;
    const curated = a.curated!;
    const started = deps.now();
    const deadline = a.kind === 'matchEnd' ? (deps.matchDeadlineMs ?? 6000) : (deps.deadlineMs ?? 4000);
    let settled = false;
    let outcome: GenOutcome = 'curated';
    let timer: unknown;
    const abort = new AbortController();

    const finish = (o: GenOutcome) => {
      outcome = o;
      this.done.add(eventId);
      this.inflight.delete(eventId);
      this.runs.push({ eventId, outcome: o, ms: deps.now() - started });
    };

    const deliverCurated = (reason: string): GenOutcome => {
      if (settled) return outcome;
      settled = true;
      deps.clearTimeout(timer);
      a.emit(curated);
      this.noteText(curated.text);
      deps.log({ t: 'fallback', eventId, reason, ms: deps.now() - started });
      finish('curated');
      return 'curated';
    };

    timer = deps.setTimeout(() => {
      abort.abort();
      if (!settled) {
        deps.log({ t: 'stale-drop', eventId, reason: 'deadline', ms: deps.now() - started });
        deliverCurated('deadline');
      }
    }, deadline);

    try {
      const res = await deps.adapter.generate(payload, abort.signal);
      if (settled) { deps.log({ t: 'stale-drop', eventId, reason: 'late-after-fallback' }); return outcome; }
      // Gate 1: the output fact-check (a failure here is never spoken, never shown)
      const fc = factCheckLine(res.line, payload);
      if (!fc.ok) return deliverCurated(`factcheck:${fc.reasons.join(',')}`);
      // Gate 2: repetition — the table just heard this phrase
      if (genRepeatsRecent(res.line, this.recentTexts)) return deliverCurated('repeat');
      // Speech stage: only now, only the persona's own studio voice.
      let clip: AudioBuffer | null = null;
      const prefs = deps.prefs();
      if (deps.speech.configured && prefs.voices && !prefs.voiceMuted(curated.name)) {
        const sr = await deps.speech.synthesize({ persona: GEN_PROTO_PERSONA, name: curated.name, text: res.line, emotion: res.emotion }, abort.signal);
        if (settled) { deps.log({ t: 'stale-drop', eventId, reason: 'speech-late' }); return outcome; }
        if (sr.status === 'clip') { clip = sr.buffer; deps.log({ t: 'speech', eventId, ms: sr.ms }); }
        else deps.log({ t: 'speech', eventId, reason: sr.reason });
      }
      if (settled) return outcome;
      settled = true;
      deps.clearTimeout(timer);
      const genLine: TalkLine = {
        seat: curated.seat, name: curated.name, text: res.line, persona: curated.persona,
        gen: { model: deps.adapter.id, speech: clip ? 'studio' : 'text' },
      };
      if (clip) deps.playSpeech(clip, curated.name, prefs.voiceVolume * 0.9);
      if (res.animation && deps.onAnimate) deps.onAnimate(curated.seat, res.animation);
      a.emit(genLine);
      this.noteText(genLine.text);
      deps.log({ t: 'gen-win', eventId, ms: deps.now() - started });
      finish(clip ? 'gen-voiced' : 'gen');
      return outcome;
    } catch (e) {
      if (settled) { deps.log({ t: 'stale-drop', eventId, reason: 'error-after-fallback' }); return outcome; }
      return deliverCurated(`error:${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  private noteText(text: string): void {
    this.recentTexts = [...this.recentTexts, text].slice(-8);
  }
}
