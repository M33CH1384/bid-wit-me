-- 0038: Team rosters (owner, 2026-11-05) — a team name is an owned team:
-- the owner + up to 3 HUMAN partners. team_rosters is the header (one row
-- per (owner, name) the roster system has materialised); its existence is
-- the "seeded" marker, so grandfather seeding from game_players history
-- runs exactly once per roster and an owner who ejects everyone is never
-- re-seeded. team_roster_members carries the human partners; bot partners
-- never appear here (they hold no account and take no spot). No FKs on
-- purpose (the favorite_partners precedent): the read side drops member
-- rows whose account no longer exists. Ejecting deletes a member row only —
-- game_players history, and therefore every team record, is untouched.
CREATE TABLE IF NOT EXISTS team_rosters (
  owner_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, team_name)
);
CREATE TABLE IF NOT EXISTS team_roster_members (
  owner_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  member_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, team_name, member_id)
);
