import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSessionHint, isKnownGuest, noteSession, noteSessionLoading, skipSelfRead } from '../src/account/sessionHint';
import { fetchVenueUnlocks, invalidateVenueUnlocks } from '../src/venues';

// Audit fix 7: a known guest makes no self-only account reads (no guaranteed 401s); a signed-in or unknown session still reads.
describe('guest self-read skip (sessionHint)', () => {
  let calls: string[];
  beforeEach(() => {
    __resetSessionHint(); invalidateVenueUnlocks(); calls = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(String(u)); return new Response(JSON.stringify({ unlocks: [{ itemId: 'v1' }], dev: false, storyAccess: true }), { status: 200, headers: { 'content-type': 'application/json' } }); }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('known guest: no /api/profile/me request, null unlocks', async () => {
    noteSession('guest');
    expect(isKnownGuest()).toBe(true);
    expect(await fetchVenueUnlocks()).toBeNull();
    expect(calls).toEqual([]);
  });
  it('signed-in session still reads /api/profile/me (restore unchanged)', async () => {
    noteSession('user');
    expect(await fetchVenueUnlocks()).toEqual({ unlocks: ['v1'], dev: false, storyAccess: true });
    expect(calls).toEqual(['/api/profile/me']);
  });
  it('unknown (auth/me failed) still reads — never skipped on doubt', async () => {
    noteSession(null);
    expect(await skipSelfRead()).toBe(false);
    await fetchVenueUnlocks();
    expect(calls).toEqual(['/api/profile/me']);
  });
  it('waits for the first auth/me answer, bounded', async () => {
    noteSessionLoading(); const p = skipSelfRead(1000); noteSession('guest');
    expect(await p).toBe(true);
    __resetSessionHint();
    expect(await skipSelfRead(10)).toBe(false); // nothing in flight → answers at once
    noteSessionLoading(); // no answer in time → read as before
  });
  it('a guest who signs in reads again', async () => {
    noteSession('guest'); expect(await skipSelfRead()).toBe(true);
    noteSession('user'); expect(await skipSelfRead()).toBe(false);
  });
});
