-- Release 13: Web Push notifications (VAPID).
-- Subscriptions are per-device; prefs are per-user per-type (opt-out, default on).
-- Cooldowns keep turn/friend-online/season pushes from spamming.

CREATE TABLE push_subscriptions(
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,                  -- base64url, 65-byte uncompressed P-256 key
  auth TEXT NOT NULL,                    -- base64url, 16-byte auth secret
  ua TEXT,                               -- user-agent snapshot at subscribe time (debugging)
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_push_subs_user ON push_subscriptions(user_id);

CREATE TABLE push_prefs(
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,                    -- turn|invite|friend_online|achievement|daily|rankup|challenge|season
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, type)
);

CREATE TABLE push_cooldowns(
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  last_sent INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, key)
);

-- Offline game invites: created when the invitee has no live socket; delivered as a
-- live toast when they come online (and immediately via push). The client joins by code.
CREATE TABLE offline_invites(
  id TEXT PRIMARY KEY,
  from_uid TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_uid TEXT NOT NULL,
  code TEXT NOT NULL,
  mode TEXT,
  seat INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_offline_invites_to ON offline_invites(to_uid, expires_at);
