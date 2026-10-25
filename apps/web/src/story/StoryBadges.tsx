/**
 * Story badges (owner, 2026-10-21): the collection strip — earned badges
 * lit, the rest grayed as the visible remainder, with the count. Tap any
 * badge for its explanation in a detail sheet over the screen (owner,
 * 2026-10-25: the outro's tiles became doors like the deck card): what
 * it's for, and either how it was earned (from the stored facts) or the
 * fair hint for unlocking it. Used on the map (browse), on the win
 * moment (outro), where the badges this win just unlocked arrive
 * highlighted as NEW, and on the player's own profile.
 */
import { useState, type CSSProperties } from 'react';
import { storyBadgesFor, type StoryBadgeFacts } from '@spades/bots';
import { StoryDetailSheet } from './StoryDetailSheet';

export function badgeFactsOf(p: { stops: { stopId: string; attempts: number; clears: number }[]; finds?: { eggs: string[]; feats: string[] }; completed: boolean; anyTrack?: { stops: { stopId: string; attempts: number; clears: number }[]; finds: { eggs: string[]; feats: string[] }; completed: boolean } } | null): StoryBadgeFacts {
  if (!p) return { stops: [], finds: { eggs: [], feats: [] }, completed: false };
  // Union with the all-tracks summary (Phase 4, spec §3.9): the badge
  // collection is the PERSON's — a clear on any track (solo or any pair
  // run) earns, finds union, completion on any track completes. The
  // summary already includes this payload's own track, so per-stop the
  // merge is a max; a solo-only player's union equals their solo facts
  // exactly, and their badges render unchanged.
  const any = p.anyTrack;
  if (!any) return { stops: p.stops, finds: p.finds ?? { eggs: [], feats: [] }, completed: p.completed };
  const anyByStop = new Map(any.stops.map((s) => [s.stopId, s]));
  const stops = p.stops.map((s) => {
    const a = anyByStop.get(s.stopId);
    return a ? { stopId: s.stopId, attempts: Math.max(s.attempts, a.attempts), clears: Math.max(s.clears, a.clears) } : s;
  });
  for (const a of any.stops) if (!stops.some((s) => s.stopId === a.stopId)) stops.push(a);
  const union = (own: string[] | undefined, extra: string[]) => [...new Set([...(own ?? []), ...extra])];
  return {
    stops,
    finds: { eggs: union(p.finds?.eggs, any.finds.eggs), feats: union(p.finds?.feats, any.finds.feats) },
    completed: p.completed || any.completed,
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
        <StoryDetailSheet
          label={`${selected.name} badge`}
          testid="story-badge-detail"
          kicker={selected.earned ? 'Badge · earned' : 'Badge · locked'}
          glyph={selected.icon}
          title={selected.name}
          ghost={!selected.earned}
          onClose={() => setOpen(null)}
        >
          <p className="story-badge-detail-about">{selected.about}</p>
          <p className="story-badge-detail-how">{selected.earned ? (selected.detail ?? 'Earned.') : `To unlock: ${selected.hint}`}</p>
        </StoryDetailSheet>
      )}
    </section>
  );
}
