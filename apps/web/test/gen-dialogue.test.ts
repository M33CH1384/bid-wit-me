/**
 * PROTOTYPE (proto/nemotron-dialogue): the client half — director
 * discipline (deadline race, stale-drop, single-flight, exactly-once,
 * fact-check-before-speech, mute/prefs), the Nemotron adapter's request
 * shape, and the speech adapters (mock = labeled text-only; studio =
 * fails closed, routes by the persona's own voice key).
 */
import { describe, expect, it } from 'vitest';
import { type GameState, makeRules, newGame } from '@spades/rules';
import type { GenPayload, GenResponse, TalkLine, TalkTable } from '@spades/bots';
import { GenDirector, type GenDirectorDeps, type GenLogEvent, type GenPrefs } from '../src/genDialogue/director';
import { MockDialogueAdapter, NemotronDialogueAdapter, parseModelContent, type DialogueAdapter } from '../src/genDialogue/adapter';
import { ChatterboxSpeechAdapter, MockSpeechAdapter, speechRouteFor } from '../src/genDialogue/speech';

/* ------------------------------ fixtures ------------------------------ */

const table: TalkTable = {
  seats: [{ bot: false, name: 'You' }, { bot: true, name: 'Darius' }, { bot: true, name: 'Moe' }, { bot: true, name: 'Zuri' }],
  partnerships: true,
  teamNames: ['Us', 'Them'],
};

function riggedState(over: Partial<GameState> = {}): GameState {
  const base = newGame(makeRules('joker', {}), 'gen-web-rig');
  const hand = {
    handNo: 1, dealer: 0,
    bids: [4, 3, 'nil', 4] as GameState['history'][number]['bids'],
    tricksWon: [5, 4, 0, 2],
    sides: [
      { side: 0, seats: [0, 2], contract: 7, contractTricks: 5, tricks: 5, contractMade: true, contractPoints: 70, nils: [{ seat: 2, kind: 'nil', tricks: 0, made: true, points: 100 }], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0, points: 170, totalScore: 210, totalBags: 0 },
      { side: 1, seats: [1, 3], contract: 7, contractTricks: 4, tricks: 4, contractMade: false, contractPoints: -70, nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0, points: -70, totalScore: 145, totalBags: 0 },
    ],
  };
  return { ...base, handNo: 1, scores: [210, 145], history: [hand as GameState['history'][number]], ...over };
}

const curated: TalkLine = { seat: 1, name: 'Darius', text: 'we will rise again. next hand.', persona: 'deacon', line: 'deacon.gotSet.0' };

class FakeClock {
  t = 0;
  private timers: { at: number; ms: number; fn: () => void; id: number }[] = [];
  private seq = 0;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => { const id = ++this.seq; this.timers.push({ at: this.t, ms, fn, id }); return id; };
  clearTimeout = (h: unknown) => { this.timers = this.timers.filter((x) => x.id !== h); };
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at + x.ms <= end).sort((a, b) => a.at + a.ms - (b.at + b.ms))[0];
      if (!due) break;
      this.t = due.at + due.ms;
      this.timers = this.timers.filter((x) => x.id !== due.id);
      due.fn();
    }
    this.t = end;
  }
}

class ScriptedAdapter implements DialogueAdapter {
  readonly id = 'scripted';
  readonly configured = true;
  calls = 0;
  constructor(private clock: FakeClock, private plan: (p: GenPayload) => { delay: number; res?: GenResponse; err?: Error }) {}
  generate(p: GenPayload): Promise<GenResponse> {
    this.calls++;
    const { delay, res, err } = this.plan(p);
    return new Promise((resolve, reject) => {
      this.clock.setTimeout(() => (err ? reject(err) : resolve(res!)), delay);
    });
  }
}

const GOOD: GenResponse = { line: 'we promised 7 and brought 4. a test of faith — noted, and we rise.', emotion: 'rueful', animation: null };
const LIE: GenResponse = { line: 'we promised 9 and took the ace of spades with it.', emotion: 'smug', animation: null };

function harness(opts: {
  adapter?: DialogueAdapter;
  speech?: GenDirectorDeps['speech'];
  prefs?: Partial<GenPrefs>;
  deadlineMs?: number;
  matchDeadlineMs?: number;
  clock?: FakeClock;
} = {}) {
  const clock = opts.clock ?? new FakeClock();
  const emitted: TalkLine[] = [];
  const played: { buf: AudioBuffer; name: string }[] = [];
  const logs: GenLogEvent[] = [];
  const prefs: GenPrefs = {
    botTalk: true, voices: true, voiceVolume: 0.6, voiceMuted: () => false,
    ...(opts.prefs ?? {}),
  };
  const deps: GenDirectorDeps = {
    adapter: opts.adapter ?? new MockDialogueAdapter(),
    speech: opts.speech ?? new MockSpeechAdapter(),
    prefs: () => prefs,
    playSpeech: (buf, name) => { played.push({ buf, name }); return true; },
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    log: (e) => logs.push(e),
    deadlineMs: opts.deadlineMs,
    matchDeadlineMs: opts.matchDeadlineMs,
  };
  return { clock, emitted, played, logs, director: new GenDirector(deps), emit: (l: TalkLine) => { emitted.push(l); return true; } };
}

const setArgs = (h: ReturnType<typeof harness>, over: Partial<Parameters<GenDirector['compete']>[0]> = {}) => ({
  state: riggedState(), table, curated, kind: 'set' as const, lineKind: 'gotSet' as const,
  subjectSide: 1, emit: h.emit, ...over,
});

/* ------------------------------ director ------------------------------ */

describe('director: the race', () => {
  it('mock adapter wins instantly: exactly one line, generated, text-only (mock speech)', async () => {
    const h = harness();
    const outcome = await h.director.compete(setArgs(h));
    expect(outcome).toBe('gen');
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]!.gen).toEqual({ model: 'mock', speech: 'text' });
    expect(h.emitted[0]!.text).toContain('7');
    expect(h.emitted[0]!.line).toBeUndefined(); // no recorded clip id — the fence default
    expect(h.played).toHaveLength(0);
  });

  it('slow generation: the curated line owns the moment at the deadline; the late line is dropped, never delivered', async () => {
    const clock = new FakeClock();
    const emitted: TalkLine[] = [];
    const logs: GenLogEvent[] = [];
    const d = new GenDirector({
      adapter: new ScriptedAdapter(clock, () => ({ delay: 5000, res: GOOD })),
      speech: new MockSpeechAdapter(),
      prefs: () => ({ botTalk: true, voices: true, voiceVolume: 0.6, voiceMuted: () => false }),
      playSpeech: () => true,
      now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
      log: (e) => logs.push(e),
    });
    const p = d.compete({ state: riggedState(), table, curated, kind: 'set', lineKind: 'gotSet', subjectSide: 1, emit: (l) => { emitted.push(l); return true; } });
    clock.advance(4000); // deadline
    expect(emitted).toEqual([curated]);
    clock.advance(2000); // the model finally answers
    const outcome = await p;
    expect(outcome).toBe('curated');
    expect(emitted).toHaveLength(1); // still exactly one line
    expect(logs.some((l) => l.t === 'stale-drop')).toBe(true);
  });

  it('duplicate events are single-flight: one delivery total', async () => {
    const h = harness();
    const [o1, o2] = await Promise.all([h.director.compete(setArgs(h)), h.director.compete(setArgs(h))]);
    expect([o1, o2].sort()).toEqual(['duplicate', 'gen']);
    expect(h.emitted).toHaveLength(1);
    const o3 = await h.director.compete(setArgs(h)); // even after completion
    expect(o3).toBe('duplicate');
    expect(h.emitted).toHaveLength(1);
  });

  it('a lying model is fact-checked out: curated fires once, speech is NEVER attempted', async () => {
    const clock = new FakeClock();
    let speechCalls = 0;
    const speech = {
      id: 'spy', configured: true,
      synthesize: async () => { speechCalls++; return { status: 'text-only' as const, reason: 'spy' }; },
    };
    const h = harness({ adapter: new ScriptedAdapter(clock, () => ({ delay: 10, res: LIE })), speech, clock });
    const p = h.director.compete(setArgs(h));
    clock.advance(50);
    const outcome = await p;
    expect(outcome).toBe('curated');
    expect(h.emitted).toEqual([curated]);
    expect(speechCalls).toBe(0);
    expect(h.logs.some((l) => l.t === 'fallback' && (l.reason ?? '').startsWith('factcheck:'))).toBe(true);
  });

  it('adapter failure (unconfigured / unreachable / invalid) fails closed to the curated line', async () => {
    const clock = new FakeClock();
    const h = harness({ adapter: new ScriptedAdapter(clock, () => ({ delay: 5, err: new Error('gen-invalid:emotion-not-allowlisted') })), clock });
    const p = h.director.compete(setArgs(h));
    clock.advance(20);
    expect(await p).toBe('curated');
    expect(h.emitted).toEqual([curated]);
  });

  it('botTalk off: gated, curated still delivered exactly once, model never called', async () => {
    const clock = new FakeClock();
    const adapter = new ScriptedAdapter(clock, () => ({ delay: 0, res: GOOD }));
    const h = harness({ adapter, prefs: { botTalk: false } });
    expect(await h.director.compete(setArgs(h))).toBe('gated');
    expect(adapter.calls).toBe(0);
    expect(h.emitted).toEqual([curated]);
  });

  it('no curated line → no freelancing', async () => {
    const h = harness();
    expect(await h.director.compete(setArgs(h, { curated: null }))).toBe('no-line');
    expect(h.emitted).toHaveLength(0);
  });

  it('match end gets the longer window: a 5 s generation still lands', async () => {
    const clock = new FakeClock();
    const st = riggedState({ result: { endReason: 'target', finalScores: [512, 388], winners: [0], placements: [1, 2] } as GameState['result'] });
    const winCurated: TalkLine = { seat: 1, name: 'Darius', text: 'the Lord works in mysterious ways. so does that deck.', persona: 'deacon', line: 'deacon.lose.0' };
    const res: GenResponse = { line: '512 to 388. the Lord works in mysterious ways; so does that deck.', emotion: 'gracious', animation: null };
    const emitted: TalkLine[] = [];
    const d = new GenDirector({
      adapter: new ScriptedAdapter(clock, () => ({ delay: 5000, res })),
      speech: new MockSpeechAdapter(),
      prefs: () => ({ botTalk: true, voices: true, voiceVolume: 0.6, voiceMuted: () => false }),
      playSpeech: () => true,
      now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
      log: () => {},
    });
    const p = d.compete({ state: st, table, curated: winCurated, kind: 'matchEnd', lineKind: 'lose', subjectSide: 0, emit: (l) => { emitted.push(l); return true; } });
    clock.advance(5000);
    expect(await p).toBe('gen');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.text).toContain('512');
  });
});

/** flush pending promise continuations (the director's generate → gate → speech chain advances one await per flush) */
const flush = async () => { await new Promise<void>((r) => setImmediate(r)); };

describe('director: speech discipline', () => {
  const clipSpeech = (clock: FakeClock, delay: number) => ({
    id: 'studio-fake', configured: true,
    synthesize: async () => {
      await new Promise<void>((r) => clock.setTimeout(r, delay));
      return { status: 'clip' as const, buffer: { duration: 1.5 } as unknown as AudioBuffer, ms: 1500 };
    },
  });

  it('studio clip in time: voiced delivery, clip played once, gen marker says studio', async () => {
    const clock = new FakeClock();
    const h = harness({ adapter: new ScriptedAdapter(clock, () => ({ delay: 100, res: GOOD })), speech: clipSpeech(clock, 300), clock });
    const p = h.director.compete(setArgs(h));
    clock.advance(100); // the line lands
    await flush();      // gates pass, speech starts
    clock.advance(300); // the clip lands inside the deadline
    expect(await p).toBe('gen-voiced');
    expect(h.played).toHaveLength(1);
    expect(h.emitted[0]!.gen).toEqual({ model: 'scripted', speech: 'studio' });
  });

  it('studio clip too slow: the moment passes — text fallback owns it, the late clip never plays', async () => {
    const clock = new FakeClock();
    const h = harness({ adapter: new ScriptedAdapter(clock, () => ({ delay: 100, res: GOOD })), speech: clipSpeech(clock, 10_000), clock });
    const p = h.director.compete(setArgs(h));
    clock.advance(100); // the line lands
    await flush();      // speech starts (10 s out)
    clock.advance(3900); // deadline hits while speech is still synthesizing
    expect(h.emitted).toEqual([curated]);
    clock.advance(10_000);
    expect(await p).toBe('curated');
    expect(h.played).toHaveLength(0);
    expect(h.emitted).toHaveLength(1);
  });

  it('speaker muted: no speech attempted, generated text still lands', async () => {
    const clock = new FakeClock();
    let speechCalls = 0;
    const speech = { id: 'spy', configured: true, synthesize: async () => { speechCalls++; return { status: 'text-only' as const, reason: 'x' }; } };
    const h = harness({
      adapter: new ScriptedAdapter(clock, () => ({ delay: 10, res: GOOD })),
      speech, prefs: { voiceMuted: () => true }, clock,
    });
    const p = h.director.compete(setArgs(h));
    clock.advance(50);
    expect(await p).toBe('gen');
    expect(speechCalls).toBe(0);
    expect(h.emitted[0]!.gen?.speech).toBe('text');
  });

  it('voices pref off: same — text only', async () => {
    const clock = new FakeClock();
    let speechCalls = 0;
    const speech = { id: 'spy', configured: true, synthesize: async () => { speechCalls++; return { status: 'text-only' as const, reason: 'x' }; } };
    const h = harness({ adapter: new ScriptedAdapter(clock, () => ({ delay: 10, res: GOOD })), speech, prefs: { voices: false }, clock });
    const p = h.director.compete(setArgs(h));
    clock.advance(50);
    expect(await p).toBe('gen');
    expect(speechCalls).toBe(0);
  });
});

/* ------------------------------ adapters ------------------------------ */

describe('nemotron adapter', () => {
  it('is unconfigured without a URL and fails closed', async () => {
    const a = new NemotronDialogueAdapter({});
    expect(a.configured).toBe(false);
    await expect(a.generate(null as unknown as GenPayload)).rejects.toThrow('nemotron-unconfigured');
  });

  it('sends the card\'s conversational settings and parses the structured reply', async () => {
    let body: Record<string, unknown> | null = null;
    const fetchFn = (async (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body) as Record<string, unknown>;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"line":"a fine line.","emotion":"calm","animation":null}' } }] }) };
    }) as unknown as typeof fetch;
    const a = new NemotronDialogueAdapter({ url: 'http://localhost:8000/v1/chat/completions', fetchFn });
    const p = await import('@spades/bots').then((bots) => bots.buildGenPayload({ state: riggedState(), table, speakerSeat: 1, kind: 'set', lineKind: 'gotSet', subjectSide: 1 }));
    const res = await a.generate(p);
    expect(res.line).toBe('a fine line.');
    expect(body!.max_tokens).toBe(60);
    expect(body!.temperature).toBe(1.0);
    expect(body!.top_p).toBe(0.95);
    expect(body!.chat_template_kwargs).toEqual({ enable_thinking: false, conversational_mode: true });
  });

  it('schema validation rejects a bad emotion before the director ever sees it', () => {
    expect(() => parseModelContent('{"line":"ok line.","emotion":"furious","animation":null}')).toThrow('gen-invalid:emotion-not-allowlisted');
  });

  it('relay mode: posts only the payload (no prompt, no key) and parses the raw reply', async () => {
    let seen: { url: string; init: { body: string; credentials?: string; headers: Record<string, string> } } | null = null;
    const fetchFn = (async (url: string, init: NonNullable<typeof seen>['init']) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ content: '{"line":"a relayed line.","emotion":"calm","animation":null}' }) };
    }) as unknown as typeof fetch;
    const a = new NemotronDialogueAdapter({ relayPath: '/api/gen-dialogue', fetchFn });
    expect(a.configured).toBe(true);
    const p = await import('@spades/bots').then((bots) => bots.buildGenPayload({ state: riggedState(), table, speakerSeat: 1, kind: 'set', lineKind: 'gotSet', subjectSide: 1 }));
    const res = await a.generate(p);
    expect(res.line).toBe('a relayed line.');
    expect(seen!.url).toBe('/api/gen-dialogue');
    expect(seen!.init.credentials).toBe('same-origin');
    expect(seen!.init.headers.Authorization).toBeUndefined();
    const sent = JSON.parse(seen!.init.body) as Record<string, unknown>;
    expect(sent.event).toMatchObject({ kind: 'set' }); // the payload, allowlisted facts only
    expect(sent).not.toHaveProperty('messages'); // no prompt is built client-side in relay mode
    expect(JSON.stringify(sent)).not.toMatch(/"hands"|"deck"|"seed"/);
  });

  it('relay mode: a relay 404 (kill-switch off) fails closed like any adapter failure', async () => {
    const fetchFn = (async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
    const a = new NemotronDialogueAdapter({ relayPath: '/api/gen-dialogue', fetchFn });
    const p = await import('@spades/bots').then((bots) => bots.buildGenPayload({ state: riggedState(), table, speakerSeat: 1, kind: 'set', lineKind: 'gotSet', subjectSide: 1 }));
    await expect(a.generate(p)).rejects.toThrow('gen-relay-http-404');
  });
});

describe('speech adapters', () => {
  it('mock speech is labeled text-only and produces nothing', async () => {
    const m = new MockSpeechAdapter();
    expect(m.configured).toBe(false);
    const r = await m.synthesize({ persona: 'deacon', name: 'Darius', text: 'amen.', emotion: 'calm' });
    expect(r.status).toBe('text-only');
    if (r.status === 'text-only') expect(r.reason).toContain('mock-speech');
  });

  it('studio adapter fails closed when unconfigured', async () => {
    const s = new ChatterboxSpeechAdapter({});
    expect(s.configured).toBe(false);
    const r = await s.synthesize({ persona: 'deacon', name: 'Darius', text: 'amen.', emotion: 'calm' });
    expect(r).toEqual({ status: 'text-only', reason: 'speech-unconfigured' });
  });

  it('routes the deacon by his own sprite voice key', () => {
    expect(speechRouteFor('deacon', 'Darius')).toEqual({ voiceKey: 'am_eric', gender: 'm', sprite: 'deacon-m', speed: 0.9 });
    expect(speechRouteFor('deacon', 'Anjali').voiceKey).toBe('af_sarah');
  });

  it('studio adapter posts the route and decodes the clip', async () => {
    let posted: Record<string, unknown> | null = null;
    const fetchFn = (async (_url: string, init: { body: string }) => {
      posted = JSON.parse(init.body) as Record<string, unknown>;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    }) as unknown as typeof fetch;
    const s = new ChatterboxSpeechAdapter({ url: 'http://studio/speak', fetchFn, decode: async () => ({ duration: 2 }) as AudioBuffer });
    const r = await s.synthesize({ persona: 'deacon', name: 'Darius', text: 'amen, children.', emotion: 'warm' });
    expect(r.status).toBe('clip');
    expect(posted).toMatchObject({ persona: 'deacon', voiceKey: 'am_eric', sprite: 'deacon-m', format: 'mp3' });
  });
});
