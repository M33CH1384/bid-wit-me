-- Voice (c): text-only miss queue for the Workers AI line writer (docs/voice-phase2-design.md).
-- Generated lines wait here (never heard until the nightly bake voices them into the catalog).
CREATE TABLE voice_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona TEXT NOT NULL,
  g TEXT NOT NULL,             -- 'f' | 'm'
  bucket TEXT NOT NULL,        -- set1|set2|set3|win|wheelsBid:<bid>:<books>|wheelsUnder:<bid>:<books>
  text TEXT NOT NULL,
  norm TEXT NOT NULL,          -- normalized lowercase text: dedupe key with (persona, g, bucket)
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | baked | rejected
  created_at INTEGER NOT NULL,
  UNIQUE (persona, g, bucket, norm)
);
CREATE INDEX voice_queue_status ON voice_queue (status, bucket);

-- The writer's daily neuron budget (hard stop 8,000/day, free allowance is 10,000, reset 00:00 UTC).
CREATE TABLE voice_writer_budget (
  day TEXT PRIMARY KEY,        -- UTC YYYY-MM-DD
  neurons REAL NOT NULL DEFAULT 0
);
