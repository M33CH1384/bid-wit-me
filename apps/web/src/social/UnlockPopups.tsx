/**
 * Unlock celebrations (Phase 2): the first time the client sees a celebrated unlock on
 * your account — `big-bank` (Rep Level 20) or `after-dark` (The Pj's) — a solid popup
 * card announces "you now have this ability". Once per unlock per account: the seen set
 * lives in localStorage keyed by account id (the profile payload anchors the truth —
 * it carries every unlock with its server grant timestamp). Rules: never over a table
 * (queued until you're back in menus/lobby), one at a time, not on every login.
 * Mounted in SocialRoot so it can appear anywhere in the app.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAccount } from '../account/api';
import { wasInGame } from '../save';
import { social } from './store';
import { fetchMyCred } from './wagerApi';
import { parseSeen, popupDeferred, seenKey, unseenUnlocks, withSeen, type UnlockInfo } from './wagerLogic';

const COPY: Record<string, { title: string; body: string; cta?: string }> = {
  'big-bank': {
    title: '🏦 Big Bank Take Lil Bank unlocked!',
    body: 'You now have this ability: challenge players to scheduled coin-wager matches — Partnership 2v2 or Cutthroat. Winners take the pot; no-shows lose their wager.',
    cta: 'Start a challenge',
  },
  'after-dark': {
    title: "🌆 The Pj's unlocked!",
    body: "You now have this ability: The Pj's venue is yours — the block at night, folding table under the streetlight. Pick it when you set up a game.",
  },
};

export function UnlockPopups() {
  const acct = useAccount();
  const accountId = acct.user?.id ?? null;
  const [queue, setQueue] = useState<UnlockInfo[]>([]);
  const [path, setPath] = useState(() => location.pathname);
  const [, setTick] = useState(0);

  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  // the offline in-game marker flips without a path change — re-check the deferral on a beat
  useEffect(() => { const t = window.setInterval(() => setTick((x) => x + 1), 2000); return () => window.clearInterval(t); }, []);

  const check = useCallback(async () => {
    if (!accountId) { setQueue([]); return; }
    const cred = await fetchMyCred();
    if (!cred || cred.id !== accountId) return;
    let seen: string[] = [];
    try { seen = parseSeen(localStorage.getItem(seenKey(accountId))); } catch { /* private mode */ }
    setQueue(unseenUnlocks(cred.unlockDetails, seen));
  }, [accountId]);

  useEffect(() => {
    void check();
    const t = window.setInterval(() => void check(), 45_000);
    const onVis = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, [check]);

  const current = queue[0];
  if (!current || !accountId) return null;
  if (popupDeferred(path, wasInGame())) return null; // stays queued until menus/lobby
  const copy = COPY[current.itemId];
  if (!copy) return null;
  const markSeen = () => {
    try {
      const seen = parseSeen(localStorage.getItem(seenKey(accountId)));
      localStorage.setItem(seenKey(accountId), JSON.stringify(withSeen(seen, current.itemId)));
    } catch { /* private mode */ }
    setQueue((q) => q.slice(1));
  };
  return (
    <div className="unlock-pop" role="dialog" aria-label={copy.title} data-testid={`unlock-pop-${current.itemId}`}>
      <div className="unlock-pop-txt"><b>{copy.title}</b><span>{copy.body}</span></div>
      <div className="unlock-pop-acts">
        {copy.cta && (
          <button type="button" className="primary" data-testid="unlock-pop-go"
            onClick={() => { markSeen(); social.startChallenge(); }}>{copy.cta}</button>
        )}
        <button type="button" data-testid="unlock-pop-dismiss" onClick={markSeen}>{copy.cta ? 'Later' : 'Nice!'}</button>
      </div>
    </div>
  );
}
