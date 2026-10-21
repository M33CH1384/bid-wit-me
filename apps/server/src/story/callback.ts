/**
 * Story Mode call-backs (owner, 2026-10-21): when a story match sits
 * unfinished, the seated characters themselves call the player back to the
 * table by push notification — in their own voices.
 *
 * The story save is device-local (localStorage 'bwm.storySave.v1'), so the
 * client reports session state through POST /api/story/session (see
 * routes.ts): 'open' on save create/checkpoint, 'closed' on finish /
 * discard / resume-completion. Sessions live in story_sessions
 * (migration 0023), one open row per (user, track), stamped with SERVER
 * receive times only — client clocks never drive the schedule.
 *
 * The sweep rides the Worker's hourly cron (index.ts scheduled handler,
 * alongside runScheduledPushes):
 *   · first call-back after ~5h away from an open session
 *   · one "last call" after ~24h away
 *   · then silence — at most 2 nudges per session, ever
 *   · sessions expire for nudge purposes 7 days after they opened
 * A nudge is only counted as sent when the push layer actually delivered
 * it to at least one live subscription (pref off / no subscription costs
 * the player nothing — the call simply stays pending until expiry).
 * Delivery, per-type prefs, cooldown-free fan-out and dead-subscription
 * pruning are the push layer's (push/send.ts sendPushToUser).
 */
import { STORY_CHARACTERS, STORY_STOPS } from '@spades/bots';
import { sendPushToUser, type PushPayload } from '../push/send';
import type { VapidKeys } from '../push/crypto';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Away-time before the first call-back. */
export const STORY_CALLBACK_FIRST_MS = 5 * HOUR;
/** Away-time before the last call. */
export const STORY_CALLBACK_LAST_MS = 24 * HOUR;
/** Sessions older than this are never nudged. */
export const STORY_CALLBACK_EXPIRE_MS = 7 * DAY;
/** Hard cap: nudges per session, ever. */
export const STORY_CALLBACK_MAX_NUDGES = 2;

export interface StoryCallbackLine {
  /** STORY_CHARACTERS id of the speaker (display name resolved from the cast) */
  fromId: string;
  body: string;
}

export interface StoryCallbackStop {
  /** place name as it reads after the speaker: "Uncle Ray · The Porch" */
  place: string;
  /** first call-back (~5h away) */
  first: StoryCallbackLine;
  /** last call (~24h away) — then silence */
  last: StoryCallbackLine;
}

/**
 * The call-back copy, keyed by stop id. Two lines per stop, each spoken by
 * a member of the seated pair — except the last calls Dee makes: she's the
 * partner left sitting at the table, and her loyalty needle lands hardest
 * at the warm end (the Porch) and the grit end (the Pj's). Register follows
 * the route's range map (Porch warm/funny, Barbershop history, Rec loud,
 * Cookout weird, Corner menace, Church grace with steel — never profane,
 * Rooftop strange, High-Rise cold, Pj's grit, Legends' reverence, and the
 * King summons you himself). The owner's anchor phrase ("get that ass
 * beat") lives exactly once, cleaned for a lock screen, at the warm stop
 * where it's family talk. No line is reused across stops.
 */
export const STORY_CALLBACK_LINES: Record<string, StoryCallbackStop> = {
  porch: {
    place: 'The Porch',
    first: { fromId: 'uncleRay', body: 'Your seat\u2019s still warm, and Pat\u2019s already retelling the hand you walked out on. Come on back to the porch \u2014 we saved the lemonade and the lesson.' },
    last: { fromId: 'dee', body: 'Ray said to tell you: come get that ass-whooping you ordered. His words. Mine are simpler \u2014 I saved your seat, partner. Don\u2019t make me hold it forever.' },
  },
  barbershop: {
    place: 'The Barbershop',
    first: { fromId: 'june', body: 'Your chair\u2019s still warm, baby. Mr. Coleman\u2019s been telling your unfinished game like it\u2019s history \u2014 come back and give it a better ending.' },
    last: { fromId: 'mrColeman', body: 'Fifty years I\u2019ve kept this shop\u2019s book, and I don\u2019t leave pages open. Yours is open. The Barbershop is waiting \u2014 come finish your lesson.' },
  },
  'rec-center': {
    place: 'The Rec Center',
    first: { fromId: 'lilMan', body: 'You left MID-GAME?! Trey\u2019s been running his mouth for two days straight. Get back to the Rec and finish this \u2014 I ain\u2019t losing to a ghost!' },
    last: { fromId: 'trey', body: 'Last call! Lil\u2019 Man wore the buzzer out asking where you went. The table\u2019s still set up at the Rec \u2014 come finish him so the rest of us can get some quiet.' },
  },
  cookout: {
    place: 'The Cookout',
    first: { fromId: 'keisha', body: 'You left mid-hand and the potato salad\u2019s been asking about you. The Cookout table remembers. So do we. Both of us. At the same time.' },
    last: { fromId: 'teisha', body: 'Keisha set your plate aside. I ate the plate. Come finish what you started \u2014 before I start finishing your sentences at this table too.' },
  },
  corner: {
    place: 'The Corner',
    first: { fromId: 'smoke', body: 'You left a debt mid-hand on my corner. Debts don\u2019t age well out here. Come settle it.' },
    last: { fromId: 'redd', body: 'Last time I\u2019m saying it. The Corner is open, your seat is still yours, and Smoke is still counting. Walk back.' },
  },
  'church-basement': {
    place: 'The Church Basement',
    first: { fromId: 'sisterMae', body: 'Baby, your chair\u2019s been empty and your partner\u2019s been patient. The basement table is set whenever you\u2019re ready to come back to it. We\u2019ll be here.' },
    last: { fromId: 'deaconFord', body: 'The Lord gives second chances, and so does this table \u2014 but service is ending, child. Come finish your game while the light\u2019s still on down here.' },
  },
  rooftop: {
    place: 'The Rooftop',
    first: { fromId: 'poet', body: 'The moon filed a missing persons report on a card player. Rooftop. Same stars. Unfinished business. You know the way up.' },
    last: { fromId: 'poet', body: 'Seven nodded toward your empty chair. From Seven, that is a whole speech. Last call \u2014 come hear the ending he already knows.' },
  },
  'high-rise': {
    place: 'The High-Rise',
    first: { fromId: 'velvet', body: 'Leaving mid-game at my table? Expensive habit, darling. The High-Rise keeps its appointments. So should you.' },
    last: { fromId: 'accountant', body: 'Final notice. Your unfinished game has been accruing interest, and I have priced your return to the cent. Come close the account.' },
  },
  'the-pjs': {
    place: "The Pj's",
    first: { fromId: 'captainBlock', body: 'Under my light, you don\u2019t leave a game standing. Your chair is where you left it and the streetlight\u2019s still on. The Pj\u2019s are waiting \u2014 come finish it.' },
    last: { fromId: 'dee', body: 'Brick hasn\u2019t blinked since you left, and the Captain\u2019s telling the whole street you ran. I know better. Come back and take what\u2019s yours, partner.' },
  },
  legends: {
    place: "The Legends' Table",
    first: { fromId: 'queenie', body: 'Legends don\u2019t leave a table mid-story, sugar. Ace has kept your cards exactly where they fell. Come back and earn the ending.' },
    last: { fromId: 'ace', body: 'I\u2019ve waited fifty years on some hands without a word. I won\u2019t wait on yours. Last call at the Legends\u2019 Table \u2014 come sit down.' },
  },
  king: {
    place: "The King's Table",
    first: { fromId: 'king', body: 'Twenty-two years undefeated, and you keep me waiting mid-game? Bold. The crown is patient, but it is not entertained. Come back and finish what you started.' },
    last: { fromId: 'king', body: 'Last summons. Kings don\u2019t call twice \u2014 I have already called once. Return to my table, or the story ends with you walking away from it.' },
  },
};

/** The push payload for a stop's call-back at a stage (1 = first, 2 = last). */
export function storyCallbackPayload(stopId: string, stage: 1 | 2): PushPayload | null {
  const stop = STORY_CALLBACK_LINES[stopId];
  if (!stop) return null;
  const line = stage === 1 ? stop.first : stop.last;
  const from = STORY_CHARACTERS[line.fromId]?.name ?? line.fromId;
  return {
    title: `${from} \u00B7 ${stop.place}`,
    body: line.body,
    url: '/story',
    tag: `story-callback-${stopId}`,
    type: 'story_callback',
  };
}

/**
 * Record that a story match is open (or still open) on a track. A ping for
 * a different stop — or after a close — starts a FRESH session (new open
 * stamp, nudge budget reset): it is a new sitting at a new table. A ping
 * for the same open session only refreshes the activity stamp; the nudge
 * history of the sitting survives.
 */
export async function openStorySession(db: D1Database, userId: string, track: string, stopId: string, now: number): Promise<void> {
  const row = await db.prepare('SELECT stop_id AS stopId, closed_at AS closedAt FROM story_sessions WHERE user_id = ? AND track_key = ?')
    .bind(userId, track).first<{ stopId: string; closedAt: number | null }>();
  if (row && row.closedAt == null && row.stopId === stopId) {
    await db.prepare('UPDATE story_sessions SET updated_at = ? WHERE user_id = ? AND track_key = ?')
      .bind(now, userId, track).run();
    return;
  }
  await db.prepare(`INSERT INTO story_sessions (user_id, track_key, stop_id, opened_at, updated_at, nudges_sent, last_nudge_at, closed_at)
    VALUES (?, ?, ?, ?, ?, 0, NULL, NULL)
    ON CONFLICT (user_id, track_key) DO UPDATE SET
      stop_id = excluded.stop_id, opened_at = excluded.opened_at, updated_at = excluded.updated_at,
      nudges_sent = 0, last_nudge_at = NULL, closed_at = NULL`)
    .bind(userId, track, stopId, now, now).run();
}

/** Close the track's open session (finish / discard / resume-completion). Idempotent. */
export async function closeStorySession(db: D1Database, userId: string, track: string, now: number): Promise<void> {
  await db.prepare('UPDATE story_sessions SET closed_at = ? WHERE user_id = ? AND track_key = ? AND closed_at IS NULL')
    .bind(now, userId, track).run();
}

interface OpenSessionRow {
  userId: string; track: string; stopId: string;
  openedAt: number; updatedAt: number; nudgesSent: number;
}

/**
 * The call-back sweep: find open sessions that have been away long enough
 * and let the table speak. Runs on the hourly cron; a session qualifies
 * for its first call at ≥5h away, its last call at ≥24h away, and never
 * again after that (or after 7 days from open). A nudge counts only when
 * at least one device actually accepted the push.
 */
export async function runStoryCallbacks(
  db: D1Database, vapid: VapidKeys, now: number, fetchFn: typeof fetch = fetch,
): Promise<{ first: number; last: number }> {
  const out = { first: 0, last: 0 };
  const rows = await db.prepare(`SELECT user_id AS userId, track_key AS track, stop_id AS stopId,
      opened_at AS openedAt, updated_at AS updatedAt, nudges_sent AS nudgesSent
    FROM story_sessions WHERE closed_at IS NULL`)
    .all<OpenSessionRow>();
  for (const row of rows.results) {
    if (row.nudgesSent >= STORY_CALLBACK_MAX_NUDGES) continue;
    if (now - row.openedAt > STORY_CALLBACK_EXPIRE_MS) continue;
    const away = now - row.updatedAt;
    const stage: 1 | 2 | 0 = row.nudgesSent === 0 && away >= STORY_CALLBACK_FIRST_MS ? 1
      : row.nudgesSent === 1 && away >= STORY_CALLBACK_LAST_MS ? 2 : 0;
    if (!stage) continue;
    const payload = storyCallbackPayload(row.stopId, stage);
    if (!payload) continue;
    let sent = 0;
    try {
      sent = await sendPushToUser(db, fetchFn, vapid, row.userId, payload, { ttl: DAY, urgency: 'normal', now });
    } catch { sent = 0; /* pushes never break the sweep */ }
    if (sent <= 0) continue; // toggle off / no live subscription: the call stays pending, budget unspent
    // Conditional on the nudge count we read, so an overlapping run can't double-send.
    const res = await db.prepare(`UPDATE story_sessions SET nudges_sent = ?, last_nudge_at = ?
      WHERE user_id = ? AND track_key = ? AND nudges_sent = ? AND closed_at IS NULL`)
      .bind(stage, now, row.userId, row.track, row.nudgesSent).run();
    if ((res.meta?.changes ?? 0) > 0) { if (stage === 1) out.first++; else out.last++; }
  }
  return out;
}

/** Every stop on the route has a call-back pair (kept honest against the route data). */
export function storyCallbackCoverage(): string[] {
  return STORY_STOPS.filter((s) => !STORY_CALLBACK_LINES[s.id]).map((s) => s.id);
}
