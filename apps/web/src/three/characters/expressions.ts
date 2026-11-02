/**
 * Story expression → morph weights (code-driven: the clips carry no morph tracks).
 * There was no `expr` argument on StoryFace / StageFace / storyPortraitFor before this, so nothing is
 * superseded; the 2D side keeps its single neutral portrait. One expression at a time, neutral = 1 at rest.
 */
import { CHARACTER_MORPHS, type CharacterExpression } from './manifest';

/** Full weight vector in CHARACTER_MORPHS order. `k` eases an expression in (0..1). */
export function morphWeights(expr: CharacterExpression, k = 1): number[] {
  const a = Math.min(1, Math.max(0, k));
  return CHARACTER_MORPHS.map((m) => (expr === 'neutral' ? (m === 'neutral' ? 1 : 0) : m === expr ? a : m === 'neutral' ? 1 - a : 0));
}

/** A beat's expression for one figure: the speaker reads the line's punctuation/wording; listeners stay neutral. */
export function expressionForBeat(characterId: string, beat: { speaker: string; line: string } | null | undefined): CharacterExpression {
  if (!beat || beat.speaker !== characterId) return 'neutral';
  const l = beat.line;
  if (/\b(ha(ha)+|lol|hee)\b/i.test(l)) return 'laugh';
  if (/\?!|!\?|\bwhat\b.*[!?]$/i.test(l)) return 'shocked';
  if (/\b(boy|please|watch|nah|never)\b/i.test(l) && /!/.test(l)) return 'angry';
  if (/!$/.test(l.trim())) return 'smile';
  if (/\b(told you|of course|easy|sure)\b/i.test(l)) return 'smug';
  return 'neutral';
}
