/** Coin glyph sweep, server side (Demetrius 2026-10-20): the 🪙 emoji "don't
 *  work for me" — coin amounts in player-facing text are plain words. The web
 *  tree was swept and pinned in 2026-10 (apps/web/test/coin-icon-sweep.test.ts);
 *  the server never was, so the daily push went out titled 'Daily bonus 🪙' and
 *  the Big Bank wager texts carried the glyph. This pin covers the whole
 *  apps/server/src tree so the emoji can't creep back into any server text —
 *  push titles, wager terms, reminders, settlements. Other emoji are fine;
 *  only the coin glyph is banned. */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('coin glyph: plain coin words in server texts, the emoji nowhere', () => {
  it('no 🪙 remains anywhere in apps/server/src', () => {
    const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true })
      .map(String)
      .filter((f) => /\.ts$/.test(f));
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) {
      expect(read(`../src/${f}`), f).not.toContain('🪙');
    }
  });

  it('the daily push title is the plain label every other surface uses', () => {
    const notify = read('../src/push/notify.ts');
    expect(notify).toContain("title: 'Daily bonus',");
    expect(read('../src/push/send.ts')).toContain("daily: 'Daily bonus',");
  });

  it('the Big Bank wager texts name coins in words', () => {
    const svc = read('../src/wager/service.ts');
    expect(svc).toContain('coins a player');
    expect(svc).toContain('escrow your ${c.wager} coins.');
    expect(svc).toContain('escrow your ${d.wager} coins.');
    expect(svc).toContain('took the ${pot}-coin pot.');
    expect(svc).toContain('their ${w}-coin wager is split by the table.');
  });
});
