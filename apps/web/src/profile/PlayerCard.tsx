/**
 * The Player Card (owner-approved 2026-10-23, rank-face steering same day):
 * the flippable card that is now the header of every profile. The FRONT is
 * structured as an actual PLAYING CARD FACE for the player's current rank
 * card — true card proportions (5:7), corner rank+suit indices top-left and
 * bottom-right (rotated 180°), a double-line keyline frame, and a field
 * laid out by rank class from the payload alone: number cards get TRUE pip
 * layouts (PIP_LAYOUTS below) around a framed portrait art window, courts
 * get the portrait as the framed figure with a royal tab, the Ace gets one
 * oversized hero pip, the Deuce two hero pips, and the Jokers a full-figure
 * field with JOKER lettered down the edge. The display name + @handle sit
 * on a nameplate band worked into the bottom of the frame, with the
 * showcased badges as medal seals in the band — never UI on the face. The
 * flair that isn't card anatomy (status, partner tags, the story ribbon)
 * renders BELOW the card as profile content, with the Edit card button and
 * the flip hint. The BACK is the scouting report — ratings, record, win%,
 * streak, the Partnership / Cutthroat splits, story stops, member-since,
 * and a head-to-head line when the viewer has met the subject across a
 * table — set as an inset panel inside a patterned card back, in the same
 * card footprint.
 *
 * Polish pass (owner on-device verdict, 2026-10-23): the indices and pips
 * print at real-card scale in classic suit ink (red hearts/diamonds, black
 * clubs/spades — all in playercard.css), and the bottom-right index owns
 * its corner: the corner rules pin every offset so no foreign rule can
 * stretch the box, and the nameplate plaque is inset clear of the corner
 * zones. The crank carries data-two for a two-digit rank (the 10), which
 * the CSS prints condensed, as real decks do.
 *
 * Flip fix + stat table (owner, 2026-10-23): on iOS the flipped card
 * painted the front's children mirrored over the back — WebKit culls
 * per composited layer under preserve-3d, and every layer-forming
 * child of the front kept the default visible backface. The CSS now
 * culls every layer inside a face and makes the settled states
 * deterministic (the turned-away face is visibility:hidden, swapped
 * mid-flip); both faces share one box, so the footprint never changes
 * across the flip. The back's line is a baseball-card stat table:
 * ruled rows for Partnership, Cutthroat and the Career totals in
 * straight tabular columns, honest "No games yet" rows for unplayed
 * modes.
 *
 * Layout pass v4 (owner, 2026-10-23): the status moves UP — with
 * statusPlacement="above" (the profile header passes it) the card's
 * status renders over the card, centered, instead of in the below-card
 * column; the default keeps it below, so the rewards card-up reveal is
 * unchanged. The portrait grows: number-card art windows are sized by
 * pip density (sparse 3/4/5 wide, dense 6/9/10 narrower, tight 7/8
 * shorter — the offset center pips cap their height), the Ace and Deuce
 * windows grow with them, and court figures fill the field keyline to
 * keyline with an ivory backing keeping the corner indices readable.
 *
 * The rank ladder is the owner's: Rep level IS a card — 3♥ up through the
 * suits (hearts the come-up, clubs "you belong", diamonds "bout that
 * life", spades the elite run) to the Deuce of spades at 49, the Little
 * Joker at 50, and the Big Joker at step 51 — a prestige step past the
 * cap, earned at level 50 with every badge earned (latched forever) and
 * displayed only while its seasonal upkeep is active (the payload's
 * bigJoker {earned, active} carries both layers). The server derives it
 * (cred/xp.ts cardRankForLevel) and the payload carries it; this
 * component renders whatever card it's handed — every front is
 * programmatic, no per-rank assets.
 *
 * One component, size-aware via `variant`: 'header' on profile pages today,
 * 'deck' when the Partner Finder (Build 2) deals these into its swipe deck.
 * The data contract is the server's card payload (apps/server cred/card.ts)
 * — self-contained on purpose, so the Finder feeds it unchanged.
 *
 * Data honesty carries over from the versus/profile work: every number is
 * rendered exactly as the payload carries it, and a player with no recorded
 * games gets "No games on record yet" on the back — never a wall of
 * fabricated zeroes dressed up as stats.
 */
import { useState } from 'react';
import { faceOf } from '../avatar';
import { BADGES } from '../badges';
import { TaglineText } from '../tagline';
import './playercard.css';

export type CardBadgeKind = 'achievement' | 'story' | 'badge';
export interface CardBadge { kind: CardBadgeKind; id: string; name: string | null; icon: string | null; earnedAt: number | null }
export interface CardModeSplit { rating: number; games: number; wins: number; losses: number }
/** The rank card, exactly as the server derives it (cred/xp.ts). */
export interface CardRankData {
  level: number;
  /** ladder step 1..51; 51 is the prestige Big Joker step */
  step: number;
  prestige: boolean;
  rank: string;
  rankName: string;
  suit: 'hearts' | 'clubs' | 'diamonds' | 'spades' | null;
  symbol: string;
  tier: string;
  isJoker: boolean;
  isLittleJoker: boolean;
  isBigJoker: boolean;
}
export interface PlayerCardData {
  userId: string;
  name: string;
  avatar: string | null;
  avatarUpdatedAt: number | null;
  memberSince: number;
  level: { level: number; title: string };
  rank: CardRankData;
  /** Big Joker two-layer status: the latched feat + the seasonal crown */
  bigJoker: { earned: boolean; active: boolean };
  status: string | null;
  tags: string[];
  showcase: CardBadge[];
  badges: CardBadge[];
  story: { stopsCleared: number; stopsTotal: number; completed: boolean };
  stats: {
    games: number; wins: number; losses: number;
    winPct: number | null; streak: number; bestStreak: number;
    team: CardModeSplit; cutthroat: CardModeSplit;
  };
  vsViewer?: { games: number; wins: number; losses: number };
}

/** Partner tags: the server's closed vocabulary, display labels here. */
export const PARTNER_TAG_LABELS: Record<string, string> = {
  'story-coop': 'Story Co-op',
  competitive: 'Competitive',
  casual: 'Casual',
  'big-bank': 'Big Bank',
  'nil-hunter': 'Nil Hunter',
  'boston-runner': 'Boston Runner',
};
export const PARTNER_TAG_IDS = Object.keys(PARTNER_TAG_LABELS);

export const badgeKeyOf = (b: { kind: CardBadgeKind; id: string }): string => `${b.kind}:${b.id}`;

/** Display name/glyph for a badge summary: the server's name wins, then the
 *  local badge catalog (the same fallback the profile's badge chips use),
 *  then a per-kind medal. */
export function badgeDisplay(b: CardBadge): { name: string; icon: string } {
  return {
    name: b.name ?? BADGES[b.id]?.name ?? b.id,
    icon: b.icon ?? BADGES[b.id]?.icon ?? (b.kind === 'achievement' ? '🏅' : '🎖️'),
  };
}

const monthYear = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/* ------------------------------------------------------------ pip layouts */

/** One pip in the field: x/y are % of the field box; `inv` = the pip is
 *  rotated 180°, as classic decks print the lower half. */
export interface PipPos { x: number; y: number; inv?: boolean }

/**
 * The classic pip geometry for the number ranks, in field coordinates.
 * Columns at 15 / 50 / 85. The portrait art window owns the field's center,
 * so a classic pip that would land dead-center (the 3's, 5's and 9's middle
 * pip) is NOT in the map — the window takes that spot; every other pip
 * holds its classic position around it (the 7's, 8's and 10's offset center
 * pips sit above/below the window and stay). Lower-half pips (y > 50) are
 * inverted; the y = 50 row of the 6/7/8 stands upright, as printed.
 */
export const PIP_LAYOUTS: Record<string, PipPos[]> = {
  '2': [{ x: 50, y: 10 }, { x: 50, y: 90, inv: true }],
  '3': [{ x: 50, y: 8 }, { x: 50, y: 92, inv: true }],
  '4': [{ x: 15, y: 10 }, { x: 85, y: 10 }, { x: 15, y: 90, inv: true }, { x: 85, y: 90, inv: true }],
  '5': [{ x: 15, y: 10 }, { x: 85, y: 10 }, { x: 15, y: 90, inv: true }, { x: 85, y: 90, inv: true }],
  '6': [
    { x: 15, y: 10 }, { x: 85, y: 10 }, { x: 15, y: 50 }, { x: 85, y: 50 },
    { x: 15, y: 90, inv: true }, { x: 85, y: 90, inv: true },
  ],
  '7': [
    { x: 15, y: 10 }, { x: 85, y: 10 }, { x: 50, y: 26 }, { x: 15, y: 50 }, { x: 85, y: 50 },
    { x: 15, y: 90, inv: true }, { x: 85, y: 90, inv: true },
  ],
  '8': [
    { x: 15, y: 10 }, { x: 85, y: 10 }, { x: 50, y: 26 }, { x: 15, y: 50 }, { x: 85, y: 50 },
    { x: 50, y: 74, inv: true }, { x: 15, y: 90, inv: true }, { x: 85, y: 90, inv: true },
  ],
  '9': [
    { x: 15, y: 8 }, { x: 85, y: 8 }, { x: 15, y: 36 }, { x: 85, y: 36 },
    { x: 15, y: 64, inv: true }, { x: 85, y: 64, inv: true }, { x: 15, y: 92, inv: true }, { x: 85, y: 92, inv: true },
  ],
  '10': [
    { x: 15, y: 8 }, { x: 85, y: 8 }, { x: 50, y: 22 }, { x: 15, y: 36 }, { x: 85, y: 36 },
    { x: 15, y: 64, inv: true }, { x: 85, y: 64, inv: true }, { x: 50, y: 78, inv: true },
    { x: 15, y: 92, inv: true }, { x: 85, y: 92, inv: true },
  ],
};

/** Royal tabs for the court frames: the knight for the Jack (the jack was
 *  the knave/knight of the old courts), the queen, the king. */
const ROYAL_TAB: Record<string, string> = { J: '♞', Q: '♛', K: '♚' };

/** The framed rectangular art window: the player's picture as card art, or
 *  their initial set as a printed letter when they have no picture. */
function ArtWindow({ pic, name, cls }: { pic: string | null; name: string; cls: string }) {
  const face = faceOf(pic, name);
  return (
    <div className={`pcard-artwin ${cls}`} aria-hidden>
      {face.kind === 'pic'
        ? <img src={face.src} alt="" />
        : <span className="pcard-artletter">{face.letter}</span>}
    </div>
  );
}

/** The WIN % column speaks ONE precision (owner, 2026-10-23): every
 *  value in it — mode rows and the career line alike — renders with
 *  exactly one decimal (33.3%, 38.8%, 64.0%), the way a real card back
 *  prints it. Mode rows compute theirs from wins/games; the career row
 *  runs the payload's winPct through this same formatter, so the
 *  column can never mix whole numbers and decimals again (the owner's
 *  flip showed Partnership "33%" beside Career "38.8%"). */
function winPctText(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

/** One mode's row in the back's stat table (baseball-card layout, owner
 *  2026-10-23): rating, W–L, win% and games in straight columns, all
 *  from the real payload — the mode's win% is its own wins/games, the
 *  same arithmetic the career line's payload winPct carries. A mode
 *  with no games reads as an honest "No games yet"; its seeded rating
 *  never prints as if it were earned. */
function ModeRow({ label, split, testid }: { label: string; split: CardModeSplit; testid: string }) {
  if (split.games === 0) {
    return (
      <tr data-testid={testid}>
        <th scope="row">{label}</th>
        <td className="pcard-nogames-cell" colSpan={4}>No games yet</td>
      </tr>
    );
  }
  return (
    <tr data-testid={testid}>
      <th scope="row">{label}</th>
      <td>{split.rating}</td>
      <td>{split.wins}–{split.losses}</td>
      <td>{winPctText((split.wins / split.games) * 100)}</td>
      <td>{split.games}</td>
    </tr>
  );
}

export function PlayerCard({ data, pic, variant = 'header', champion, self, onEditCard, statusPlacement = 'below' }: {
  data: PlayerCardData;
  /** resolved avatar picture (the profile's cache-aware resolution wins
   *  over the payload's copy); omit to use the payload's avatar */
  pic?: string | null;
  variant?: 'header' | 'deck';
  /** tournament champion count, shown as a 🏆 chip by the name (profile
   *  surfaces carry it on the social payload) */
  champion?: number;
  self?: boolean;
  /** own card only: opens the card editor (status / tags / showcase) */
  onEditCard?: () => void;
  /** where the card's status line renders (owner, 2026-10-23): 'above'
   *  the card in the profile header, front and center; 'below' in the
   *  below-card column (the default — the rewards reveal keeps it). The
   *  status renders in exactly one of the two places, never both. */
  statusPlacement?: 'above' | 'below';
}) {
  const [flipped, setFlipped] = useState(false);
  const shownPic = pic !== undefined ? pic : data.avatar;
  const s = data.stats;
  const flip = () => setFlipped((f) => !f);

  /* The front is a playing-card face for the rank card the payload carries.
   * Treatment is data-driven from {rank, suit, symbol} alone — no per-rank
   * assets: number cards lay their pips out classically around the portrait
   * window; courts frame the portrait as the figure under a royal tab; the
   * Ace rides one oversized hero pip; the Deuce stacks two; the Jokers go
   * full-figure with JOKER lettered down the edge (the Big Joker — the
   * rarest front of all — in black and gold, the Little in violet). */
  const r = data.rank;
  const isCourt = ['J', 'Q', 'K'].includes(r.rank);
  const isDeuce = r.rank === '2' && !r.isJoker;
  const treatment = r.isBigJoker ? 'big-joker' : r.isLittleJoker ? 'little-joker' : isDeuce ? 'deuce' : isCourt ? 'court' : r.rank === 'A' ? 'ace' : 'number';
  const cornerRank = r.isJoker ? '★' : r.rank;
  const cornerSuit = r.isJoker ? 'JOKER' : r.symbol;

  /* The number window's size group, from the pip geometry around it:
   * sparse ranks (3/4/5) have open centers and take the wide window;
   * dense ranks (6/9/10) are fenced by the mid/side rows and narrow;
   * tight ranks (7/8) carry offset center pips that cap the height. */
  const numGroup = ['3', '4', '5'].includes(r.rank) ? 'sparse' : (r.rank === '7' || r.rank === '8') ? 'tight' : 'dense';

  const field = r.isJoker ? (
    <div className="pcard-field" data-field="joker">
      <span className="pcard-jokerword" aria-hidden>JOKER</span>
      <ArtWindow pic={shownPic} name={data.name} cls="joker" />
    </div>
  ) : isCourt ? (
    <div className="pcard-field" data-field="court">
      <ArtWindow pic={shownPic} name={data.name} cls="court" />
      <span className="pcard-royaltab" aria-hidden>{ROYAL_TAB[r.rank]}</span>
    </div>
  ) : r.rank === 'A' ? (
    <div className="pcard-field" data-field="ace">
      <span className="pcard-heropip" aria-hidden>{r.symbol}</span>
      <ArtWindow pic={shownPic} name={data.name} cls="ace" />
    </div>
  ) : isDeuce ? (
    <div className="pcard-field" data-field="deuce">
      <span className="pcard-heropip top" aria-hidden>{r.symbol}</span>
      <span className="pcard-heropip bot" aria-hidden>{r.symbol}</span>
      <ArtWindow pic={shownPic} name={data.name} cls="deuce" />
    </div>
  ) : (
    <div className="pcard-field" data-field="number">
      {(PIP_LAYOUTS[r.rank] ?? []).map((p, i) => (
        <span key={i} className="pcard-pipdot" data-inv={p.inv ? '1' : undefined}
          style={{ left: `${p.x}%`, top: `${p.y}%` }} aria-hidden>{r.symbol}</span>
      ))}
      <ArtWindow pic={shownPic} name={data.name} cls={`number ${numGroup}`} />
    </div>
  );

  return (
    <div className="pcard-wrap" data-variant={variant}>
      {statusPlacement === 'above' && data.status && (
        <div className="pcard-above" data-testid="pcard-status-top">
          <TaglineText text={data.status} className="pcard-status" />
        </div>
      )}
      <div className="pcard plcard" data-testid="player-card" data-variant={variant}
        data-suit={r.suit ?? 'joker'} data-treatment={treatment}
        onClick={flip}
        role="group" aria-label={`Player card for ${data.name} — ${r.rankName} — tap to flip`}>
        <div className={`pcard-inner${flipped ? ' flipped' : ''}`}>
          {/* ------------------------------------------------------ FRONT */}
          <section className="pcard-face pcard-front" aria-hidden={flipped} data-testid="pcard-front">
            <div className="pcard-corner tl" aria-hidden>
              <span className="pcard-crank" data-two={cornerRank.length > 1 ? '1' : undefined}>{cornerRank}</span>
              <span className="pcard-csuit">{cornerSuit}</span>
            </div>
            <div className="pcard-corner br" aria-hidden>
              <span className="pcard-crank" data-two={cornerRank.length > 1 ? '1' : undefined}>{cornerRank}</span>
              <span className="pcard-csuit">{cornerSuit}</span>
            </div>

            {field}

            <div className="pcard-plate">
              <div className="pcard-plate-id">
                <h3 className="pcard-name" data-testid="pcard-name">
                  {data.name}
                  {champion !== undefined && champion > 0 && <span className="soc-champ" title="Tournament champion">🏆×{champion}</span>}
                </h3>
                <p className="pcard-handle">@{data.name}</p>
              </div>
              {data.showcase.length > 0 && (
                <div className="pcard-seals" data-testid="pcard-showcase">
                  {data.showcase.slice(0, 3).map((b) => {
                    const d = badgeDisplay(b);
                    return <span key={badgeKeyOf(b)} className="pcard-seal" title={d.name} role="img" aria-label={d.name}>{d.icon}</span>;
                  })}
                </div>
              )}
            </div>
          </section>

          {/* ------------------------------------------------------- BACK */}
          <section className="pcard-face pcard-back" aria-hidden={!flipped} data-testid="pcard-back">
            <div className="pcard-back-panel">
              <div className="pcard-back-head">
                <b>{data.name}</b><span>career line</span>
              </div>
              {s.games > 0 ? (
                <>
                  <table className="pcard-stats" data-testid="pcard-stats">
                    {/* The colgroup carries the fit contract (back fit
                        pass): under the sheet's table-layout: fixed these
                        five classed columns split the panel's content box
                        by rule — content can never widen the table past
                        its frame at any card size. The widths live in
                        playercard.css beside the layout rule. */}
                    <colgroup>
                      <col className="pcard-col-mode" />
                      <col className="pcard-col-rating" />
                      <col className="pcard-col-wl" />
                      <col className="pcard-col-winpct" />
                      <col className="pcard-col-games" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">Mode</th><th scope="col">Rating</th><th scope="col">W–L</th><th scope="col">Win %</th><th scope="col">Games</th>
                      </tr>
                    </thead>
                    <tbody>
                      <ModeRow label="Partnership" split={s.team} testid="pcard-row-partnership" />
                      <ModeRow label="Cutthroat" split={s.cutthroat} testid="pcard-row-cutthroat" />
                      <tr className="totals" data-testid="pcard-row-career">
                        <th scope="row">Career</th>
                        <td>—</td>
                        <td>{s.wins}–{s.losses}</td>
                        <td>{s.winPct === null ? '—' : winPctText(s.winPct)}</td>
                        <td>{s.games}</td>
                      </tr>
                      <tr className="streakrow" data-testid="pcard-row-streak">
                        <th scope="row">Streak</th>
                        <td colSpan={4}>{s.streak > 0 ? `W${s.streak}` : '—'}{s.bestStreak > 1 ? ` · best W${s.bestStreak}` : ''}</td>
                      </tr>
                    </tbody>
                  </table>
                  {data.vsViewer && (
                    <p className="pcard-vs" data-testid="pcard-vs">
                      You vs {data.name}: <b>{data.vsViewer.wins}–{data.vsViewer.losses}</b> in {data.vsViewer.games} game{data.vsViewer.games === 1 ? '' : 's'}
                    </p>
                  )}
                </>
              ) : (
                <p className="pcard-nogames" data-testid="pcard-nogames">No games on record yet</p>
              )}
              <p className="pcard-back-story">
                Story — {data.story.stopsCleared} of {data.story.stopsTotal} stops cleared{data.story.completed && ' · route complete 👑'}
              </p>
              <p className="pcard-since">Member since {monthYear(data.memberSince)}</p>
            </div>
          </section>
        </div>
      </div>

      {/* --------------------------------------- below the card (profile) */}
      <div className="pcard-below">
        {statusPlacement === 'below' && data.status && <TaglineText text={data.status} className="pcard-status" />}

        {data.tags.length > 0 && (
          <div className="pcard-tags" data-testid="pcard-tags">
            {data.tags.map((t) => <span key={t} className="pcard-tag">{PARTNER_TAG_LABELS[t] ?? t}</span>)}
          </div>
        )}

        <p className="pcard-ribbon" data-testid="pcard-ribbon">
          🎗 Story — {data.story.stopsCleared} of {data.story.stopsTotal} stops cleared
          {data.story.completed && <> · <b>Route complete 👑</b></>}
        </p>

        {data.bigJoker.earned && !data.bigJoker.active && (
          <p className="pcard-upkeep" data-testid="pcard-upkeep">Big Joker earned 👑 — season upkeep due</p>
        )}

        <div className="pcard-actions">
          {self && onEditCard && (
            <button type="button" className="pcard-edit" data-testid="card-edit" onClick={onEditCard}>
              ✏ Edit card
            </button>
          )}
          <button type="button" className="pcard-flipbtn" data-testid="pcard-flip" onClick={flip}>
            {flipped ? 'See front ⇋' : 'See stats ⇋'}
          </button>
        </div>
      </div>
    </div>
  );
}
