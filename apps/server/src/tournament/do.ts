/** Release 9b: one Durable Object per tournament (idFromName(id)); serialised ops, DO alarms for check-in + start. */
import { DurableObject } from 'cloudflare:workers';
import { CODE_ALPHABET, CODE_LENGTH } from '@spades/protocol';
import type { Env } from '../index';
import { type TData, type TIO, type TMeta, TError, alarm, begin, cancel, checkin, create, register, result, unregister, view } from './service';

export type TOp =
  | { op: 'create'; meta: TMeta }
  | { op: 'view'; viewer: string | null }
  | { op: 'register'; me: { uid: string; name: string }; partner: { uid: string; name: string } | null; teamName: string | null }
  | { op: 'unregister'; uid: string }
  | { op: 'checkin'; uid: string }
  | { op: 'start'; uid: string; admin: boolean }
  | { op: 'cancel'; uid: string; admin: boolean }
  | { op: 'result'; match: string; scores: number[]; places: number[] };

function code(): string {
  const b = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}

export class TournamentDO extends DurableObject<Env> {
  private chain: Promise<unknown> = Promise.resolve();

  private io(): TIO {
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
      createMatchTable: async (setup) => {
        for (let i = 0; i < 8; i++) {
          const c = code();
          const r = await env.TABLES.get(env.TABLES.idFromName(c)).fetch(`https://table/tournament-setup?code=${c}`, { method: 'POST', body: JSON.stringify(setup) });
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
    const op = await req.json() as TOp;
    try {
      const out = await this.serial(() => this.run(op));
      return Response.json(out);
    } catch (e) {
      if (e instanceof TError) return Response.json({ error: e.message }, { status: e.status });
      console.error('tournament', e);
      return Response.json({ error: 'Something went wrong.' }, { status: 500 });
    }
  }

  private async run(op: TOp): Promise<unknown> {
    const io = this.io();
    if (op.op === 'create') {
      if (await this.ctx.storage.get('d')) throw new TError(409, 'exists');
      const d = await create(io, op.meta);
      return view(d, op.meta.hostId, io.now());
    }
    const d = await this.ctx.storage.get<TData>('d');
    if (!d) throw new TError(404, 'No such tournament.');
    switch (op.op) {
      case 'view': return view(d, op.viewer, io.now());
      case 'register': return view(await register(io, d, op.me, op.partner, op.teamName), op.me.uid, io.now());
      case 'unregister': return view(await unregister(io, d, op.uid), op.uid, io.now());
      case 'checkin': return view(await checkin(io, d, op.uid), op.uid, io.now());
      case 'start':
        if (op.uid !== d.meta.hostId && !op.admin) throw new TError(403, 'Only the host can start it.');
        return view(await begin(io, d), op.uid, io.now());
      case 'cancel':
        if (op.uid !== d.meta.hostId && !op.admin) throw new TError(403, 'Only the host can cancel it.');
        return view(await cancel(io, d), op.uid, io.now());
      case 'result': await result(io, d, op.match, op.scores, op.places); return { ok: true };
    }
  }

  override async alarm(): Promise<void> {
    await this.serial(async () => {
      const d = await this.ctx.storage.get<TData>('d');
      if (d) await alarm(this.io(), d);
    });
  }
}
