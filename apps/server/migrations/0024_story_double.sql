-- Story Mode: the King's double or nothing (owner, 2026-10-21). Beating the
-- final boss once banks nothing: the first win sets double_pending and
-- stores that leg's honestly-computed game facts (double_leg_facts, a JSON
-- StoryGameFacts) so the deciding leg's result can evaluate the King's
-- feat across BOTH legs instead of trusting the last game alone. The mark
-- and the facts live on the stop's story_progress row, so the owner
-- reset-stop tool (which deletes that row) wipes a live double with it.

ALTER TABLE story_progress ADD COLUMN double_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE story_progress ADD COLUMN double_leg_facts TEXT;
