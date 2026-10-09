import { type Card, SUIT_SYMBOL, type Suit } from '@spades/rules';

interface Props {
  card?: Card;
  faceDown?: boolean;
  small?: boolean;
  legal?: boolean;
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  className?: string;
  /** Mark a non-spade card that plays as a trump (e.g. the promoted 2♦). */
  trumpBadge?: boolean;
}

export default function CardView({ card, faceDown, small, legal, selected, dim, onClick, style, className = '', trumpBadge }: Props) {
  const cls = ['card', small ? 'small' : '', selected ? 'selected' : '', dim ? 'dim' : '', legal ? 'legal' : '', onClick ? 'clickable' : '', className];
  if (faceDown || !card) {
    return <div className={[...cls, 'back'].join(' ')} style={style} aria-label="face-down card"><div className="back-inner" /></div>;
  }
  if (card === 'BJ' || card === 'LJ') {
    const big = card === 'BJ';
    return (
      <button type="button" className={[...cls, 'joker', big ? 'big-joker' : 'little-joker'].join(' ')} style={style} onClick={onClick} disabled={!onClick} aria-label={big ? 'Big Joker' : 'Little Joker'}>
        <span className="corner jk">{'JOKER'.split('').map((l, i) => <i key={i}>{l}</i>)}</span>
        <span className="joker-face">
          <span className="joker-star">★</span>
          <span className="joker-word">{big ? 'BIG' : 'LITTLE'}</span>
        </span>
      </button>
    );
  }
  const rank = card[0] === 'T' ? '10' : card[0]!;
  const suit = card[1] as Suit;
  const red = suit === 'H' || suit === 'D';
  return (
    <button type="button" className={[...cls, red ? 'red' : 'black'].join(' ')} style={style} onClick={onClick} disabled={!onClick} aria-label={`${rank}${SUIT_SYMBOL[suit]}`}>
      <span className="corner"><b>{rank}</b><span>{SUIT_SYMBOL[suit]}</span></span>
      <span className="pip">{SUIT_SYMBOL[suit]}</span>
      <span className="corner br"><b>{rank}</b><span>{SUIT_SYMBOL[suit]}</span></span>
      {trumpBadge && <span className="trump-badge" title="Plays as a spade">♠</span>}
    </button>
  );
}
