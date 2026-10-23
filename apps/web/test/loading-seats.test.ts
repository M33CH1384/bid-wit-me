import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { personaPortraitFor } from '@spades/bots';
import {
  LOADING_SEAT_STAGGER_MS,
  TableLoading,
  loadingSeatDelayMs,
  type LoadingSeat,
} from '../src/TableLoading';

/**
 * Taking seats (owner, 2026-10-23): the loading hold presents the table's
 * real faces arriving in seat order — story portraits, uploaded pictures,
 * persona nameplates — never the bare single-letter circle for a bot.
 */

const AVATAR = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAoAAAAvAAAAAA==';

const STORY_SEATS: LoadingSeat[] = [
  { name: 'You', you: true, direct: AVATAR, color: '#f5c542' },
  { name: 'Poet', storyId: 'poet', tag: 'Rooftop philosopher', bot: true, color: '#4fd1ff' },
  { name: 'Dee', storyId: 'dee', tag: 'Your partner on the run', bot: true, color: '#ff6ad5' },
  { name: 'Seven', storyId: 'seven', tag: 'The quiet one', bot: true, color: '#7dff9b' },
];

const BOT_SEATS: LoadingSeat[] = [
  { name: 'You', you: true, color: '#f5c542' },
  { name: 'Big Mike', bot: true, tag: 'The Professor', color: '#4fd1ff' },
  { name: 'Sharon', bot: true, tag: 'Big Mama', color: '#ff6ad5' },
  { name: 'Dre', bot: true, tag: 'The Hustler', color: '#7dff9b' },
];

const seatChunks = (html: string) => html.split('data-testid="loading-seat"').slice(1);

describe('loading hold — taking seats', () => {
  it('paces the arrival across the hold, in seat order; reduced motion seats everyone at once', () => {
    expect(LOADING_SEAT_STAGGER_MS).toBe(450);
    expect(loadingSeatDelayMs(0, false)).toBe(0);
    expect(loadingSeatDelayMs(1, false)).toBe(450);
    expect(loadingSeatDelayMs(3, false)).toBe(1350);
    expect(loadingSeatDelayMs(3, true)).toBe(0);
  });

  it('story seats render their real portraits with names and roles, arriving in seat order', () => {
    const html = renderToStaticMarkup(createElement(TableLoading, { progress: 0.3, seats: STORY_SEATS }));
    expect(html).toContain('data-testid="loading-seats"');
    for (const id of ['poet', 'dee', 'seven']) {
      expect(html).toContain(`data-testid="story-face-${id}"`);
      expect(html).toContain(`src="/assets/story/portraits/${id}.webp"`);
    }
    expect(html).toContain('Rooftop philosopher');
    expect(html).toContain('Your partner on the run');
    expect(html).toContain('The quiet one');
    // the viewer's own seat shows their uploaded picture
    expect(html).toContain(`src="${AVATAR}"`);
    // arrival order = seat order: delays ascend with the seats
    const delays = [...html.matchAll(/animation-delay:(\d+)ms/g)].map((m) => Number(m[1]));
    expect(delays).toEqual([0, 450, 900, 1350]);
    const names = ['You', 'Poet', 'Dee', 'Seven'].map((n) => html.indexOf(`>${n}<`));
    expect(names.every((i) => i >= 0)).toBe(true);
    expect([...names].sort((a, b) => a - b)).toEqual(names);
    // the standard hold's furniture is untouched
    expect(html).toContain('data-testid="table-loading-line"');
    expect(html).toContain('data-testid="table-loading-tip"');
  });

  it('bots arrive with their persona portraits — full name and tag, no letter circle', () => {
    const html = renderToStaticMarkup(createElement(TableLoading, { progress: 0.3, seats: BOT_SEATS }));
    const chunks = seatChunks(html);
    expect(chunks).toHaveLength(4);
    for (const [i, name] of ['Big Mike', 'Sharon', 'Dre'].entries()) {
      const chunk = chunks[i + 1]!;
      // the bot's face slot is its persona portrait (resolved from its name)
      expect(chunk).toContain('persona-face-');
      expect(chunk).toContain(`src="${personaPortraitFor(name)}"`);
      expect(chunk).toContain(name);
      // never the initial-letter circle, and no nameplate while the art stands
      expect(chunk).not.toContain('bwm-seat-face-circle');
      expect(chunk).not.toContain('bwm-seat-plate');
    }
    expect(html).toContain('The Professor');
    expect(html).toContain('Big Mama');
    expect(html).toContain('The Hustler');
  });

  it('the nameplate stays as the fallback: TableLoading swaps to it when portrait art fails', () => {
    const src = readFileSync(new URL('../src/TableLoading.tsx', import.meta.url), 'utf8');
    expect(src).toContain('faceFailed');
    expect(src).toContain('<PersonaFace name={seat.name} onError={onFaceError} />');
    expect(src).toContain('bwm-seat-plate-name');
  });

  it('a human seat without a picture keeps the avatar treatment (their photo system, not a bot plate)', () => {
    const seats: LoadingSeat[] = [
      { name: 'You', you: true, color: '#f5c542' },
      { name: 'LovleyT714', uid: null, color: '#4fd1ff' },
      ...BOT_SEATS.slice(2),
    ];
    const html = renderToStaticMarkup(createElement(TableLoading, { progress: 0.3, seats }));
    const chunks = seatChunks(html);
    expect(chunks[1]).toContain('bwm-seat-face-circle');
    expect(chunks[1]).toContain('LovleyT714');
    expect(chunks[1]).not.toContain('bwm-seat-plate');
  });

  it('reduced motion: every seat is simply seated — zero delays, reduced strip', () => {
    const html = renderToStaticMarkup(createElement(TableLoading, { progress: 0.3, seats: STORY_SEATS, reducedMotion: true }));
    expect(html).toContain('bwm-loading-seats reduced');
    const delays = [...html.matchAll(/animation-delay:(\d+)ms/g)].map((m) => Number(m[1]));
    expect(delays).toEqual([0, 0, 0, 0]);
  });

  it('no seats, fault, and versus holds are exactly as before', () => {
    const plain = renderToStaticMarkup(createElement(TableLoading, { progress: 0.3 }));
    expect(plain).not.toContain('loading-seats');
    const fault = renderToStaticMarkup(createElement(TableLoading, { fault: 'nope', seats: STORY_SEATS, onRetry: () => {}, onBack: () => {} }));
    expect(fault).not.toContain('loading-seats');
    expect(fault).toContain('data-testid="join-fault"');
    const versus = renderToStaticMarkup(createElement(TableLoading, {
      progress: 0.3,
      seats: STORY_SEATS,
      versus: createElement('div', { 'data-testid': 'versus-stub' }, 'VS'),
    }));
    expect(versus).not.toContain('loading-seats');
    expect(versus).toContain('data-testid="versus-stub"');
  });

  it('both table surfaces wire their real rosters into the hold', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('seats={loadingSeats}');
    expect(table).toContain('reducedMotion={reduceFx || fx.osReducedMotion}');
    const online = readFileSync(new URL('../src/online/OnlineTable.tsx', import.meta.url), 'utf8');
    expect(online).toContain('seats={joinSeats}');
  });
});
