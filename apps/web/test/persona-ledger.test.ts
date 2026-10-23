import { describe, expect, it } from 'vitest';
import { EMPTY_LEDGER, parsePersonaLedger, personaRecord, sanitizeLedgerSplit } from '../src/personaLedger';

/**
 * The persona ledger reader (2026-10-23): the versus cards (and later, the
 * persona talk) read the viewer's recorded history with each bot persona
 * from this device-local store. The reader is tolerant of junk and NEVER
 * repairs numbers into existence — a malformed split is "no record",
 * because a wrong record presented as fact is worse than none.
 */
describe('persona ledger reader', () => {
  it('missing, empty, or garbage input is an empty ledger', () => {
    expect(parsePersonaLedger(null)).toEqual(EMPTY_LEDGER);
    expect(parsePersonaLedger(undefined)).toEqual(EMPTY_LEDGER);
    expect(parsePersonaLedger('')).toEqual(EMPTY_LEDGER);
    expect(parsePersonaLedger('not json {')).toEqual(EMPTY_LEDGER);
    expect(parsePersonaLedger('{"v":1}')).toEqual(EMPTY_LEDGER);
    expect(parsePersonaLedger('[1,2]')).toEqual(EMPTY_LEDGER);
  });

  it('a well-formed entry round-trips both splits, viewer-perspective intact', () => {
    const raw = JSON.stringify({ v: 1, personas: { gambler: {
      vs: { games: 6, wins: 4, losses: 2, streak: 2 },
      together: { games: 3, wins: 2, losses: 1, streak: -1 },
    } } });
    const led = parsePersonaLedger(raw);
    expect(personaRecord(led, 'gambler')).toEqual({
      vs: { games: 6, wins: 4, losses: 2, streak: 2 },
      together: { games: 3, wins: 2, losses: 1, streak: -1 },
    });
    expect(personaRecord(led, 'professor')).toBeNull();
    expect(personaRecord(led, null)).toBeNull();
  });

  it('zero-game, negative, and half-formed splits drop to no-record', () => {
    expect(sanitizeLedgerSplit({ games: 0, wins: 0, losses: 0, streak: 0 })).toBeNull();
    expect(sanitizeLedgerSplit({ games: -2, wins: 0, losses: 0 })).toBeNull();
    expect(sanitizeLedgerSplit({ games: 3, wins: 'three', losses: 0 })).toBeNull();
    expect(sanitizeLedgerSplit(null)).toBeNull();
    expect(sanitizeLedgerSplit(42)).toBeNull();
    const led = parsePersonaLedger(JSON.stringify({ v: 1, personas: {
      gambler: { vs: { games: 0, wins: 0, losses: 0, streak: 0 } },
      og: { vs: { games: 2, wins: 1, losses: 1, streak: 1 }, together: 'junk' },
    } }));
    expect(personaRecord(led, 'gambler')).toBeNull(); // entry with no valid split drops entirely
    expect(personaRecord(led, 'og')).toEqual({ vs: { games: 2, wins: 1, losses: 1, streak: 1 } });
  });

  it('a missing streak reads as 0 (unknown), never invented', () => {
    expect(sanitizeLedgerSplit({ games: 2, wins: 1, losses: 1 })).toEqual({ games: 2, wins: 1, losses: 1, streak: 0 });
  });
});
