import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card } from '@spades/rules';
import { drawFace } from '../src/cardArt';

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

  it('continues the Barlow tail instead of drawing a new queen', () => {
    const src = readFileSync(new URL('../src/cardArt.ts', import.meta.url), 'utf8');
    expect(src).toContain('function queenTail');
    expect(src).toContain("if (label === 'Q') queenTail");
    expect(src).toContain("if (rank === 'Q') queenTail");
    expect(src).toContain('ctx.fillText(label, cx, W * 0.255)');
    expect(src).toContain('ctx.fillText(rank, W / 2, courtY)');
  });
});
