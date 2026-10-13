import { dealerPhrase } from './dealerName';

/** Live "who deals" note. The name is the current occupant of the current hand's dealer seat. */
export function DealerPopup({ name, localSeat }: { name: string; localSeat: number }) {
  const phrase = dealerPhrase(name);
  return (
    <div className="center-note dealer-popup" data-testid="dealer-popup" data-dealer-seat={localSeat} role="status" aria-label={phrase}>
      <b data-testid="dealer-popup-name">{name}</b>
      <span>{name === 'You' ? 'deal' : 'deals'}</span>
    </div>
  );
}
