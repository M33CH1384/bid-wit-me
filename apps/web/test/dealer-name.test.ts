import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeRules, newGame, scoreHand } from '@spades/rules';
import { rotation } from '../src/online/rotate';
import { DealerPopup } from '../src/DealerPopup';
import {
  type SeatOccupant,
  dealerAnnouncement,
  dealerFromServer,
  hudSeatName,
  withCurrentDealerLine,
} from '../src/dealerName';
import { ScorePad } from '../src/ScorePad';

const table = [
  { name: 'Ava', kind: 'human' },
  { name: 'Lamar', kind: 'human' },
  { name: 'Mei', kind: 'human' },
  { name: 'Jules', kind: 'bot' },
] as const satisfies readonly SeatOccupant[];

/** Local-seat names the way the online HUD builds them (seat 0 is "You" for a seated viewer). */
function seatedNames(occupants: readonly SeatOccupant[], viewer: number): string[] {
  const rules = makeRules(occupants.length === 3 ? 'cutthroat' : 'joker', { playerCount: occupants.length as 3 | 4 });
  const rot = rotation(rules, viewer);
  return occupants.map((_, i) => {
    if (i === 0) return 'You';
    const server = rot.R(i);
    const occ = occupants[server];
    return !occ || occ.kind === 'empty' || !occ.name.trim() ? `Seat ${server + 1}` : occ.name;
  });
}

describe('dealer name from the current hand', () => {
  it('names the occupant of the engine dealer seat from every viewing seat', () => {
    const rules = makeRules('joker');
    for (const serverDealer of [0, 1, 2, 3]) {
      const occupant = table[serverDealer]!.name;
      for (let viewer = 0; viewer < 4; viewer++) {
        const id = dealerFromServer({ serverDealer, occupants: table, viewerSeat: viewer });
        expect(id.serverSeat).toBe(serverDealer);
        expect(id.localSeat).toBe(rotation(rules, viewer).L(serverDealer));
        expect(id.name).toBe(viewer === serverDealer ? 'You' : occupant);
        expect(id.phrase).toBe(viewer === serverDealer ? 'You deal' : `${occupant} deals`);
        // the rotated roster, indexed by the local seat, is the same person (not names[serverDealer])
        expect(hudSeatName(id.localSeat, seatedNames(table, viewer))).toBe(id.name);
        if (viewer !== 0) expect(seatedNames(table, viewer)[serverDealer]).not.toBe(id.name);
      }
    }
  });

  it('keeps the same person when the table is rotated for a 3-handed game', () => {
    const occupants: SeatOccupant[] = [
      { name: 'Ava', kind: 'human' },
      { name: 'Lamar', kind: 'human' },
      { name: 'Mei', kind: 'human' },
    ];
    const rules = makeRules('cutthroat', { playerCount: 3 });
    for (let viewer = 0; viewer < 3; viewer++) {
      const id = dealerFromServer({ serverDealer: 1, occupants, viewerSeat: viewer });
      expect(id.localSeat).toBe(rotation(rules, viewer).L(1));
      expect(id.name).toBe(viewer === 1 ? 'You' : 'Lamar');
      expect(hudSeatName(id.localSeat, seatedNames(occupants, viewer))).toBe(id.name);
    }
  });

  it('follows dealer rotation onto the next seat, not the previous dealer', () => {
    const first = dealerFromServer({ serverDealer: 1, occupants: table, viewerSeat: 3 });
    const next = dealerFromServer({ serverDealer: 2, occupants: table, viewerSeat: 3 });
    expect(first.name).toBe('Lamar');
    expect(next.name).toBe('Mei');
    expect(next.localSeat).toBe((first.localSeat + 1) % 4);
    expect(dealerAnnouncement(2, next.name)).toBe('Hand 2 · Mei deals');
    expect(dealerAnnouncement(2, next.name)).not.toContain('Lamar');
  });

  it('uses the new occupant after a seat change, at the same dealer seat', () => {
    const before = dealerFromServer({ serverDealer: 1, occupants: table, viewerSeat: 2 });
    const changed: SeatOccupant[] = table.map((s, i) => (i === 1 ? { name: 'Noor', kind: 'human' } : { ...s }));
    const after = dealerFromServer({ serverDealer: 1, occupants: changed, viewerSeat: 2 });
    expect(before.name).toBe('Lamar');
    expect(after.serverSeat).toBe(before.serverSeat);
    expect(after.localSeat).toBe(before.localSeat);
    expect(after.name).toBe('Noor');
    expect(after.phrase).toBe('Noor deals');
  });

  it('shows the bot who took the seat, matching the live plate rather than the player they replaced', () => {
    const before = dealerFromServer({ serverDealer: 1, occupants: table, viewerSeat: 0 });
    const taken: SeatOccupant[] = table.map((s, i) => (i === 1 ? { name: 'Nia', kind: 'bot' } : { ...s }));
    const after = dealerFromServer({ serverDealer: 1, occupants: taken, viewerSeat: 0 });
    expect(before.name).toBe('Lamar');
    expect(after.name).toBe('Nia');
    expect(after.localSeat).toBe(before.localSeat);
    expect(hudSeatName(after.localSeat, seatedNames(taken, 0))).toBe('Nia');
    // the replaced player was sitting in that seat: once a bot takes them, a spectator sees the bot
    const watching = dealerFromServer({ serverDealer: 0, occupants: [{ name: 'Nia', kind: 'bot' }, ...table.slice(1)], viewerSeat: null });
    expect(watching.name).toBe('Nia');
    expect(watching.phrase).toBe('Nia deals');
    expect(watching.name).not.toBe('You');
  });

  it('never calls the anchor seat "You" while spectating', () => {
    for (const serverDealer of [0, 1, 2, 3]) {
      const id = dealerFromServer({ serverDealer, occupants: table, viewerSeat: null });
      expect(id.localSeat).toBe(serverDealer);
      expect(id.name).toBe(table[serverDealer]!.name);
      expect(id.name).not.toBe('You');
      const specNames = table.map((s, i) => (s.kind === 'empty' || !s.name.trim() ? `Seat ${i + 1}` : s.name));
      expect(hudSeatName(id.localSeat, specNames)).toBe(id.name);
    }
  });

  it('names an empty dealer seat by its server number', () => {
    const occupants: SeatOccupant[] = [
      { name: 'Ava', kind: 'human' },
      { name: '', kind: 'empty' },
      { name: 'Mei', kind: 'human' },
      { name: 'Jules', kind: 'bot' },
    ];
    const id = dealerFromServer({ serverDealer: 1, occupants, viewerSeat: 3 });
    expect(id.name).toBe('Seat 2');
    expect(hudSeatName(id.localSeat, seatedNames(occupants, 3))).toBe('Seat 2');
    expect(dealerFromServer({ serverDealer: 5, occupants: table, viewerSeat: 0 }).name).toBe('Lamar');
  });

  it('rewrites only the current hand when the dealer occupant changes', () => {
    const texts = ['Hand 1 · Ava deals', 'Hand 1: Ava+Mei +20', 'Hand 2 · Lamar deals'];
    expect(withCurrentDealerLine(texts, 2, dealerAnnouncement(2, 'Nia'))).toEqual([
      'Hand 1 · Ava deals',
      'Hand 1: Ava+Mei +20',
      'Hand 2 · Nia deals',
    ]);
    expect(withCurrentDealerLine(texts, 2, 'Hand 2 · Lamar deals')).toBeNull();
    expect(withCurrentDealerLine(['Hand 3: Ava+Mei +10'], 3, dealerAnnouncement(3, 'Mei'))).toBeNull();
  });

  it('renders the popup from that name, including after a takeover', () => {
    const html = renderToStaticMarkup(createElement(DealerPopup, { name: 'Lamar', localSeat: 3 }));
    expect(html).toContain('data-testid="dealer-popup"');
    expect(html).toContain('data-dealer-seat="3"');
    expect(html).toContain('>Lamar<');
    expect(html).toContain('deals');
    expect(html).toContain('aria-label="Lamar deals"');
    const yours = renderToStaticMarkup(createElement(DealerPopup, { name: 'You', localSeat: 0 }));
    expect(yours).toContain('>You<');
    expect(yours).toContain('>deal<');
    expect(yours).not.toContain('>deals<');
  });

  it('score pad current hand uses the live dealer name, and a past hand uses that seat\'s current occupant', () => {
    const rules = makeRules('joker', { targetScore: 250, firstHandBidsItself: false });
    const live = newGame(rules, 'dealer-pad', { dealer: 0 });
    const bids = [3, 4, 3, 4] as const;
    const tricksWon = [3, 4, 3, 3];
    const sides = scoreHand(rules, [...bids], tricksWon, [0, 0], [0, 0]);
    const st = {
      ...live,
      handNo: 2,
      dealer: 1,
      phase: 'bidding' as const,
      history: [{ handNo: 1, dealer: 0, bids: [...bids], tricksWon, sides }],
    };
    const names = ['Nia', 'Noor', 'Mei', 'Jules'];
    const html = renderToStaticMarkup(createElement(ScorePad, {
      st, names, dealerName: 'Noor', onClose: () => {}, sideName: () => 'Side',
    }));
    expect(html).toContain('Noor deals');
    expect(html).not.toContain('You deals');
    expect(html).toContain('Nia dealt');
  });

  it('does not hardcode the bottom seat as "You deal"', () => {
    const tableSrc = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    const onlineSrc = readFileSync(new URL('../src/online/useOnline.ts', import.meta.url), 'utf8');
    expect(tableSrc).not.toContain("st.dealer === HUMAN ? 'You deal'");
    expect(tableSrc).toContain('<DealerPopup');
    expect(tableSrc).toContain('me={spectating ? -1 : HUMAN}');
    expect(tableSrc).toContain('dealerFromServer');
    expect(onlineSrc).not.toContain('names[st.dealer]} deals');
    expect(onlineSrc).toContain('dealerAnnouncement');
    expect(onlineSrc).toContain('withCurrentDealerLine');
  });
});
