import { type Rng, createRng } from '@spades/rules';

/**
 * Bot names: picked at random per game (offline from the game seed, online by the server), never twice at a table
 * and never a human player's name. Fun, varied first names / nicknames across genders and cultures.
 */
export const BOT_NAMES: readonly string[] = [
  'Marcus', 'Keisha', 'Dre', 'Tasha', 'Big Mike', 'Nia', 'Rell', 'Ty', 'Jasmine', 'Malik',
  'Aaliyah', 'DeShawn', 'Imani', 'Jamal', 'Tiana', 'Andre', 'Kiara', 'Darius', 'Monique', 'Terrell',
  'Lucia', 'Mateo', 'Sofia', 'Diego', 'Carmen', 'Luis', 'Yesenia', 'Rafa', 'Ana', 'Javi',
  'Priya', 'Arjun', 'Anjali', 'Ravi', 'Mei', 'Kenji', 'Hana', 'Jin', 'Minh', 'Linh',
  'Kofi', 'Amara', 'Tunde', 'Zuri', 'Kwame', 'Ayo', 'Fatima', 'Omar', 'Layla', 'Yusuf',
  'Siobhan', 'Liam', 'Ingrid', 'Sven', 'Nikos', 'Elena', 'Dmitri', 'Olga', 'Tomás', 'Bea',
  'Auntie Pat', 'Unc', 'Cuz', 'Lil Ray', 'Peaches', 'Smoke', 'Boo', 'Sunny', 'Ace', 'Queenie',
  'Moe', 'Cookie', 'Kai', 'Noa', 'Leilani', 'Rocco', 'Gigi', 'Bubba', 'Skye', 'Jojo',
];

/** `count` distinct names, none in `taken` (case-insensitive). Falls back to "Bot N" if the pool runs out. */
export function pickBotNames(count: number, taken: Iterable<string> = [], rng: Rng | string = createRng(String(Math.random()))): string[] {
  const r = typeof rng === 'string' ? createRng(`names:${rng}`) : rng;
  const used = new Set([...taken].map((x) => x.trim().toLowerCase()));
  const pool = BOT_NAMES.filter((x) => !used.has(x.toLowerCase()));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    if (pool.length) out.push(pool.splice(r.int(pool.length), 1)[0]!);
    else { let k = out.length + 1; while (used.has(`bot ${k}`) || out.includes(`Bot ${k}`)) k++; out.push(`Bot ${k}`); }
    used.add(out[i]!.toLowerCase());
  }
  return out;
}
