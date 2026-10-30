/**
 * Bot pacing, server side (owner, 2026-10-30: bots "throw out cards at the
 * exact same time"). The room used to schedule every bot turn at the flat
 * timing.botMs after the turn started — a metronome every client rendered
 * identically. The due time now draws from the seeded pacing band in
 * @spades/rules (botPaceDelayMs, mean = botMs): the same function the solo
 * scheduler uses, keyed on the game's seed and the turn's identity, so the
 * client's flight-start spacing can re-assert the identical draw. These
 * pins keep the wiring (and the watchdog/lead-in structure around it) from
 * silently reverting to the constant.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const room = readFileSync(new URL('../src/room.ts', import.meta.url), 'utf8');

describe('room bot scheduling', () => {
  it('draws the bot due time from the seeded pacing band around botMs', () => {
    expect(room).toContain('botPaceDelayMs({');
    expect(room).toContain('baseMs: this.timing.botMs');
    expect(room).toContain('seed: g.seed');
    // the flat metronome is gone from the scheduling expression
    expect(room).not.toContain('+ leadIn + this.timing.botMs)');
  });

  it('keeps the surrounding structure: lead-in first, talk beat added after, watchdog untouched', () => {
    expect(room).toContain('(d.turnStartedAt ?? now) + leadIn + botPaceDelayMs({');
    expect(room).toContain('if (line) { this.pushBotLine(line); at += 900; changed = true; }');
    expect(room).toContain('BOT_WATCHDOG_MS');
  });
});
