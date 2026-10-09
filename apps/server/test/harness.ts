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

  constructor(data?: RoomData, public timing: RoomTiming = DEFAULT_TIMING) {
    this.room = new Room(data ?? newRoomData('ABCDE', this.t), this.io(), timing);
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
      close: (cid) => { this.closed.push(cid); },
      wake: (ms) => { this.wakes.push(this.t + ms); },
      setAlarm: (at) => { if (at !== null && at !== this.alarm) { this.alarm = at; this.alarmSets++; } },
      persist: () => { this.persists++; },
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

  join(cid: string, name: string, token?: string): { pid: string; token: string } {
    this.room.open(cid);
    this.send(cid, { t: 'hello', name, token });
    const w = this.last(cid, 'welcome')!;
    return { pid: w.you, token: w.token };
  }
}
