/**
 * Game-over headline grammar: "YOU WIN", "<Name> WINS" (one Cutthroat player), "<Team> WIN" (team names read
 * plural: "SHOT CALLERS WIN", "You & Andre win"), and ties ("Ravi & Zuri win", "You & Ravi win").
 */
export function winHeadline(winners: string[], partnerships: boolean): string {
  const names = winners.map((n) => n.trim()).filter(Boolean);
  if (!names.length) return 'Game over';
  const who = names.join(' & ');
  if (partnerships || names.length > 1) return `${who} win`;
  return /^you$/i.test(who) ? 'You win' : `${who} wins`;
}
