import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card } from '@spades/rules';
import { COURT_FRAME_X, QUEEN_TAIL_EM, drawFace, queenTailReach } from '../src/cardArt';

/**
 * PR #88 drew the queen as an open bowl with a tail. The rank is the Barlow glyph again,
 * the same fill and stroke the jack and king already use. A short stroke continues
 * Barlow's own tail so it still reads as Q when the card is phone-sized.
 */
type TextOp = { method: 'fillText' | 'strokeText'; text: string; x: number; y: number; font: string };

function textOps(card: Card): TextOp[] {
  const ops: TextOp[] = [];
  const state = { font: '' };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof typeof target];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} });
      return (...args: unknown[]) => {
        if (prop === 'fillText' || prop === 'strokeText') {
          ops.push({
            method: prop,
            text: String(args[0]),
            x: Number(args[1]),
            y: Number(args[2]),
            font: target.font,
          });
        }
      };
    },
    set(target, prop, value) {
      (target as Record<string, unknown>)[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  const prev = globalThis.document;
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  } as unknown as Document;
  try {
    drawFace(card, 200, 280, false);
  } finally {
    globalThis.document = prev;
  }
  return ops;
}

describe('queen rank glyph', () => {
  const prev = globalThis.document;
  afterEach(() => { globalThis.document = prev; });

  it('paints Q with the same Barlow index as J and K', () => {
    const jack = textOps('JS');
    const queen = textOps('QS');
    const king = textOps('KS');

    const letters = (ops: TextOp[]) => ops.map((op) => op.text);
    expect(letters(queen)).toEqual(['Q', 'Q', 'Q', 'Q', 'Q']);
    expect(letters(jack)).toEqual(['J', 'J', 'J', 'J', 'J']);
    expect(letters(king)).toEqual(['K', 'K', 'K', 'K', 'K']);

    const shape = (ops: TextOp[]) => ops.map(({ method, x, y, font }) => ({ method, x, y, font }));
    expect(shape(queen)).toEqual(shape(jack));
    expect(shape(queen)).toEqual(shape(king));
    for (const op of queen) expect(op.font).toContain('Barlow Condensed');
    // Corner index is filled and stroked; the court letter is filled. No drawn bowl.
    expect(queen.filter((op) => op.method === 'strokeText')).toHaveLength(2);
    expect(queen.filter((op) => op.method === 'fillText')).toHaveLength(3);
  });

  it('continues the Barlow tail past the bowl instead of drawing a new queen', () => {
    const src = readFileSync(new URL('../src/cardArt.ts', import.meta.url), 'utf8');
    expect(src).toContain('function queenTail');
    expect(src).toContain("if (label === 'Q') queenTail");
    expect(src).toContain("if (rank === 'Q') queenTail");
    expect(src).toContain('ctx.fillText(label, cx, W * 0.255)');
    expect(src).toContain('ctx.fillText(rank, mid, courtY)');
    // The bowl's right edge is about 0.23em. The stroke clears that and stops short of the fan overlap.
    expect(src).toContain('ctx.lineTo(cx + fs * QUEEN_TAIL_EM, baseline + fs * 0.14)');
    expect(src).toContain('ctx.clip()');
    expect(src).not.toContain('ctx.lineTo(cx + fs * 0.34, baseline + fs * 0.14)');
    expect(src).not.toContain('ctx.lineTo(cx + fs * 0.62, baseline + fs * 0.32)');
    expect(QUEEN_TAIL_EM).toBeGreaterThan(0.23);
    // A phone fan exposes about 0.31 of the card. The ink stays left of 0.24, so the tail is not on that edge.
    expect(queenTailReach()).toBeGreaterThan(0.2);
    expect(queenTailReach()).toBeLessThan(0.24);
  });

  it('keeps the gold court frame out of the exposed phone-fan strip', () => {
    // A 13-card phone fan shows about 31% of each card. The stroke is 1.8% wide and centered on the frame.
    // The fan step never exceeds 62% of the card. The stroke has to start past that, or its
    // left edge is a gold line down the card in front.
    expect(COURT_FRAME_X - 0.009).toBeGreaterThan(0.62);
  });
});
