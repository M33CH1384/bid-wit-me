import type { ClientMsg, ServerMsg } from '@spades/protocol';
import { createRng } from '@spades/rules';
import { DEFAULT_TIMING, Room, type RoomData, type RoomIO, type RoomTiming, newRoomData } from '../src/room';

/** Fake Durable Object environment: manual clock, captured messages, timers, alarm, save counter. */
export class FakeEnv {
  t = 1_000_000;
  sent = new Map<string, ServerMsg[]>();
  closed: string[] = [];
  wakes: number[] = [];
  alarm: number | null = null;
  alarmSets = 0;
  persists = 0;
  raw: ServerMsg[] = [];
  rng = createRng('test-ids');
  room: Room;
  tourResults: { match: string; scores: number[]; places: number[] }[] = [];
  challengeResults: import('../src/room').ChallengeResult[] = [];
  records: { rec: import('../src/stats/record').GameRecord; rated: boolean; meta?: import('../src/stats/record').SaveMeta }[] = [];
  highlights: import('../src/stats/highlights').HighlightEvent[] = [];
  /** The DO's socket close can re-enter the room. Tests set this to simulate that. */
  onClose?: (cid: string) => void;
  timing: RoomTiming;

  constructor(data?: RoomData, timing: RoomTiming = DEFAULT_TIMING) {
    // The suite was written against instant first deals: the pre-deal setup window
    // defaults OFF here and is exercised explicitly by pre-deal.test.ts.
    this.timing = { preDealMs: 0, ...timing };
    this.room = new Room(data ?? newRoomData('ABCDE', this.t), this.io(), this.timing);
  }

  io(): RoomIO {
    return {
      now: () => this.t,
      send: (cid, msg) => {
        const m = JSON.parse(JSON.stringify(msg)) as ServerMsg;
        this.raw.push(JSON.parse(JSON.stringify(msg)));
        // like the client: an elided (null) history means "unchanged"
        if (m.t === 'state' && m.view && m.view.history === null) m.view.history = this.last(cid, 'state')?.view?.history ?? [];
        (this.sent.get(cid) ?? this.sent.set(cid, []).get(cid)!).push(m);
      },
      close: (cid) => { this.closed.push(cid); this.onClose?.(cid); },
      wake: (ms) => { this.wakes.push(this.t + ms); },
      // match the DO: a later alarm does not postpone an earlier one; clearing is a no-op
      setAlarm: (at) => { if (at === null || (this.alarm !== null && this.alarm <= at)) return; this.alarm = at; this.alarmSets++; },
      persist: () => { this.persists++; },
      gameOver: (rec, rated, meta) => { this.records.push({ rec, rated, meta }); },
      highlight: (ev) => { this.highlights.push(ev); },
      tournamentResult: (t, scores, places) => { this.tourResults.push({ match: t.match, scores, places }); },
      challengeResult: (_c, r) => { this.challengeResults.push(r); },
      randomId: () => Array.from({ length: 4 }, () => this.rng.nextUint32().toString(16).padStart(8, '0')).join(''),
    };
  }

  /** Rebuild the room from a JSON round-trip of its data (simulates a DO restart / hibernation wake-up). */
  restart(conns: [string, string | null][]): void {
    const data = JSON.parse(JSON.stringify(this.room.data)) as RoomData;
    this.room = new Room(data, this.io(), this.timing);
    for (const [cid, pid] of conns) this.room.restoreConnection(cid, pid);
    this.wakes = [];
    this.alarm = null;
  }

  /**
   * Hibernation: the in-memory bot wake is gone, the saved row and the storage alarm remain.
   * A WebSocket ping does not wake the object, so nothing here calls tick until the alarm.
   */
  hibernate(conns: [string, string | null][]): void {
    const alarm = this.alarm;
    const data = JSON.parse(JSON.stringify(this.room.data)) as RoomData;
    this.room = new Room(data, this.io(), this.timing);
    for (const [cid, pid] of conns) this.room.restoreConnection(cid, pid);
    this.wakes = [];
    this.alarm = alarm;
  }

  send(cid: string, msg: ClientMsg): void {
    this.room.message(cid, JSON.stringify(msg));
  }

  /** Advance the clock, firing due wakes/alarms in order. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (let guard = 0; guard < 100_000; guard++) {
      const due = [...this.wakes, ...(this.alarm !== null ? [this.alarm] : [])].filter((x) => x <= end);
      if (!due.length) break;
      const next = Math.min(...due);
      this.t = Math.max(this.t, next);
      this.wakes = this.wakes.filter((w) => w > this.t);
      if (this.alarm !== null && this.alarm <= this.t) this.alarm = null;
      this.room.tick();
    }
    this.t = end;
  }

  msgs(cid: string): ServerMsg[] { return this.sent.get(cid) ?? []; }
  last<T extends ServerMsg['t']>(cid: string, t: T): Extract<ServerMsg, { t: T }> | undefined {
    const m = this.msgs(cid).filter((x) => x.t === t);
    return m[m.length - 1] as Extract<ServerMsg, { t: T }> | undefined;
  }
  errors(cid: string) { return this.msgs(cid).filter((x) => x.t === 'error') as Extract<ServerMsg, { t: 'error' }>[]; }
  clear(): void { this.sent.clear(); }

  join(cid: string, name: string, token?: string, uid?: string, gid?: string): { pid: string; token: string } {
    this.room.open(cid);
    this.room.message(cid, JSON.stringify({ t: 'hello', name, ...(token ? { token } : {}), ...(gid ? { gid } : {}) }), uid);
    const w = this.last(cid, 'welcome')!;
    return { pid: w.you, token: w.token };
  }
}
