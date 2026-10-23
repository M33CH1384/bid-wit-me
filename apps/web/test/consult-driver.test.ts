/**
 * @vitest-environment happy-dom
 *
 * Partner consultation, web layer (consultDriver): the first-meet store,
 * consultation delivery wiring, the settle trigger, Dee's ack gate, and
 * the bid-delay decisions (partner clip extension §6.2, confer caps
 * §5.4). The bots builders are the real ones; talkPrefs is mocked so no
 * audio graph is touched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRules, newGame, viewFor, type GameState } from '@spades/rules';
import { INTRO_COMMON, INTRO_OWN, partnerBidIntent } from '@spades/bots';

vi.mock('../src/talkPrefs', () => ({
  talkPrefs: { get: () => ({ botTalk: true, hideBotTalk: false, voices: true, voiceVolume: 0.6, aiVoices: true }) },
  spokenClipDurationMs: vi.fn(async () => 1000),
  speakConsult: vi.fn(),
  consultClipDurationMs: vi.fn(async () => 1800),
}));
vi.mock('../src/decks', () => ({ getActiveDeck: () => 'classic' }));

const { ConsultDriver, hasMetPartner, markPartnerMet, bumpPartnerMatch, loadMetPartners } = await import('../src/consultDriver');
const { offlineTalk } = await import('../src/offlineTalk');
const { speakConsult } = await import('../src/talkPrefs');

const NAMES = ['You', 'Ash', 'Partner', 'Bo'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeDriver(pushes: { name: string; text: string }[], opts: { story?: boolean; k?: number } = {}) {
  return new ConsultDriver({
    story: !!opts.story,
    names: NAMES,
    partnerSeat: 2,
    humanSeat: 0,
    levelFor: () => 'pro',
    k: () => opts.k ?? 1,
    push: (name, text) => pushes.push({ name, text }),
    seatPos: () => undefined,
    kingLeg2: () => false,
    humanHinted: () => false,
    humanNilAnnounced: () => false,
  });
}
const freshState = (seed = 'driver-test'): GameState => newGame(makeRules('joker', { firstHandBidsItself: false }), seed);
const withBids = (st: GameState, bids: (number | 'nil' | null)[]): GameState => ({ ...st, bids: bids as GameState['bids'] });

beforeEach(() => {
  localStorage.clear();
  vi.mocked(speakConsult).mockClear();
  offlineTalk.newGame();
});

describe('first-meet store (§5.1)', () => {
  it('records a partner once, bumps matches, and keeps partners independent', () => {
    expect(hasMetPartner('Partner')).toBe(false);
    markPartnerMet('Partner');
    expect(hasMetPartner('Partner')).toBe(true);
    expect(loadMetPartners()['Partner']!.matches).toBe(1);
    bumpPartnerMatch('Partner');
    expect(loadMetPartners()['Partner']!.matches).toBe(2);
    markPartnerMet('Partner'); // never resets an existing entry
    expect(loadMetPartners()['Partner']!.matches).toBe(2);
    expect(hasMetPartner('Ash')).toBe(false);
    bumpPartnerMatch('Ash'); // no entry: no-op, no phantom greeting-skip
    expect(hasMetPartner('Ash')).toBe(false);
  });
});

describe('consultation delivery', () => {
  it('fires once per hand: intro first (unmet partner), then the claim line; the recorded claim is partnerBidIntent', async () => {
    const pushes: { name: string; text: string }[] = [];
    const d = makeDriver(pushes);
    const st = freshState();
    d.onState(st, { dealing: false, misdealShowing: false });
    await sleep(750); // deal-complete + 600 ms: the introduction beat
    expect(pushes.length).toBe(1);
    expect(pushes[0]!.name).toBe('Partner');
    const introPool = [...INTRO_COMMON, ...Object.values(INTRO_OWN).flatMap((x) => x ?? [])];
    expect(introPool).toContain(pushes[0]!.text);
    expect(hasMetPartner('Partner')).toBe(true); // written the moment it fired
    await sleep(1700); // the consultation line follows as its own beat
    expect(pushes.length).toBe(2);
    expect(pushes[1]!.name).toBe('Partner');
    // the recorded claim is the one real number — the coach's number
    expect(d.session.claimsByHand.get(st.handNo)?.claim).toEqual(partnerBidIntent(viewFor(st, 2), 'pro'));
    // right-of-way stamped for the talk layer
    expect(offlineTalk.consultBusyUntil).toBeGreaterThan(0);
    d.dispose();
  });

  it('a met partner goes straight to book talk — no second introduction, ever', async () => {
    markPartnerMet('Partner');
    const pushes: { name: string; text: string }[] = [];
    const d = makeDriver(pushes);
    d.onState(freshState('driver-test-2'), { dealing: false, misdealShowing: false });
    await sleep(800);
    expect(pushes.length).toBe(1); // the consultation only
    d.dispose();
  });

  it('never fires while dealing, and never twice for one physical deal', async () => {
    const pushes: { name: string; text: string }[] = [];
    const d = makeDriver(pushes);
    const st = freshState('driver-test-3');
    d.onState(st, { dealing: true, misdealShowing: false });
    await sleep(750);
    expect(pushes.length).toBe(0);
    d.onState(st, { dealing: false, misdealShowing: false });
    d.onState(st, { dealing: false, misdealShowing: false });
    await sleep(800);
    const afterFirst = pushes.length;
    expect(afterFirst).toBeGreaterThanOrEqual(1);
    await sleep(900);
    expect(pushes.length).toBe(afterFirst); // the intro+consult pair, nothing more
    d.dispose();
  });
});

describe('bid delays (§5.4 / §6.2)', () => {
  it("holds the partner's bid while their consultation clip plays", () => {
    const d = makeDriver([]);
    const st = freshState('delay-test');
    d.session.consultHandKey = `${st.seed}:${st.handNo}:${st.misdeals ?? 0}`;
    d.session.consultClipEndAt = performance.now() + 2000;
    const extra = d.bidDelay(2, st);
    expect(extra).toBeGreaterThan(1100);
    expect(extra).toBeLessThanOrEqual(1350); // 2000 of clip, minus the 650 base delay
    d.session.consultClipEndAt = performance.now() - 1;
    expect(d.bidDelay(2, st)).toBe(0);
    d.dispose();
  });

  it('holds a provisional beat when the partner bids before the consultation lands', async () => {
    const d = makeDriver([]);
    const st = freshState('delay-test-2');
    d.onState(st, { dealing: false, misdealShowing: false });
    expect(d.bidDelay(2, st)).toBe(900);
    d.dispose();
  });

  it('confer: caps, consecutiveness, first-bidder exemption, speed gate', () => {
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0); // every roll passes; form A; voiced
    try {
      const pushes: { name: string; text: string }[] = [];
      const d = makeDriver(pushes);
      const st = freshState('confer-test');
      // first bidder of the hand is exempt (its own driver/hand: a seat
      // bids once per hand, and decisions are cached per hand+seat —
      // idempotent across useGame effect re-runs, as asserted below)
      const first = makeDriver([]);
      expect(first.bidDelay(3, withBids(freshState('confer-first'), [null, null, null, null]))).toBe(0);
      first.dispose();
      // seat 3 confers on the second bid of the hand (partner seat 1 claims)
      expect(d.bidDelay(3, withBids(st, [5, null, null, null]))).toBe(800);
      expect(pushes.some((p) => p.name === 'Ash' && p.text.includes('→ Bo:'))).toBe(true);
      // the same seat's decision is idempotent (useGame re-runs its effect)
      expect(d.bidDelay(3, withBids(st, [5, null, null, null]))).toBe(800);
      expect(pushes.length).toBe(1);
      // the very next bid may not confer (never consecutive)
      expect(d.bidDelay(1, withBids(st, [5, null, null, 3]))).toBe(0);
      // a later bid in the same hand may (second confer of the hand):
      // probed on a fresh driver, since a seat bids once per hand and
      // the skip above is itself a cached decision for that seat+hand
      const d2 = makeDriver([]);
      expect(d2.bidDelay(3, withBids(st, [5, null, null, null]))).toBe(800);
      expect(d2.bidDelay(1, withBids(st, [5, null, 4, 3]))).toBe(800);
      d2.dispose();
      // caps are per hand: the next hand (new key) confers again
      const d3 = makeDriver([]);
      expect(d3.bidDelay(3, withBids(freshState('confer-next-hand'), [5, null, null, null]))).toBe(800);
      d3.dispose();
      // fast tables (k < 1) never confer
      const fast = makeDriver([], { k: 0.5 });
      expect(fast.bidDelay(3, withBids(st, [5, null, null, null]))).toBe(0);
      fast.dispose();
      // story tables confer text-only: a shorter hold, no voice call
      vi.mocked(speakConsult).mockClear();
      const storyPushes: { name: string; text: string }[] = [];
      const sd = makeDriver(storyPushes, { story: true });
      expect(sd.bidDelay(3, withBids(st, [5, null, null, null]))).toBe(400);
      expect(storyPushes.some((p) => p.text.includes('→ Bo:'))).toBe(true);
      expect(vi.mocked(speakConsult)).not.toHaveBeenCalled();
      sd.dispose();
      d.dispose();
    } finally { rnd.mockRestore(); }
  });
});

describe('settle (§5.3)', () => {
  it('fires when the second of the pair lands, speaking the placed total', () => {
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0); // the 0.75 roll passes
    try {
      const pushes: { name: string; text: string }[] = [];
      const d = makeDriver(pushes);
      const st = freshState('settle-test');
      d.onState(withBids(st, [5, null, null, null]), { dealing: false, misdealShowing: false });
      expect(pushes.length).toBe(0);
      d.onState(withBids(st, [5, null, 3, null]), { dealing: false, misdealShowing: false });
      const settle = pushes.find((p) => p.name === 'Partner');
      expect(settle).toBeTruthy();
      expect(settle!.text).toContain('8'); // T = 5 + 3, the PLACED bids
      // and only once
      d.onState(withBids(st, [5, 2, 3, null]), { dealing: false, misdealShowing: false });
      expect(pushes.filter((p) => p.name === 'Partner').length).toBe(1);
      d.dispose();
    } finally { rnd.mockRestore(); }
  });
});

describe('match boundary (repetition follow-up, 2026-10-22)', () => {
  it('a new game at the same table refills the per-match line bags', () => {
    const pushes: { name: string; text: string }[] = [];
    const d = makeDriver(pushes);
    const a = freshState('game-a');
    d.onState(a, { dealing: false, misdealShowing: false });
    // spend session state the way a played match would
    const talkBefore = d.session.talk;
    d.session.ackUsed = true;
    d.session.firedConsults.add('game-a:1:0');
    d.session.claimsByHand.set(1, { claim: 3, read: 3 });
    const b = freshState('game-b');
    d.onState(b, { dealing: false, misdealShowing: false });
    // a different seed is a different match: bags refill (within a match
    // they must NOT reset — the no-repeat rotation depends on it)
    expect(d.session.talk).not.toBe(talkBefore);
    expect(d.session.ackUsed).toBe(false);
    expect(d.session.firedConsults.size).toBe(0);
    expect(d.session.claimsByHand.size).toBe(0);
    // and the same seed again does NOT reset (same match, next state)
    const talkAfter = d.session.talk;
    d.onState(b, { dealing: false, misdealShowing: false });
    expect(d.session.talk).toBe(talkAfter);
    d.dispose();
  });
});
