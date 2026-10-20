import { describe, expect, it } from 'vitest';
import { joinPresence, presenceLine } from '../src/index';

/**
 * Presence line dedupe (owner screenshot 2026-10-20): his own profile header
 * read "● Online — Online" because the headers joined a hardcoded "Online"
 * base with statusLabel(), which itself returns "Online" for a plain online
 * status. joinPresence drops a detail that just repeats the base.
 */
describe('joinPresence', () => {
  it('renders the base once when the detail repeats it', () => {
    expect(joinPresence('Online', 'Online')).toBe('Online');
  });

  it('dedupes case-insensitively and ignores surrounding whitespace', () => {
    expect(joinPresence('Online', 'online')).toBe('Online');
    expect(joinPresence('Online', '  Online  ')).toBe('Online');
    expect(joinPresence(' Away ', 'away')).toBe('Away');
  });

  it('joins differing parts with an em dash', () => {
    expect(joinPresence('Online', 'In a game')).toBe('Online — In a game');
    expect(joinPresence('Online', 'At a table · Joker')).toBe('Online — At a table · Joker');
  });

  it('renders the base alone when the detail is empty', () => {
    expect(joinPresence('Online', '')).toBe('Online');
    expect(joinPresence('Online', '   ')).toBe('Online');
  });
});

describe('presenceLine', () => {
  it('a plain online status reads just "Online" — never "Online — Online"', () => {
    expect(presenceLine({ kind: 'online' })).toBe('Online');
  });

  it('other statuses keep the joined form', () => {
    expect(presenceLine({ kind: 'lobby' })).toBe('Online — In lobby');
    expect(presenceLine({ kind: 'lobby', open: 2 })).toBe('Online — In lobby · 2 seats open');
    expect(presenceLine({ kind: 'tournament', name: 'Friday Cup' })).toBe('Online — In tournament · Friday Cup');
  });

  it('table status carries the mode name through the supplied mapper', () => {
    const modeName = (m: string) => (m === 'joker' ? 'Joker' : m);
    expect(presenceLine({ kind: 'table', mode: 'joker' }, modeName)).toBe('Online — At a table · Joker');
    expect(presenceLine({ kind: 'table', offline: true })).toBe('Online — At a table · vs bots');
  });
});
