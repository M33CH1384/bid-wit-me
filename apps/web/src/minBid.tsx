import type { Bid, BidOptions, TableRules } from '@spades/rules';
import { hostMinimum, isNilBid } from '@spades/rules';

export interface MinBidNote {
  /** "Min bid 3 · house rule" */
  label: string;
  /** Why the buttons start there, e.g. "Partner bid 1 — your team needs 4". */
  reason: string;
}

/**
 * The bid buttons start at `opt.min`. Under default 2v2 that is 1 until a partner has bid.
 * A higher start is the house minimum (the "Minimum 4" chip) minus what the partner already bid,
 * or the whole minimum when they bid Nil or when each player bids alone (Cutthroat).
 * Returns null when 1 is legal, so the picker does not invent a floor.
 */
export function minBidNote(
  opt: Pick<BidOptions, 'min' | 'nil'>,
  rules: Pick<TableRules, 'partnerships' | 'firstHandMin' | 'minTeamBid'>,
  partnerBid: Bid | null,
): MinBidNote | null {
  if (opt.min <= 1) return null;
  const floor = hostMinimum(rules);
  const label = `Min bid ${opt.min} · house rule`;
  if (!rules.partnerships) return { label, reason: `Each bid has to reach ${floor}` };
  if (isNilBid(partnerBid)) {
    const kind = partnerBid === 'blindNil' ? 'Blind Nil' : 'Nil';
    return { label, reason: `Partner bid ${kind} — you need ${floor}` };
  }
  if (typeof partnerBid === 'number') {
    const nil = opt.nil ? '' : ', so Nil is off';
    return { label, reason: `Partner bid ${partnerBid} — your team needs ${floor}${nil}` };
  }
  return { label, reason: `The table minimum is ${floor}` };
}

/** Numbers the picker offers, from the legal minimum up. */
export function bidChoices(min: number, max: number): number[] {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) return [];
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

export function MinBidLine({ note }: { note: MinBidNote }) {
  return (
    <p className="bid-block" data-testid="bid-min">
      {note.label}
      <span className="bid-min-why"> · {note.reason}</span>
    </p>
  );
}
