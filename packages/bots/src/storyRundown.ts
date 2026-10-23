/**
 * DEE'S CO-OP RUNDOWNS (co-op spec §5.1, §7.4, §8.8–8.9): the briefing
 * Dee gives a PAIR at the tape, selected by the PAIR's facts — never by
 * either player's solo history (solo histories feed only the awareness
 * FACTS that choose between pairFirst and pairAwareness). Four variants:
 *
 *   pairFirst       — case (a): the pair's true first meet at the stop.
 *   pairAwareness   — case (b)/(d): the room knows at least one of them.
 *   pairReturnLoss  — case (e): the pair lost here together before.
 *   pairReturnClear — case (e): the pair holds this stop together.
 *
 * Case 'finale' (the pair holds the King's double mark) selects NO
 * rundown — the proposal scene owns that sit-down (Phase 4). The solo
 * 34 rundown scripts are a different set with different keys; the two
 * sets never play in each other's mode.
 *
 * VOICE FENCE: every script here is TEXT ONLY until the Phase 4
 * mini-bake records it in Dee's own cast voice. No surface may voice
 * them from any other sprite, catalog, or speech synthesis — the panel
 * renders her written words with her byline, exactly as specced.
 */
import type { AwarenessCase } from './storyAwareness';
import type { StoryStop } from './story';

export type CoopRundownVariant = 'pairFirst' | 'pairAwareness' | 'pairReturnLoss' | 'pairReturnClear';

export interface CoopRundown { variant: CoopRundownVariant; stopId: string; text: string }

/* =====================================================================
 * pairFirst (spec §8.8, VERBATIM)
 * ===================================================================== */

export const PAIR_FIRST_RUNDOWNS: Record<string, string> = {
  'porch': 'First time here as a pair — so meet Ray and Miss Pat. His porch, her memory. Ray bids low on purpose and books high just to watch you do the math; Pat remembers every bid ever made up here. Neither of them knows you-two yet. That’s worth one hand of mystery. Spend it well.',
  'barbershop': 'Meet Mr. Coleman and June — his chair, her century. Coleman runs this shop and this table the same way: slow, certain, no wasted motion. June has seen every kind of player twice. You’re a new entry in a very old book, the both of you together. Keep the pages boring.',
  'rec-center': 'Lil’ Man and Trey. This gym is theirs and the noise is a weapon. Lil’ Man’s game swings — some days world-beater, some days beatable — and Trey never met a moment he wouldn’t hype. They don’t know you as a pair yet. New teams confuse reads. Stay confusing.',
  'cookout': 'Keisha and Teisha — the twins. They finish each other’s sentences and each other’s setups. Keisha bids up, Teisha keeps receipts. Together they’re the first real exam on this route, and you-two are an untested answer sheet. Talk more than feels natural. Pairs die quiet.',
  'corner': 'Smoke and Redd. Smoke is patience with a price tag; Redd is a lit match with a bid paddle. They hunt nils for sport on this corner, and my daddy’s name is tangled up in why this stop matters. They don’t know your pair yet — first impressions here get spent, not saved.',
  'church-basement': 'Deacon Ford and Sister Mae. Quiet room, heavy lessons. Nils are worth double down here, which means every quiet bid is a loaded one. They’ll teach you who they are one hand at a time, the way they teach everybody. You-two are new here together — learn faster than they expect.',
  'rooftop': 'Poet and Seven. Poet talks in circles that turn out to be maps; Seven barely talks at all and misses nothing. Blind nils are worth 300 on this roof and the strange is normal. As a pair you’re unread — protect that. The wind up here carries tells.',
  'high-rise': 'Velvet and the Accountant. She smiles like a brochure and under-bids like a trap; he has never once been surprised by a number. Everything up here is priced — including a brand-new partnership, which they’ll try to buy cheap. Don’t sell.',
  'the-pjs': 'Captain Block and Brick. The Captain runs this block; Brick is the reason people pay on time. This is as real as the route gets before the legends. They know everybody — except you-two, yet. New pairs either become a problem or a story here. Choose problem.',
  'legends': 'Queenie and Ace. Living history, both of them — Queenie’s warmth is real and so is the knife in it. Ace loves a nil more than anybody alive and plays like the cards owe him. You’re the newest thing in an old room. Old rooms respect exactly one thing: winning.',
  'king': 'The King of the Block, and his Ringer — the quietest dangerous man on the route. Two wins in a row takes the crown; anything less is a visit. He’ll read you as a pair before you’ve finished your first bid, so make the read wrong on purpose. Everything before this was tuition.',
};

/* =====================================================================
 * pairAwareness (spec §7.6, VERBATIM — Dee's frame: the opponents know
 * YOU; they don't know you-two.)
 * ===================================================================== */

export const PAIR_AWARENESS_RUNDOWNS: Record<string, string> = {
  'porch': 'Okay, so here’s the wrinkle: Ray and Pat know YOU. They watched you clear this porch, and they’ve had time to think about it. Your partner? Brand-new book to them — and they’ll spend the first hands reading them like a bedtime story. Don’t let the lemonade fool you twice.',
  'barbershop': 'Coleman and June remember you — barbershop memory is forever, and they keep receipts in that chair. What they don’t know is you-two. No rhythm yet, no shortcuts, and June will test your partner’s patience just to watch you react. Play boring early. Boring is safe here.',
  'rec-center': 'Lil’ Man and Trey have the scouting report on you from last time — the jokes are already written. Your partner’s the mystery, and this gym loves a mystery until it solves one. Lil’ Man’s game still runs hot and cold; if your partner stays steady while he swings, we eat.',
  'cookout': 'The twins remember you — and twins remember EVERYTHING, twice. They don’t know your partner, which means the finishing-each-other’s-sentences show gets one new victim. Keisha will feed them, Teisha will read them. Keep your partner close and your bids honest.',
  'corner': 'Smoke knows your game from the last run — priced it already. Your partner walks in unpriced, and on this corner unknown is either armor or a target. Redd will test them early just to put a number on them. My daddy’s debt don’t care who’s new. Play it like that.',
  'church-basement': 'Deacon Ford and Sister Mae remember your last visit down here — every bid, every lesson. Your partner hasn’t heard a single one yet, and down here ignorance gets tithed. Nils are worth double and Mae counts everything. Teach as we go — quietly.',
  'rooftop': 'Poet has theories about you specifically — you’re a chapter now. Your partner is a blank page, and Seven reads blank pages fastest of anybody. Blind nils are worth 300 up here and the wind takes the rest. Keep your partner close; this roof eats strays.',
  'high-rise': 'Velvet has your file — she under-bids on purpose and plays over the number, and she’ll assume your partner does whatever YOU taught them. The Accountant prices pairs, not players, and right now you-two are an unrated bond. Play below your reputation until it costs them.',
  'the-pjs': 'Captain Block remembers you — the block keeps books better than the bank. Brick has already forgotten your partner exists, which is the most dangerous thing about Brick. You’re known here; they’re unproven here. That gap is either our cover or our wound.',
  'legends': 'Queenie and Ace have a table history with you — Ace loves a nil like rent’s due and he knows your tells from last time. Your partner is the only mystery left in this room, and legends solve mysteries for sport. Let them be the surprise. Just make it a good one.',
  'king': 'He remembers you. The King forgets nothing and forgives less — and the Ringer’s silence will be spent entirely on your partner, the one unknown in the room. Two wins in a row or the crown stays. You’re not new here — so there’s no excuse left to hide behind. Neither is there for them.',
};

/* =====================================================================
 * Return variants (spec §8.9 — written at build under the solo return
 * discipline: short, 35–55 words, only stored PAIR facts referenced —
 * attempts/clears TOGETHER — plus the stop's public tells; pair framing
 * throughout. Owner-vetoable like every Dee script.)
 * ===================================================================== */

export const PAIR_RETURN_LOSS_RUNDOWNS: Record<string, string> = {
  'porch': 'Back to Ray’s porch, together this time. Last run he read your pair rhythm by the third hand — all porch, no hurry, and Pat counted every crack in it. So change the tempo on him: talk more, bid plain, and don’t let the lemonade slow your reads down.',
  'barbershop': 'Coleman and June have seen you-two now — the book has a page with both your names on it. Last time June read the hesitation between your bids like print. Kill the tell: decide together early, bid it clean, and make her read a new chapter tonight.',
  'rec-center': 'The Rec remembers you-two — mostly the noise you made losing. Lil’ Man’s swing is still the whole scouting report: when he runs hot he’s a problem, when he cools he’s a donation. Ride out the hot streak together, don’t chase it, and take the gym quiet.',
  'cookout': 'The twins have tape on you-two now — a whole cookout’s worth. Last time they finished your sentences AND your setups, which means your signals are family knowledge. So change the language tonight: fewer looks, more plain talk, and make them learn a new pair from scratch.',
  'corner': 'Smoke priced you-two last run, and the Corner doesn’t do discounts on a second read. He knows which of you hunts and which of you hesitates. Switch the jobs tonight — let the hunter play patient, the patient one draw blood — and make his price wrong.',
  'church-basement': 'Ford and Mae have a lesson plan with you-two’s names on it now — they kept every bid from last time, and down here nils pay double for students who don’t adjust. Adjust quietly: protect the quiet bids, count everything twice, and let the basement teach somebody else tonight.',
  'rooftop': 'Poet’s had time to write theories about you-two, and Seven’s read the draft. Last run the wind took your tells one hand at a time. So give them less weather to read: tighter bids, no victory laps at three hundred points of sky, and finish each other’s thoughts silently.',
  'high-rise': 'Velvet’s file on you-two has a second entry now, and the Accountant’s priced the pair, not just the players. Last time you paid retail for your own reputation. Play below it tonight — bid under your names, let their math chase a pair that isn’t in the file.',
  'the-pjs': 'The block keeps books, and you-two have a page now — last run’s page, with the ending nobody here forgot. Captain Block will open with exactly the pressure that worked before. Expect it, eat it together, and make him turn a page he hasn’t written yet.',
  'legends': 'Queenie and Ace have eaten with you-two once — legends don’t forget a meal or a mistake. Last time Ace hunted his nil through your whole game and found it. This time make the hunt expensive: watch the quiet bids as a pair, and guard your books like history’s watching. It is.',
  'king': 'You’ve stood in this room as a pair and left without the crown — he remembers the shape of that night, and so does the quiet one beside him. Two wins in a row is still the whole price. Whatever he read in you-two last time, make the second read a different book.',
};

export const PAIR_RETURN_CLEAR_RUNDOWNS: Record<string, string> = {
  'porch': 'You-two hold this porch — Ray’s said so twice this week, which for Ray is a parade. Champions don’t get the friendly version twice, though: Pat’s kept every page of your pair rhythm. So enjoy the lemonade, then change one habit they wrote down and make the old book wrong.',
  'barbershop': 'The book says you-two passed this class — Coleman’s handwriting, June’s underline. Replays in that chair don’t get the student discount, though: they’ll test whether the clear was learning or luck. Play it boring, play it by the book, and make them grade the same exam twice.',
  'rec-center': 'You-two own a piece of this gym now — the Rec doesn’t give those back, but it does re-test them loud. Lil’ Man’s been telling YOUR story all week, his version, where he almost had you. Let him talk. Then run the same steady pair game and correct the record.',
  'cookout': 'The twins clear a plate for you-two now — that’s family, and family is exactly the danger. They’ve SEEN your pair finish each other’s setups, so tonight the show runs both directions. Keep one signal they haven’t catalogued, spend it late, and don’t let the welcome make you soft.',
  'corner': 'Smoke doesn’t congratulate — the best you get is the price going up, and yours did. You-two cleared this corner together, which makes you a known quantity with a known number. Known gets hunted here. Play like strangers with a shared secret and make the corner re-price the pair.',
  'church-basement': 'Mae put you-two in the book with the good handwriting — cleared, together, under this roof. That earns respect down here, and respect earns their BEST lessons, not their kindest. Nils still pay double and Mae still counts everything. Bring the same quiet discipline and one new wrinkle she hasn’t tallied.',
  'rooftop': 'You-two have a chapter in Poet’s book now — a finished one, which is rarer than you’d think up here. Seven reads finished chapters closest of all. The wind still takes the careless, and blind nils still pay three hundred. Play like the pair that already knows how the story ends.',
  'high-rise': 'Your pair’s bond got rated upstairs — cleared at this address, together, and Velvet doesn’t upgrade files for free. The re-test is the trap: they’ll play you like the file, every lean included. So be the file for two hands, then be somebody the Accountant has to re-audit mid-game.',
  'the-pjs': 'The block knows you-two cleared it under these lights — that buys a nod from the Captain, not a rematch discount. Brick remembers every book of the clear, including the lucky ones. Run the replay like you belong on the page you’re already on: no proving, just collecting.',
  'legends': 'You-two ate at this table and left with the legends’ respect — Queenie said so, which means it’s in the record. Champions’ replays are where legends check whether it was real. Ace will hunt the same nil; Queenie will watch how you carry winning. Carry it quiet and carry it together.',
  'king': 'The crown carries you-two’s names now — both of them, together, in his archive and everybody else’s. Coming back as champions of this room doesn’t soften it; he collects rent on legends too. Two in a row bought the crown once. Whatever he brings for the holders, meet it like holders.',
};

const RUNDOWN_SETS: Record<CoopRundownVariant, Record<string, string>> = {
  pairFirst: PAIR_FIRST_RUNDOWNS,
  pairAwareness: PAIR_AWARENESS_RUNDOWNS,
  pairReturnLoss: PAIR_RETURN_LOSS_RUNDOWNS,
  pairReturnClear: PAIR_RETURN_CLEAR_RUNDOWNS,
};

/**
 * The co-op rundown for a sit-down, selected by the awareness case +
 * the pair's own facts (spec §5.1 precedence: King finale states →
 * awareness → pair return → pair first). Returns null when no script
 * plays (the finale case, or a defensive miss) — the panel then does
 * not render, per the rundown presentation discipline.
 */
export function coopRundownFor(stopId: string, awareCase: AwarenessCase, pair: { attempts: number; clears: number }): CoopRundown | null {
  if (awareCase === 'finale') return null;
  const variant: CoopRundownVariant =
    awareCase === 'b' || awareCase === 'd' ? 'pairAwareness'
    : awareCase === 'e' ? (pair.clears > 0 ? 'pairReturnClear' : 'pairReturnLoss')
    : 'pairFirst';
  const text = RUNDOWN_SETS[variant][stopId];
  return text ? { variant, stopId, text } : null;
}

/** Word count of a script (the §8.9 return discipline is 35–55). */
export const rundownWordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/* =====================================================================
 * SOLO RUNDOWNS (rundown spec §3/§5, VERBATIM): Dee's meet-them
 * briefing on the SOLO route — 11 first-meet + 11 return-after-loss +
 * 11 return-after-clear + the King leg-2 piece = 34 scripts, selected
 * by the PLAYER's stored facts at the stop (attempts / cleared /
 * doublePending). A different set from the pair rundowns above, with
 * different keys; the two sets never play in each other's mode.
 *
 * The texts below are byte-for-byte the RECORDED display texts: each
 * is the key of Dee's take in her cast sprite (lilcuz-f), recorded in
 * the 2026-10-22 consultation + rundown batch — straight apostrophes
 * and all (sha1('dee' + '|' + text)[:12] of the Porch first-meet is
 * the spec's worked example, 872b0ad54292). Do not "fix" punctuation
 * here without re-recording: the sprite lookup is the text itself.
 * ===================================================================== */

export type RundownVariant = 'first' | 'returnLoss' | 'returnClear' | 'kingLeg2';

export interface StoryRundown { variant: RundownVariant; stopId: string; text: string }

export const RUNDOWN_FIRST: Record<string, string> = {
  'porch': "Okay, so — that's Uncle Ray and Miss Pat, and this porch is basically where I learned what cards even were. Don't let the lemonade fool you. Ray bids low on purpose and then books high just to watch you do the math out loud — and Pat? Pat remembers every bid you made three hands ago. And three years ago. They're not the fastest table on the route, and they're not trying to be. Play patient, count honest, and don't try to out-talk them. Nobody out-talks this porch. We just gotta out-book 'em.",
  'barbershop': "Mr. Coleman and Miss June. Fifty years in that shop, and everything in it is by the book — including the game. No jokers here, Ace Down, so the deck is honest and so are they. Coleman's a retired teacher: he plays textbook, every book accounted for, no gifts. June's the one to watch, though. Quiet, exact — she bids what the mirrors show her, and she does not guess. Beating them ain't about tricks. It's about doing the plain thing right, every single hand, till they respect it.",
  'rec-center': "Lil' Man and Trey. Yeah, those two. Lil' Man beat me one summer and I stopped coming around — that's the history, so let's just put it on the table. Here's the real scouting report: they're loud because loud works. Twenty seconds a move, all that yelling, and pretty soon you're playing fast just to keep up — and fast is where the mistakes live. Lil' Man bids like momentum is a card, and some games he's a world-beater and some games he just... isn't. Trey's the echo — whatever Lil' Man says, louder. Play your speed, not theirs. Breathe between tricks.",
  'cookout': "Keisha and Teisha — the Twins. And before you ask: yes, it's as weird as it looks. They finish each other's sentences, each other's bids, everything. Keisha bids for two people like she's holding one big hand, because far as she's concerned, she is. Teisha's quieter, meaner — she plays her sister's cards as careful as her own. This is the first table on the route that actually counts what you throw away, so nothing's free anymore. The test here ain't them, it's us: do we cover each other like they do? That's Mama's standard, and they grade on it.",
  'corner': "Okay. Listen to me on this one. That's Smoke, and that's Redd, and this corner is the first table where the game can hurt you. My daddy owed these people. That bill is part of why we're here. Smoke counts everything — every card, every bag, every look — and he bids like the count is the whole conversation. Redd barely talks, and when he bids, he bids mean. They hunt nils for sport. Ours and theirs. So: no lazy bids, no free books, and if one of us goes nil, the other one guards it like rent money. Quiet table. Loud consequences.",
  'church-basement': "Mind your manners at this one — and your arithmetic. That's Deacon Ford, sweet as pie until the cards come out, and Sister Mae, who runs this basement like it owes her money. Mae ran this whole route herself, years back. Stopped one stop short. She doesn't talk about why, so I won't either. What I will say: nils are worth double down here, and these two treat a nil like a calling — planned, prayed over, and covered like family. Deacon preaches patience and practices it. Mae covers her partner the way she'd cover her own child. Play clean, guard your partner, and do not — do not — get caught grandstanding in Sister Mae's basement.",
  'rooftop': "Poet and Seven. I won't pretend I understand this table — nobody does, that's kind of the point of it. Poet talks like the game already happened and he's just telling you how. Riddles, prophecies, all that. Except his calls keep coming true, so laugh careful. Seven's said maybe ten words since 2019 — but his game is the blind nil. Up here it's always on and worth three hundred, and he calls it without looking, like scripture. These two play the deepest game on the route so far. Everything they throw means something. Watch what they keep, not what they say. Well — except Poet. Watch what he says too.",
  'high-rise': "Velvet and the Accountant. Start with what everybody gets wrong: Velvet smiles like she's lost and bids like she's broke. Neither one is true. She left our street with forty dollars and came back owning the view — she under-bids on purpose and then plays over her number, so don't you dare relax on her little bid. The Accountant is the opposite problem: no smile, no mercy, just math. He counts every card played and every bag owed, and his nil math has ended more runs than any pair alive. Nothing at this table is an accident. So we don't give them accidents.",
  'the-pjs': "Captain Block and Brick — the Captains. This is their street, their light, their table, and they play like the fence is a rule: nothing gets through. The Captain fell one stop short of the King in his own run, years ago, and instead of quitting he took the door — he's been pricing everybody who walks through it for twenty years. Brick doesn't talk, doesn't blink, doesn't react. Twice in twenty years, supposedly. Don't play to her — you can't read a wall. Play to the Captain's pride. This is home turf at full strength. We earn this one or we don't take it.",
  'legends': "Queenie and Ace. Take a second, because this is the history part. Queenie ran this route before it was a route — beat Vegas in '87 and stayed gracious about it for fifty years, which tells you everything about the kind of dangerous she is. Grace at full strength. Ace is her mirror: precise to the card, remembers every hand he's ever dealt — including the night the lights went out in '03, at the King's table. And Ace gambles. He'll nil at you smiling, because betting on people is the only bet he still enjoys. They're not guarding this table. They're guarding us from what's behind it.",
  'king': "The King of the Block — and the Ringer. Twenty-two years, nobody's taken this table. Not because he's magic. Because there's no mistake to wait for. The King counts everything, forgets nothing, and plays the cards in front of him instead of the name across from him — you should be so lucky as to get underestimated; you won't be. The Ringer? Nobody knows his name, nobody knows his game, and that blank page is the point — you can't scout what isn't written down. And the terms, so you hear them from me first: we have to beat them twice in a row. First win banks nothing. So pace yourself — this is two games wearing one crown.",
};

export const RUNDOWN_RETURN_LOSS: Record<string, string> = {
  'porch': "Same porch, same two. You know the book on them now: Ray bids low and books high, Pat's keeping the count in pencil. Last time they taught the lesson. This time we take notes faster. Nothing fancy — patient cards, honest math. We owe them one.",
  'barbershop': "Back to the classroom. Coleman hasn't changed a page and June hasn't missed a bid since we left. Last time we bid our hopes. This time we bid our cards, by the book, until the book runs out. Sit down — chapter two.",
  'rec-center': "Run it back. The noise is the same, and now you know it's a costume — underneath it they're beatable when we play our speed. Lil' Man's either a world-beater today or he isn't. Either way: breathe between tricks and let him outrun his own cards.",
  'cookout': "The Twins again. Last time they covered each other better than we did — that's the whole report. This time when one of us stretches, the other one's already there. Mama's standard. We know it now. Let's meet it.",
  'corner': "You know what this table costs now. Smoke counted us out loud last time; Redd didn't have to say a word. So we play it quiet and exact: no lazy bids, nils guarded like rent money. The bill doesn't get bigger unless we let it.",
  'church-basement': "Back to the basement. Sister Mae expected us — losing here doesn't surprise her, and neither will winning, if we earn it. Nils are still doubled, still guarded like family. Play clean, cover your partner, and let patience do the preaching this time.",
  'rooftop': "Poet's already written this ending too, probably. Last time his calls came true because we played like they would. Seven's blind nil is still up there waiting. Watch what they keep, not what he says — and let's write our own ending this time.",
  'high-rise': "Velvet's still smiling. The Accountant's still counting — and now his ledger has a page on us. Last time we gave them accidents. This time we give them nothing: her little bid is a lie, his math only works on what we show him. Show less.",
  'the-pjs': "Their street, their light — same as last time, and that's the point: nothing here changes, so we have to. The Captain's still pricing us at the door. Brick's still a wall. Play to his pride, not her silence. Earn it or don't take it — round two.",
  'legends': "Queenie poured the same grace on us and Ace kept the same ledger. They turned us back to protect us — that's what a guardrail is. So let's show them the lesson landed: precise cards, no gifts, and make Ace's gambles cost him for once.",
  'king': "He's still undefeated, and now the record has our name in it. Good. That means we're part of the story he's bored of telling. Twice in a row is still the price — nothing about that changed. What changed is we've seen his whole game at full strength. Bring it back to him.",
};

export const RUNDOWN_RETURN_CLEAR: Record<string, string> = {
  'porch': "Victory lap rules: Ray's got new jokes and the same old patience, and Pat wrote our last win down in pencil — she can still revise it. They'll bid a little prouder this time. Let 'em. We know this porch.",
  'barbershop': "We hold this table, but the book doesn't care — Coleman teaches the same lesson to winners, and June's read our whole game once already. Expect her to bid like she knows us. Because she does. Stay textbook-clean.",
  'rec-center': "Champions coming back to the Rec — Lil' Man's been rehearsing this rematch at full volume since we left. He'll come out faster and prouder. That's fine. Fast and proud is how he gives books away. Our speed, again.",
  'cookout': "The Twins have had a whole week of family dinners to talk about us. Whatever we did weakest last time, they'll test it first — twins share notes. Cover each other like family and the notes won't help them.",
  'corner': "We paid this bill once. Smoke remembers — a cleared account on his corner means he'll count us twice as careful this time, and Redd's silence will be priced higher. No discounts for returning customers. Earn it again.",
  'church-basement': "Sister Mae counts us as hers now — which means she'll test us harder, not softer. Champions get the real sermon. Nils still doubled, her cover still family-tight. Play like we belong in her book. We do. Keep proving it.",
  'rooftop': "Poet called our win last time — after it happened, in verse, like he'd called it before. Charming. Seven nodded once. Upgrades, both. The blind nil is still scripture up here. Watch what they keep.",
  'high-rise': "The Accountant has a whole file on us now — every habit, priced. Velvet will smile like it means something new. It doesn't. It means she's adjusting. We adjust faster: vary the rhythm, starve his ledger.",
  'the-pjs': "We took their street once. The Captain does not forget a price — he'll charge us double in respect this time, and Brick will still be a wall about it. Home tables defend champions harder. Come take it twice.",
  'legends': "Queenie and Ace, with respect both ways now. They dealt the King himself once — beating them twice is its own sentence in the block's history. Ace will gamble bigger this time. Let him. His heart's the tell.",
  'king': "We did the thing nobody does — twice in a row, crown and all. And he's still here, still bored, still perfect, because that's what kings do after the story ends. There's nothing left to prove at this table. Play it like a celebration and he'll try to ruin it anyway. That's respect.",
};

/** The King, leg 2 only: leg 1 won, the double live, the gun on the felt. */
export const RUNDOWN_KING_LEG2: string = "One down. That's the first time anybody's made him play a second game for it in years. The iron's on the felt and the room knows what it means: no more teaching, no more patience. He plays this one like the crown is actually leaving. Nothing banks unless we do it again — right now. Same two, full strength, no secrets left. Finish it.";

const SOLO_RUNDOWN_SETS: Record<Exclude<RundownVariant, 'kingLeg2'>, Record<string, string>> = {
  first: RUNDOWN_FIRST,
  returnLoss: RUNDOWN_RETURN_LOSS,
  returnClear: RUNDOWN_RETURN_CLEAR,
};

/** Every solo rundown script (34), in route order — the corpus dump's
 *  `rundown` family enumerates exactly this list. */
export function allSoloRundowns(): StoryRundown[] {
  const out: StoryRundown[] = [];
  for (const stopId of Object.keys(RUNDOWN_FIRST)) {
    out.push({ variant: 'first', stopId, text: RUNDOWN_FIRST[stopId]! });
    out.push({ variant: 'returnLoss', stopId, text: RUNDOWN_RETURN_LOSS[stopId]! });
    out.push({ variant: 'returnClear', stopId, text: RUNDOWN_RETURN_CLEAR[stopId]! });
    if (stopId === 'king') out.push({ variant: 'kingLeg2', stopId, text: RUNDOWN_KING_LEG2 });
  }
  return out;
}

/**
 * The solo rundown for a sit-down (rundown spec §3 precedence,
 * top-down): the King's leg-2 piece while the double is pending,
 * then return-after-clear at a table the player holds, then
 * return-after-loss once a stop has turned them back, else the
 * first-meet briefing. Returns null only on a defensive miss (a
 * stop with no script) — the panel then does not render.
 */
export function rundownFor(stop: StoryStop, facts: { attempts: number; cleared: boolean; doublePending?: boolean }): StoryRundown | null {
  if (stop.id === 'king' && facts.doublePending) {
    return { variant: 'kingLeg2', stopId: stop.id, text: RUNDOWN_KING_LEG2 };
  }
  const variant: Exclude<RundownVariant, 'kingLeg2'> =
    facts.cleared ? 'returnClear' : facts.attempts >= 1 ? 'returnLoss' : 'first';
  const text = SOLO_RUNDOWN_SETS[variant][stop.id];
  return text ? { variant, stopId: stop.id, text } : null;
}
