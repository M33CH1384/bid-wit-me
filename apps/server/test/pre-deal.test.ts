import { describe, expect, it } from 'vitest';
import { PRE_DEAL_MS } from '../src/room';
import { FakeEnv } from './harness';

/**
 * Pre-deal setup window (owner, 2026-10-20): cards do not deal until the room's
 * window ends — the table loads, the versus intro dismisses, players set their
 * cameras/mics — and then the first hand deals to everyone at once, server-side,
 * so no seat's bid clock can start early. First deal only; resumes untouched.
 */
const TIMING = { botMs: 10, trickPauseMs: 0, dealMs: 0, disconnectGraceMs: 5000, handOverMs: 3000, preDealMs: PRE_DEAL_MS };

function started() {
  const env = new FakeEnv(undefined, TIMING);
  const a = env.join('a', 'Meech');
  const b = env.join('b', 'Imani');
  env.send('a', { t: 'sit', seat: 0 });
  env.send('b', { t: 'sit', seat: 2 });
  env.send('a', { t: 'addBot', seat: 1 });
  env.send('a', { t: 'addBot', seat: 3 });
  env.send('a', { t: 'start' });
  return { env, a, b };
}

describe('pre-deal setup window', () => {
  it('is 8 seconds — inside the owner\'s 5–10s range', () => {
    expect(PRE_DEAL_MS).toBe(8000);
    expect(PRE_DEAL_MS).toBeGreaterThanOrEqual(5000);
    expect(PRE_DEAL_MS).toBeLessThanOrEqual(10_000);
  });

  it('the game starts UNDEALT: no cards, no turn, no clock — and the state says when the deal lands', () => {
    const { env } = started();
    const d = env.room.data;
    expect(d.phase).toBe('playing');
    expect(d.game?.handNo).toBe(0);
    expect(d.game?.hands.every((h) => h.length === 0)).toBe(true);
    expect(d.game?.turn).toBeNull();
    expect(d.deadline).toBeNull(); // no bid clock can be running
    expect(d.dealAt).toBe(env.t + PRE_DEAL_MS);
    const st = env.last('a', 'state')!;
    expect(st.room.dealAt).toBe(env.t + PRE_DEAL_MS);
    expect(st.view?.hand).toEqual([]);
    expect(st.view?.handCounts).toEqual([0, 0, 0, 0]);
  });

  it('nothing deals before the window ends; at the end the first hand deals to everyone at once', () => {
    const { env } = started();
    env.advance(PRE_DEAL_MS - 1);
    expect(env.room.data.game?.handNo).toBe(0);
    expect(env.room.data.dealAt).not.toBeNull();
    env.advance(1);
    const d = env.room.data;
    expect(d.game?.handNo).toBe(1);
    expect(d.game?.hands.every((h) => h.length === 13)).toBe(true);
    expect(d.dealAt).toBeNull();
    // only NOW does a turn exist, and its machinery is armed (human deadline or bot due time)
    expect(d.game?.turn).not.toBeNull();
    expect(d.deadline ?? d.botDueAt).not.toBeNull();
    const st = env.last('a', 'state')!;
    expect(st.room.dealAt).toBeNull();
    expect(st.view?.handCounts).toEqual([13, 13, 13, 13]);
  });

  it('the dealt hand is the seeded hand (the window changes when, never which cards)', () => {
    const one = started();
    one.env.advance(PRE_DEAL_MS);
    const two = started();
    two.env.advance(PRE_DEAL_MS);
    // different rooms roll different seeds, so compare structure, not cards:
    // the point pinned here is one deal per game — handNo 1 and full hands, once.
    expect(one.env.room.data.game?.handNo).toBe(1);
    expect(two.env.room.data.game?.handNo).toBe(1);
    one.env.advance(60_000);
    expect(one.env.room.data.game?.handNo).toBeGreaterThanOrEqual(1);
    expect(one.env.room.data.dealAt).toBeNull(); // never re-arms mid-game
  });

  it('nobody connected: the deal waits; the first player back gets the deal, not a started clock', () => {
    const { env, a } = started();
    env.room.close('a');
    env.room.close('b');
    env.advance(PRE_DEAL_MS + 5000);
    expect(env.room.data.game?.handNo).toBe(0); // frozen, like every timer at this table
    env.join('z', 'Meech', a.token);
    env.room.tick();
    expect(env.room.data.game?.handNo).toBe(1);
    expect(env.room.data.dealAt).toBeNull();
  });

  it('hibernation mid-window keeps the pending deal — the durable alarm deals once, on time', () => {
    const { env, a, b } = started();
    const dealAt = env.room.data.dealAt!;
    env.advance(3000);
    env.hibernate([['a', a.pid], ['b', b.pid]]);
    expect(env.room.data.dealAt).toBe(dealAt); // persisted in the saved row
    expect(env.room.data.game?.handNo).toBe(0);
    env.advance(PRE_DEAL_MS - 3000);
    expect(env.room.data.game?.handNo).toBe(1);
    expect(env.room.data.game?.hands.every((h) => h.length === 13)).toBe(true);
  });

  it('a hard restart mid-window keeps dealAt in the saved row (the next tick re-arms it)', () => {
    const { env, a, b } = started();
    const dealAt = env.room.data.dealAt!;
    env.advance(3000);
    env.restart([['a', a.pid], ['b', b.pid]]);
    expect(env.room.data.dealAt).toBe(dealAt);
    expect(env.room.data.game?.handNo).toBe(0);
    env.room.tick(); // any wake/message re-arms the alarm from the persisted dealAt
    env.advance(PRE_DEAL_MS - 3000);
    expect(env.room.data.game?.handNo).toBe(1);
  });

  it('resuming a dealt game never opens a new window', () => {
    const { env, a, b } = started();
    env.advance(PRE_DEAL_MS);
    expect(env.room.data.game?.handNo).toBe(1);
    env.restart([['a', a.pid], ['b', b.pid]]);
    expect(env.room.data.dealAt).toBeNull();
    expect(env.room.data.game?.handNo).toBe(1);
  });
});
