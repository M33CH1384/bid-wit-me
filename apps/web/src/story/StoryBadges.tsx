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
import { storyBadgesFor, type StoryBadge, type StoryBadgeFacts } from '@spades/bots';
import { BadgeDetail } from './StoryDetailSheet';

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

/** Newest-first earned order. Progress facts carry no earned-at stamp
 *  (story-badges spec: fall back to the defs' order reversed); a win's
 *  just-unlocked badges (highlight) lead when given. */
export function newestEarned(badges: StoryBadge[], highlight?: ReadonlySet<string>): StoryBadge[] {
  const rev = badges.filter((b) => b.earned).reverse();
  if (!highlight?.size) return rev;
  return [...rev.filter((b) => highlight.has(b.id)), ...rev.filter((b) => !highlight.has(b.id))];
}

function Medal({ b }: { b: StoryBadge }) {
  return <span className="story-medal" aria-hidden><span className="story-medal-glyph">{b.icon}</span></span>;
}

/** The map's compact strip (spec §1): title + count + progress, the last
 *  three earned medals, and "See all" for the full collection sheet. */
function BadgeStrip({ facts, highlight }: { facts: StoryBadgeFacts; highlight?: ReadonlySet<string> }) {
  const badges = storyBadgesFor(facts);
  const earned = badges.filter((b) => b.earned).length;
  const [sheet, setSheet] = useState(false);
  const recent = newestEarned(badges, highlight).slice(0, 3);
  return (
    <section className="story-badges strip" data-testid="story-badges" aria-label="Story badges">
      <div className="story-badges-strip-main">
        <p className="story-badges-head">
          <span className="story-badges-title">Story badges</span>
          <span className="story-badges-count" data-testid="story-badges-count">{earned} of {badges.length}</span>
        </p>
        <span className="story-badges-prog" aria-hidden><i style={{ width: `${(earned / badges.length) * 100}%` }} /></span>
      </div>
      {recent.length > 0 && (
        <span className="story-badges-recent" aria-hidden>
          {recent.map((b) => <span key={b.id} className="story-badges-recent-medal"><Medal b={b} /></span>)}
        </span>
      )}
      <button type="button" className="btn ghost xs story-badges-all" data-testid="story-badges-all" onClick={() => setSheet(true)}>See all</button>
      {sheet && <StoryBadgesSheet facts={facts} highlight={highlight} onClose={() => setSheet(false)} />}
    </section>
  );
}

/** The full collection (spec §2): a full-screen sheet, equal tiles, the
 *  newest earned tagged NEW, an "N to go" remainder tile, a 44px ✕. */
export function StoryBadgesSheet({ facts, highlight, onClose }: { facts: StoryBadgeFacts; highlight?: ReadonlySet<string>; onClose: () => void }) {
  const badges = storyBadgesFor(facts);
  const earned = badges.filter((b) => b.earned).length;
  const [open, setOpen] = useState<string | null>(null);
  const selected = badges.find((b) => b.id === open) ?? null;
  const fresh = highlight?.size ? highlight : new Set(newestEarned(badges).slice(0, 1).map((b) => b.id));
  const locked = badges.filter((b) => !b.earned);
  return (
    <div className="story-badges-sheet" role="dialog" aria-modal="true" aria-label="Story badges" data-testid="story-badges-sheet">
      <div className="sbs-head">
        <div className="sbs-head-main">
          <p className="sbs-title"><b>Story badges</b><span data-testid="story-badges-sheet-count">{earned} of {badges.length}</span></p>
          <span className="story-badges-prog" aria-hidden><i style={{ width: `${(earned / badges.length) * 100}%` }} /></span>
        </div>
        <button type="button" className="icon-btn sbs-x" aria-label="Close" data-testid="story-badges-sheet-close" onClick={onClose}>✕</button>
      </div>
      <p className="sbs-hint">Tap a badge for the story behind it. Locked badges show how to earn them.</p>
      <div className="story-badges-row">
        {badges.map((b, i) => (
          <button
            type="button" key={b.id}
            className={`story-badge${b.earned ? ' earned' : ' locked'}${b.earned && fresh.has(b.id) ? ' new' : ''}`}
            data-testid={`story-badge-${b.id}`}
            data-earned={b.earned ? 'true' : 'false'}
            onClick={() => setOpen(b.id)}
            aria-label={`${b.name}${b.earned ? ' (earned)' : ''}`}
            style={{ ['--i' as string]: i } as CSSProperties}
          >
            <Medal b={b} />
            <span className="story-badge-name">{b.name}</span>
            <span className="story-badge-line">{b.earned ? 'Earned ✓' : b.hint}</span>
            {!b.earned && <span className="story-badge-lock" aria-hidden>🔒</span>}
            {b.earned && fresh.has(b.id) && <span className="story-badge-new">NEW</span>}
          </button>
        ))}
        {locked.length > 0 && (
          <div className="story-badge remainder" data-testid="story-badges-remainder">
            <b>{locked.length} to go</b>
            <span className="story-badge-line">Next up: {locked[0]!.name}</span>
          </div>
        )}
      </div>
      {selected && <BadgeDetail badge={selected} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** A win's new badge(s) (spec §3): one big medal per badge, in sequence. */
export function StoryBadgeReveal({ facts, fresh }: { facts: StoryBadgeFacts; fresh: ReadonlySet<string> }) {
  const badges = storyBadgesFor(facts);
  const list = badges.filter((b) => fresh.has(b.id));
  const earned = badges.filter((b) => b.earned).length;
  const [at, setAt] = useState(0);
  const [sheet, setSheet] = useState(false);
  if (list.length === 0 || at >= list.length) return null;
  const b = list[at]!;
  return (
    <section className="story-badge-reveal" data-testid="story-badge-reveal" aria-label="New badge">
      <span className="sbr-medal"><Medal b={b} /></span>
      <p className="sbr-kicker">New badge</p>
      <p className="sbr-name">{b.name}</p>
      <p className="sbr-about">{b.about}</p>
      <span className="sbr-chip">{earned} of {badges.length} earned</span>
      {list.length > 1 && <span className="sbr-dots" aria-hidden>{list.map((x, j) => <i key={x.id} className={j === at ? 'on' : ''} />)}</span>}
      <button type="button" className="primary big sbr-nice" data-testid="story-badge-reveal-nice" onClick={() => setAt(at + 1)}>Nice</button>
      <button type="button" className="btn ghost sbr-all" data-testid="story-badge-reveal-all" onClick={() => setSheet(true)}>See all badges</button>
      {sheet && <StoryBadgesSheet facts={facts} highlight={fresh} onClose={() => setSheet(false)} />}
    </section>
  );
}

export default function StoryBadges({ facts, highlight, title, celebrate, variant }: {
  facts: StoryBadgeFacts;
  /** 'strip': the map's compact row + full-collection sheet */
  variant?: 'strip';
  /** badge ids unlocked by the win being celebrated (outro) */
  highlight?: ReadonlySet<string>;
  title?: string;
  /** outro only: the case reveals tile by tile and just-earned medals
   *  shine — the map browses the same case at rest, no motion */
  celebrate?: boolean;
}) {
  if (variant === 'strip') return <BadgeStrip facts={facts} highlight={highlight} />;
  return <BadgeCase facts={facts} highlight={highlight} title={title} celebrate={celebrate} />;
}

function BadgeCase({ facts, highlight, title, celebrate }: { facts: StoryBadgeFacts; highlight?: ReadonlySet<string>; title?: string; celebrate?: boolean }) {
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
        <BadgeDetail badge={selected} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}
