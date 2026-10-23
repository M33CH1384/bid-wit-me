/**
 * The Player Card (owner-approved 2026-10-23, rank-face steering same day):
 * the flippable card that is now the header of every profile. The FRONT is
 * structured as an actual PLAYING CARD FACE for the player's current rank
 * card — corner rank+suit indices top-left and bottom-right (rotated), the
 * avatar as the card's figure (court treatment for J/Q/K and the summit
 * cards, a portrait medallion with pips for number cards), the name +
 * @handle on the card's nameplate strip, and the flair (status, partner
 * tags, showcased badges, the story-progress ribbon) as a designed band on
 * the card. The BACK is the scouting report — ratings, record, win%,
 * streak, the Partnership / Cutthroat splits, story stops, member-since,
 * and a head-to-head line when the viewer has met the subject across a
 * table.
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
import { AvatarCircle } from '../avatar';
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

function SplitRow({ label, split }: { label: string; split: CardModeSplit }) {
  return (
    <div className="pcard-split">
      <span className="pcard-split-label">{label}</span>
      {split.games > 0
        ? <b>Rating {split.rating} · {split.wins}–{split.losses} <small>this season</small></b>
        : <b className="pcard-split-none">No games yet</b>}
    </div>
  );
}

export function PlayerCard({ data, pic, variant = 'header', champion, self, onEditCard }: {
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
}) {
  const [flipped, setFlipped] = useState(false);
  const shownPic = pic !== undefined ? pic : data.avatar;
  const s = data.stats;
  const flip = () => setFlipped((f) => !f);

  /* The front is a playing-card face for the rank card the payload carries.
   * Treatment is data-driven: court ranks (J/Q/K) and the THREE summit
   * cards (the Deuce, the Little Joker, the Big Joker — the rarest and
   * most distinct front of all) get the framed court figure over a big
   * suit watermark; aces get the watermark too; number cards get a
   * portrait medallion with their pips beneath it. No per-rank assets —
   * every one of the 51 fronts renders from {rank, suit, symbol} alone. */
  const r = data.rank;
  const isCourt = ['J', 'Q', 'K'].includes(r.rank);
  const isDeuce = r.rank === '2' && !r.isJoker;
  const isSummit = isDeuce || r.isJoker;
  const pipCount = /^\d+$/.test(r.rank) && !isDeuce ? Number(r.rank) : 0;
  const treatment = r.isBigJoker ? 'big-joker' : r.isLittleJoker ? 'little-joker' : isDeuce ? 'deuce' : isCourt ? 'court' : r.rank === 'A' ? 'ace' : 'number';
  const cornerRank = r.isJoker ? '★' : r.rank;
  const cornerSuit = r.isJoker ? 'JOKER' : r.symbol;
  const rankGlyph = r.isJoker ? `${r.rankName} ★` : `${r.rank}${r.symbol}`;

  return (
    <div className="pcard" data-testid="player-card" data-variant={variant}
      data-suit={r.suit ?? 'joker'} data-treatment={treatment}
      onClick={flip}
      role="group" aria-label={`Player card for ${data.name} — ${r.rankName} — tap to flip`}>
      <div className={`pcard-inner${flipped ? ' flipped' : ''}`}>
        {/* ------------------------------------------------------ FRONT */}
        <section className="pcard-face pcard-front" aria-hidden={flipped} data-testid="pcard-front">
          <div className="pcard-corner tl" aria-hidden>
            <span className="pcard-crank">{cornerRank}</span>
            <span className="pcard-csuit">{cornerSuit}</span>
          </div>
          <div className="pcard-corner br" aria-hidden>
            <span className="pcard-crank">{cornerRank}</span>
            <span className="pcard-csuit">{cornerSuit}</span>
          </div>

          <div className="pcard-figure">
            {(isCourt || isSummit || r.rank === 'A') && <span className="pcard-watermark" aria-hidden>{r.symbol}</span>}
            <AvatarCircle pic={shownPic} name={data.name} className="pcard-av" />
            {pipCount > 0 && (
              <div className="pcard-pips" aria-hidden>
                {Array.from({ length: pipCount }, (_, i) => <span key={i}>{r.symbol}</span>)}
              </div>
            )}
            {isDeuce && <div className="pcard-pips deuce" aria-hidden><span>{r.symbol}</span><span>{r.symbol}</span></div>}
          </div>

          <div className="pcard-nameplate">
            <div className="pcard-id">
              <h3 className="pcard-name" data-testid="pcard-name">
                {data.name}
                {champion !== undefined && champion > 0 && <span className="soc-champ" title="Tournament champion">🏆×{champion}</span>}
              </h3>
              <p className="pcard-handle">@{data.name}</p>
              <p className="pcard-rankline" data-testid="pcard-level">{rankGlyph} · Level {data.level.level} · {data.level.title}</p>
            </div>
            {self && onEditCard && (
              <button type="button" className="pcard-edit" data-testid="card-edit"
                onClick={(e) => { e.stopPropagation(); onEditCard(); }}>
                ✏ Edit card
              </button>
            )}
          </div>

          <div className="pcard-band">
            {data.status && <TaglineText text={data.status} className="pcard-status" />}

            {data.tags.length > 0 && (
              <div className="pcard-tags" data-testid="pcard-tags">
                {data.tags.map((t) => <span key={t} className="pcard-tag">{PARTNER_TAG_LABELS[t] ?? t}</span>)}
              </div>
            )}

            {data.showcase.length > 0 && (
              <div className="pcard-showcase" data-testid="pcard-showcase">
                {data.showcase.map((b) => {
                  const d = badgeDisplay(b);
                  return <span key={badgeKeyOf(b)} className="pcard-badge" title={d.name}><span aria-hidden>{d.icon}</span> {d.name}</span>;
                })}
              </div>
            )}

            <p className="pcard-ribbon" data-testid="pcard-ribbon">
              🎗 Story — {data.story.stopsCleared} of {data.story.stopsTotal} stops cleared
              {data.story.completed && <> · <b>Route complete 👑</b></>}
            </p>

            {data.bigJoker.earned && !data.bigJoker.active && (
              <p className="pcard-upkeep" data-testid="pcard-upkeep">Big Joker earned 👑 — season upkeep due</p>
            )}

            <button type="button" className="pcard-flipbtn" data-testid="pcard-flip"
              onClick={(e) => { e.stopPropagation(); flip(); }}>
              See stats ⇋
            </button>
          </div>
        </section>

        {/* ------------------------------------------------------- BACK */}
        <section className="pcard-face pcard-back" aria-hidden={!flipped} data-testid="pcard-back">
          <div className="pcard-back-head">
            <b>{data.name}</b><span>career line</span>
          </div>
          {s.games > 0 ? (
            <>
              <div className="pcard-record" data-testid="pcard-record">
                <div><b>{s.wins}–{s.losses}</b><small>record</small></div>
                <div><b>{s.winPct === null ? '—' : `${s.winPct}%`}</b><small>win rate</small></div>
                <div><b>{s.games}</b><small>games</small></div>
                <div><b>{s.streak > 0 ? `W${s.streak}` : '—'}</b><small>streak{s.bestStreak > 1 ? ` · best W${s.bestStreak}` : ''}</small></div>
              </div>
              <SplitRow label="Partnership" split={s.team} />
              <SplitRow label="Cutthroat" split={s.cutthroat} />
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
          <button type="button" className="pcard-flipbtn" data-testid="pcard-flip-back"
            onClick={(e) => { e.stopPropagation(); flip(); }}>
            See front ⇋
          </button>
        </section>
      </div>
    </div>
  );
}
