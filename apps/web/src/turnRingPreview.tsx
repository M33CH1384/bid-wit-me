import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SEAT_COLORS, USER_COLORS } from './overlay';
import { TurnCountdown } from './TurnRing';

/** Frozen local clock so a WebKit screenshot can catch gold, then red. */
const NOW = 1_700_000_000_000;

function windowFor(at: 'gold' | 'red') {
  // Gold: 14s left on the default 20s play clock. Red: 1s left on a 4s clock
  // (legal timers start at 3s), so the arc is still a wedge and the color is red.
  const span = at === 'gold' ? 20_000 : 4_000;
  const left = at === 'gold' ? 14_000 : 1_000;
  const deadline = NOW + left;
  return { start: deadline - span, deadline, now: () => NOW };
}

function Plate({ name, letter, color, turn, mine, testId, clock }: {
  name: string;
  letter: string;
  color: string;
  turn: boolean;
  mine: boolean;
  testId: string;
  clock: ReturnType<typeof windowFor> | null;
}) {
  return (
    <div className={`plate ${turn ? 'turn' : ''} ${mine ? 'me-plate' : 'foe'}`} data-testid={testId}>
      <div className="plate-avatar" style={{ ['--uc' as string]: color }}>{letter}</div>
      <div className="plate-body">
        <div className="plate-name">{name}</div>
        <div className="plate-stats">
          <span className="chip">BID 4</span>
          <span className="chip">TOOK 2</span>
        </div>
      </div>
      {turn && <div className="plate-turn">{mine ? 'YOUR TURN' : 'TO PLAY'}</div>}
      {turn && clock && <TurnCountdown start={clock.start} deadline={clock.deadline} mine={mine} now={clock.now} />}
    </div>
  );
}

function Preview({ at }: { at: 'gold' | 'red' }) {
  const clock = windowFor(at);
  const mine = at === 'red';
  return (
    <div className="table-screen" data-testid="ring-preview" data-at={at}>
      <div className="ring-felt" />
      <div className="ring-seat top">
        <Plate name="RAY" letter="R" color={SEAT_COLORS[1]!} turn={!mine} mine={false} testId="seat-opp" clock={mine ? null : clock} />
      </div>
      <div className="ring-seat side">
        <Plate name="KIM" letter="K" color={SEAT_COLORS[2]!} turn={false} mine={false} testId="seat-wait" clock={null} />
      </div>
      <div className="ring-seat bottom">
        <Plate name="YOU" letter="Y" color={USER_COLORS.You!} turn={mine} mine testId="seat-me" clock={mine ? clock : null} />
      </div>
    </div>
  );
}

export function mountTurnRingPreview(root: HTMLElement): void {
  const at = new URLSearchParams(location.search).get('at') === 'red' ? 'red' : 'gold';
  createRoot(root).render(
    <StrictMode>
      <Preview at={at} />
    </StrictMode>,
  );
}
