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

/** Name gender for voices: f / m / n (neutral: either voice). Every BOT_NAMES entry is tagged (tests enforce it). */
export type NameGender = 'f' | 'm' | 'n';
export const NAME_GENDER: Record<string, NameGender> = {
  Marcus: 'm', Keisha: 'f', Dre: 'm', Tasha: 'f', 'Big Mike': 'm', Nia: 'f', Rell: 'm', Ty: 'n', Jasmine: 'f', Malik: 'm',
  Aaliyah: 'f', DeShawn: 'm', Imani: 'f', Jamal: 'm', Tiana: 'f', Andre: 'm', Kiara: 'f', Darius: 'm', Monique: 'f', Terrell: 'm',
  Lucia: 'f', Mateo: 'm', Sofia: 'f', Diego: 'm', Carmen: 'f', Luis: 'm', Yesenia: 'f', Rafa: 'm', Ana: 'f', Javi: 'm',
  Priya: 'f', Arjun: 'm', Anjali: 'f', Ravi: 'm', Mei: 'f', Kenji: 'm', Hana: 'f', Jin: 'n', Minh: 'n', Linh: 'f',
  Kofi: 'm', Amara: 'f', Tunde: 'm', Zuri: 'f', Kwame: 'm', Ayo: 'n', Fatima: 'f', Omar: 'm', Layla: 'f', Yusuf: 'm',
  Siobhan: 'f', Liam: 'm', Ingrid: 'f', Sven: 'm', Nikos: 'm', Elena: 'f', Dmitri: 'm', Olga: 'f', Tomás: 'm', Bea: 'f',
  'Auntie Pat': 'f', Unc: 'm', Cuz: 'n', 'Lil Ray': 'm', Peaches: 'f', Smoke: 'n', Boo: 'n', Sunny: 'n', Ace: 'n', Queenie: 'f',
  Moe: 'm', Cookie: 'f', Kai: 'n', Noa: 'n', Leilani: 'f', Rocco: 'm', Gigi: 'f', Bubba: 'm', Skye: 'f', Jojo: 'n',
};
const hashName = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619); } return h >>> 0; };
/** The gender a bot name is tagged with (unknown names, e.g. "Bot 5", are neutral). */
export function nameGender(name: string): NameGender { return NAME_GENDER[name] ?? 'n'; }
/** The voice gender actually used: the name's gender; neutral names pick one deterministically (stable per name). */
export function voiceGender(name: string): 'f' | 'm' {
  const g = nameGender(name);
  return g === 'n' ? (hashName(`voice:${name}`) % 2 ? 'f' : 'm') : g;
}
/** his / her / their for a player name (humans and unknown names: their). */
export function possessive(name: string | undefined): 'his' | 'her' | 'their' {
  const g = name ? nameGender(name) : 'n';
  return g === 'f' ? 'her' : g === 'm' ? 'his' : 'their';
}

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
