import { useEffect, useRef, useState } from 'react';
import GameOverRewards, { type RewardsData } from './GameOverRewards';
import { cardTakeoverKey, takeoverDismissed } from './CardTakeover';
import { fx, useReduceEffects } from './fx';
import { loadClaimResult, peekPendingClaim } from './pendingClaim';
import { clearRewards, loadRewards, rematchPathFor, stashRematchSeats, stashRewards, type RewardsPayload } from './rewardsStash';

/**
 * Reload recovery for the merged victory screen (2026-11-01 consolidation).
 *
 * The victory report lives at the table now — finishing a game never
 * navigates anywhere — but two things on it are owed to the player across
 * a reload, and the stash Table writes at presentation carries them:
 *
 *  1. A level-up CARD TAKEOVER that is still pending (presented, or armed
 *     but not yet fired) when the page goes away. Retirement is
 *     dismissal-only, so an undismissed grant must present again — with
 *     its entrance — on the next load, wherever the player lands.
 *  2. A guest's held rewards claim tied to an UNSIGNED breakdown: either
 *     still held (this surface owns the claim and completes it visibly) or
 *     already credited elsewhere with the result stored (this surface
 *     swaps the credited breakdown in — see useVictoryClaim).
 *
 * This overlay is the ONLY way the standalone composition is reached: it
 * is not a navigation destination, no flow routes to it, and it presents
 * only when one of the two owed states above is actually in the stash.
 * Its actions are the old report actions (Home / Rematch / Profile /
 * Open Tables); leaving through one clears the stash — unless a takeover
 * grant is STILL undismissed, in which case the stash stays and the next
 * boot presents it again. The ✕ closes the report for this page view
 * only; an undismissed grant will still be owed on the next load.
 */
function takeoverPending(p: RewardsPayload): boolean {
  const key = cardTakeoverKey(p.data);
  return !!key && !takeoverDismissed(key);
}

function qualifies(p: RewardsPayload, reduced: boolean): boolean {
  if (!reduced && takeoverPending(p)) return true;
  if (!p.data.signedIn && p.gameId) {
    if (loadClaimResult(p.gameId)) return true;
    const peek = peekPendingClaim(Date.now());
    if (peek.state === 'held' && peek.claim.item.clientGameId === p.gameId) return true;
  }
  return false;
}

export default function VictoryRecovery() {
  const reduceFx = useReduceEffects();
  const reduced = reduceFx || fx.osReducedMotion;
  const [payload, setPayload] = useState<RewardsPayload | null>(null);
  const decided = useRef(false);

  // Decide ONCE per page load: a reload is what strands the merged screen,
  // so the landing load is where the owed states are checked.
  useEffect(() => {
    if (decided.current) return;
    decided.current = true;
    const p = loadRewards();
    if (p && qualifies(p, reduced)) setPayload(p);
  }, [reduced]);

  if (!payload) return null;

  const leave = (href: string) => {
    if (!takeoverPending(payload)) clearRewards();
    location.href = href;
  };
  const onClaimSwap = (nd: RewardsData) => {
    const p2 = { ...payload, data: nd };
    setPayload(p2);
    stashRewards(p2);
  };
  return (
    <div className="recovery-shell">
      <GameOverRewards
        data={payload.data}
        claimGameId={payload.gameId}
        onClaimSwap={onClaimSwap}
        onHome={() => leave(payload.homePath)}
        onRematch={() => {
          // A rematch deals the same table back (owner, 2026-11-04): hand the
          // finished game's seats to the autostart this navigates to. Online
          // rematches return to their room and story rematches to their stop —
          // neither rides this hand-off.
          if (!payload.online && !payload.storyStopId && payload.seatNames?.length) stashRematchSeats(payload.seatNames);
          if (!takeoverPending(payload)) clearRewards();
          location.href = rematchPathFor(payload);
        }}
        onProfile={() => leave('/profile')}
        onOpenTables={() => leave('/online')}
      />
      <button type="button" className="modal-x recovery-x" aria-label="Close the match report" data-testid="recovery-close" onClick={() => setPayload(null)}>✕</button>
    </div>
  );
}
