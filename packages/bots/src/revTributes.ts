/**
 * Revolutionaries deck tributes (owner, 2026-10-21): when a court card of the
 * Black-history deck is thrown, the table honours the figure on it — one line,
 * name + one true stroke of history, spoken by the game's own cast. NO archival
 * recordings and NO impersonations of the figures themselves (their audio is
 * estate-licensed, and half of the twelve never recorded a word): the honour is
 * in the table's voices, not theirs.
 *
 * The figure map is read off the shipped deck art itself — every Revolutionaries
 * court letters its figure's name on the ivory foot margin (apps/web/public/
 * assets/decks/revolutionaries/<card>.webp):
 *   KS Frederick Douglass · QS Harriet Tubman · JS Nat Turner
 *   KH Martin Luther King Jr. · QH Sojourner Truth · JH Fannie Lou Hamer
 *   KD Marcus Garvey · QD Ida B. Wells · JD W.E.B. Du Bois
 *   KC Malcolm X · QC Angela Davis · JC Huey P. Newton
 *
 * Two triggers, and ONLY while the Revolutionaries deck is the active deck
 * (the caller gates on that — this module is pure detection + caps):
 *  1. COURT PLAYED — a Revolutionaries court lands on a trick: a tribute for
 *     its figure, rolled (signature, not spam). Malcolm's own tribute is
 *     evaluated when his trick completes, never the moment he is thrown —
 *     see the cut rule below.
 *  2. MALCOLM GETS CUT — the signature. KC was WINNING its trick and an
 *     opposing trump played after it takes the trick: the 'by any means
 *     necessary' beat fires near-guaranteed, once per game, ahead of every
 *     other line that step. A KC merely discarded into a trick it never led,
 *     trumped by Malcolm's own partner, or beaten without a trump does NOT
 *     fire it (no higher club exists, so a non-trump winner over KC is
 *     impossible — the winner test is trump + later + opposing side).
 *
 * Speaker choice lives with the caller (the client's talk driver): at the
 * Barbershop story stop Mr. Coleman carries the tributes — he is the stop's
 * historian — with June taking an occasional one where her line exists (she
 * corrects and sharpens him); elsewhere the bot who threw the card speaks.
 * Lines route through the ordinary talk sink, so every talk/voice setting
 * applies, and the texts are registered with BOTH bake worklists (story
 * corpus under mrColeman/june, persona worklist under kind 'tribute'), which
 * is what lets the voice studio record them like any other line.
 */
import { type Action, type Card, type GameState, isTrump, rulesForLive, sideOf, trickWinner } from '@spades/rules';

export interface RevFigure {
  card: Card;
  /** the figure's name as lettered on the card art */
  name: string;
  /** Coleman's tribute (also the text other speakers read) */
  tribute: string;
  /** June's alternate, where she has a natural angle on the figure */
  june?: string;
}

export const REV_FIGURES: RevFigure[] = [
  { card: 'KS', name: 'Frederick Douglass', tribute: 'Frederick Douglass. Taught himself to read when it was forbidden to him, escaped slavery at twenty, and wrote it all down for the world to answer for.' },
  { card: 'QS', name: 'Harriet Tubman', tribute: 'Harriet Tubman. She got herself free — then went back some thirteen times for family and strangers alike, and she brought out every single one.', june: 'Harriet Tubman. Coleman counts her trips back. I count the souls who slept free because of them — some seventy people, and not one left behind.' },
  { card: 'JS', name: 'Nat Turner', tribute: 'Nat Turner. In 1831 he rose in Southampton County and led the deadliest slave rebellion in American history.' },
  { card: 'KH', name: 'Martin Luther King Jr.', tribute: 'Dr. Martin Luther King Jr. Twenty-six years old when Montgomery stopped riding the buses — and he led that boycott all 381 days.' },
  { card: 'QH', name: 'Sojourner Truth', tribute: 'Sojourner Truth. Born enslaved — and the first Black woman to win a court case against a white man in this country, bringing her own son home.' },
  { card: 'JH', name: 'Fannie Lou Hamer', tribute: 'Fannie Lou Hamer. A Mississippi sharecropper who stood before a national convention in 1964 and told the truth until the whole country had to listen.', june: 'Fannie Lou Hamer. They beat that woman in a Winona jail cell for registering to vote. She walked out and testified anyway. Remember that part.' },
  { card: 'KD', name: 'Marcus Garvey', tribute: 'Marcus Garvey. He built the largest Black movement of his age — and put our own ships on the water with the Black Star Line.' },
  { card: 'QD', name: 'Ida B. Wells', tribute: 'Ida B. Wells. A mob wrecked her newspaper office for printing the truth about lynching — so she carried that truth north and printed it louder.', june: "Ida B. Wells. Coleman's too gentle about it — they lynched her friends, wrecked her press, and she still picked up the pen. Tell it whole." },
  { card: 'JD', name: 'W.E.B. Du Bois', tribute: 'W.E.B. Du Bois. The first Black man to earn a Ph.D. from Harvard, in 1895 — and he spent ninety-five years writing the record straight.' },
  { card: 'KC', name: 'Malcolm X', tribute: 'Malcolm X. He remade himself in a prison cell — walked out teaching discipline, dignity, and standing up straight.' },
  { card: 'QC', name: 'Angela Davis', tribute: 'Angela Davis. A philosopher they put on trial in 1972 — she walked out acquitted, and she has been teaching ever since.' },
  { card: 'JC', name: 'Huey P. Newton', tribute: "Huey P. Newton. In 1966, in Oakland, he co-founded the Black Panther Party — and a neighborhood's protection became a movement." },
];

export const REV_FIGURE_BY_CARD: Readonly<Record<string, RevFigure>> = Object.fromEntries(REV_FIGURES.map((f) => [f.card, f]));

/** Malcolm X's card — the King of Clubs, per the lettered art. */
export const MALCOLM_CARD: Card = 'KC';

/** The twelve tribute texts in figure order (the bake's persona worklist set). */
export const REV_TRIBUTE_TEXTS: string[] = REV_FIGURES.map((f) => f.tribute);

/** The signature lines for Malcolm getting cut (speaker variants of one beat). */
export const REV_MALCOLM_CUT_LINES: string[] = [
  "Hold on now. That's Malcolm they just cut. The man told us freedom would come 'by any means necessary' — a spade on a playing card changes none of it.",
  "Malcolm X, cut down on a trick. He taught a whole generation to stand up straight — 'by any means necessary' was never a slogan. It was a promise.",
];

/** Recorded-clip id for a tribute text ('rev.tribute.<n>' / 'rev.malcolm.<n>'); lineById resolves it back. */
export function revLineIdForText(text: string): string | undefined {
  const t = REV_TRIBUTE_TEXTS.indexOf(text);
  if (t >= 0) return `rev.tribute.${t}`;
  const m = REV_MALCOLM_CUT_LINES.indexOf(text);
  return m >= 0 ? `rev.malcolm.${m}` : undefined;
}

/** Tribute discipline: signature, not spam. */
export const REV_TRIBUTE = {
  /** chance a played court draws its figure's tribute */
  chance: 0.5,
  /** regular tributes per game (the Malcolm cut is its own once-per-game beat) */
  maxPerGame: 4,
  /** regular tributes per hand */
  maxPerHand: 1,
  /** at the Barbershop, June's share of the tributes she has a line for */
  juneShare: 0.3,
} as const;

export interface RevTributeState {
  /** figure cards that have had their regular tribute this game */
  figures: Set<string>;
  /** regular tributes spoken this game */
  total: number;
  /** hand the per-hand count belongs to */
  handNo: number;
  /** regular tributes spoken in `handNo` */
  handCount: number;
  /** the Malcolm-cut signature has fired this game */
  malcolmCut: boolean;
  /** Malcolm's regular tribute fired for the trick with this index (after.tricks index at completion) in this hand */
  malcolmTributeTrick: number;
  malcolmTributeHand: number;
}

export function newRevTributeState(): RevTributeState {
  return { figures: new Set(), total: 0, handNo: -1, handCount: 0, malcolmCut: false, malcolmTributeTrick: -1, malcolmTributeHand: -1 };
}

export interface RevTributeEvent {
  kind: 'tribute' | 'malcolmCut';
  card: Card;
  figure: string;
  /** the seat that played the honoured card */
  cardSeat: number;
  /** malcolmCut only: the seat whose trump took Malcolm's trick */
  cutterSeat?: number;
  /** the line (Coleman's text; at the shop June may take it via `juneText`) */
  text: string;
  /** June's alternate text for this figure, when one exists */
  juneText?: string;
}

function handRoom(st: RevTributeState, handNo: number): boolean {
  return st.total < REV_TRIBUTE.maxPerGame && (st.handNo !== handNo || st.handCount < REV_TRIBUTE.maxPerHand);
}

/** Detect a tribute moment in a game step WITHOUT mutating state; commit with revTributeCommit when the line is actually delivered. */
export function revTributeDetect(st: RevTributeState, before: GameState, action: Action, after: GameState, rnd: () => number): RevTributeEvent | null {
  if (action.type !== 'play') return null;
  const r = rulesForLive(before);

  // ---- trick completion: Malcolm's whole story is told here ----
  if (after.tricks.length > before.tricks.length) {
    const trick = after.tricks[after.tricks.length - 1]!;
    const kcIx = trick.plays.findIndex((p) => p.card === MALCOLM_CARD);
    if (kcIx >= 0) {
      const kc = trick.plays[kcIx]!;
      const winnerSeat = trick.winner ?? trickWinner(trick.plays, r);
      const winPlay = trick.plays.find((p) => p.seat === winnerSeat);
      if (winPlay && winPlay.card !== MALCOLM_CARD) {
        const winIx = trick.plays.indexOf(winPlay);
        // CUT: Malcolm was winning when he landed (the plays up to his were
        // not beating him), and a trump played AFTER him, by the other side,
        // took the trick. His own partner's trump is a partner play, not a
        // cut; a winner decided before he landed means he was thrown into a
        // trick already gone — discarded, not cut.
        const wasWinning = trickWinner(trick.plays.slice(0, kcIx + 1), r) === kc.seat;
        const cut = wasWinning && winIx > kcIx && isTrump(winPlay.card, r) && sideOf(winPlay.seat, r) !== sideOf(kc.seat, r);
        if (cut && !st.malcolmCut && !(st.malcolmTributeHand === after.handNo && st.malcolmTributeTrick === after.tricks.length - 1)) {
          return {
            kind: 'malcolmCut', card: MALCOLM_CARD, figure: REV_FIGURE_BY_CARD[MALCOLM_CARD]!.name,
            cardSeat: kc.seat, cutterSeat: winPlay.seat,
            text: REV_MALCOLM_CUT_LINES[Math.floor(rnd() * REV_MALCOLM_CUT_LINES.length)]!,
          };
        }
        // Not a cut and not Malcolm's win: he was discarded into a trick that
        // was never his — fall through; the closing play may honour its own.
      }
      if (winPlay && winPlay.card === MALCOLM_CARD) {
        // Malcolm stood: his regular tribute, judged at the close like his cut.
        const fig = REV_FIGURE_BY_CARD[MALCOLM_CARD]!;
        if (!st.figures.has(MALCOLM_CARD) && handRoom(st, after.handNo) && rnd() < REV_TRIBUTE.chance) {
          return { kind: 'tribute', card: MALCOLM_CARD, figure: fig.name, cardSeat: kc.seat, text: fig.tribute, ...(fig.june ? { juneText: fig.june } : {}) };
        }
      }
    }
  }

  // ---- a court is thrown ----
  const card = action.card as Card;
  if (card === MALCOLM_CARD) return null; // Malcolm is judged when his trick closes (above)
  const fig = REV_FIGURE_BY_CARD[card];
  if (!fig) return null;
  if (st.figures.has(card) || !handRoom(st, after.handNo)) return null;
  if (rnd() >= REV_TRIBUTE.chance) return null;
  return { kind: 'tribute', card, figure: fig.name, cardSeat: action.seat, text: fig.tribute, ...(fig.june ? { juneText: fig.june } : {}) };
}

/** Apply a delivered event to the caps (call only when the line is actually spoken). */
export function revTributeCommit(st: RevTributeState, ev: RevTributeEvent, handNo: number, completedTrickIx = -1): void {
  if (ev.kind === 'malcolmCut') { st.malcolmCut = true; return; }
  st.figures.add(ev.card);
  st.total++;
  if (st.handNo !== handNo) { st.handNo = handNo; st.handCount = 0; }
  st.handCount++;
  if (ev.card === MALCOLM_CARD) { st.malcolmTributeHand = handNo; st.malcolmTributeTrick = completedTrickIx; }
}
