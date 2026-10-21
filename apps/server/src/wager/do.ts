/** Big Bank Take Lil Bank (Phase 1): one Durable Object per challenge (idFromName(id)); serialised ops, DO alarms for the accept deadline, check-in opening and the scheduled start. Cloned from TournamentDO. */
import { DurableObject } from 'cloudflare:workers';
import { CODE_ALPHABET, CODE_LENGTH } from '@spades/protocol';
import type { Env } from '../index';
import { notifyWager, pushVapid } from '../push/notify';
import { type WData, type WIO, type WPerson, type WResult, WError, accept, alarm, cancel, checkin, create, decline, result, view, type WCreate } from './service';

export type WOp =
  | { op: 'create'; c: WCreate }
  | { op: 'view'; viewer: string | null }
  | { op: 'accept'; me: WPerson; partner: WPerson | null }
  | { op: 'decline'; uid: string }
  | { op: 'cancel'; uid: string; admin: boolean }
  | { op: 'checkin'; uid: string }
  | { op: 'result'; result: WResult };

function code(): string {
  const b = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}

export class ChallengeDO extends DurableObject<Env> {
  private chain: Promise<unknown> = Promise.resolve();

  private io(): WIO {
    const env = this.env;
    return {
      now: () => Date.now(),
      db: env.DB!,
      save: (d) => this.ctx.storage.put('d', d),
      setAlarm: (at) => this.ctx.storage.setAlarm(at),
      notify: async (uids, n) => {
        if (!uids.length) return;
        try { await env.SOCIAL.get(env.SOCIAL.idFromName('hub')).fetch('https://social/notify', { method: 'POST', body: JSON.stringify({ uids, notice: n }) }); } catch (e) { console.error('notify', e); }
      },
      wire: async (id, text) => {
        // League Wire (item 7): settled Big Bank results post to global chat
        // via the Social hub (which dedupes + cadence-caps).
        try { await env.SOCIAL.get(env.SOCIAL.idFromName('hub')).fetch('https://social/wire', { method: 'POST', body: JSON.stringify({ id, text }) }); } catch (e) { console.error('wire', e); }
      },
      push: async (cid, uid, kind, title, body) => {
        // pushes ride waitUntil (never on the op's critical path) and are always
        // paired with the in-app notice + the challenge card state
        const vapid = pushVapid(env);
        if (!vapid || !env.DB) return;
        this.ctx.waitUntil(notifyWager(env.DB, vapid, uid, kind, title, body, cid, Date.now()).then(() => undefined).catch((e) => console.error('wagerPush', e)));
      },
      createMatchTable: async (setup) => {
        for (let i = 0; i < 8; i++) {
          const c = code();
          const r = await env.TABLES.get(env.TABLES.idFromName(c)).fetch(`https://table/challenge-setup?code=${c}`, { method: 'POST', body: JSON.stringify(setup) });
          if (r.status === 201) return c;
        }
        throw new Error('could not allocate a table');
      },
    };
  }

  /** one op at a time (outbound fetches would otherwise let results interleave with seating) */
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const p = this.chain.then(f, f);
    this.chain = p.catch(() => undefined);
    return p;
  }

  override async fetch(req: Request): Promise<Response> {
    const op = await req.json() as WOp;
    try {
      const out = await this.serial(() => this.run(op));
      return Response.json(out);
    } catch (e) {
      if (e instanceof WError) return Response.json({ error: e.message }, { status: e.status });
      console.error('wager-challenge', e);
      return Response.json({ error: 'Something went wrong.' }, { status: 500 });
    }
  }

  private async run(op: WOp): Promise<unknown> {
    const io = this.io();
    if (op.op === 'create') {
      if (await this.ctx.storage.get('d')) throw new WError(409, 'exists');
      const d = await create(io, op.c);
      return view(d, op.c.challenger.uid, io.now());
    }
    const d = await this.ctx.storage.get<WData>('d');
    if (!d) throw new WError(404, 'No such challenge.');
    switch (op.op) {
      case 'view': return view(d, op.viewer, io.now());
      case 'accept': return view(await accept(io, d, op.me, op.partner), op.me.uid, io.now());
      case 'decline': return view(await decline(io, d, op.uid), op.uid, io.now());
      case 'cancel': return view(await cancel(io, d, op.uid, op.admin), op.uid, io.now());
      case 'checkin': return view(await checkin(io, d, op.uid), op.uid, io.now());
      case 'result': await result(io, d, op.result); return { ok: true };
    }
  }

  override async alarm(): Promise<void> {
    await this.serial(async () => {
      const d = await this.ctx.storage.get<WData>('d');
      if (d) await alarm(this.io(), d);
    });
  }
}
