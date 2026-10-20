/** Coin glyph sweep (Demetrius 2026-10-20): the 🪙 emoji "don't work for me" —
 *  every coin amount in the web app renders the drawn CoinIcon (src/RepBlock.tsx)
 *  instead. The profile surfaces were swapped first (0360d780); this sweep covers
 *  the rest — the rewards screen's Coins row and the whole Big Bank wager UI
 *  (list rows, create form, detail card) — and pins the whole src tree so the
 *  emoji can't creep back in anywhere. wagerLogic's string outputs (netText,
 *  the balance validation hint) are plain text by construction, so they carry
 *  no glyph at all; the JSX call sites render the icon beside the amount. */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const wager = read('../src/social/Wager.tsx');
const wagerLogic = read('../src/social/wagerLogic.ts');
const rewards = read('../src/GameOverRewards.tsx');
const repBlock = read('../src/RepBlock.tsx');

describe('coin glyph: the drawn CoinIcon everywhere, the emoji nowhere', () => {
  it('no 🪙 remains anywhere in apps/web/src', () => {
    const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true })
      .map(String)
      .filter((f) => /\.(ts|tsx|css)$/.test(f));
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) {
      expect(read(`../src/${f}`), f).not.toContain('🪙');
    }
  });

  it('CoinIcon has exactly one definition, in RepBlock.tsx', () => {
    expect(repBlock).toContain('export function CoinIcon({ size = 15 }');
    expect(wager).toContain("import { CoinIcon } from '../RepBlock';");
    expect(rewards).toContain("import { CoinIcon } from './RepBlock';");
  });

  it('the rewards Coins row renders the drawn coin at the row icon size', () => {
    expect(rewards).toContain('<div className="rw-icon"><CoinIcon size={22} /></div>');
    expect(rewards).toContain('Coins earned');
  });

  it('the wager UI renders CoinIcon beside every amount it used to emoji', () => {
    // list row: wager + pot; create form: balance label, ladder chips, escrow
    // terms (wager ×2 + pot), submit; detail: wager, pot, accept button,
    // per-player net — plus the RowCard finished line's "you <net>" amount.
    const uses = wager.split('<CoinIcon />').length - 1;
    expect(uses).toBe(13);
    expect(wager).toContain('{r.wager.toLocaleString()} <CoinIcon /> each');
    expect(wager).toContain('pot {r.pot.toLocaleString()} <CoinIcon />');
    expect(wager).toContain('your balance {cred.coins.toLocaleString()} <CoinIcon />');
    expect(wager).toContain('Send challenge · escrow {f.wager.toLocaleString()} <CoinIcon />');
    expect(wager).toContain('Accept · escrow {v.wager.toLocaleString()} <CoinIcon />');
    expect(wager).toContain('{netText(me.net)}{me.net !== 0 && <> <CoinIcon /></>}');
    expect(wager).toContain('{netText(p.net)}{p.net !== 0 && <> <CoinIcon /></>}');
  });

  it('wagerLogic string outputs carry no glyph — the icon lives in the JSX', () => {
    expect(wagerLogic).not.toContain('🪙');
    expect(wagerLogic).toContain('return `+${net.toLocaleString()}`;');
    expect(wagerLogic).toContain('return `−${Math.abs(net).toLocaleString()}`;');
    expect(wagerLogic).toContain('Your balance is ${o.balance.toLocaleString()} — pick a smaller wager.');
  });
});
