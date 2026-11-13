import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type Bid,
  type Card,
  type GameState,
  makeRules,
  newGame,
} from '@spades/rules';
import { landCueFor, littleJokerWhips } from '../src/landCue';
import { deuceLandCue } from '../src/deuceFx';
import { fireCue, fx } from '../src/fx';
import { photorealFor } from '../src/photoreal/host';

/**
 * THE WHIP-CRACK (owner-approved 2026-11-06) — the Little Joker's own
 * throw action, sibling to the Big Joker's quake: ONE crack line
 * whipping across the table in a fast single stroke, with a shiver
 * through the felt and the glassCrack recording presented as a snap
 * (under the quake's gain, pitched up). Big = weight and sprawl;
 * Little = speed and precision. Single treatment — no degree scale.
 *
 * Boundaries pinned here:
 *  - the whip answers the THROW, not the steal: when the Little Joker
 *    cuts a standing trump, The Cut (deuceFx's classification) owns
 *    the moment exactly as before — no whip segment in the cue;
 *  - both Jokers in one trick is the nuke's moment: with the Big
 *    Joker already down, the whip yields (suppressed); thrown first,
 *    the Little keeps its own moment and the Big answers later with
 *    the MAX quake + blast, as shipped;
 *  - the Big Joker's cue and tiers are untouched.
 * Seats are play order (seat = index); partnerships pair 0+2 vs 1+3.
 */
const joker = makeRules('joker');

function state(o: { bids?: (Bid | null)[]; done?: Card[][]; trick?: Card[] } = {}): GameState {
  const st = newGame(joker, 'whip');
  const mk = (cs: Card[]) => ({ ...st.trick, plays: cs.map((card, seat) => ({ seat, card })) });
  return {
    ...st,
    bids: o.bids ?? st.bids,
    tricks: (o.done ?? []).map(mk),
    trick: mk(o.trick ?? []),
  } as GameState;
}

describe('the whip fires on the throw', () => {
  it('the Little Joker led plainly', () => {
    const st = state({ trick: ['LJ'] });
    expect(littleJokerWhips(st, 'LJ')).toBe(true);
    expect(landCueFor(st, 'LJ')).toContain('jokerWhip');
  });
  it('following a plain lead', () => {
    const st = state({ trick: ['AH', 'LJ'] });
    expect(littleJokerWhips(st, 'LJ')).toBe(true);
    expect(landCueFor(st, 'LJ')).toContain('jokerWhip');
  });
  it('over its own side’s standing trump — a throw, not a steal', () => {
    const st = state({ trick: ['AS', '3H', 'LJ'] });
    expect(littleJokerWhips(st, 'LJ')).toBe(true);
  });
  it('thrown first in a trick the Big Joker later joins — its moment is its own', () => {
    const st = state({ trick: ['LJ', '3H'] });
    expect(littleJokerWhips(st, 'LJ')).toBe(true);
  });
});

describe('the whip yields where another effect owns the moment', () => {
  it('cutting a standing trump deuce is The Cut’s moment (the shipped boundary)', () => {
    const st = state({ trick: ['2S', 'LJ'] });
    expect(littleJokerWhips(st, 'LJ')).toBe(false);
    expect(deuceLandCue(st, 'LJ')).toBe('play,jokerLittle,deuceThump,trumpCut');
  });
  it('cutting a cut-in ace of trumps is The Cut’s moment too', () => {
    const st = state({ trick: ['KH', 'AS', 'LJ'] });
    expect(littleJokerWhips(st, 'LJ')).toBe(false);
    expect(landCueFor(st, 'LJ')).not.toContain('jokerWhip');
  });
  it('with the Big Joker already down, the trick is the nuke’s — no whip', () => {
    const st = state({ trick: ['BJ', 'LJ'] });
    expect(littleJokerWhips(st, 'LJ')).toBe(false);
    expect(landCueFor(st, 'LJ')).not.toContain('jokerWhip');
  });
  it('a late-built cue for a completed both-Jokers trick stays whip-free', () => {
    const st = state({ done: [['LJ', '3H', 'BJ', '4C']], trick: ['3C'] });
    expect(littleJokerWhips(st, 'LJ')).toBe(false);
  });
});

describe('controls', () => {
  it('the Big Joker’s cue gains no whip segment', () => {
    const st = state({ trick: ['AH', 'BJ'] });
    expect(landCueFor(st, 'BJ')).not.toContain('jokerWhip');
  });
  it('a plain card’s cue has neither rumble nor whip', () => {
    const st = state({ trick: ['KH', 'AS'] });
    expect(landCueFor(st, 'AS')).not.toContain('jokerWhip');
  });
});

describe('the whip rides the cue onto its own fx event, silently', () => {
  it('fireCue emits jokerWhip (the snap is the host’s, with the picture)', () => {
    const seen: string[] = [];
    const off = fx.on((e) => seen.push(e.kind));
    fireCue('jokerWhip');
    off();
    expect(seen).toContain('jokerWhip');
  });
  it('the photoreal map sends jokerWhip to the whip module', () => {
    expect(photorealFor({ kind: 'jokerWhip' })).toBe('whip');
  });
});

describe('host + module: one fast line, one snap', () => {
  const host = readFileSync(new URL('../src/photoreal/host.ts', import.meta.url), 'utf8');
  const whip = readFileSync(
    new URL('../src/photoreal/modules/whip.js', import.meta.url),
    'utf8',
  );
  const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');

  it('the host loads the whip module and keeps the preview silent', () => {
    expect(host).toContain("whip: () => import('./modules/whip.js')");
    expect(host).toContain('T >= WHIP_SNAP_T');
    expect(host).toContain("name === 'whip' && !cracked && opts.at === undefined");
  });
  it('the snap: same recording, under the quake’s gain, pitched up', () => {
    expect(host).toContain('WHIP_SNAP_T = 0.18');
    expect(host).toContain('WHIP_SNAP_GAIN = 0.9');
    expect(host).toContain('WHIP_SNAP_RATE = 1.35');
    // the rate reaches the sample only through the opt-in channel;
    // callers that pass no rate (plate crack, quake) are untouched
    expect(audio).toContain('(opts.rate ?? 1) * (0.98 + Math.random() * 0.04)');
  });
  it('the module grows exactly ONE crack — the opposite of the sprawl', () => {
    expect(whip.match(/cracks\.push/g)).toHaveLength(1);
    expect(whip).not.toContain('[3,5,7,9]');
    expect(whip).toContain('D=1.7');
  });
  it('the felt shiver is the module’s own shake, small and fast', () => {
    expect(whip).toContain('S*.0035');
  });
});
