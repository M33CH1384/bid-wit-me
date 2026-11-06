/**
 * Team rosters (owner, 2026-11-05) — the setup block decision: when a
 * player names their side in the online table lobby, the save is refused
 * (with plain words) only when ALL of these hold: their roster for that
 * name is full, and their seated partner is a signed-in human who is not
 * on it. Bots, guests (no account), empty seats, members, open spots and
 * unknown rosters never block — the server join at record time is the
 * backstop, and bot games are exempt by the owner's rule.
 */
import { describe, expect, it } from 'vitest';
import { rosterBlock, type TeamRoster } from '../src/social/teamsApi';

const full: TeamRoster = {
  name: 'Homies', full: true,
  members: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }, { id: 'p3', name: 'Three' }],
};
const open: TeamRoster = { name: 'Homies', full: false, members: [{ id: 'p1', name: 'One' }] };

describe('rosterBlock', () => {
  it('blocks a full roster with a non-member signed-in partner, in plain words', () => {
    const msg = rosterBlock(full, { uid: 'p9', name: 'Ninth' });
    expect(msg).toBeTruthy();
    expect(msg).toContain('Homies');
    expect(msg).toContain('full');
    expect(msg).toContain('Ninth');
    expect(msg).toContain('Eject');
  });

  it('allows a member of the full roster (either id form)', () => {
    expect(rosterBlock(full, { uid: 'p2', name: 'Two' })).toBeNull();
    expect(rosterBlock(full, { uid: 'u:p2', name: 'Two' })).toBeNull();
  });

  it('allows a non-member when a spot is free', () => {
    expect(rosterBlock(open, { uid: 'p9', name: 'Ninth' })).toBeNull();
  });

  it('never blocks for a bot, a guest, or an empty partner seat', () => {
    expect(rosterBlock(full, { uid: undefined, name: 'Dee' })).toBeNull();
    expect(rosterBlock(full, { uid: null, name: 'Guest' })).toBeNull();
    expect(rosterBlock(full, null)).toBeNull();
    expect(rosterBlock(full, undefined)).toBeNull();
  });

  it('never blocks when the roster is unknown (not loaded / brand-new name)', () => {
    expect(rosterBlock(undefined, { uid: 'p9', name: 'Ninth' })).toBeNull();
  });
});
