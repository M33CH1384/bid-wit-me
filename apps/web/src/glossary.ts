import { type TableRules, cardLabel, firstHandMinOf, shotOutOn, trumpOrder } from '@spades/rules';

/**
 * Card basics for people who have never played a trick-taking game: plain definitions, worded for the table's
 * mode (Joker Spades, regular / Ace Down, Cutthroat, with or without jokers). Used by the "?" help ("Card basics")
 * and by the tappable terms inside tips (`{term}` or `{shown text|term}` in tip text).
 */
export type TermKey = 'book' | 'suit' | 'high' | 'trump' | 'lead' | 'follow' | 'cut' | 'broken' | 'bid' | 'set' | 'bags' | 'nil' | 'partner' | 'wheels' | 'shot';
export interface Term { key: TermKey; term: string; def: string }

export const TERM_ORDER: TermKey[] = ['book', 'suit', 'high', 'trump', 'lead', 'follow', 'cut', 'broken', 'bid', 'set', 'bags', 'nil', 'partner', 'wheels', 'shot'];

export function topTrumps(r: TableRules, n = 4): string {
  return trumpOrder(r).slice(0, n).map((c) => cardLabel(c)).join(', ');
}

/** How to say "a trump" in plain words for this mode: spades, plus Jokers / promoted 2s (e.g. "a spade, a Joker or the 2♦"). */
export function trumpWords(r: TableRules): { one: string; many: string; extra: string } {
  const order = trumpOrder(r);
  const jokers = order.includes('BJ' as never);
  const aceAt = order.indexOf('AS' as never);
  const odd = order.slice(0, aceAt < 0 ? 0 : aceAt).filter((c) => c !== 'BJ' && c !== 'LJ' && !c.endsWith('S')).map((c) => `the ${cardLabel(c)}`);
  const or = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : xs[0]!);
  const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]!);
  return {
    one: or(['a spade', ...(jokers ? ['a Joker'] : []), ...odd]),
    many: and(['spades', ...(jokers ? ['Jokers'] : []), ...odd]),
    extra: jokers || odd.length ? `${and([...(jokers ? ['the Jokers'] : []), ...odd])} count as spades too.` : '',
  };
}

export function glossary(r: TableRules): Record<TermKey, Term> {
  const order = trumpOrder(r);
  const jokers = order.includes('BJ' as never);
  // cards ranked above the Ace of spades besides the jokers (e.g. 2♦ and 2♠ in Joker Spades)
  const aceAt = order.indexOf('AS' as never);
  const promoted = order.slice(0, aceAt < 0 ? 0 : aceAt).filter((c) => c !== 'BJ' && c !== 'LJ').map((c) => cardLabel(c));
  const extras = [jokers ? 'the two Jokers' : '', ...promoted].filter(Boolean);
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '');
  const top = topTrumps(r);
  const tw = trumpWords(r);
  const n = r.playerCount;
  const t = (key: TermKey, term: string, def: string): Term => ({ key, term, def });
  return {
    book: t('book', 'Book', `One round of play: everyone puts down one card, and the best card takes all ${n}. That little pile is a book (also called a trick).`),
    suit: t('suit', 'Suit', `The four card families: ♥ hearts, ♦ diamonds, ♣ clubs and ♠ spades.${jokers ? ' Here the Jokers count as spades.' : ''}`),
    high: t('high', 'High card', `Inside a suit, 2 is the lowest, then 3 to 10, Jack, Queen, King, and the Ace is the highest.${extras.length ? ` Exceptions here: ${list(extras)} count as spades (trumps) and rank even above the Ace of spades.` : ''}`),
    trump: t('trump', 'Trump', `Spades are the boss suit (the trumps)${extras.length ? `, and ${list(extras)} count as spades` : ''}: any spade beats any heart, diamond or club. From the top: ${top}… You can only play one on another suit when you have none of that suit.`),
    lead: t('lead', 'Lead', 'Playing the first card of a book. Everyone else has to answer with that same suit if they can.'),
    follow: t('follow', 'Follow suit', 'If you have a card of the suit that was led, you must play one. Your cards that are allowed right now are lifted and glowing.'),
    cut: t('cut', 'Cutting', `When you have none of the suit that was led, you may play ${tw.one} (a trump) instead. That's cutting: it beats all their cards and steals the book.`),
    broken: t('broken', 'Spades broken', `Nobody may start a book with ${tw.one} until someone has played one on another suit. After that, spades are "broken" and anyone can lead them.${r.spadesMustBeBroken ? '' : ' (This table lets you lead spades any time.)'}`),
    bid: t('bid', 'Bid', r.partnerships
      ? 'Before playing, you guess how many books you will win. Your bid plus your partner\'s is the team\'s goal for the hand. Bid order: the team without the deal bids first (both partners back to back), then the dealer\'s partner, and the dealer bids last. Play still starts left of the dealer. Online, partners can talk out loud over open mics while bidding, but each bids their own number. Mics and chat are public: the other team hears and sees it too.'
      : `Before playing, you guess how many books you will win this hand. Hit it to score. Bids go clockwise from the dealer's left. The lowest number you can bid is ${Math.max(1, r.minTeamBid)}; a bid of 0 is Nil${r.nil.allowed ? '' : ' (off at this table)'}.${n === 3 ? ` With 3 players the ${list(r.removedCards.map((c) => cardLabel(c)))} ${r.removedCards.length > 1 ? 'are' : 'is'} removed (the lowest non-trump cards), so everyone gets 17 cards and there are 17 books.` : ''}`),
    set: t('set', 'Set', `Winning fewer books than you bid. You lose 10 points for every book you bid. Getting the other ${r.partnerships ? 'team' : 'players'} set is the best feeling in the game.`),
    bags: t('bags', 'Bags', r.bagsOn === false
      ? 'Extra books beyond your bid. Bags and penalties are off at this table: extra books score nothing.'
      : `Extra books beyond your bid. Each is +1 point, but every ${r.bagsPerPenalty} bags cost ${Math.abs(r.bagPenalty)} points.`),
    nil: t('nil', 'Nil', r.nil.allowed
      ? `Bidding zero: you promise to win no books at all. Make it for +${r.nil.value}; win even one and it's −${r.nil.value}.`
      : 'Bidding zero (promising to win no books). It is turned off at this table.'),
    partner: t('partner', 'Partner', r.partnerships
      ? 'The player sitting across from you. You win or lose together, and your books count as one team. Partners can talk out loud about books during bidding; all chat is public (the other team sees it too).'
      : 'Cutthroat has no partners: everyone plays for themselves.'),
    shot: t('shot', 'Shot (Shot = out)', (() => {
      const who = r.partnerships ? 'team' : 'player';
      const min = firstHandMinOf(r);
      if (!shotOutOn(r)) return `Getting shot means getting set: taking fewer books than you bid. (Shot = out is off at this table.)`;
      return `Getting shot means getting set: taking fewer books than you bid. A ${who} shot two hands in a row loses the game (SHOT OUT). After one shot the ${who} is ON NOTICE.${r.firstHandBidsItself !== false ? (min !== null ? ` On the first hand, taking fewer than ${min} books is a shot, and a shot on hand 1 loses right away.` : '') : ' Getting shot on hand 1 loses right away.'} If both sides go out on the same hand, the higher score wins.`;
    })()),
    wheels: t('wheels', 'Wheels', `A team bidding 10+ books together, or taking 10+ books yourself in Cutthroat.${r.partnerships ? ' Make it and the wheels come out.' : ''}`),
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
