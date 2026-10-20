/**
 * The combined Rep block — Level + title, the XP progress bar, both division ·
 * Elo chips and (on surfaces that show it inline) the coin chip. ONE
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
export interface RepRankInfo { division: string; elo: number }

const DIV_LABEL: Record<string, string> = { stoop: 'Stoop', corner: 'Corner', block: 'Block', avenue: 'Avenue', boulevard: 'Boulevard', legend: 'Legend' };
export const divLabel = (d: string) => DIV_LABEL[d] ?? d;

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
        <span className="soc-div-chip" title="Partnership season division">⚔ {divLabel(team.division)} · {team.elo}</span>
        <span className="soc-div-chip" title="Cutthroat season division">🔪 {divLabel(cutthroat.division)} · {cutthroat.elo}</span>
        {coins !== undefined && <span className="soc-coin-chip" title="Coin balance" data-testid={coinsTestid}>🪙 {coins.toLocaleString()}</span>}
      </div>
    </div>
  );
}
