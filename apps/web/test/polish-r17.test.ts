import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hostMinimum, makeRules } from '@spades/rules';
import { booksBanner, minimumChip, teamMinNote } from '../src/polishText';
import { trickSpot } from '../src/three/layout';
import { BOT_PLAY_MS } from '../src/useGame';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

describe('r17 polish', () => {
  it('hand 1 banner uses the real minimum', () => {
    const r = makeRules('joker');
    const min = hostMinimum(r);
    expect(booksBanner(min, r.partnerships)).toBe(`First hand: no bids — your team must make at least ${min} books`);
    expect(booksBanner(0, true)).toContain('no bids');
  });
  it('the minimum is labelled as a team minimum, and the picker says bids start at 1', () => {
    expect(minimumChip(4, true)).toBe('Team minimum 4');
    expect(minimumChip(4, false)).toBe('Minimum 4');
    expect(teamMinNote(4, true)).toContain('start at 1');
    expect(teamMinNote(4, false)).toBeNull();
  });
  it('later plays sit above the led card', () => {
    for (const pos of ['top', 'bottom', 'left', 'right'] as const) {
      expect(trickSpot(pos, 4, 1, 0).p[1] - trickSpot(pos, 4, 0, 0).p[1]).toBeGreaterThan(0.02);
    }
  });
  it('bots take about 0.6s longer per card', () => {
    expect(BOT_PLAY_MS).toBe(1200);
  });
  it('no gold outline mesh on any card', () => {
    expect(src('three/Card3D.tsx')).not.toMatch(/material=\{glowMat\}/);
  });
  it('one consistent team name maxlength', () => {
    expect(src('TeamName.tsx')).toMatch(/maxLength=\{TEAM_NAME_MAX\}/);
  });
  it('menu and chat buttons do not report a collapsed state', () => {
    const t = src('Table.tsx');
    expect(t).not.toMatch(/aria-expanded=\{menuOpen\}/);
    expect(t).not.toMatch(/tray-toggle" aria-expanded/);
  });
  it('bid order lists every seat in the a11y tree', () => {
    expect(src('PartnerTalk.tsx')).toMatch(/role="listitem"/);
  });
  it('a plate never keeps two DEALER chips', () => {
    expect(src('plateFacts.ts')).toMatch(/One DEALER chip per plate/);
    expect(src('styles.css')).toMatch(/\.chip\.dealer ~ \.chip\.dealer \{ display: none; \}/);
  });
  it('the countdown clears the YOUR TURN tag', () => {
    expect(src('styles.css')).toMatch(/\.turn-clock \{ left: auto !important; right: 0;/);
  });
});

describe('new hand plates start clean', () => {
  it('TOOK is 0 while bidding, real count once playing', async () => {
    const { plateTookText, bidChipText } = await import('../src/plateFacts');
    expect(plateTookText(7, 'bidding')).toBe('TOOK 0');
    expect(plateTookText(7, 'playing')).toBe('TOOK 7');
    expect(bidChipText(null, false)).toBe('BID —'); // blank until this seat bids
    expect(bidChipText(null, true)).toBe('BID …');
  });
});
