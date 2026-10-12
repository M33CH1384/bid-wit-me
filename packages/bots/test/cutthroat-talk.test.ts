import { describe, expect, it } from 'vitest';
import { BOT_NAMES, COMMON, PERSONAS, botTalk, newTalkState, poolFor, prePlayLine, type PersonaId, type TalkIntensity, type TalkKind, type TalkTable } from '../src';

const IDS = Object.keys(PERSONAS) as PersonaId[];
const INTENSITIES: TalkIntensity[] = ['family', 'cookout', 'nomercy'];
const kinds = (p: PersonaId) => [...new Set([...Object.keys(PERSONAS[p].lines), ...Object.keys(COMMON)])] as TalkKind[];
// independent detector: anything that only makes sense with a partner / team
const PARTNERISH = /partner|teammate|team mate|\{team\}|\b(my|your|whole|our) team\b/i;

describe('Cutthroat (no teams): bots never use partner lines', () => {
  it('no-teams pools contain no partner / team references (every persona, kind, intensity, gender)', () => {
    let filtered = 0;
    for (const p of IDS) for (const k of kinds(p)) for (const i of INTENSITIES) for (const g of ['f', 'm'] as const) {
      const solo = poolFor(p, k, i, g, undefined, false);
      for (const l of solo) expect(PARTNERISH.test(l), `${p}.${k}: ${l}`).toBe(false);
      filtered += poolFor(p, k, i, g, undefined, true).length - solo.length;
    }
    expect(filtered).toBeGreaterThan(0); // there really are partner lines in team modes
  });
  it('a long simulated Cutthroat game of moments never produces a partner line (text or clip id)', () => {
    const names = BOT_NAMES.slice(0, 4);
    const t: TalkTable = { seats: names.map((name) => ({ bot: true, name })), partnerships: false, teamNames: names, intensity: 'nomercy', jokers: true };
    const st = newTalkState();
    let now = 0, seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const evKinds = ['cut', 'overcut', 'setThem', 'win', 'lose', 'nilBid', 'blindNil', 'streak', 'slow', 'gotSet', 'roast', 'badHand', 'bidTooHigh', 'nuke', 'runIt', 'partnerBlunder', 'hypePartner'] as const;
    let spoken = 0;
    for (let i = 0; i < 6000; i++) {
      now += 9000;
      const kind = evKinds[i % evKinds.length]!;
      const line = i % 5 === 0 ? prePlayLine(st, t, i % 4, now, rnd) : botTalk(st, t, { kind, seat: i % 4, them: (i + 1) % 4, bid: 3, side: i % 4 } as never, now, rnd);
      if (!line) continue;
      spoken++;
      expect(PARTNERISH.test(line.text), line.text).toBe(false);
      expect(line.line ?? '', line.text).not.toMatch(/partnerBlunder|hypePartner/);
    }
    expect(spoken).toBeGreaterThan(200);
  });
});
