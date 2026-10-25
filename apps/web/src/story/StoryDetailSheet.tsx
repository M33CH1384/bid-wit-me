/**
 * Outro detail sheets (owner, 2026-10-25: "These should be tap able as
 * well") — the deck card became a door into the DeckViewer; the rest of
 * the outro's unlock stack gets the same treatment. One sheet shell in
 * the story register, the DeckViewer's overlay discipline exactly: a
 * fixed backdrop, tap-outside / ✕ / Done / Escape all close, and the
 * sheet holds no state of its own — closing returns to the exact screen
 * (outro, map, profile) the player came from, untouched.
 *
 * REAL DATA ONLY: every line a sheet shows comes from the game's own
 * definitions — the egg's tale and the feat's featText (STORY_SECRETS),
 * the set animation's name and blurb (setAnims), the badge's
 * about/hint/detail (storyBadges). Nothing is dressed up here; a find
 * whose id resolves to no definition shows the card's own fallback line.
 */
import { useState, type ReactNode } from 'react';
import { STORY_SECRETS, storyEggById, type StoryBadge } from '@spades/bots';
import { setAnimForStop } from '../setAnims';
import { useReduceEffects } from '../fx';
import { useEscapeClose } from '../useEscapeClose';
import { SetCover } from '../animfx/SetCover';
import { BadgeMedal3D } from './BadgeMedal3D';
import type { StoryNewFind } from './storyApi';

export function StoryDetailSheet({ label, kicker, glyph, title, ghost, hero, onClose, testid, children }: {
  /** accessible name for the dialog */
  label: string;
  /** the small gold line over the title (the item's kind / state) */
  kicker?: string;
  /** the medallion glyph (the item's own, from its definition) */
  glyph: ReactNode;
  title: string;
  /** render the medallion ghosted (a locked badge's silhouette) */
  ghost?: boolean;
  /** a hero presentation that takes the top of the sheet (the badge's
   *  3D medallion): the titles then sit centered beneath it instead of
   *  beside the small emblem in the header row */
  hero?: ReactNode;
  onClose: () => void;
  testid?: string;
  children: ReactNode;
}) {
  const sheetRef = useEscapeClose(onClose);
  return (
    <div className="modal-backdrop story-detail-backdrop" ref={sheetRef}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className={`story-detail-sheet${ghost ? ' ghost' : ''}${hero ? ' has-hero' : ''}`} role="dialog" aria-modal="true"
        aria-label={label} data-testid={testid}>
        {hero ? (
          <>
            <button type="button" className="story-detail-close story-detail-close-float" data-testid="story-detail-close"
              aria-label="Close details" onClick={onClose}>✕</button>
            <div className="story-detail-hero">{hero}</div>
            <div className="story-detail-titles story-detail-titles-hero">
              {kicker && <p className="story-detail-kicker">{kicker}</p>}
              <h3 className="story-detail-title">{title}</h3>
            </div>
          </>
        ) : (
          <header className="story-detail-head">
            <span className="story-medal emblem" aria-hidden><span className="story-medal-glyph">{glyph}</span></span>
            <div className="story-detail-titles">
              {kicker && <p className="story-detail-kicker">{kicker}</p>}
              <h3 className="story-detail-title">{title}</h3>
            </div>
            <button type="button" className="story-detail-close" data-testid="story-detail-close"
              aria-label="Close details" onClick={onClose}>✕</button>
          </header>
        )}
        <div className="story-detail-body">{children}</div>
        <footer className="story-detail-foot">
          <button type="button" className="btn primary story-detail-done" data-testid="story-detail-done" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
}

/** The set animation's blurb carries both tiers in one authored string —
 *  the regular moment, then "Finale: …". The split is presentational
 *  only; the words are the definition's own, verbatim. */
export function splitSetAnimBlurb(blurb: string): { regular: string; finale: string | null } {
  const i = blurb.indexOf('Finale:');
  if (i < 0) return { regular: blurb, finale: null };
  return { regular: blurb.slice(0, i).trim(), finale: blurb.slice(i + 'Finale:'.length).trim() };
}

/**
 * The set-animation detail: the name, the two tiers' own descriptions,
 * and a LIVE preview — the recap's own SetCover engine mounted fresh in
 * a stage per tier, playing the animation exactly as a recap card wears
 * it (reduced effects collapse it to the end state, the same bargain).
 * No finale headline is passed: the headline is keyed to a real game's
 * ending fact, and a preview has none — inventing one would be a lie.
 */
export function SetAnimDetail({ stopId, onClose }: { stopId: string; onClose: () => void }) {
  const def = setAnimForStop(stopId);
  const reduceFx = useReduceEffects();
  const [run, setRun] = useState(0);
  if (!def) return null;
  const { regular, finale } = splitSetAnimBlurb(def.blurb);
  return (
    <StoryDetailSheet label={`${def.name} — set animation`} testid="story-setanim-detail"
      kicker={`Set animation · ${def.stopName}`} glyph="✦" title={def.name} onClose={onClose}>
      <div className="story-setanim-preview">
        <div className="story-setanim-stage" data-testid="story-setanim-stage-regular">
          <SetCover key={`regular-${run}`} animId={def.stopId} tier="regular" mode="fresh" reduced={reduceFx} side={0} />
          <span className="story-setanim-stage-tag">The set</span>
        </div>
        <div className="story-setanim-stage" data-testid="story-setanim-stage-finale">
          <SetCover key={`finale-${run}`} animId={def.stopId} tier="finale" mode="fresh" reduced={reduceFx} side={1} />
          <span className="story-setanim-stage-tag">The finale</span>
        </div>
      </div>
      <button type="button" className="btn ghost story-setanim-replay" data-testid="story-setanim-replay"
        onClick={() => setRun((n) => n + 1)}>↻ Replay</button>
      <p className="story-detail-line"><b>The set:</b> {regular}</p>
      {finale && <p className="story-detail-line"><b>The finale:</b> {finale}</p>}
    </StoryDetailSheet>
  );
}

/**
 * A badge's detail — the medallion itself, presented as the physical
 * coin it is (owner, 2026-10-25: "I really want the badges to be 3d
 * items that take precent in the modal"). The 3D medallion takes the
 * top of the sheet as its hero; the badge's own words (about, and how
 * it was earned or the hint that unlocks it) sit beneath it, verbatim
 * from the definition — the same lines the sheet has always shown.
 */
export function BadgeDetail({ badge, onClose }: { badge: StoryBadge; onClose: () => void }) {
  const reduceFx = useReduceEffects();
  let osReduced = false;
  try { osReduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { /* no OS signal */ }
  return (
    <StoryDetailSheet label={`${badge.name} badge`} testid="story-badge-detail"
      kicker={badge.earned ? 'Badge · earned' : 'Badge · locked'}
      glyph={badge.icon} title={badge.name} ghost={!badge.earned} onClose={onClose}
      hero={<BadgeMedal3D glyph={badge.icon} name={badge.name} earned={badge.earned} still={reduceFx || osReduced} />}>
      <p className="story-badge-detail-about">{badge.about}</p>
      <p className="story-badge-detail-how">{badge.earned ? (badge.detail ?? 'Earned.') : `To unlock: ${badge.hint}`}</p>
    </StoryDetailSheet>
  );
}

/**
 * A find's detail — an egg tells its tale (the authored telling the map
 * card shows once found), a feat names what was done (the authored
 * featText the map card chases with). The title is the payload's name,
 * the same one the card printed.
 */
export function FindDetail({ find, onClose }: { find: StoryNewFind; onClose: () => void }) {
  const egg = find.kind === 'egg' ? storyEggById(find.id) : undefined;
  const unlockable = find.kind === 'feat'
    ? Object.values(STORY_SECRETS).map((s) => s.unlockable).find((u) => u.itemId === find.id)
    : undefined;
  const body = find.kind === 'egg' ? egg?.egg.tale : unlockable?.featText;
  return (
    <StoryDetailSheet label={`${find.name} — ${find.kind === 'egg' ? 'hidden egg' : 'feat collectible'}`}
      testid="story-find-detail"
      kicker={find.kind === 'egg' ? 'Hidden egg · found' : 'Feat collectible · unlocked'}
      glyph={find.kind === 'egg' ? '🥚' : '🏆'} title={find.name} onClose={onClose}>
      <p className="story-detail-line">{body ?? (find.kind === 'egg'
        ? 'Hidden egg — recorded on this stop’s map card.'
        : 'Feat collectible — recorded on this stop’s map card.')}</p>
    </StoryDetailSheet>
  );
}
