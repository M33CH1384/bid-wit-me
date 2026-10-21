/**
 * The combined Rep block — Level + title, the XP progress bar, both rating
 * chips and (on surfaces that show it inline) the coin chip. ONE
 * implementation shared by the /profile header card, the Social profile header
 * and the in-game profile modal, so the three can never drift apart again
 * (Demetrius 2026-10-20: "combine the rep profile with the regular profile and
 * not have it in separate places" — and the XP bar belongs "up near the top
 * with the profile image like in the rep profile").
 *
 * The bar uses the same xpIntoLevel / xpForNext semantics as the /profile
 * header card always did; both /api/profile/:id and /api/profile/me carry
 * those fields off the server's xpSnapshot().
 */

export interface RepLevelInfo { level: number; title: string; xpIntoLevel: number; xpForNext: number }
/** The payload still carries the division id (internal band logic), but no
 *  user-facing surface renders a division NAME anymore (owner, 2026-10-20:
 *  rankings are metric-based — "not some corny names"). The chips below show
 *  the plain rating number, and the LEVEL title is the only named title on a
 *  profile (the one-title rule). */
export interface RepRankInfo { division: string; elo: number }

/** The coins chip's drawn coin (Demetrius 2026-10-20: the coin emoji "don't
 *  work for me") — a gold-gradient disc with a darker gold rim and a centered spade,
 *  inline SVG so it sits with the chip text exactly where the emoji did and
 *  renders the same on every platform (the emoji didn't). */
export function CoinIcon({ size = 15 }: { size?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ flex: 'none', verticalAlign: '-2px' }}>
      <defs>
        <radialGradient id="bwm-coin-g" cx="35%" cy="30%" r="85%">
          <stop offset="0%" stopColor="#ffedb0" />
          <stop offset="55%" stopColor="#f5c542" />
          <stop offset="100%" stopColor="#cf9c2c" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill="url(#bwm-coin-g)" stroke="#8a6414" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="7.3" fill="none" stroke="#a87f1d" strokeWidth="0.9" opacity="0.8" />
      <path d="M12 5.1c1.8 2.4 6.2 5.6 6.2 8.6a3.25 3.25 0 0 1-5.8 2.1c.3 1.4.9 2.6 1.8 3.5H9.8c.9-.9 1.5-2.1 1.8-3.5a3.25 3.25 0 0 1-5.8-2.1c0-3 4.4-6.2 6.2-8.6z" fill="#8a6414" />
    </svg>
  );
}

export function RepBlock({ level, team, cutthroat, coins, testid, coinsTestid }: {
  level: RepLevelInfo;
  team: RepRankInfo;
  cutthroat: RepRankInfo;
  /** Inline coin balance chip. Omit on the /profile card, whose header shows
   *  the balance as its own big block beside the avatar. */
  coins?: number;
  testid: string;
  coinsTestid?: string;
}) {
  const xpPct = Math.min(100, Math.round((level.xpIntoLevel / Math.max(1, level.xpForNext)) * 100));
  return (
    <div className="soc-rep soc-prof-rep" data-testid={testid}>
      <div className="soc-rep-level"><b>Level {level.level}</b><span>{level.title}</span></div>
      <div className="xp-bar" data-testid={`${testid}-xp`}><i style={{ width: `${xpPct}%` }} /><small>{level.xpIntoLevel}/{level.xpForNext} XP</small></div>
      <div className="soc-rep-ranks">
        <span className="soc-div-chip" title="Partnership rating">⚔ Rating {team.elo}</span>
        <span className="soc-div-chip" title="Cutthroat rating">🔪 Rating {cutthroat.elo}</span>
        {coins !== undefined && <span className="soc-coin-chip" title="Coin balance" data-testid={coinsTestid}><CoinIcon /> {coins.toLocaleString()}</span>}
      </div>
    </div>
  );
}
