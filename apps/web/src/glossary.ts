import { type TableRules, cardLabel, trumpOrder } from '@spades/rules';

/**
 * Card basics for people who have never played a trick-taking game: plain definitions, worded for the table's
 * mode (Joker Spades, regular / Ace Down, Cutthroat, with or without jokers). Used by the "?" help ("Card basics")
 * and by the tappable terms inside tips (`{term}` or `{shown text|term}` in tip text).
 */
export type TermKey = 'book' | 'suit' | 'high' | 'trump' | 'lead' | 'follow' | 'cut' | 'broken' | 'bid' | 'set' | 'bags' | 'nil' | 'partner';
export interface Term { key: TermKey; term: string; def: string }

export const TERM_ORDER: TermKey[] = ['book', 'suit', 'high', 'trump', 'lead', 'follow', 'cut', 'broken', 'bid', 'set', 'bags', 'nil', 'partner'];

export function topTrumps(r: TableRules, n = 4): string {
  return trumpOrder(r).slice(0, n).map((c) => cardLabel(c)).join(', ');
}

export function glossary(r: TableRules): Record<TermKey, Term> {
  const order = trumpOrder(r);
  const jokers = order.includes('BJ' as never);
  const promoted = order.filter((c) => c !== 'BJ' && c !== 'LJ' && !c.endsWith('S')).map((c) => cardLabel(c));
  const extras = [jokers ? 'the two Jokers' : '', ...promoted].filter(Boolean);
  const top = topTrumps(r);
  const n = r.playerCount;
  const t = (key: TermKey, term: string, def: string): Term => ({ key, term, def });
  return {
    book: t('book', 'Book', `One round of play: everyone puts down one card, and the best card takes all ${n}. That little pile is a book (also called a trick).`),
    suit: t('suit', 'Suit', `The four card families: ♥ hearts, ♦ diamonds, ♣ clubs and ♠ spades.${jokers ? ' Here the Jokers count as spades.' : ''}`),
    high: t('high', 'High card', `Inside a suit, 2 is the lowest, then 3 to 10, Jack, Queen, King, and the Ace is the highest.${extras.length ? ` Exceptions here: ${extras.join(' and ')} are special trumps above the Ace of spades.` : ''}`),
    trump: t('trump', 'Trump', `Spades${extras.length ? ` (plus ${extras.join(' and ')})` : ''} are trumps: any trump beats any card of another suit. From the top: ${top}… You can only play one on another suit's book when you have none of that suit.`),
    lead: t('lead', 'Lead', 'Playing the first card of a book. Everyone else has to answer with that same suit if they can.'),
    follow: t('follow', 'Follow suit', 'If you have a card of the suit that was led, you must play one. Your cards that are allowed right now are lifted and glowing.'),
    cut: t('cut', 'Cutting', "When you have none of the suit that was led, you may play a trump instead. That's cutting: your trump beats all their cards and steals the book."),
    broken: t('broken', 'Spades broken', `Nobody may lead a spade until someone has cut with one. After that, spades are "broken" and can be led.${r.spadesMustBeBroken ? '' : ' (This table lets you lead spades any time.)'}`),
    bid: t('bid', 'Bid', r.partnerships
      ? 'Before playing, you guess how many books you will win. Your bid plus your partner\'s is the team\'s goal for the hand.'
      : 'Before playing, you guess how many books you will win this hand. Hit it to score.'),
    set: t('set', 'Set', `Winning fewer books than you bid. You lose 10 points for every book you bid. Getting the other ${r.partnerships ? 'team' : 'players'} set is the best feeling in the game.`),
    bags: t('bags', 'Bags', `Extra books beyond your bid. Each is +1 point, but every ${r.bagsPerPenalty} bags cost ${Math.abs(r.bagPenalty)} points.`),
    nil: t('nil', 'Nil', r.nil.allowed
      ? `Bidding zero: you promise to win no books at all. Make it for +${r.nil.value}; win even one and it's −${r.nil.value}.`
      : 'Bidding zero (promising to win no books). It is turned off at this table.'),
    partner: t('partner', 'Partner', r.partnerships
      ? 'The player sitting across from you. You win or lose together, and your books count as one team.'
      : 'Cutthroat has no partners: everyone plays for themselves.'),
  };
}

/** Splits tip text into plain strings and term references: `{book}` or `{books|book}`. */
export function parseTerms(text: string): (string | { text: string; key: TermKey })[] {
  const out: (string | { text: string; key: TermKey })[] = [];
  const re = /\{([^}|]+)(?:\|([^}]+))?\}/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = (m[2] ?? m[1]!).trim() as TermKey;
    out.push(TERM_ORDER.includes(key) ? { text: m[1]!, key } : m[1]!);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Tip text with the markup removed (tests, aria). */
export const plainText = (text: string) => parseTerms(text).map((p) => (typeof p === 'string' ? p : p.text)).join('');
