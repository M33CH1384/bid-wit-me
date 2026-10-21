/**
 * League Wire client pins (league data wave, item 7): a wire line in global
 * chat renders as a distinct system block — never as a player message — and
 * never plays the player-message blip. Server behavior (stored system
 * line, dedupe, cadence, no reactions/replies) is pinned in
 * apps/server/test/social.test.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const social = read('../src/social/Social.tsx');
const store = read('../src/social/store.ts');
const css = read('../src/social/social.css');
const protocol = read('../../../packages/protocol/src/social.ts');

describe('League Wire rendering', () => {
  it('the line type carries the wire flag (a stored system-line kind)', () => {
    expect(protocol).toContain('wire?: boolean');
  });
  it('global chat renders wire lines as a wire block with the stored byline, before any bubble markup', () => {
    const branch = social.indexOf('if (l.wire) {');
    expect(branch).toBeGreaterThan(-1);
    expect(social.slice(branch, branch + 900)).toContain('data-testid="wire-line"');
    expect(social.slice(branch, branch + 900)).toContain('soc-wire-byline');
    expect(social.slice(branch, branch + 900)).toContain('{l.name}');
    // the wire branch returns before the normal message row is built
    expect(branch).toBeLessThan(social.indexOf('soc-bubble-row'));
  });
  it('the wire block is styled distinctly in both themes (functionally identical)', () => {
    expect(css).toContain('.soc-wire {');
    expect(css).toContain('.soc-wire-byline {');
    expect(css).toContain('html[data-theme="neon"] .soc-wire {');
    expect(css).toContain('html[data-theme="neon"] .soc-wire-byline {');
  });
  it('a wire arrival never plays the player-message blip', () => {
    expect(store).toContain("if (!m.line.wire) playChatSound('global'");
  });
});
