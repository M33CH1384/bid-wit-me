/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { blocksPan, lockBody } from '../src/antiPan';
import { smackSound } from '../src/audio';

describe('anti-pan guards', () => {
  it('blocks pans on the table, hand and plates, not in menus or the score pad', () => {
    document.body.innerHTML = `<div class="table-screen"><canvas></canvas><div data-testid="hand"><i class="c"></i></div><div class="plate"><b></b></div><div class="sheet"><div class="scroll"><p class="row"></p></div></div><div class="score-pad"><p class="pad-row"></p></div></div><div class="outside"></div>`;
    const root = document.querySelector('.table-screen')!;
    for (const sel of ['canvas', '[data-testid="hand"] .c', '.plate b']) expect(blocksPan(document.querySelector(sel), root)).toBe(true);
    for (const sel of ['.scroll .row', '.score-pad .pad-row', '.outside']) expect(blocksPan(document.querySelector(sel), root)).toBe(false);
  });
  it('locks the page only while in a game', () => {
    const undo = lockBody();
    expect(document.documentElement.classList.contains('bwm-in-game')).toBe(true);
    undo();
    expect(document.documentElement.classList.contains('bwm-in-game')).toBe(false);
  });
});

describe('slam sound', () => {
  it('intensity drives gain up, pitch down and adds a thud only for hard hits', () => {
    const soft = smackSound(0), mid = smackSound(0.5), hard = smackSound(1);
    expect(soft.gain).toBeLessThan(mid.gain);
    expect(mid.gain).toBeLessThan(hard.gain);
    expect(hard.gain).toBeGreaterThan(0.9); // louder than a normal play
    expect(hard.rate).toBeLessThan(soft.rate);
    expect(soft.thud).toBe(0);
    expect(hard.thud).toBeGreaterThan(0.5);
    expect(smackSound(5)).toEqual(hard);
  });
});
