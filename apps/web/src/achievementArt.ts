/**
 * Achievement art + "earned for" lines for the Player Card (owner,
 * 2026-11-01: "I don't know what these badges are" — his card showed three
 * identical gold medals for three different achievements).
 *
 * Why this file exists: the server's card payload (apps/server/src/cred/
 * card.ts, earnedBadgesFor) carries each Rep achievement's NAME and earned
 * timestamp but icon: null — by design the client resolves display art
 * from its own catalogs (the same pattern as BADGES in badges.ts). Until
 * now no client catalog covered the achievements, so badgeDisplay fell
 * through to ONE generic 🏅 glyph for every achievement and the card's
 * medal row was three copies of the same medal.
 *
 * This catalog mirrors the achievement DEFS in
 * apps/server/src/cred/achievements.ts — ids and the `about` lines are
 * that file's titles/hints (the hint is what the achievement is earned
 * for; titles stay server-owned and are NOT duplicated here). If a def
 * is added server-side, add its glyph here; an id missing from this map
 * keeps the generic 🏅 fallback, never a wrong badge's art.
 *
 * Glyphs are chosen per feat and deliberately avoid the story badge
 * set's glyphs (🎓🌑🕯️💡⭐👑🥚🗝️🏆🎖️🛡️🙏🔥) and the progress
 * badge's 🌪, so two badges sharing a card can never read as the same
 * medal.
 */
export const ACHIEVEMENT_ART: Record<string, { icon: string; about: string }> = {
  'first-dub': { icon: '🙌', about: 'Win your first game' },
  'ten-toes': { icon: '👣', about: 'Win 10 games' },
  'dealmaker': { icon: '🤝', about: 'Win 25 partnership games' },
  'lone-wolf': { icon: '🐺', about: 'Win 10 cutthroat games' },
  'century': { icon: '💯', about: 'Win 100 games' },
  'clean-nil': { icon: '🧼', about: 'Bid nil and make it' },
  'blind-faith': { icon: '🙈', about: 'Bid blind nil and make it' },
  'no-baggage': { icon: '🪶', about: 'Win a game with zero bags' },
  'wheels-up': { icon: '🛞', about: 'Call wheels and take the game' },
  'boston': { icon: '📚', about: 'Take 13+ books in a single hand' },
  'run-it-up': { icon: '🚀', about: 'Claim "Run it!" and clear the table' },
  'sharpshooter': { icon: '🎯', about: 'Give 25 shots across your career' },
  'comeback-kid': { icon: '🐐', about: 'Win after trailing by 100+ points' },
  'undertaker': { icon: '⚰️', about: 'Outlast an eliminated rival in cutthroat' },
  'untouchable': { icon: '⚡', about: 'Reach a 10-game win streak' },
  'world-traveler': { icon: '🌍', about: 'Play in 5 different venues' },
  'iron-man': { icon: '🦾', about: 'Play 500 games' },
  'after-dark': { icon: '🌙', about: 'Win 25 night-venue games and reach a 1,000 rating' },
};
