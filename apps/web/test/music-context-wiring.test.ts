import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Source wiring guard (node env so file URLs work): contexts must actually be entered. */
describe('sound context wiring', () => {
  it('Table enters game on mount / menu on leave; the App root enters menu when no game shows', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(table).toContain("sound.enterContext('game')");
    expect(table).toContain("return () => sound.enterContext('menu')");
    expect(app).toContain("if (!game) sound.enterContext('menu')");
  });
  it('no extra ambience beds or picker were added (held for a separate ask)', () => {
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    for (const held of ['Rain', 'Fireplace', 'Crickets', 'Café', 'Vinyl']) expect(audio).not.toContain(held);
  });
});
