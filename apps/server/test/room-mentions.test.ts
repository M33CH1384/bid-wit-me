/**
 * Table-chat @mentions + mute filtering (room side). The Room itself holds
 * no account data: tests supply the RoomIO hooks the TableDO implements in
 * production (D1 username resolution, the mute cache, the mention push).
 */
import { describe, expect, it } from 'vitest';
import type { ChatLine, ServerMsg } from '@spades/protocol';
import { Room, type RoomIO } from '../src/room';
import { FakeEnv } from './harness';

const USERS: Record<string, string> = { alice: 'ua', bobby: 'ub', cee: 'uc' };
const flush = () => new Promise((r) => setTimeout(r, 10));

interface Hooks {
  mentionPushes: { toUid: string; authorUid: string; authorName: string; text: string; code: string }[];
  env: FakeEnv;
}

function makeEnv(opts: { muted?: Record<string, string[]> } = {}): Hooks {
  const env = new FakeEnv();
  const mentionPushes: Hooks['mentionPushes'] = [];
  const io: RoomIO = {
    ...env.io(),
    lookupUsernames: async (keys) => Object.fromEntries(keys.filter((k) => USERS[k]).map((k) => [k, USERS[k]!])),
    mutedAuthors: (viewerUid) => (opts.muted?.[viewerUid] ? new Set(opts.muted[viewerUid]) : undefined),
    chatMention: (info) => { mentionPushes.push(info); },
  };
  env.room = new Room(env.room.data, io, env.timing);
  return { env, mentionPushes };
}

function chatLines(env: FakeEnv, cid: string): ChatLine[] {
  return env.msgs(cid).filter((m): m is Extract<ServerMsg, { t: 'chat' }> => m.t === 'chat').map((m) => m.line);
}

describe('table @mentions', () => {
  it('resolves a tagged member to their room pid on the line; connected members get no push', async () => {
    const { env, mentionPushes } = makeEnv();
    const a = env.join('c1', 'Alice', undefined, 'ua');
    const b = env.join('c2', 'Bobby', undefined, 'ub');
    env.send('c1', { t: 'chat', text: 'your move @Bobby' });
    await flush();
    const line = chatLines(env, 'c2').at(-1)!;
    expect(line.text).toBe('your move @Bobby');
    expect(line.mentions).toEqual([b.pid]);
    expect(chatLines(env, 'c1').at(-1)!.mentions).toEqual([b.pid]); // the author sees the tag too
    expect(mentionPushes).toEqual([]);
    expect(a.pid).not.toBe(b.pid);
  });

  it('self-mentions drop; non-members and unknown names resolve nobody', async () => {
    const { env } = makeEnv();
    env.join('c1', 'Alice', undefined, 'ua');
    env.join('c2', 'Bobby', undefined, 'ub');
    env.send('c1', { t: 'chat', text: '@Alice notes @Cee and @Nobody' });
    await flush();
    // Cee is an account but not at this table: no room pid, no tag
    expect(chatLines(env, 'c2').at(-1)!.mentions).toBeUndefined();
  });

  it('a mentioned member with no live socket fires the mention-push hook', async () => {
    const { env, mentionPushes } = makeEnv();
    env.join('c1', 'Alice', undefined, 'ua');
    const b = env.join('c2', 'Bobby', undefined, 'ub');
    env.send('c2', { t: 'sit', seat: 1 }); // seated members persist through a disconnect; unseated ones are swept
    env.room.close('c2');
    env.send('c1', { t: 'chat', text: '@Bobby come back' });
    await flush();
    expect(mentionPushes).toEqual([{ toUid: 'ub', authorUid: 'ua', authorName: 'Alice', text: '@Bobby come back', code: 'ABCDE' }]);
    // the line still posts (and keeps the tag for when Bobby rejoins)
    expect(chatLines(env, 'c1').at(-1)!.mentions).toEqual([b.pid]);
  });

  it('without the resolver hook, chat posts exactly as before (no mentions, no async)', async () => {
    const env = new FakeEnv(); // stock harness IO: no lookupUsernames
    env.join('c1', 'Alice', undefined, 'ua');
    env.join('c2', 'Bobby', undefined, 'ub');
    env.send('c1', { t: 'chat', text: 'plain @Bobby' });
    const line = chatLines(env, 'c2').at(-1)!; // already there, synchronously
    expect(line.text).toBe('plain @Bobby');
    expect(line.mentions).toBeUndefined();
  });
});

describe('table mute filtering', () => {
  it("a muted author's lines never reach the muter — live or in the welcome history — but reach everyone else", async () => {
    const { env } = makeEnv({ muted: { ub: ['ua'] } });
    env.join('c1', 'Alice', undefined, 'ua');
    env.join('c2', 'Bobby', undefined, 'ub');
    env.join('c3', 'Cee', undefined, 'uc');
    env.send('c1', { t: 'chat', text: 'hello table' });
    // Bobby gets system lines (no account author) but never Alice's line
    expect(chatLines(env, 'c2').map((l) => l.text)).not.toContain('hello table');
    expect(chatLines(env, 'c2').some((l) => l.system)).toBe(true);
    expect(chatLines(env, 'c3').map((l) => l.text)).toContain('hello table');
    expect(chatLines(env, 'c1').map((l) => l.text)).toContain('hello table'); // the author still sees her own line
    // Bobby rejoins on a fresh socket: the welcome history is filtered for him only
    const rejoin = env.join('c4', 'Bobby', undefined, 'ub');
    const w4 = env.last('c4', 'welcome')!;
    expect(w4.chat.map((l) => l.text)).not.toContain('hello table');
    expect(rejoin.pid).toBeTruthy();
    // a fresh joiner who muted nobody sees the full history
    env.join('c5', 'Cee', undefined, 'uc');
    const w5 = env.last('c5', 'welcome')!;
    expect(w5.chat.map((l) => l.text)).toContain('hello table');
  });

  it('a guest author is never filtered (the filter keys off account uids only)', async () => {
    const { env } = makeEnv({ muted: { ub: ['ua'] } });
    env.join('g1', 'Alice'); // guest: no uid linked, so no account author to match the mute against
    env.join('c2', 'Bobby', undefined, 'ub');
    env.send('g1', { t: 'chat', text: 'guest alice here' });
    expect(chatLines(env, 'c2').map((l) => l.text)).toContain('guest alice here');
  });
});
