/** The Pj's server gate: entitlement = After Dark unlock row OR Rep level 20+ OR admin.
 *  This is the check behind the Table DO's member stamp — the room's venue gate and Random
 *  roll trust the stamp, so the stamp's source has to be right, and it has to fail closed. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { pjsVenueAccess } from '../src/cred/venueAccess';
import { grantUnlock } from '../src/cred/achievements';

let db: D1Database;
const NOW = 1_800_000_000_000;

beforeEach(async () => {
  db = await makeD1();
});

describe("pjsVenueAccess (The Pj's entitlement)", () => {
  it('denies a fresh account, and fails closed with no DB at all', async () => {
    expect(await pjsVenueAccess({}, db, 'nobody', 'Nobody')).toBe(false);
    expect(await pjsVenueAccess({}, undefined, 'nobody', 'Nobody')).toBe(false);
  });
  it('grants on the after-dark unlock row (achievement or the level-20 grant)', async () => {
    await grantUnlock(db, 'u1', 'after-dark', 'achievement:after-dark', NOW);
    expect(await pjsVenueAccess({}, db, 'u1', 'U1')).toBe(true);
    // some other unlock item does not open the venue
    await grantUnlock(db, 'u2', 'big-bank', 'level:20', NOW);
    expect(await pjsVenueAccess({}, db, 'u2', 'U2')).toBe(false);
  });
  it('grants on Rep level 20+ read from xp_state, denies level 19', async () => {
    await db.prepare('INSERT INTO xp_state (user_id, xp, level, updated_at) VALUES (?, ?, ?, ?)').bind('u19', 0, 19, NOW).run();
    await db.prepare('INSERT INTO xp_state (user_id, xp, level, updated_at) VALUES (?, ?, ?, ?)').bind('u20', 0, 20, NOW).run();
    expect(await pjsVenueAccess({}, db, 'u19', 'U19')).toBe(false);
    expect(await pjsVenueAccess({}, db, 'u20', 'U20')).toBe(true);
  });
  it('admin accounts bypass (username list or account-id list), nobody else does', async () => {
    expect(await pjsVenueAccess({ ADMIN_USERNAMES: 'M33CH' }, db, 'u9', 'm33ch')).toBe(true);
    expect(await pjsVenueAccess({ ADMIN_USER_IDS: 'u9' }, db, 'u9', 'Whoever')).toBe(true);
    expect(await pjsVenueAccess({}, db, 'u9', 'm33ch')).toBe(false);
  });
});
