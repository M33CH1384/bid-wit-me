import { useEffect } from 'react';
import { dismissDailyBonus, useDailyBonus } from './dailyBonus';
import { CoinIcon } from './RepBlock';

const fmt = (n: number): string => n.toLocaleString('en-US');

/**
 * The daily-bonus receipt: a dismissible top-center card in the social
 * toast family, raised once when the day's coin grant lands (see
 * dailyBonus.ts). Both numbers are the server's — the amount granted and
 * the balance it left him with. Auto-retires after 12s; the ✕ dismisses
 * now. Mounted once at the root so it can greet any landing surface.
 */
export default function DailyBonusReceipt() {
  const grant = useDailyBonus();
  useEffect(() => {
    if (!grant) return;
    const t = setTimeout(dismissDailyBonus, 12_000);
    return () => clearTimeout(t);
  }, [grant]);
  if (!grant) return null;
  return (
    <div className="daily-bonus-receipt" data-testid="daily-bonus-receipt" role="status">
      <CoinIcon size={22} />
      <div className="dbr-txt">
        <b>+{fmt(grant.amount)} coins — Daily bonus</b>
        {grant.balance !== null && <span>You now have {fmt(grant.balance)} coins.</span>}
        {grant.streak > 1 && <span>{grant.streak}-day streak.</span>}
      </div>
      <button type="button" className="dbr-x" onClick={dismissDailyBonus} aria-label="Dismiss">✕</button>
    </div>
  );
}
