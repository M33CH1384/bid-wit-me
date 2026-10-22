/**
 * Story badges (owner, 2026-10-21): the collection strip — earned badges
 * lit, the rest grayed as the visible remainder, with the count. Tap any
 * badge for its explanation: what it's for, and either how it was earned
 * (from the stored facts) or the fair hint for unlocking it. Used on the
 * map (browse) and on the win moment (outro), where the badges this win
 * just unlocked arrive highlighted as NEW.
 */
import { useState, type CSSProperties } from 'react';
import { storyBadgesFor, type StoryBadgeFacts } from '@spades/bots';

export function badgeFactsOf(p: { stops: { stopId: string; attempts: number; clears: number }[]; finds?: { eggs: string[]; feats: string[] }; completed: boolean } | null): StoryBadgeFacts {
  return {
    stops: p?.stops ?? [],
    finds: p?.finds ?? { eggs: [], feats: [] },
    completed: p?.completed ?? false,
  };
}

export default function StoryBadges({ facts, highlight, title, celebrate }: {
  facts: StoryBadgeFacts;
  /** badge ids unlocked by the win being celebrated (outro) */
  highlight?: ReadonlySet<string>;
  title?: string;
  /** outro only: the case reveals tile by tile and just-earned medals
   *  shine — the map browses the same case at rest, no motion */
  celebrate?: boolean;
}) {
  const badges = storyBadgesFor(facts);
  const earned = badges.filter((b) => b.earned).length;
  const [open, setOpen] = useState<string | null>(null);
  const selected = badges.find((b) => b.id === open) ?? null;
  return (
    <section className={`story-badges${celebrate ? ' celebrate' : ''}`} data-testid="story-badges" aria-label="Story badges">
      <p className="story-badges-head">
        <span className="story-badges-title">{title ?? 'Story badges'}</span>
        <span className="story-badges-count" data-testid="story-badges-count">{earned} of {badges.length}</span>
      </p>
      <div className="story-badges-row">
        {badges.map((b, i) => (
          <button
            type="button" key={b.id}
            className={`story-badge${b.earned ? ' earned' : ' locked'}${highlight?.has(b.id) ? ' new' : ''}${open === b.id ? ' open' : ''}`}
            data-testid={`story-badge-${b.id}`}
            data-earned={b.earned ? 'true' : 'false'}
            onClick={() => setOpen(open === b.id ? null : b.id)}
            aria-label={`${b.name}${b.earned ? ' (earned)' : ''}`}
            style={celebrate ? ({ ['--i' as string]: i } as CSSProperties) : undefined}
          >
            {/* The medallion (rewards presentation, owner 2026-10-21):
                one designed medal per badge — gold ring + dark disc +
                the badge's glyph — in every state, so the strip reads
                as a trophy case: earned medals lit, the rest the same
                medal ghosted, still to hunt. The glyph is the badge
                def's own icon; the medal is pure CSS (story.css). */}
            <span className="story-medal" aria-hidden><span className="story-medal-glyph">{b.icon}</span></span>
            <span className="story-badge-name">{b.name}</span>
            {highlight?.has(b.id) && <span className="story-badge-new">NEW</span>}
          </button>
        ))}
      </div>
      {selected && (
        <div className="story-badge-detail" data-testid="story-badge-detail">
          <p className="story-badge-detail-name">{selected.icon} {selected.name}</p>
          <p className="story-badge-detail-about">{selected.about}</p>
          <p className="story-badge-detail-how">{selected.earned ? (selected.detail ?? 'Earned.') : `To unlock: ${selected.hint}`}</p>
        </div>
      )}
    </section>
  );
}
