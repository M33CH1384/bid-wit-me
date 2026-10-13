import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeRules } from '@spades/rules';
import type { RoomInfo } from '@spades/protocol';
import { biddingNote, noticeTip, seatFacingName, seatInitial, trickTakenLine } from '../src/seatLabel';
import { rotation } from '../src/online/rotate';
import { chatUserLabel, localNames } from '../src/online/useOnline';

const names = ['You', 'Keisha', 'Boo', 'Jasmine'];

describe('spectator seat labels', () => {
  it('names the occupant, and a bot, instead of You', () => {
    expect(seatFacingName(names, 0, false)).toBe('You');
    expect(seatFacingName(names, 2, false)).toBe('Boo');
    expect(seatInitial(seatFacingName(names, 0, false))).toBe('Y');
    expect(trickTakenLine('You')).toBe('YOU TAKE IT');
    expect(biddingNote('Keisha', { partnerships: true, partnerTurn: true, spectating: false })).toBe('Your partner Keisha is bidding…');
    expect(noticeTip(false)).toContain("you're out");

    for (const seat of [0, 1, 2, 3]) {
      const label = seatFacingName(['Boo', 'Keisha', 'Auntie Pat', 'Jasmine'], seat, true);
      expect(label.toLowerCase()).not.toBe('you');
    }
    expect(seatFacingName(names, 0, true)).toBe('Seat 1');
    expect(seatFacingName(['Boo', 'Keisha', 'Auntie Pat', 'Jasmine'], 0, true)).toBe('Boo');
    expect(seatInitial('Boo')).toBe('B');
    expect(trickTakenLine('Boo')).toBe('BOO TAKES IT');
    expect(biddingNote('Keisha', { partnerships: true, partnerTurn: true, spectating: true })).toBe('Keisha is bidding…');
    expect(noticeTip(true)).not.toMatch(/\byou\b/i);
  });

  it('builds the roster without a You at the anchor seat while watching', () => {
    const rules = makeRules('joker');
    const rot = rotation(rules, 0);
    const room = {
      seats: [
        { kind: 'bot', name: 'Boo', level: 'pro' },
        { kind: 'human', playerId: 'k', name: 'Keisha', connected: true, media: { mic: false, cam: false } },
        { kind: 'bot', name: 'Auntie Pat', level: 'pro' },
        { kind: 'bot', name: 'Jasmine', level: 'pro' },
      ],
    } as RoomInfo;
    expect(localNames(room, rot)).toEqual(['You', 'Keisha', 'Auntie Pat', 'Jasmine']);
    const watching = localNames(room, rot, true);
    expect(watching).toEqual(['Boo', 'Keisha', 'Auntie Pat', 'Jasmine']);
    expect(watching.join(' ')).not.toMatch(/\bYou\b/);
    expect(chatUserLabel('Wes', 'spec', 'spec', true)).toBe('Wes');
    expect(chatUserLabel('Boo', 'bot-0', 'spec', true)).toBe('Boo');
    expect(chatUserLabel('Wes', 'spec', 'spec', false)).toBe('You');
  });

  it('wires the table and chat off the helper', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('seatFacingName(names, seat, spectating)');
    expect(table).toContain('trickTakenLine(face(');
    expect(table).toContain('seatInitial(face(HUMAN))');
    expect(table).toContain('biddingNote(');
    expect(table).toContain('noticeTip(spectating)');
    expect(table).toContain('toastsFor(rec, r, names, mySide, spectating)');
    expect(table).toContain('!spectating && r.partnerships && seat === partnerOf(HUMAN, r)');
    expect(table).not.toContain("t.winner === HUMAN ? 'You'");
    expect(table).not.toContain("pl.seat === HUMAN ? 'You'");
    expect(table).not.toContain("winnerSeat === HUMAN ? 'YOU TAKE IT'");
    expect(table).not.toContain("runFx.claimer === HUMAN ? 'You'");
    expect(table).not.toContain("callout.seat === HUMAN ? 'You'");
    expect(table).not.toContain('}}>Y</div>');

    const online = readFileSync(new URL('../src/online/useOnline.ts', import.meta.url), 'utf8');
    expect(online).toContain('chatUserLabel(');
    expect(online).toContain('if (!spectating && i === 0) return \'You\'');
    expect(online).not.toContain("if (i === 0) return 'You'");
    expect(online).not.toContain("user: mine ? 'You'");
  });
});
