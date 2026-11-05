-- 0037: BWM Central Phase 3 — crew membership lifecycle.
-- 0036 created crew_members without a status column; crew invites need to
-- distinguish a pending invitation from a seated member. Existing rows
-- (and every pre-0037 insert) default to 'active': anyone already in a
-- crew is a member, never retroactively an invitee. Values: 'invited'
-- (invited by an active member, has not answered) | 'active'.
ALTER TABLE crew_members ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
