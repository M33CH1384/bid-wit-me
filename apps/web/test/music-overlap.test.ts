import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = readFileSync(fileURLToPath(new URL('../src/audio.ts', import.meta.url)), 'utf8');

describe('music: one active track', () => {
  it('advance() is single-flight, and ended cannot race a crossfade', () => {
    expect(src).toMatch(/if \(this\.advancing\) return; \/\/ a crossfade is already running/);
    expect(src).toMatch(/this\.decks\[this\.active\] === deck && !this\.fading/);
    expect(src).toMatch(/this\.advancing = false;\n {6}if \(this\.settings\.music\) this\.loadDeck/);
  });
  it('decks are created once and released (paused) when the context is rebuilt', () => {
    expect(src).toMatch(/private ensureDecks\(\) \{\n {4}if \(this\.decks\.length \|\| !this\.ctx\) return;/);
    expect(src).toMatch(/private recreateContext\(\) \{[\s\S]{0,200}this\.releaseDecks\(\);/);
  });
  it('the playing-deck probe counts only audible decks', () => {
    expect(src).toMatch(/playingDeckCount\(\)/);
  });
});
