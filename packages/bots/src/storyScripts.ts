/**
 * Story Mode SCENES (scene pass, 2026-10-21 — owner: "it should be like
 * sitting in a scene from a movie… more energy between the characters, rich,
 * telling a story"). Every stop is written as a scripted multi-character
 * scene with an arc: an intro with a real stake, a win scene that pays the
 * stake off, a lose scene that cuts the other way, and a loss-return intro.
 * Characters talk TO EACH OTHER at least as much as to the player; Dee is in
 * every scene, and her arc (green → believing → belonging) is the spine.
 *
 * Tone: grounded neighborhood drama — warmth and humor on the surface, real
 * stakes, history and quiet menace underneath; dialogue with subtext; what
 * it costs to climb. Original characters and lines throughout.
 *
 * Continuity is FACT-DRIVEN, never faked: a line that references an earlier
 * stop (or Dee's growth, or a prior loss) lives in the `gated` lists below
 * and only fires when the stored fact it names is true for this track
 * (cleared stop ids from the progress endpoint). `beatsFor` merges gated
 * lines into the scene at their marked positions.
 *
 * The scene continues DURING the game: each stop also carries mid-scene
 * beats and table exchanges (see STORY_MID_SCENES / STORY_TABLE_EXCHANGES
 * below), keyed to real game milestones and hand flow — never random pools.
 *
 * REBALANCE (2026-10-21, owner: "most of the convo is happening on the intro
 * screen instead of at the table — the game itself should be the
 * experience"): the intro is a SHORT sit-down (≤5 beats; returns/cleared
 * bands 3; the King ≤6 — he carries the double-or-nothing terms beat and
 * one extra ceremony beat). The arc the long intros used to narrate moved
 * INTO the match verbatim: each stop's signature story beat now fires at
 * the `midgame` milestone (after hand 2) from STORY_MID_SCENES.signature,
 * and Dee's own made nil earns a memory-gated endgame callback
 * (STORY_CALLBACKS.deeNilMade). Outros are closers (win ≤4, loss ≤3; the
 * King's win keeps 5 — the graduation). Caps are pinned in the bots tests.
 */
import type { StoryStop } from './story';
import { RAIL_INTRO_SUBJECTS, STORY_KING_RAIL_OUTRO, STORY_RAIL_INTRO } from './storyRail';
import { awarenessMeetBeats, awarenessOpenerLength, type AwarenessFacts } from './storyAwareness';
import { KING_PROPOSAL_LINES } from './storyKingDouble';
import { GUIDE_FINALE } from './storyGuide';

export interface StoryBeat {
  /** a STORY_CHARACTERS id, or 'you' (the player) */
  speaker: string;
  line: string;
  /** A physical prop the scene player stages on the table as this beat
   *  lands (it stays for the rest of that scene). Only the King's double
   *  or nothing uses it: 'kingGun' — the revolver he lays on the felt when
   *  he states the double's terms (storyKingDouble). The matching prop
   *  then lies on the 3D table for the whole of leg 2, keyed to the
   *  double-pending state (Table/Scene), never to this marker. */
  prop?: 'kingGun';
}

/** A beat that only exists when a stored fact is true (data honesty). */
export interface GatedBeat extends StoryBeat {
  /** id of a stop that must be CLEARED on this track for the line to fire */
  requiresCleared?: string;
  /** insert position in the scene (beat index); appended when absent */
  at?: number;
}

export interface StoryScript {
  /** first visit to this stop on this track */
  intro: StoryBeat[];
  /** fact-gated extra beats woven into `intro` when their fact holds */
  introGated?: GatedBeat[];
  /** back after losing here (attempts > 0, not yet cleared) */
  introReturn: StoryBeat[];
  outroWin: StoryBeat[];
  outroLose: StoryBeat[];
}

const b = (speaker: string, line: string): StoryBeat => ({ speaker, line });
const g = (speaker: string, line: string, requiresCleared: string, at?: number): GatedBeat =>
  ({ speaker, line, requiresCleared, ...(at !== undefined ? { at } : {}) });

export const STORY_SCRIPTS: Record<string, StoryScript> = {
  /* ================= 1 · THE PORCH — Uncle Ray & Pat =================
   * Stake: respect. Ray runs the porch like a court; Dee is Ray's late
   * friend's daughter and has something to prove to the whole block,
   * starting here. Under the jokes: the porch used to run itself — Ray is
   * quietly testing whether the next generation can carry it. */
  porch: {
    intro: [
      b('pat', 'Ray. Ray, look up from them cards a minute. We got company coming up the walk.'),
      b('uncleRay', 'I see ’em, I see ’em. Well. If it ain’t Dee, all grown and walking like she got somewhere to be.'),
      b('dee', 'That’s why I brought us here first. If we’re gonna run the whole route — the shop, the Corner, all of it — I wanted to start where it started.'),
      b('uncleRay', 'Alright. House rules, since Pat gets mad when I skip ’em: we play to 250, nobody’s in a hurry, and my wife keeps score, so no creative counting.'),
      b('pat', 'I keep score because YOU can’t be trusted near a pencil when you’re losing, Raymond.'),
    ],
    introReturn: [
      b('uncleRay', 'Well, well. Back on my porch. Glasses from last time ain’t even dry.'),
      b('pat', 'They came back, Ray. That’s the part that matters. Plenty don’t.'),
      b('pat', 'He bites a little. Sugar in his coffee helps. Sit down, babies — run it back.'),
    ],
    outroWin: [
      b('pat', 'I’m writing it down, Raymond. "Dee came home and took the porch." Your daddy would’ve talked about this for a year, baby.'),
      b('pat', 'Next is the Barbershop, baby. Mr. Coleman plays it by the book — the whole book, out loud. You think THIS table talks?'),
      b('uncleRay', 'Tell Coleman… tell him Ray said the porch is still standing. He’ll know what it means.'),
      b('dee', 'One down. Ten to go. …We really doing this, huh?'),
    ],
    outroLose: [
      b('uncleRay', 'And THAT is the lesson for today. No charge.'),
      b('dee', 'And he kept coming back. …Okay. Okay, we keep coming back. That’s the whole thing, isn’t it?'),
      b('uncleRay', 'Now she’s learning. Table’s warm when you’re ready. It ain’t going nowhere. Neither am I.'),
    ],
  },

  /* ================= 2 · THE BARBERSHOP — Mr. Coleman & June =================
   * Stake: history. The shop is the block's memory; Coleman tests whether
   * the young ones studied where they came from. Under it: the street
   * outside is changing, shops closing — the book is his way of keeping it. */
  barbershop: {
    intro: [
      b('mrColeman', 'Mind the clippers. …June. Look who’s in my doorway.'),
      b('june', 'I see them, Coleman. Dee. And Dee brought the one who took Ray’s porch. Word travels this street faster than cards.'),
      b('dee', 'No jokers at all… okay. Textbook.'),
    ],
    introGated: [
      g('mrColeman', 'Ray’s porch first, then my shop. That’s the right order. That’s how it was always done.', 'porch', 3),
    ],
    introReturn: [
      b('june', 'Back for another lesson. Good. The book doesn’t change. Students do.'),
      b('mrColeman', 'Same chairs, same rules. Ace Down. But I noticed something last time — you play like you’re apologizing. In this shop we don’t apologize to cards.'),
      b('june', 'Sit, then. Chapter two.'),
    ],
    outroWin: [
      b('mrColeman', 'Clean. Correct. Every book accounted for… You play like you were raised by people who read.'),
      b('june', 'He means that as the highest thing he knows how to say. And I counted, Coleman — she read your hand by the second deal.'),
      b('mrColeman', 'The Rec Center is next, Lord help you. Two boys over there play loud and fast and think noise is a strategy.'),
      b('mrColeman', 'And when you pass the shop window coming back — knock. Winners in this classroom always report back.'),
    ],
    outroLose: [
      b('june', 'The book says that’s what happens when you bid your hopes instead of your cards.'),
      b('mrColeman', 'No shame in it. Everybody loses in this chair before they win in it. I did. In ’79. June still brings it up at holidays.'),
      b('june', 'Because it taught you. Come back when you’ve studied, babies. The classroom keeps its hours.'),
    ],
  },

  /* ================= 3 · THE REC CENTER — Lil' Man & Trey =================
   * Stake: belonging. The Rec is where the block's kids grow up; Lil' Man
   * acts like he owns it because the Rec is the one place that never turned
   * him away. Under the noise: he tests whether Dee still belongs to the
   * neighborhood now that she's "running routes." */
  'rec-center': {
    intro: [
      b('lilMan', 'AYE! AYE! LOOK WHO WALKED IN! DEE! DEE FROM THE BLOCK! AND DEE BROUGHT A WITNESS!'),
      b('trey', 'A WITNESS! FOR THE BEATING! SOMEBODY GET THE CAMERA, THIS GON’ BE EDUCATIONAL!'),
      b('dee', '…Hi, Lil’ Man. Hi, Trey.'),
      b('trey', 'THEN LET’S TEST IT! TWENTY SECONDS A MOVE! NO THINKING! THINKING IS HOW THE PORCH PEOPLE PLAY!'),
      b('dee', 'Don’t let them speed you up into stupid. That’s the whole game here — the noise IS the defense. Play your cards, breathe between tricks.'),
    ],
    introReturn: [
      b('lilMan', 'THEY CAME BACK! THEY CAME BACK TO THE REC! TREY, THEY CAME BACK!'),
      b('trey', 'BACK FOR MORE NOISE! THE CLOCK IN MY HEAD NEVER STOPPED! IT COUNTED YOUR WHOLE DRIVE HOME!'),
      b('lilMan', 'YOUR SPEED GOT YOU LAST TIME’S RESULT! SIT DOWN! THE TOLL WENT UP!'),
    ],
    outroWin: [
      b('lilMan', '…they beat us. TREY. THEY BEAT US AT OUR OWN SPEED. IN MY ROOM.'),
      b('lilMan', 'Nah. Nah, hold on. …You ain’t change, Dee. You just — you aim higher now. That’s different from changing. Tell ’em at the Cookout Lil’ Man said that.'),
      b('dee', '…Thank you. The Twins are next, y’all — Keisha and Teisha, by the grill. They finish each other’s—'),
      b('dee', 'Ears ringing. Heart full. Let’s go meet the Twins before these two start a rematch league.'),
    ],
    outroLose: [
      b('lilMan', 'TOO SLOW! TOO SLOW! THE CLOCK ATE Y’ALL UP AND ASKED FOR SECONDS!'),
      b('dee', 'Don’t listen to the volume. Listen to what happened: we rushed. That’s all. That’s fixable.'),
      b('lilMan', 'SHE RIGHT THOUGH! COME BACK AND PAY SLOWER! THE REC AIN’T GOING NOWHERE! NEITHER AM I! EVER!'),
    ],
  },

  /* ================= 4 · THE COOKOUT — Keisha & Teisha =================
   * Stake: trust. The Twins test whether your partnership is real — they
   * play like one mind, and they probe yours. Under the weird: their mama
   * hosted this cookout for thirty years; keeping it alive is their job
   * now, and strangers at the family table are vetted hard. */
  cookout: {
    intro: [
      b('keisha', 'Oh good, you’re—'),
      b('teisha', '—right on time. We saved you the seats by the grill. The ones with the—'),
      b('keisha', '—wobbly legs. Sit careful. Dee, baby, you look—'),
      b('dee', '…See what I meant? They do that the whole time. Bids too. Sentences, bids, whole thoughts.'),
      b('teisha', 'Three stops is a weekend. We’ve had arguments longer than your whole partnership. Here’s the test, since you came to the family table: when your partner bids scared, do you cover her — or do you count her mistake?'),
    ],
    introReturn: [
      b('teisha', 'The ones who lost came—'),
      b('keisha', '—back. We knew before the gate opened. The grill was already lit.'),
      b('keisha', '—showing. We just haven’t dealt it yet.'),
    ],
    outroWin: [
      b('keisha', 'They actually—'),
      b('teisha', '—covered each other. Every time. Did you see it, when her partner went quiet in the third hand and she just… knew?'),
      b('keisha', 'We saw. That’s not a weekend. That’s a foundation. You may tell people the Twins said so.'),
      b('teisha', 'Don’t spend it all in one place, babies. The Corner is next, and Smoke and Redd don’t—'),
    ],
    outroLose: [
      b('teisha', 'Told you at the gate how this—'),
      b('keisha', '—ends. You play like two solos in matching chairs. The cards showed everybody.'),
      b('keisha', '—keeps score. Run it back.'),
    ],
  },

  /* ================= 5 · THE CORNER — Smoke & Redd =================
   * Stake: survival/respect on cold ground. The Corner isn't family —
   * it's territory, and Smoke decides who the street takes seriously.
   * Dee has history here she hasn't told the player: her daddy owed the
   * Corner, once. Quiet menace; almost no jokes. */
  corner: {
    intro: [
      b('smoke', '…You’re Dee.'),
      b('redd', 'That’s her. Route girl. Porch, shop, all that. Five hundred here. No stories, no lessons.'),
      b('redd', 'Enough. Cards. You bid it, you better have it. And if either one of you is thinking nil — think again. We hunt those for breakfast.'),
      b('dee', '…Heads up. The whole way. These two don’t bluff about hunting nils. They study them.'),
    ],
    introReturn: [
      b('smoke', 'Back again.'),
      b('dee', 'Last time taught me the price of a loose bid out here. I paid it. Not paying twice.'),
      b('smoke', 'We’ll see what the cards say about your education. Deal.'),
    ],
    outroWin: [
      b('smoke', '…Hmph. Clean work. No panic. No noise.'),
      b('redd', 'I don’t say this. I’m not gonna say it again. They played the corner like they belonged on it.'),
      b('smoke', 'The block’s gonna hear about this one — from me. That’s worth more than the points, Dee. Whatever your daddy owed… the corner considers the name square. What you build on it now is yours.'),
      b('dee', '…I didn’t know I was holding my breath for that. Church Basement next. Deacon Ford, Sister Mae.'),
    ],
    outroLose: [
      b('redd', 'That’s what the Corner does. Come back when your bids mean something.'),
      b('smoke', '…Door’s open. It always is. Winning here ain’t.'),
      b('dee', 'I wanted that one too much and it showed in my cards. That’s on me. We tighten up and we come back. That’s all.'),
    ],
  },

  /* ================= 6 · THE CHURCH BASEMENT — Deacon Ford & Sister Mae =====
   * Stake: judgment, sweetly delivered. The basement raised half the block;
   * Mae and Ford decide who is "sound." Under the sugar: Mae lost her own
   * route run decades ago at the Pj's and never talks about it — she is
   * deciding whether Dee gets to finish what she couldn't. */
  'church-basement': {
    intro: [
      b('sisterMae', 'Well bless your hearts, look at you two, running the whole route! Sit, babies. Lemonade? It’s fresh.'),
      b('deaconFord', 'Down here we play sweet — and nils count double, praise be. Two hundred a nil, made or busted. The Lord rewards the bold and invoices the careless.'),
      b('sisterMae', 'Dee, sugar, your grandmother would want me to be kind to you. She did NOT say a blessed thing about the cards.'),
      b('dee', 'I remember being small down here. Folding chairs taller than me. I thought you two were the final bosses of the whole church.'),
    ],
    introReturn: [
      b('sisterMae', 'Back in the basement! The Lord loves a persistent spirit, and so do I.'),
      b('deaconFord', 'Same as before — nils double. You remember. We remember too. That’s the thing about a church basement, children: everybody remembers, and most of them are kind about it.'),
      b('dee', 'Most of them. We’ll take those odds. Deal us in.'),
    ],
    outroWin: [
      b('sisterMae', 'Well. Bless MY heart. Beaten in my own basement, fair and square, with my own lemonade on the table.'),
      b('deaconFord', 'The Rooftop next, children. Poet talks in circles and Seven hasn’t said a word since 2019. Pray before you go — and after, some would say.'),
      b('sisterMae', 'Dee. Come here a second. …Your grandmother sat where you’re sitting and beat me twice in one night. She’d have some opinions about tonight, and every one of them would start with "that’s my grandbaby." You’re further than I got. Don’t you dare stop at the strange tables.'),
      b('dee', 'No, ma’am. We don’t stop.'),
    ],
    outroLose: [
      b('sisterMae', 'Oh, babies. The basement keeps the lights on for rematches. Come on back now, you hear?'),
      b('deaconFord', 'A setback is just a setup. That’s what I always say.'),
      b('sisterMae', 'Ford says it because it’s true at the altar AND the table. Dee — I stopped running after one hard loss, once, a long time ago. I think about it every time somebody’s grandbaby sits down here. Don’t be me in that one way. Be me in the others.'),
    ],
  },

  /* ================= 7 · THE ROOFTOP — Poet & Seven =================
   * Stake: mystery/truth. The roof is where the block's watchers sit above
   * it all. Poet's riddles are all literally true; Seven's silence is the
   * loudest judgment on the route. Dee starts speaking their language —
   * the arc turning point. */
  rooftop: {
    intro: [
      b('poet', 'Two climbers reach the roof where the quiet man waits. The sky has seen this game before. It ended… how it ends.'),
      b('dee', 'That’s Poet. That’s how he talks. The quiet one is Seven. Blind nils are live up here, worth three hundred, and Seven loves them the way other people love oxygen.'),
      b('dee', 'Seven — I’m Dee. In case the roof forgot. …He nodded. Poet, he NODDED.'),
      b('seven', '…Deal.'),
      b('poet', 'A nod from Seven is a paragraph from anyone else. Guard it. Now — the cards are already dealt, friends. We are only here to watch you notice. Blind nils at three hundred, and the wind takes the careless. Climb in.'),
    ],
    introReturn: [
      b('poet', 'The climbers return. The roof remembers. Seven remembers. Seven always remembers.'),
      b('dee', 'Still not a word out of him. Okay. Blind nils live — watch his seat like weather.'),
      b('poet', 'Weather is only weather to those who won’t read it. Deal.'),
    ],
    outroWin: [
      b('poet', 'And so the sky learns a new ending. …Seven nodded — twice. In one night. The roof will talk about this, in its way, which is mostly silence.'),
      b('dee', 'The High-Rise next. Velvet and the Accountant. Money table — every point counted twice: once on paper, once in pride.'),
      b('poet', 'A word before you descend, climber. The girl who arrives at the penthouse is not the girl who climbed my roof. Tell her Poet said the stairs are working.'),
      b('dee', '…I’ll tell her. I think she already knows.'),
    ],
    outroLose: [
      b('poet', 'The roof keeps what it catches. Climb again when the wind changes.'),
            b('dee', 'I’ll climb it again. That’s the whole point of a roof — it stays up there whether I’m ready or not. We come back readier.'),
b('dee', 'He never said a word and somehow that loss felt personal. …It felt TRUE, is what it felt. We read the hand wrong and he knew before we did. Run it back.'),
    ],
  },

  /* ================= 8 · THE HIGH-RISE — Velvet & The Accountant =========
   * Stake: class and worth. The penthouse is the block's money dream and
   * its warning label at once. Velvet came from Dee's street and never
   * looks back — or says she doesn't. The Accountant counts everything,
   * including what people owe themselves. */
  'high-rise': {
    intro: [
      b('velvet', 'Penthouse rules, darlings: everything up here is expensive, including mistakes.'),
      b('accountant', 'Five hundred points. For the record: I have counted every card played on this floor since 2016. Yours will be added to the ledger.'),
      b('dee', 'Evening. …Velvet. I know that name. You’re from over by the Rec. My mama pointed your picture out in the paper once.'),
      b('velvet', 'Did she. And did she tell you the rest — that I left that street with forty dollars and a bus pass, and that nobody from it has called since except to ask for something? Careful, darling. Nostalgia is the only currency I don’t accept.'),
      b('dee', 'He means me. She’s a sharp, he’s a calculator, and I’m the "variable." …You know what? Fine. Price me.'),
    ],
    introReturn: [
      b('accountant', 'Returning parties. Your previous engagement has been noted, itemized, and filed under "unfinished."'),
      b('velvet', 'Sit, darlings. Most people take the elevator down and stay down. Whatever this is — pride, hunger — it photographs well.'),
      b('dee', 'File this under unfinished too, then. We’re about to finish it.'),
    ],
    outroWin: [
      b('accountant', '…The ledger balances in your favor. I do not say this often. I do not say it twice.'),
      b('velvet', 'The Pj’s next, darlings. The Captains, on their own street, under their own light. Win there and the whole block says your names — the ones who left AND the ones who stayed.'),
      b('accountant', 'One line for the road: the Pj’s is next. Captain Block holds it, Brick holds him, and the lights hold everybody. Street rules again after my columns — go learn the weather down there.'),
      b('velvet', '…Careful, darling. Keep talking like that and I’ll have to feel something before the elevator. Go. Take the street’s name with you — somebody should carry it properly.'),
    ],
    outroLose: [
      b('velvet', 'Charged to experience, darlings. The elevator runs both ways.'),
      b('accountant', 'Rematch entries remain open. For now. Interest accrues in pride, payable on return.'),
      b('dee', 'We got priced tonight. Fine. Everybody who ever climbed anything got priced on the way up. We pay it and climb again.'),
    ],
  },

  /* ================= 9 · THE PJ'S — Captain Block & Brick =================
   * Stake: the crown almost — home turf defended like family honor.
   * Captain Block once RAN this route as a young man and fell at the
   * Legends; his defense of this table is pride and scar tissue both.
   * Dee is nearly who she's becoming; Brick (silent, watchful) sees it. */
  'the-pjs': {
    intro: [
      b('captainBlock', 'So the route’s real. You made it to the Pj’s. MY table. MY light. Everybody shining on this route got stopped right here — ask around.'),
      b('dee', 'That’s Captain Block. And that’s Brick — she’ll stare through you for four hours and call it conversation. This is the venue’s own all-star team, and they defend this streetlight like it’s family. Because to them, it is.'),
      b('dee', 'Then hold it fair, Captain. We didn’t come this far for a handout OR a wall. Standard Joker, five hundred — your rules.'),
      b('brick', '…Play good. Both of you. I’ll be watching the part where it matters.'),
    ],
    introGated: [
      g('captainBlock', 'Ray’s porch, Coleman’s shop, my table. She’s doing it in the old order. Respect that, Brick.', 'porch', 2),
    ],
    introReturn: [
      b('captainBlock', 'Back under the streetlight. Brick kept your chairs. She does that. It’s not kindness — it’s bookkeeping. She wants the loss finished properly.'),
      b('dee', 'Same table, same Captains. We know what they do now — no excuses, no surprises. We play our game.'),
      b('captainBlock', 'Then play it. The light’s not getting younger.'),
    ],
    outroWin: [
      b('captainBlock', '…On my own street. Under my own light. …Alright. ALRIGHT. Brick, stop smiling — you never smile. …She’s smiling, Dee. In twenty years that’s twice.'),
      b('dee', 'We’re really going. Queenie and Ace. The LEGENDS. One table between us and the King.'),
      b('captainBlock', 'Listen to me, both of you, and hear the whole thing: what’s past them isn’t a table. It’s the story this whole block tells itself about itself. The King IS the route. Everything else was directions. …Go get your names in the story. I’ll hold the door.'),
    ],
    outroLose: [
      b('captainBlock', 'The Pj’s don’t give it away. Not to tourists. Not to stories-in-progress. You want this street, you take it.'),
      b('dee', 'So close to the end and the street said no. …No is not never. It’s just no, today, at this light. We run it back.'),
      b('captainBlock', 'That’s the first true thing the end of the route teaches everybody. Say it again at the door, louder, so it follows you home.'),
    ],
  },

  /* ================= 10 · THE LEGENDS' TABLE — Queenie & Ace =============
   * Stake: blessing. The Legends don't gatekeep out of ego — they decide
   * who is READY, because they sent one unready kid to the King in '03
   * (the night the lights went out) and it went bad. Their test is care
   * disguised as a card game. */
  legends: {
    intro: [
      b('queenie', 'Well. Look what the route dragged in. Ace, baby, they beat the CAPTAINS.'),
      b('dee', 'Miss Queenie. Mr. Ace. …I used to think you two were statues. Stories people made up to scare kids off the good tables.'),
      b('queenie', 'Statues don’t shuffle, baby. Sit down. House truth, since you’ve earned one: nobody sits with the King until WE say they’re ready. That ain’t pride. That’s a scar.'),
      b('ace', 'For what it’s worth — I watched the girl at the Pj’s. She holds a door like somebody taught her. …Show us the rest. Deal.'),
    ],
    introGated: [
      g('ace', 'Porch to Pj’s in the old order. That’s how the first ones did it, back when the route was just the neighborhood minding its own.', 'porch', 2),
    ],
    introReturn: [
      b('ace', 'The hopefuls again. Queenie, they’ve got the one thing you can’t teach.'),
      b('queenie', 'Stubborn. Same as us at their age. Sit down, babies — legends’ rules, same as before. And remember what the test actually measures.'),
      b('dee', 'Not just the cards. We heard you. All the way.'),
    ],
    outroWin: [
      b('queenie', 'That’s it. That’s the game I used to play. That’s how you carry a partner through a dark hand — did you see it, Ace? She didn’t grab. She COVERED.'),
      b('queenie', 'Already done, baby. The King knows you’re coming. Truth is, he’s known since the Porch. Men like him hear a route the way you hear weather coming.'),
      b('dee', '…This is it. The last table. Whatever happens up there — thank you. Both of you. For the guardrail.'),
      b('ace', 'Go take his crown, kids. And when it’s heavy — and it will be heavy — remember the weight is the receipt. It proves you were really here.'),
    ],
    outroLose: [
      b('queenie', 'Not yet, babies. And hear me: "not yet" from us is love, not a wall. The King eats "almost" for breakfast. Come back when it’s all the way in you.'),
      b('ace', 'Cards’ll be here. So will we. That’s more promise than most get.'),
      b('dee', '…Okay. Not yet means there’s a yet. We go earn the yet.'),
    ],
  },

  /* ================= 11 · THE KING OF THE BLOCK — The King & The Ringer ===
   * Stake: everything the route means. The King is not a villain — he is
   * the standard, and his secret is that he's been WAITING to be beaten
   * right: an undefeated crown is a lonely room, and the block needs a
   * new story more than he needs the streak. Heavy, quiet, earned. */
  king: {
    intro: [
      b('king', 'So the stories are true.'),
      b('dee', '…That’s him. That’s actually him. And the quiet one beside him is his ringer — nobody knows his name, and after tonight I understand why nobody asks twice.'),
      b('king', 'Porch to Pj’s, Legends’ blessing on your shoulders. Sit down, both of you. Mind how you sit. Chairs remember.'),
      b('king', 'Hear the terms, then, since nobody leaves my table confused: one win here is a story people tell. Two in a row — back to back, no breathing room — is a crown. Beat me twice, or don’t call it beating me.'),
      b('ringer', '…Twelve runs ended at this table. I remember all twelve. Sit down.'),
      b('dee', '…We didn’t come to play a legend. We came to play the last table on the route. That’s what we’re gonna do.'),
    ],
    introReturn: [
      b('king', 'Back at my table. Most don’t come twice. The ringer respects it — look, he almost nodded.'),
      b('dee', 'We know how he plays now. We know how WE play now. That’s the difference this time.'),
      b('king', 'Then no speeches. The cards have been waiting to finish this conversation.'),
    ],
    outroWin: [
      b('king', '…Ha. HA! Since ’03. Since the LIGHTS WENT OUT. And it took you two — a route-runner and the partner who grew up along the whole road. Look at the ringer, children. Look at him. He’s SMILING. I have known that man thirty years and seen it twice.'),
      b('dee', 'We did it. We DID it. The whole route — porch to King. …I’m gonna tell this story forever, and nobody’s gonna believe the half of it.'),
      b('king', 'Then hear the last of it. You didn’t just beat a table tonight. You made it OUT. The porch, the corner, the basement, my room — those are behind you now, and they stay yours. What’s ahead is the other game. The ranked rooms. The televised tables. The league with its numbers and its lights.'),
      b('king', 'Go be professional at them, little one. That world grades everything and forgives nothing, and it has no idea what the block sent it. …Dee. When they ask where you learned — and they WILL ask — say the route. Say it proud.'),
      b('king', 'And Dee. Your daddy’s name is spoken kindly on every table of this route again. You did that. Not the crown — YOU. Now go home and call your mama before the street does. Champions first. Stories after.'),
    ],
    outroLose: [
      b('king', 'Close isn’t a crown. But it is closer than most ever stand, and I do not say that to be kind — I have forgotten how to be kind about cards.'),
      b('dee', 'We came THIS far. We are not ending on a loss at the last table. Run. It. Back.'),
      b('king', 'My table keeps a chair for you. Both chairs. Earn them again — I will be here, being bored a little less than I was. That is your doing too.'),
    ],
  },
};

/* =====================================================================
 * MID-SCENE BEATS — the scene continues while the cards are out.
 * Each fires at most once per game, at a REAL milestone, and picks up the
 * stop's stake. Selection is deterministic from game state (see
 * storyScene glue in apps/web): milestone + who's ahead picks the lines.
 * ===================================================================== */

export type StoryMilestone = 'firstHand' | 'midgame' | 'pullAway' | 'nilAttempt' | 'matchPoint' | 'finalHand';

/** pullAway lines split by who's running away with it: 'us' = the player's side, 'them' = the pair. */
export interface MidSceneSet {
  firstHand: StoryBeat[];
  /** The stop's signature story beat — the arc the trimmed intro used to
   *  narrate up front, now told at midgame (after hand 2), cards out. */
  signature: StoryBeat[];
  pullAwayUs: StoryBeat[];
  pullAwayThem: StoryBeat[];
  nilAttempt: StoryBeat[];
  matchPoint: StoryBeat[];
  finalHand: StoryBeat[];
}

export const STORY_MID_SCENES: Record<string, MidSceneSet> = {
  porch: {
    firstHand: [b('uncleRay', 'First hand’s just introductions. The cards are shaking hands so we don’t have to.'), b('pat', 'Manners, Raymond. They’re winning the introductions.')],
    signature: [b('dee', '…This is where the block learned Spades. Uncle Ray taught half the neighborhood at this table. My daddy too.'), b('pat', 'Your daddy sat right where you’re standing, talking big with a handful of nothing. God rest him — he could talk a bid out of thin air.'), b('uncleRay', 'And lost doing it, more Saturdays than not. But he showed up. That’s the whole sermon, friend: on this porch, you show up, you sit down, you play honest.')],
    pullAwayUs: [b('pat', 'Ray. Ray, they’re walking away with your porch.'), b('uncleRay', 'I see it, woman. I’m letting ’em build confidence. That’s teaching.')],
    pullAwayThem: [b('uncleRay', 'See how the porch leans? That’s forty years of house advantage, friend.'), b('dee', 'It’s one stretch. Porches lean back, too. Watch.')],
    nilAttempt: [b('pat', 'Ooh, a nil on MY porch. Bold as brass.'), b('uncleRay', 'Bold is one word. Your daddy tried that here in ’96, Dee. We still tell it at cookouts.')],
    matchPoint: [b('uncleRay', 'Well now. Somebody’s about to take my porch or die trying. Pat, get the good glasses ready — either way there’s toasting or washing.')],
    finalHand: [b('pat', 'Last hand, babies. Whatever happens, you showed up and played honest. That’s the whole sermon, like he said.'), b('dee', 'Let’s finish the sermon, then.')],
  },
  barbershop: {
    firstHand: [b('mrColeman', 'Ace Down in here. No jokers. Jokers are shortcuts, and shortcuts are how a street forgets itself. You play the cards you’re dealt, the way they were dealt to me in ’78.'), b('june', 'First chapter read. Coleman’s counting your habits already.'), b('mrColeman', 'Habits are just history that hasn’t introduced itself yet.')],
    signature: [b('mrColeman', 'Nobody "just" plays in this shop. Fifty years I been cutting hair and dealing cards in the same ten feet. Governors sat in that chair. So did men who couldn’t pay — played me for the cut. The wall remembers all of it.'), b('june', 'What he’s not saying: half those men are gone now, and the shops on either side of us are nail salons. This table is the last classroom on the block. So we don’t waste lessons.'), b('mrColeman', 'Textbook. Let me tell you about textbook. In ’83, a boy sat there — your seat, Dee — bid seven holding four and a prayer. Whole shop stopped cutting. You know why I remember? Because June here took the book that set him, without looking up from her magazine.'), b('mrColeman', 'And Dee — your friend Ray sent word the porch is standing. Porches fall, baby. Shops too. Show me the route ain’t just talk.')],
    pullAwayUs: [b('mrColeman', 'Hmm. The students are ahead in my classroom. June, note the date.'), b('june', 'Noted. In pen.')],
    pullAwayThem: [b('mrColeman', 'The book is patient. The book has been patient since before your street had a name.'), b('dee', 'Books get read cover to cover, Mr. Coleman. We’re still early chapters.')],
    nilAttempt: [b('june', 'A nil in Ace Down. No jokers to hide behind, baby. That’s courage or arithmetic.'), b('mrColeman', 'In ’83 courage and arithmetic looked exactly alike until the last trick.')],
    matchPoint: [b('mrColeman', 'Match point in my shop. The clippers stop for this. Forty years, and the room still knows when it’s real.')],
    finalHand: [b('june', 'Last hand, children. However it ends — the wall remembers, and so will we.'), b('mrColeman', 'Play it like you studied. That’s all anybody here ever asked.')],
  },
  'rec-center': {
    firstHand: [b('lilMan', 'FIRST HAND DOWN AND THE ROOM IS ALREADY SWEATING! TREY, THE ROOM IS SWEATING!'), b('trey', 'THAT’S THE REC, BABY! WE RUN HOT IN HERE!')],
    signature: [b('lilMan', 'HI?! HI?! Two stops in and it’s "hi"?! Porch Dee woulda had a JOKE ready! Route Dee talks like she late for a meeting!'), b('dee', 'I am the SAME person. I was in this room last month beating you at YOUR table, or did the clock knock that loose too?'), b('lilMan', 'OOOH! THERE SHE IS! THERE SHE IS! Okay! Okay, she still in there! Trey, she still in there!'), b('lilMan', 'BREATHE?! ON MY CLOCK?! Dee, I run this room! This room raised me when the street was — this room is MINE, and don’t nobody famous walk through it without paying the toll!')],
    pullAwayUs: [b('trey', 'THEY’RE RUNNING AWAY WITH IT! IN OUR ROOM! LIL’ MAN, YOUR ROOM!'), b('lilMan', 'I SEE IT! I’M LOUD, NOT BLIND!')],
    pullAwayThem: [b('lilMan', 'SCOREBOARD! READ IT! THE REC PROTECTS ITS OWN!'), b('dee', 'Scoreboards change. Rooms don’t get a vote. Play.')],
    nilAttempt: [b('trey', 'A NIL?! AT OUR SPEED?! THAT’S LIKE WHISPERING AT A CONCERT!'), b('lilMan', 'RESPECTFULLY: THAT IS THE CRAZIEST THING I EVER SAW AND I LIVE HERE!')],
    matchPoint: [b('lilMan', 'MATCH POINT! SOMEBODY’S LEGACY GETS DECIDED IN MY ROOM TONIGHT! I LOVE THIS ROOM!')],
    finalHand: [b('trey', 'LAST HAND! NO MORE CLOCK AFTER THIS! GIVE IT EVERYTHING INCLUDING THE NOISE!'), b('dee', 'We end it our way. Loud is fine. Ours.')],
  },
  cookout: {
    firstHand: [b('keisha', 'First hand tasted—'), b('teisha', '—promising. The grill’s not the only thing warming up.')],
    signature: [b('keisha', '—holding? No. It’s thirty years. It’s sharing a room, a ride, a life. The question, babies, is whether you two have ANY of that — or if you’re just two people who showed up together.'), b('dee', 'We’re three stops deep. We got something.'), b('keisha', 'Answer on the cards. It’s the only place answers—'), b('teisha', '—count. Eat first. Play after. That’s mama’s law, and mama’s law outlives mama.')],
    pullAwayUs: [b('teisha', 'They’re pulling away, and they’re doing it—'), b('keisha', '—together. Did you feel it? That cover in the second book? That’s real.')],
    pullAwayThem: [b('keisha', 'Family’s ahead. The table’s just remembering whose—'), b('teisha', '—house it is. Don’t take it personal, babies. Take it instructional.')],
    nilAttempt: [b('teisha', 'A nil at the family table—'), b('keisha', '—is a promise made in front of everybody. We ALL heard it.')],
    matchPoint: [b('keisha', 'Match point at mama’s cookout. Even the grill went—'), b('teisha', '—quiet. Play it like family’s watching. Family is.')],
    finalHand: [b('teisha', 'Last hand, babies. Whatever the cards say, you sat at this table like you—'), b('keisha', '—belonged. Not everybody gets told that here.')],
  },
  corner: {
    firstHand: [b('redd', 'First hand. They’re still standing. Note it.'), b('smoke', 'Noted. Standing ain’t staying, though.')],
    signature: [b('smoke', 'You walk different than your daddy did. He walked in here loud. Owed everybody, smiled at everybody. You walk in quiet. Smart.'), b('dee', 'You knew my daddy?'), b('smoke', 'Everybody on this corner knew your daddy. What they owe out here gets… remembered. Not saying you carry it. Saying the corner remembers what a name carries, and watches what the name does next.'), b('smoke', 'One more thing, since she won’t say it. Dee. Whatever you think you’re proving — prove it out THERE. Porch people, shop people, they love you free. Out here love costs. I don’t hand out serious for nothing.'), b('dee', 'I didn’t come for a handout.')],
    pullAwayUs: [b('smoke', '…They’re ahead. On my corner. Redd, are you seeing what I’m seeing?'), b('redd', 'I’m seeing it. I don’t have to like it to see it.')],
    pullAwayThem: [b('smoke', 'The corner leans the way it leans. Nothing personal was ever said out here — it’s just weight.'), b('dee', 'Weight shifts. Keep watching.')],
    nilAttempt: [b('redd', 'A NIL. OUT HERE.'), b('smoke', 'Hunting season, then. You called it into the open, friend. Whatever happens to it is arithmetic now.')],
    matchPoint: [b('smoke', 'Match point on the Corner. Understand what that means: nobody gets here by accident. Not even you two. …Not even you two.')],
    finalHand: [b('smoke', 'Last hand. Everything the corner thinks of you gets decided in the next thirteen cards.'), b('dee', 'Then let it decide right.')],
  },
  'church-basement': {
    firstHand: [b('sisterMae', 'First hand in the basement, and the lemonade’s still cold. That’s a blessing and a pace warning, babies.'), b('deaconFord', 'Amen to both.')],
    signature: [b('deaconFord', 'What Mae isn’t saying, children: this basement has fed this neighborhood through every hard year it ever had. Funerals, rent parties, babies’ first birthdays. The table you’re sitting at held all of it. So we play like it matters. It does.'), b('sisterMae', '…Were. Baby, there was a year I ran tables the way you’re running them. Got all the way to the Pj’s with the whole basement praying. I came home with a casserole and a lesson. Nobody here asks me about it. I’d like to keep it that way — and I’d like YOU to finish it. Both things are true.'), b('deaconFord', 'Mae.'), b('sisterMae', 'I’m fine, Ford. I’m always fine. Deal the cards, Deacon — and children? Double nils. One good nil hand swings the whole game down here. Choose your courage carefully.')],
    pullAwayUs: [b('deaconFord', 'Mae. The children are running away with the fellowship hall.'), b('sisterMae', 'I have eyes, Ford. I also have cake. Cake helps losses. We may be serving cake.')],
    pullAwayThem: [b('sisterMae', 'The basement’s ahead, as the basement tends to be. Sweet is a strategy, babies. It just doesn’t announce itself.'), b('dee', 'Announced now. We adjust.')],
    nilAttempt: [b('deaconFord', 'A nil — at DOUBLE value. Two hundred points of courage, made or busted.'), b('sisterMae', 'Bold in the house of the Lord. I taught Sunday school thirty years and never once saw the shy inherit a thing.')],
    matchPoint: [b('sisterMae', 'Match point in my basement. Well. Somebody’s testimony is about to change.')],
    finalHand: [b('deaconFord', 'Last hand, children. Play it like the whole congregation’s watching — because in a manner of speaking, they always are.'), b('sisterMae', 'And babies? Win or lose, you conducted yourselves. That’s recorded somewhere more permanent than a scorecard.')],
  },
  rooftop: {
    firstHand: [b('poet', 'One hand written into the sky. The climbers’ hands don’t shake anymore. Seven noticed. Seven notices shaking.')],
    signature: [b('poet', 'The girl translates. She didn’t use to. Growth is a draft that finds every open window. Tell them, climber — what did the Corner leave in your pocket?'), b('dee', '…How do you know about— he does that. Don’t ask how. It’s worse when you ask how.'), b('dee', 'You climbed up here for a card game. Every stop on this route, somebody built a whole world around one table. Why?'), b('poet', 'Because the ground kept changing its mind about what it was. Up here, a table is a promise the sky has to keep an eye on.')],
    pullAwayUs: [b('poet', 'The climbers rise. Careful — altitude makes every fall a biography.'), b('dee', 'We’re not falling. We’re reading wind.')],
    pullAwayThem: [b('poet', 'The roof leads, as roofs do: quietly, and from above.')],
    nilAttempt: [b('poet', 'A blind nil under an open sky. Three hundred points of faith with your eyes closed. Seven approves. Seven invented approving of exactly this.')],
    matchPoint: [b('poet', 'Match point, at the height of the story. Even Seven is leaning forward, and Seven leans for nothing in this decade.')],
    finalHand: [b('poet', 'The final hand arrives like weather everyone predicted and nobody prepared for.'), b('dee', 'We prepared. Watch us notice, Poet.')],
  },
  'high-rise': {
    firstHand: [b('accountant', 'Hand one: recorded. Your tendencies are already a column.'), b('velvet', 'He says that to everyone, darlings. It only scares the ones it’s true about.')],
    signature: [b('accountant', 'Sentiment aside — and I keep it itemized — your run is statistically interesting. Seven tables attempted by a partnership with a combined history of… her, mostly. The girl is the variable. I intend to price the variable.'), b('velvet', 'You keep looking at the view, darling. Look at the chairs instead. Four chairs, thirty-one floors up — do you know what it costs to keep a room like this for a game nobody televises?'), b('dee', 'Tell me.'), b('velvet', 'Everything you can’t put in a photograph. This room is the receipt for my whole life. That’s why losing in it is so expensive. Not money. Proof.')],
    pullAwayUs: [b('velvet', 'They’re ahead, Accountant. On your floor. In your ledger.'), b('accountant', '…A rounding error. It will be corrected. It will be itemized as corrected.')],
    pullAwayThem: [b('accountant', 'The house extends its lead. Compound interest, darlings. It only ever flows one way up here.'), b('dee', 'Interest rates change. Ask anybody who lived through anything.')],
    nilAttempt: [b('accountant', 'A nil. Bold. I have a column for outcomes of boldness on this floor. It has two entries: one fortune, one cautionary tale.'), b('velvet', 'He won’t say which column tonight goes in. He loves the suspense. He’d deny loving anything.')],
    matchPoint: [b('velvet', 'Match point in the penthouse. The city below has no idea. The two of you are about to be a line in his ledger forever — as a win, or as a lesson.')],
    finalHand: [b('accountant', 'Final hand. Every card from here is priced at full emotional market value.'), b('dee', 'Then we spend carefully. All in, but carefully.')],
  },
  'the-pjs': {
    firstHand: [b('captainBlock', 'First hand down and the light’s still mine. For now. Brick’s counting your souls, don’t mind her.')],
    signature: [b('captainBlock', 'Family. Hmph. Girl, when I was your age I ran a route too. Didn’t have a name for it. Got to the Legends’ table with the whole projects behind me — and came home with a story I don’t tell. So when I say earn it, I’m not being poetic. I’m being PRECISE.'), b('dee', 'You ran it? Nobody ever said that. Not Ray, not Mae—'), b('captainBlock', 'Because the ones who fall don’t get songs, Dee. They get quiet. And then they get a table of their own to defend, so the next ones have something real to climb. …That’s the part nobody warns you about the top: it comes with a door you hold for everybody behind you.'), b('captainBlock', 'The light matters because a street with a witness behaves different. I learned that the night mine went out — ’03, the whole city dark, and one room uptown stayed lit like nothing happened. I decided: my street gets a light that doesn’t answer to anybody’s grid but mine.'), b('captainBlock', 'Brick held ME that night, in the way that counts. Been holding the door since, so nobody has to wonder if it’s open. Ask her sometime. She’ll blink once. That’s the whole autobiography.')],
    pullAwayUs: [b('captainBlock', '…They’re ahead. On this street. Brick. BRICK. Are we a TOUR STOP now?'), b('dee', 'You’re not a stop, Captain. You’re the door. We knew that coming in.')],
    pullAwayThem: [b('captainBlock', 'The Pj’s lean the way the Pj’s lean. Twenty years this light watched me hold it. Nothing about tonight changes the rent.'), b('dee', 'We’re not paying rent. We’re earning a door of our own. You said it yourself.')],
    nilAttempt: [b('captainBlock', 'A nil under MY light. Every kid on this block just felt that in their teeth. Brick felt it too — look at her, almost interested.')],
    matchPoint: [b('captainBlock', 'Match point at the Pj’s. Understand: this is the hand the whole block stops cooking to watch. I can feel ’em at the fences.')],
    finalHand: [b('captainBlock', 'Last hand under this light. Whatever the cards do — the girl who plays it ain’t leaving here a tourist. Not anymore.'), b('dee', 'I never was one. Deal it home, Captain.')],
  },
  legends: {
    firstHand: [b('ace', 'First hand read. Queenie’s watching the spaces between the cards. That’s where she’s always watched.'), b('queenie', 'Spaces are where the truth keeps its coat, baby.')],
    signature: [b('ace', '’03. Night the lights went out on the whole block. We sent a boy up to that table who had the cards but not the… weather. Thought winning was the whole of it. The King didn’t just beat him. The King UNMADE him. Boy never played another hand. Not cards. Anything.'), b('queenie', 'So now we test the ones who come. Five hundred, legends’ rules, and we watch everything the points don’t measure: how you lose a trick, how you carry a partner, how you breathe when it goes dark.'), b('dee', '…And if we’re not ready?'), b('queenie', 'Then we love you enough to stop you, and feed you, and send you home mad at us instead of broken at him. That’s the job, baby. It ain’t a gate. It’s a guardrail.')],
    pullAwayUs: [b('queenie', 'Ahead of the legends in their own parlor. Ace, baby, when’s the last time—'), b('ace', 'Don’t say the year out loud. It makes the wallpaper feel old.')],
    pullAwayThem: [b('ace', 'The test is leaning the way tests lean. Nothing personal in it. That’s what makes it a test and not a feud.'), b('dee', 'Tests get passed. That’s what makes them tests and not walls.')],
    nilAttempt: [b('queenie', 'A nil in front of the legends. Oh, we have seen THAT story before. It ends one of two ways and both get told forever.')],
    matchPoint: [b('ace', 'Match point, and my partner just sat up straighter. In fifty years I have seen Queenie sit up straighter four times. Count tonight carefully, kids.')],
    finalHand: [b('queenie', 'Last hand of the test, babies. Whatever’s in you — all of it — now would be the time it shows.'), b('dee', 'It’s in us. Watch it show.')],
  },
  king: {
    firstHand: [b('king', 'One hand. …Interesting. The ringer just adjusted in his seat. He has adjusted in his seat eleven times since 2003. The room will discuss it for a year.')],
    signature: [b('king', 'Full game. Seven-fifty. Before we deal, I’ll give you the truth free, because nobody else on this route can afford to: I have been undefeated since the lights went out in ’03… and I have been BORED since roughly ’04.'), b('dee', 'Bored? You’re the end of the whole— everybody whispers your name like a—'), b('king', 'A crown nobody can take is just a room nobody enters, little one. Men climb to me angry, or scared, or hungry for a story to tell about themselves. They play the legend. They lose to the legend. The cards never get a say.'), b('king', 'So here is my only rule that matters, and hear it whole: play the CARDS. Not my name, not the streak, not the story. The girl your partner is — play HER cards true, and let mine fall where the game puts them. Do that… and whatever happens tonight, the block gets its story back.'), b('king', 'The quiet after. Twenty-two years of it. A crown is just a room that got too quiet, little one, with better furniture.')],
    pullAwayUs: [b('king', 'Ahead. At my table. Against the streak. …Do you hear that sound, children? Neither do I. That’s the block, holding its breath, twenty years deep.'), b('dee', 'Let it hold. We’re not done breathing either.')],
    pullAwayThem: [b('king', 'The king leads, as the king has led since the lights went out. It is not arrogance at this point. It is archive.'), b('dee', 'Archives get new pages. Tonight’s one.')],
    nilAttempt: [b('king', 'A nil. Against ME. …In 2007 a man tried that here and the story still gets told in Coleman’s shop like a ghost tale. Finish it or join the telling, friend. I’m honestly curious — and I am never curious.')],
    matchPoint: [b('king', 'Match point. Against the undefeated. Understand me, both of you: I will not insult this moment by going easy. Whatever you take tonight, you take at full price, from the real thing.')],
    finalHand: [b('king', 'The final hand. Twenty-two years I waited in this room for a game that deserved one. …Play it like the story it already is.'), b('dee', 'Together. All the way from the Porch. Together.')],
  },
};

/* =====================================================================
 * TABLE EXCHANGES — short back-and-forths between hands, keyed to what
 * just happened (your side won / lost the hand). These are the living
 * level between the milestones: the pair needle each other, react to Dee,
 * and the scene's stake keeps breathing while the game runs.
 * ===================================================================== */

export interface StoryTableExchangeSet { won: StoryBeat[]; lost: StoryBeat[] }

export const STORY_TABLE_EXCHANGES: Record<string, StoryTableExchangeSet> = {
  porch: {
    won: [b('uncleRay', 'Pat. PAT. Did you score that right?'), b('pat', 'I score everything right, Raymond. It’s why I hold the pencil.'), b('dee', 'We’ll take it. Quietly. This time.')],
    lost: [b('pat', 'One hand, babies. The porch has seen a thousand first acts.'), b('uncleRay', 'Second acts are where Dee’s people shine. Her daddy couldn’t act one worth a dime, but act two? Poetry.')],
  },
  barbershop: {
    won: [b('june', 'A hand to the students. The book has a chapter on humility, Coleman.'), b('mrColeman', 'I wrote the footnotes. Play on.')],
    lost: [b('mrColeman', 'The book, chapter four: a lost hand is tuition. What matters is whether you attend the lesson.'), b('dee', 'Attending, sir. Front row.')],
  },
  'rec-center': {
    won: [b('trey', 'THEY TOOK A HAND! SOMEHOW! THE CLOCK IS CONFUSED!'), b('lilMan', 'THE CLOCK AIN’T CONFUSED, TREY, THEY JUST FAST! I HATE IT AND I RESPECT IT AND I HATE THAT I RESPECT IT!')],
    lost: [b('lilMan', 'HAND TO THE REC! THE ROOM PROVIDES!'), b('dee', 'The room provides earplugs next time, that’s what the room provides.')],
  },
  cookout: {
    won: [b('teisha', 'Their hand. And did you see the cover on the—'), b('keisha', '—last book? I saw. They’re learning the family language faster than family.')],
    lost: [b('keisha', 'Our hand, babies. The grill keeps—'), b('teisha', '—what the grill catches. Come and get the next one yourselves.')],
  },
  corner: {
    won: [b('redd', 'Their hand. On the Corner.'), b('smoke', 'Counted. The corner doesn’t forget a debt or a credit. Both get collected.')],
    lost: [b('smoke', 'Ours. As expected was never said, but… noted.'), b('dee', 'Note this too: we’re still here.')],
  },
  'church-basement': {
    won: [b('sisterMae', 'A hand to the children! Well. The lemonade of victory is over there, babies — it tastes exactly like the regular lemonade, but you’ve earned the story.'), b('deaconFord', 'She’s been waiting all night to use that one.')],
    lost: [b('deaconFord', 'The basement takes the hand. A setback is a setup — I keep telling the choir, and the choir keeps coming back.')],
  },
  rooftop: {
    won: [b('poet', 'A hand climbs to the climbers. The sky updates its records in pencil — it has learned humility.')],
    lost: [b('poet', 'The roof keeps the hand. Roofs are patient collectors; they outwait every storm that argues.')],
  },
  'high-rise': {
    won: [b('accountant', 'Their hand. Entered. In a column I did not expect to use tonight.'), b('velvet', 'Frustration looks expensive on you, darling. It’s working, though.')],
    lost: [b('velvet', 'Our hand, darlings. The penthouse thanks you for the donation.'), b('dee', 'Donations are tax-deductible, Velvet. We’ll be writing this whole night off.')],
  },
  'the-pjs': {
    won: [b('captainBlock', 'Their hand. Under my light. Brick, if you laugh, I swear—'), b('dee', 'She’s not laughing, Captain. …Is she laughing? I can never tell with Brick.')],
    lost: [b('captainBlock', 'The Pj’s take it. The streetlight keeps what it catches, kids. That’s been true since before your route had a map.')],
  },
  legends: {
    won: [b('ace', 'Their hand. Against the legends. In the legends’ own chairs.'), b('queenie', 'Let them have the hand, baby. Watch how they carry winning. It tells you more than losing does.')],
    lost: [b('queenie', 'Our hand, babies. No shame anywhere near it. The test breathes out. Breathe with it.')],
  },
  king: {
    won: [b('king', 'Their hand. …The ringer is looking at me. He has not looked at me during a game in nine years. Whatever this is, it has his attention. It has mine.')],
    lost: [b('king', 'Mine. As the archive expected. And yet the ringer remains seated forward. Interesting archives, these.')],
  },
};

/* =====================================================================
 * SELECTORS — fact-driven, always. Stored facts (attempts / cleared /
 * cleared stop ids, from the progress endpoint) pick the scene variant;
 * in-match facts (what actually happened THIS game) pick callbacks.
 * ===================================================================== */

export type StoryBeatKind = 'intro' | 'outroWin' | 'outroLose';

/** Stored per-stop facts the variant selector reads. */
export interface StoryBeatFacts {
  /** games already played at this stop on this track (the NEXT game is attempt attempts+1) */
  attempts: number;
  /** clears recorded at this stop (informational; `cleared` drives selection) */
  clears?: number;
  /** this stop is cleared on this track */
  cleared: boolean;
  /** ids of stops cleared on this track (continuity gating) */
  clearedStopIds?: readonly string[];
  /** this attempt's drawn rail cast (storyRail.railCastForAttempt) —
   *  the intro scene acknowledges only railbirds who actually showed up
   *  this attempt; absent = the stop's full rail (legacy callers) */
  railCast?: readonly string[];
  /** CO-OP ONLY (awareness layer, spec §7.3): the pair-context facts
   *  for this sit-down, present only when case (b)/(d) fires. Solo
   *  NEVER sets this — with it absent every selector below is
   *  byte-identical to the solo game. */
  awareness?: AwarenessFacts;
}

/** Dee's arc stage by route position: green → believing → belonging. */
export function deeStageForStop(stopNumber: number): 'green' | 'believing' | 'belonging' {
  if (stopNumber <= 3) return 'green';
  if (stopNumber <= 7) return 'believing';
  return 'belonging';
}

function mergeGated(base: StoryBeat[], gated: GatedBeat[] | undefined, facts: StoryBeatFacts): StoryBeat[] {
  if (!gated?.length) return base;
  const out = [...base];
  const cleared = new Set(facts.clearedStopIds ?? []);
  for (const gb of gated) {
    if (gb.requiresCleared && !cleared.has(gb.requiresCleared)) continue;
    const { requiresCleared: _r, at: _a, ...beat } = gb;
    const at = gb.at !== undefined ? Math.min(gb.at, out.length) : out.length;
    out.splice(at, 0, beat);
  }
  return out;
}

/**
 * Pick the scene for a moment. Intro bands by stored attempts:
 * cleared → champions-return scene; attempts = 1 → second-visit scene
 * (they remember the loss); attempts ≥ 2 → the rivalry scene;
 * attempts = 0 → the full stranger intro (with fact-gated continuity
 * lines woven in). No retry ever replays the stranger intro.
 */
export function beatsFor(stop: StoryStop, kind: StoryBeatKind, facts: StoryBeatFacts): StoryBeat[] {
  const script = STORY_SCRIPTS[stop.id];
  if (!script) return [];
  if (kind !== 'intro') {
    const base = kind === 'outroWin' ? script.outroWin : script.outroLose;
    // At the King, the full rail answers the ending (win: the graduation
    // witnesses; lose: twenty people who are NOT leaving).
    if (stop.id === 'king') return [...base, ...(kind === 'outroWin' ? STORY_KING_RAIL_OUTRO.win : STORY_KING_RAIL_OUTRO.lose)];
    return base;
  }
  const withRail = (beats: StoryBeat[]): StoryBeat[] => {
    // The rail is acknowledged early in the scene — they're simply AROUND.
    const intro = STORY_RAIL_INTRO[stop.id];
    if (!intro?.length || facts.cleared) return beats;
    // Per-attempt draw: the acknowledgment names specific faces — it
    // only plays when every face it names actually showed up this
    // attempt. Nobody introduces an empty chair.
    if (facts.railCast !== undefined) {
      const subjects = RAIL_INTRO_SUBJECTS[stop.id] ?? [];
      const shown = subjects.length ? subjects.every((id) => facts.railCast!.includes(id)) : facts.railCast.length > 0;
      if (!shown) return beats;
    }
    const at = Math.min(2, beats.length);
    return [...beats.slice(0, at), ...intro, ...beats.slice(at)];
  };
  // The awareness variant (co-op, spec §7.5): the pair is new at this
  // stop but the room KNOWS at least one of them — the seated pair's
  // awareness meet lines REPLACE the pair-first intro's meet opener
  // (its leading seated-pair beats); the scene's remaining beats are
  // the pair-first set. Only reachable with facts.awareness set, which
  // solo never does.
  if (facts.awareness && !facts.cleared && facts.attempts === 0) {
    const meet = awarenessMeetBeats(stop.id);
    if (meet.length) {
      const first = mergeGated(script.intro, script.introGated, facts);
      return withRail([...meet, ...first.slice(awarenessOpenerLength(stop.id, first))]);
    }
  }
  const variants = STORY_INTRO_VARIANTS[stop.id];
  if (facts.cleared && variants?.champion) return variants.champion;
  if (!facts.cleared && facts.attempts === 1 && variants?.second) return withRail(variants.second);
  if (!facts.cleared && facts.attempts >= 2 && variants?.grind) return withRail(variants.grind);
  if (!facts.cleared && facts.attempts > 0) return withRail(script.introReturn);
  return withRail(mergeGated(script.intro, script.introGated, facts));
}

/**
 * The King's co-op proposal scene (Phase 4, spec §6.3) — played when a
 * pair holding the double mark sits down to settle it. FULL form (the
 * room just won leg 1, the moment is fresh): the gun beat (canon: the
 * revolver is already on the felt before he speaks — placed, never
 * pointed, never touched, never fired), the King's five lines and the
 * Ringer's one (KING_PROPOSAL_LINES, verbatim — the bake's manifest
 * keys were computed from those texts), then Dee's two answers from
 * GUIDE_FINALE ([1] the price, [2] the ante). SHORT form (a later
 * sit-down — the pair already heard the terms): the gun beat carrying
 * the price line, and Dee's reminder. The choice UI follows the scene;
 * the beats themselves never branch on the answer.
 */
export function kingProposalBeats(short: boolean): StoryBeat[] {
  if (short) {
    return [
      { speaker: 'king', prop: 'kingGun', line: KING_PROPOSAL_LINES[4]!.line },
      { speaker: 'dee', line: GUIDE_FINALE[1]! },
    ];
  }
  const beats: StoryBeat[] = KING_PROPOSAL_LINES.map((b, i) => (i === 0 ? { ...b, prop: 'kingGun' as const } : { ...b }));
  beats.push(
    { speaker: 'dee', line: GUIDE_FINALE[1]! },
    { speaker: 'dee', line: GUIDE_FINALE[2]! },
  );
  return beats;
}

/** Mid-scene beats for a milestone. `ahead` matters only for pullAway.
 *  On a retry game (attempts > 0, not cleared), the first-hand beat is the
 *  retry variant — the history is in the room from the first hand. */
export function midSceneFor(stop: StoryStop, milestone: StoryMilestone, ahead: 'us' | 'them' | null, facts?: StoryBeatFacts): StoryBeat[] {
  const set = STORY_MID_SCENES[stop.id];
  if (!set) return [];
  if (milestone === 'firstHand' && facts && facts.attempts > 0 && !facts.cleared) {
    const retry = STORY_RETRY_FIRST[stop.id];
    if (retry) return retry;
  }
  switch (milestone) {
    case 'firstHand': return set.firstHand;
    case 'midgame': return set.signature;
    case 'pullAway': return ahead === 'them' ? set.pullAwayThem : set.pullAwayUs;
    case 'nilAttempt': return set.nilAttempt;
    case 'matchPoint': return set.matchPoint;
    case 'finalHand': return set.finalHand;
    default: return [];
  }
}

/** The between-hands exchange for the hand that just ended (your side won/lost it). */
export function tableExchangeFor(stop: StoryStop, handWon: boolean): StoryBeat[] {
  const set = STORY_TABLE_EXCHANGES[stop.id];
  if (!set) return [];
  return handWon ? set.won : set.lost;
}

/** Short beats threaded through live play (deal, bidding, big plays). */
export function playBeatFor(stop: StoryStop, kind: 'sitDown' | 'bigBid' | 'joker' | 'cut'): StoryBeat[] {
  if (kind === 'sitDown') return STORY_SIT_DOWN[stop.id] ?? [];
  if (kind === 'bigBid') return STORY_BID_REACT[stop.id] ?? [];
  return STORY_PLAY_REACTS[stop.id]?.[kind] ?? [];
}

/** Callback beats: only for events that REALLY happened earlier this match. */
export function callbackFor(stop: StoryStop, event: 'nilBusted' | 'bigSwing' | 'deeNilMade'): StoryBeat[] {
  return STORY_CALLBACKS[stop.id]?.[event] ?? [];
}

/* =====================================================================
 * INTRO VARIANTS — retries carry context (owner, 2026-10-21).
 * second = attempt 2 (lost once; they remember, Dee is stung).
 * grind  = attempt 3+ (a rivalry now; respect grows, reads sharpen).
 * champion = replaying a CLEARED stop (champions returning — warmth,
 * never the loss framing).
 * ===================================================================== */

export interface StoryIntroVariants { second: StoryBeat[]; grind: StoryBeat[]; champion: StoryBeat[] }

export const STORY_INTRO_VARIANTS: Record<string, StoryIntroVariants> = {
  porch: {
    second: [
      b('pat', 'Well. Look who’s back on the porch.'),
      b('dee', 'I replayed it everywhere. The last three books. I had the spade and I played scared of it.'),
      b('uncleRay', 'And Dee — last time you played the PORCH. This time play the cards. The porch can take it.'),
    ],
    grind: [
      b('uncleRay', 'Third time on my porch. Pat keeps a chair count now. You’re regulars with a debt.'),
      b('dee', 'Then three’s my number. I can feel how they play now — Ray protects Pat’s weak suit like it’s a screen door in a storm.'),
      b('uncleRay', 'OH. She’s scouting us out loud now. Pat! She’s scouting us! …Good. That’s new. That’s growth. Now beat us, so I can brag I raised it.'),
    ],
    champion: [
      b('uncleRay', 'Well, well — the champions of the route grace my porch again. Pat, put the good glasses out. No — they BEAT us for those glasses, they can wash ’em this time.'),
      b('pat', 'Sit down, babies. Coming back to where it started — that’s class. Most who climb forget the first rung.'),
      b('uncleRay', 'Careful, friend. Champions get our BEST game. Sentiment stops at the shuffle.'),
    ],
  },
  barbershop: {
    second: [
      b('june', 'Back for chapter two. The book was open where you left it.'),
      b('dee', 'It took root, Mr. Coleman. Watch my bids. Count ’em twice.'),
      b('june', 'Sit, children. Ace Down. The classroom rewards return students who read.'),
    ],
    grind: [
      b('mrColeman', 'Again. In my chair. A student who keeps returning stops being a student, June. What do we call them?'),
      b('dee', 'Then let’s make today "eventually." I know his tells now. He taps the comb when his hand is lying.'),
      b('mrColeman', '…June. She’s READING me. In my own shop. …Deal. Before she reads the wallpaper too.'),
    ],
    champion: [
      b('mrColeman', 'The graduates return. Sit — no lesson today. Today you’re colleagues, and colleagues get the hard game with no teaching discount.'),
      b('june', 'He’s been telling your win to every head in that chair for a week. "My students," he says. His chest all out.'),
      b('mrColeman', 'Then defend it like you were raised right. Ace Down.'),
    ],
  },
  'rec-center': {
    second: [
      b('lilMan', 'THEY CAME BACK TO THE REC! TREY! THE REMATCH IS REAL!'),
      b('dee', 'We rushed last time. I rushed. That’s not happening again — we play our speed, in your room, at your volume.'),
      b('lilMan', 'SHE GOT A PLAN! TREY, SHE GOT A PLAN! PLANS MAKE IT FUNNIER WHEN THE CLOCK EATS THEM!'),
    ],
    grind: [
      b('lilMan', 'AGAIN?! THIRD TIME?! TREY, THEY LIVE HERE NOW! WE SHOULD CHARGE THEM RENT!'),
      b('dee', 'Y’all keep saying that like we haven’t been studying the room. Lil’ Man bids loud when he’s scared. Trey, you get QUIET — two whole seconds — before a nil.'),
      b('lilMan', '…TREY. TREY, SHE CLOCKED US. IN OUR OWN ROOM. …I LOVE THIS RIVALRY. SIT DOWN, RIVALS!'),
    ],
    champion: [
      b('lilMan', 'THE CHAMPIONS! BACK IN THE REC! TREY, BOW OR SOMETHING!'),
      b('dee', 'And we’d do it again. This room made our pace honest.'),
      b('lilMan', 'FLATTERY GETS YOU THE FAST CLOCK, CHAMPS! TWENTY SECONDS! SENTIMENT IS SLOW!'),
    ],
  },
  cookout: {
    second: [
      b('teisha', 'Back at the family table—'),
      b('keisha', '—after learning how family eats. We saved your seats. The wobbly ones. You’ve been promoted to wobbly.'),
      b('dee', 'Last time we played like two solos. I watched it happen and couldn’t stop it. Today we cover. That’s the whole sermon.'),
    ],
    grind: [
      b('keisha', 'Third helping—'),
      b('teisha', '—of us. Most guests find the Twins… a lot… by visit two. You keep choosing the seats.'),
      b('dee', 'Because you two are the test I want to pass. Not beat — pass. There’s a difference. You taught me that.'),
    ],
    champion: [
      b('teisha', 'Champions at the cookout! Keisha, the good—'),
      b('keisha', '—plates. They get the good plates. You earned family china when you covered each other like that.'),
      b('teisha', 'Spoken like blood. Now defend your name — family defends hardest at home.'),
    ],
  },
  corner: {
    second: [
      b('smoke', 'Back on the corner.'),
      b('dee', 'It’s bookkeeping. I owe this corner a win and I pay what I owe. You taught me that out here, remember?'),
      b('smoke', '…She quotes the corner to the corner. Deal, Redd. And watch her partner’s nils — she’s not the same bidder we buried.'),
    ],
    grind: [
      b('smoke', 'Third time. The corner’s starting to know your footsteps, Dee.'),
      b('redd', 'I don’t warn people twice, so hear it as respect: we’ve started studying YOU. Your cover plays. Your patience. It’s mutual now.'),
      b('smoke', 'Hmph. Deal. Let’s see whose education is real.'),
    ],
    champion: [
      b('smoke', 'The ones who took the Corner, back on the Corner. That’s a short list. It’s a list of one line, and the line is yours.'),
      b('redd', 'Champions get the real game. Nothing held. It’s the only compliment we keep in stock.'),
      b('dee', 'Wouldn’t want it priced any other way. Deal.'),
    ],
  },
  'church-basement': {
    second: [
      b('sisterMae', 'Back in the basement, babies. I kept your seats and your lemonade record.'),
      b('deaconFord', 'Second visit. The doubles still double, and this time somebody at this table knows it in their bones.'),
      b('sisterMae', 'Choosing on purpose. Deacon, write that on the board. That’s half of faith and all of cards.'),
    ],
    grind: [
      b('sisterMae', 'Third time in my basement. Dee, baby, I’m going to say a thing I don’t say: you remind me of me, the year I almost finished.'),
      b('dee', 'Sister Mae — "almost" from you is a whole inheritance. I’m here to finish what BOTH of us started.'),
      b('deaconFord', 'Then the basement will witness it. One way or the other, it witnesses. Deal, children.'),
    ],
    champion: [
      b('sisterMae', 'Champions in the basement! Deacon, the cake’s not just for losses anymore.'),
      b('deaconFord', 'Victory cake. A new tradition, started by these two, tonight. The minutes will reflect it.'),
      b('sisterMae', 'Then defend it sweet, babies. Sweet is a strategy — you learned that here if you learned anything.'),
    ],
  },
  rooftop: {
    second: [
      b('poet', 'The climbers return to the roof that kept them. The wind kept the score. Seven kept the silence.'),
      b('dee', 'Last time I played the view instead of the cards. Not again. Blind nils live, and this time we’re the weather.'),
      b('poet', 'Weather that knows itself. Rare. Deal, then. The sky leans in.'),
    ],
    grind: [
      b('poet', 'Third ascent. The roof has a word for those who keep climbing. Seven knows it. Seven has never said it. I am not permitted to say it.'),
      b('dee', 'Then I’ll earn it out of him. One word, Seven. That’s my side quest now.'),
      b('poet', 'Brave. The last climber who made that vow got a nod and wept. Proceed.'),
    ],
    champion: [
      b('poet', 'Champions on the roof. The sky makes room — it does that for so few that the pigeons get jealous.'),
      b('dee', 'We came back for the view and the verdict. Both were honest last time.'),
      b('poet', 'Then receive the rematch as the roof gives all things: quietly, and at altitude.'),
    ],
  },
  'high-rise': {
    second: [
      b('accountant', 'Return engagement. I have reviewed your file. The deficit was not talent — it was nerve, in two specific hands. I have asterisked them.'),
      b('dee', 'Then let’s un-asterisk me. I know exactly which two hands he means. So does he. That’s why we’re all here.'),
      b('accountant', '…She DOES know. Sit. The correction will be educational, whoever teaches it.'),
    ],
    grind: [
      b('velvet', 'Third visit to the penthouse. The doorman knows your faces now. That’s not nothing up here — that’s almost everything.'),
      b('accountant', 'Rivalry, amortized: you have cost me eleven columns and one evening of peace. I have adjusted my models TWICE. Nobody adjusts my models twice.'),
      b('velvet', 'Oh, she’s expensive now. Sit, darlings — I do love a rematch with a price history.'),
    ],
    champion: [
      b('accountant', 'The prevailing party returns. Your names are in the ledger in the ink reserved for assets, not anecdotes.'),
      b('velvet', 'Champions get the penthouse’s honest game, darlings. No house warmth. There never was any — there was just you, earning.'),
      b('dee', 'Then let’s earn it again. The ledger has room.'),
    ],
  },
  'the-pjs': {
    second: [
      b('captainBlock', 'Back under the streetlight. I wondered if the loss would keep you home. It kept ME home, my year — for a while.'),
      b('dee', 'For a while. Then you held this door for twenty years. I’m skipping the "while" part, Captain.'),
      b('captainBlock', '…Brick. Are you hearing this girl? Skipping steps. Fine. FINE. Sit. The light forgives nobody, but it respects a short memory for losses.'),
    ],
    grind: [
      b('captainBlock', 'Third time at my table. The block’s started calling this a THING, Dee. A rivalry with an address.'),
      b('dee', 'Then let’s give the address a result. I know how Brick plays now — she waits for you to protect me and punishes the seam. So today there is no seam.'),
      b('captainBlock', 'She STUDIES. In my day we studied too — we just lied about it better. Deal. Let’s find out if homework beats twenty years.'),
    ],
    champion: [
      b('captainBlock', 'The ones who took the Pj’s, back to defend it. Champions of this street get no parade. They get us, again, at full strength. That IS the parade.'),
      b('dee', 'We wouldn’t parade anywhere else.'),
      b('captainBlock', 'Brick kept BOTH chairs this time. That’s not bookkeeping anymore. That’s respect. Don’t make her regret the paperwork.'),
    ],
  },
  legends: {
    second: [
      b('queenie', 'Back before the legends. Good. "Not yet" only works on people who hear the "yet."'),
      b('ace', 'Last time we watched you lose like visitors. Today we watch for what changed. The test notices change before it notices cards.'),
      b('queenie', 'Confidence with a coat on. Sit, babies. Show the guardrail it did its job.'),
    ],
    grind: [
      b('ace', 'Third sitting. Queenie, in fifty years, how many have sat three times?'),
      b('queenie', 'On my hands, baby, with fingers left over. You’re not hopefuls anymore. You’re a STANDING appointment. That’s a different test — it asks whether you want it when it stops being new.'),
      b('ace', 'Then let the record show the answer was given properly. Deal.'),
    ],
    champion: [
      b('queenie', 'Well. The blessed ones return. You carry it well, babies — no strut in it. That’s how I know it’s real.'),
      b('ace', 'Champions at this table don’t get the test. They get the legends, undiluted. There’s a difference and you’re about to enjoy learning it.'),
      b('dee', 'We came back for exactly that. Some tables you beat. This one you keep.'),
    ],
  },
  king: {
    second: [
      b('king', 'Back at my table. I told the ringer you would be. He did not bet against me — he remembers ’09, the last time he did.'),
      b('dee', 'Last time we played your name for two hands before we played your cards. Two hands is exactly what it cost us. I’ve done that math every night since.'),
      b('king', 'Then tonight begins where tonight should. No speeches — mine or yours. The cards have been patient. So have I. Less than the cards, more than I expected.'),
    ],
    grind: [
      b('king', 'A third sitting. In twenty-two years, three parties have sat three times. One took a single game off the streak and tells it like a crown. …I respect the three of you equally. That is not a compliment I rehearse.'),
      b('dee', 'We’re not here for a game off the streak, King. We’re here for the whole story. You said it yourself: play the cards.'),
      b('king', 'So I did. A king’s words return to him like weather. Deal, old friend. Let us finish the conversation the route started.'),
    ],
    champion: [
      b('king', 'The champions return to the room they took. It does not get less strange, saying it. It gets better.'),
      b('dee', 'We just wanted to sit at the table one more time. As the ones who hold it. With the ones who held it longest.'),
      b('king', 'Then it is a table of holders, and the crown sits in the middle like a guest. Play, champions. Defending is the second education. I was an excellent student of it — out of necessity, and loneliness. You will be neither. That is my blessing, and it is also a warning.'),
    ],
  },
};

/* =====================================================================
 * CONTINUOUS PRESENCE — beats threaded through live play, so the scene
 * runs from the moment the game loads until a team wins. Short, in voice,
 * keyed to real flow only. (Owner, 2026-10-21: "consistent from the time
 * the game loads until either team wins.")
 * ===================================================================== */

/** First beat of a RETRY game (attempts > 0, not cleared): the history is in the room. */
export const STORY_RETRY_FIRST: Record<string, StoryBeat[]> = {
  porch: [b('pat', 'Same porch, same scorekeeper, babies. The rematch starts now — first hand, play it like you mean the whole route.'), b('uncleRay', 'And friend — I remember every card you owed me from last time. Mentally. Pat remembers on paper.')],
  barbershop: [b('mrColeman', 'Second lesson, first hand. The book opens where the bookmark was. Show me the bookmark moved.')],
  'rec-center': [b('lilMan', 'REMATCH HAND ONE! THE CLOCK REMEMBERS! YOUR EARS REMEMBER! EVERYTHING REMEMBERS!'), b('trey', 'EVERYTHING!')],
  cookout: [b('keisha', 'First hand of the—'), b('teisha', '—rematch. We dealt your history back to you in these cards. How it reads is up to you two.')],
  corner: [b('smoke', 'First hand. Again. The corner doesn’t do fresh starts — it does continuations. Play like one.')],
  'church-basement': [b('sisterMae', 'First hand of the rematch, babies. The basement prayed about it. Now it watches about it.')],
  rooftop: [b('poet', 'The first hand of the return. The sky dealt the climbers a memory and called it a rematch.')],
  'high-rise': [b('accountant', 'Rematch, hand one. The file is open to the page you left. Begin amending it.')],
  'the-pjs': [b('captainBlock', 'Rematch, first hand, my light. You know what this light’s seen. Add something.')],
  legends: [b('ace', 'First hand of the re-test. Queenie’s watching the spaces again. Fill them better.')],
  king: [b('king', 'The first hand of the return. No speeches live here anymore. Only the rest of the story.')],
};

/** At the deal / first look of hand 1 — the scene breathing into the game. */
export const STORY_SIT_DOWN: Record<string, StoryBeat[]> = {
  porch: [b('pat', 'Cards are out. Raymond, glasses ON. You dealt yourself the two of spades last time and bid like it was a joker.'), b('uncleRay', 'One time. One time in forty years and it lives in the family Bible.')],
  barbershop: [b('june', 'First look, children. In this shop, the first look tells the truth. Everything after is manners.')],
  'rec-center': [b('trey', 'CARDS ARE OUT! FIRST LOOK! NO BLINKING! BLINKING COSTS SECONDS!'), b('lilMan', 'I BLINKED TWICE AND BID ANYWAY! THAT’S REC MATH!')],
  cookout: [b('keisha', 'First look, babies. Eat with your—'), b('teisha', '—eyes first. She means the cards. Mostly.')],
  corner: [b('redd', 'Cards out. Look long. Out here a first look is a tell if you let it be.')],
  'church-basement': [b('deaconFord', 'First look, children. The cards you’re holding were somebody’s prayer and somebody’s warning. Play them like both.')],
  rooftop: [b('poet', 'The first look, at altitude. The climbers study their weather.')],
  'high-rise': [b('velvet', 'First look, darlings. Up here, we read faces before cards. It saves time — faces confess faster.')],
  'the-pjs': [b('captainBlock', 'Cards out under the light. First looks tell me everything on this street. I’ve had twenty years of practice reading ’em.')],
  legends: [b('queenie', 'First look, babies. Legends don’t rush a first look. It’s the only free information in the whole game.')],
  king: [b('king', 'The first look. Twenty-two years of first looks at this table… and I still Lean in for this one. That should tell you something.')],
};

/** Reaction to a big numeric bid (6+) landing at the table. */
export const STORY_BID_REACT: Record<string, StoryBeat[]> = {
  porch: [b('uncleRay', 'Well, THAT’S a bid. Pat, pencil ready — somebody just wrote a check.'), b('pat', 'Mm-hm. And this porch collects its checks, babies. It surely does.')],
  barbershop: [b('mrColeman', 'A big bid in a no-joker shop. The book calls that "conviction." The book also has a chapter on what conviction costs.')],
  'rec-center': [b('lilMan', 'BIG BID! BIG BID ENERGY! TREY, THEY BID LIKE THE CLOCK OWES THEM MONEY!'), b('trey', 'RESPECT! TERRIFIED RESPECT!')],
  cookout: [b('teisha', 'A big bid just landed—'), b('keisha', '—and we FELT it at the grill. Dinner and danger. Our favorite pairing.')],
  corner: [b('smoke', 'Big bid. Out here that’s either truth or theatre. The corner charges for theatre.')],
  'church-basement': [b('sisterMae', 'Well, that’s a FAITH bid. The Deacon’s eyebrows just went to church without him.'), b('deaconFord', 'My eyebrows are in their seat, Mae. The bid, however, has left the building — we’ll see if the cards bring it home.')],
  rooftop: [b('poet', 'A bid like a flag planted in wind. The sky takes note of flags. It has opinions about flags.')],
  'high-rise': [b('accountant', 'A bid of that size moves a column. Confidence, priced at par. Delivery is where the market corrects.')],
  'the-pjs': [b('captainBlock', 'Big bid under the light. The fences just got quieter. That’s how you know it registered.')],
  legends: [b('ace', 'A big bid. Queenie didn’t blink. In fifty years her blink is my whole weather report — calm, kids. Stay calm with her.')],
  king: [b('king', 'A real bid. At last, a table that speaks in numbers instead of hopes. Continue.')],
};

/** Reactions to the game's loudest plays: a joker dropped, a spade cut stealing a book. */
export const STORY_PLAY_REACTS: Record<string, { joker: StoryBeat[]; cut: StoryBeat[] }> = {
  porch: {
    joker: [b('pat', 'A JOKER. On my porch. Raymond, your blood pressure.'), b('uncleRay', 'My blood pressure’s been introduced to worse at this very table. Play on.')],
    cut: [b('uncleRay', 'Cut it right off the top! That book had a home and everything!'), b('dee', 'Books change homes on this porch, Uncle Ray. You taught the whole block that.')],
  },
  barbershop: {
    joker: [b('june', 'No jokers in this shop’s deck — but that play had a joker’s spirit. Textbook theft, perfectly legal.')],
    cut: [b('mrColeman', 'A clean cut. Chapter nine: "the spade is patient." I didn’t write that chapter, but I assign it.')],
  },
  'rec-center': {
    joker: [b('trey', 'THE JOKER JUST HIT THE TABLE AND THE TABLE FELT IT IN ITS LEGS!'), b('lilMan', 'WOBBLY LEGS! LIKE THE COOKOUT CHAIRS! EVERYTHING IS CONNECTED!')],
    cut: [b('lilMan', 'CUT! STOLEN! AT FULL SPEED! THE BOOK NEVER SAW ITS LIFE FLASH, IT WAS TOO FAST!')],
  },
  cookout: {
    joker: [b('keisha', 'A joker at the cookout—'), b('teisha', '—means somebody’s plate just got heavy. That’s the biggest card at any family function.')],
    cut: [b('teisha', 'Cut clean off—'), b('keisha', '—the top. The grill saw it. The grill respects it.')],
  },
  corner: {
    joker: [b('redd', 'Joker down.'), b('smoke', 'Loud card on a quiet corner. Everybody heard that one. Play it through.')],
    cut: [b('smoke', 'Cut. The book’s gone and so is the apology. There never is one out here.')],
  },
  'church-basement': {
    joker: [b('deaconFord', 'The joker, in the basement. Even the folding chairs sat up.'), b('sisterMae', 'That card has carried more Sunday dinners than the casserole dish, Deacon.')],
    cut: [b('sisterMae', 'Cut it right from under them. Bless the book’s heart — it lives somewhere else now.')],
  },
  rooftop: {
    joker: [b('poet', 'The joker lands like a meteor the sky forgot to announce. Seven blinked. History will record the blink.')],
    cut: [b('poet', 'A cut, clean as weather changing. The book goes where the wind’s already decided.')],
  },
  'high-rise': {
    joker: [b('velvet', 'The joker, darlings. Up here that’s not a card, that’s a hostile takeover.'), b('accountant', 'Noted. Acquisitions, column one.')],
    cut: [b('accountant', 'Cut. The book has been repossessed mid-escrow. Ruthless accounting, that.')],
  },
  'the-pjs': {
    joker: [b('captainBlock', 'JOKER. Under my light. The whole street just looked up from whatever it was pretending to do.')],
    cut: [b('captainBlock', 'Cut my book on my own street. …Brick’s eyebrows moved. That’s her version of a standing ovation, so take it and keep moving.')],
  },
  legends: {
    joker: [b('queenie', 'A joker in the legends’ parlor. Ace, baby, it still shines like it did in the old rooms.'), b('ace', 'Some cards never retire, Queenie. They just wait for worthy tables.')],
    cut: [b('ace', 'Cut clean. I taught a boy that cut in ’88. He taught nobody. Some lessons you pay forward only once.')],
  },
  king: {
    joker: [b('king', 'The joker. At my table, that card has started and ended dynasties. Play it like you know that.')],
    cut: [b('king', 'Cut. …The ringer shifted again. Twice in one game. The archive is being REWRITTEN tonight, whatever the score says.')],
  },
};

/** Callbacks — fire late in the game and reference ONLY events recorded earlier in THIS match. */
export const STORY_CALLBACKS: Record<string, { nilBusted: StoryBeat[]; bigSwing: StoryBeat[]; deeNilMade: StoryBeat[] }> = {
  porch: {
    nilBusted: [b('pat', 'And let’s not forget that nil that went bust earlier — this porch keeps receipts in the pencil box, babies.'), b('uncleRay', 'Receipts and rematches. That’s the porch economy.')],
    bigSwing: [b('uncleRay', 'After that swing earlier? This game had DRAMA. Pat’s gonna tell it at the cookout like she was dealing.')],
    deeNilMade: [b('pat', 'And Dee made that nil earlier — on MY porch, in front of God and the whole block. Her daddy never landed one here. She did.')],
  },
  barbershop: {
    nilBusted: [b('june', 'Remember the nil that didn’t survive chapter two. The endgame grades the whole book, not the preface.')],
    bigSwing: [b('mrColeman', 'A game with a swing like the one we saw is a game that teaches twice. Pay attention to which lesson is yours.')],
    deeNilMade: [b('june', 'Dee landed a nil in my shop today and never looked up from her cards. Cold. Grown men in that chair have failed it louder.')],
  },
  'rec-center': {
    nilBusted: [b('trey', 'THE BUSTED NIL FROM BEFORE IS STILL IN MY HEAD! IT LIVES THERE NOW! RENT FREE!')],
    bigSwing: [b('lilMan', 'AFTER THAT SWING EARLIER?! THIS GAME GOT EVERYTHING! NOISE! DRAMA! ME!')],
    deeNilMade: [b('trey', 'DEE MADE A NIL! IN THE REC! ON THE CLOCK! SOMEBODY TELL THE WALL SO THE WALL KNOWS IT HAPPENED!')],
  },
  cookout: {
    nilBusted: [b('keisha', 'And the nil that busted earlier still—'), b('teisha', '—haunts this table politely. Family haunts politely. Then family finishes dinner.')],
    bigSwing: [b('teisha', 'After that big swing, this table’s a—'), b('keisha', '—movie now. We don’t make the rules of movies. We just feed the audience.')],
    deeNilMade: [b('keisha', 'And Dee made her nil earlier like it was—'), b('teisha', '—nothing. It was NOT nothing, Dee. The fence saw it. Family saw it.')],
  },
  corner: {
    nilBusted: [b('smoke', 'The busted nil from earlier in this game. I said hunting season. The corner collects its arithmetic.')],
    bigSwing: [b('redd', 'After that swing? Nobody at this table is comfortable. Good. Comfortable is how corners get taken.')],
    deeNilMade: [b('smoke', 'The girl made a nil on my corner tonight and kept her voice down about it. That’s not luck. That’s raising.')],
  },
  'church-basement': {
    nilBusted: [b('deaconFord', 'That busted nil from earlier still testifies. In this basement, mistakes give testimony and then they give way.')],
    bigSwing: [b('sisterMae', 'A swing like the one we witnessed? Babies, that’s not a game anymore, that’s a parable with a scorecard.')],
    deeNilMade: [b('sisterMae', 'Dee kept her nil in this basement, quiet as offering. Her grandmother saw that. I don’t care what anybody says — she saw it.')],
  },
  rooftop: {
    nilBusted: [b('poet', 'The busted nil fell from a great height earlier. The sound it made is still arriving.')],
    bigSwing: [b('poet', 'After the great swing, the sky itself is unsure how this ends. The sky is never unsure. Enjoy the novelty.')],
    deeNilMade: [b('poet', 'The girl kept a nil on my roof tonight, and the wind took notes. Write it down, Seven. That one goes in the minutes.')],
  },
  'high-rise': {
    nilBusted: [b('accountant', 'The busted nil remains on the ledger — a cautionary asset. Its interest compounds in the endgame.')],
    bigSwing: [b('velvet', 'After that swing, darlings, everyone’s posture changed. I notice postures. Mine never changes. Learn from this.')],
    deeNilMade: [b('accountant', 'The girl’s nil cleared on this floor earlier. The model has been adjusted. I do not adjust models. Note the date.')],
  },
  'the-pjs': {
    nilBusted: [b('captainBlock', 'That busted nil from earlier is still in this light. The street saw it. The street’s still deciding what it means for your name.')],
    bigSwing: [b('captainBlock', 'After a swing like that, this stops being a stop on a route. It’s a story with a fence full of witnesses.')],
    deeNilMade: [b('brick', '…She made her nil under my light. Don’t make it small.')],
  },
  legends: {
    nilBusted: [b('queenie', 'The nil that busted earlier, babies — legends don’t forget a card that brave, or that costly. It’s in the record now, either way.')],
    bigSwing: [b('ace', 'After that swing, even WE leaned in. Leaning in is our cardio and our critique in one motion.')],
    deeNilMade: [b('queenie', 'The girl made her nil at THIS table tonight. Forty years I’ve watched players try. She’s on the short list now.')],
  },
  king: {
    nilBusted: [b('king', 'The nil that died earlier in this game — I keep it in mind. Kings keep everything in mind. It is the entire job description.')],
    bigSwing: [b('king', 'After that swing, the ringer looked at ME for instruction. I gave none. Some games must be allowed to become what they are.')],
    deeNilMade: [b('king', 'The girl kept her nil at my table tonight. In twenty-two years, the list of those who did is short enough to memorize. I have.')],
  },
};

/* =====================================================================
 * RESUME LINES — a story match saved mid-game (its own save slot) resumes
 * straight at the table, skipping the intro. One beat per stop welcomes
 * the table back without replaying anything.
 * ===================================================================== */
export const STORY_RESUME_LINES: Record<string, StoryBeat[]> = {
  porch: [b('pat', 'Well — look who’s back at my table. Chairs kept your places, babies. Now, where were we…')],
  barbershop: [b('june', 'Back in the chair, children. The lesson resumes mid-sentence — Coleman never lost his place, and neither did the cards.')],
  'rec-center': [b('lilMan', 'THEY’RE BACK! THE MATCH REMEMBERS ITSELF! TREY, MARK THE OCCASION — LOUDLY!'), b('trey', 'MARKED!')],
  cookout: [b('keisha', 'Back at the family table—'), b('teisha', '—plates still warm, game still open. Sit, babies. Family doesn’t restart, it continues.')],
  corner: [b('smoke', 'You came back. The corner notes that. The game’s exactly where you left it — so are we.')],
  'church-basement': [b('sisterMae', 'Back in the basement, babies. The Lord kept your seat and the Deacon kept the score. Both are acts of faith.')],
  rooftop: [b('poet', 'The climbers return to the altitude of their unfinished business. The sky kept the game open like a tab.')],
  'high-rise': [b('velvet', 'Back so soon, darlings? The elevator remembered your floor. The game, I assure you, remembered everything else.')],
  'the-pjs': [b('captainBlock', 'Back under my light. The street kept your seats and the score kept its meaning. Finish what’s open.')],
  legends: [b('queenie', 'Back at the legends’ table, babies. We kept the game exactly as it was — a record doesn’t pause, it waits.')],
  king: [b('king', 'You return. Good. Unfinished games are the only appointments I keep twice.')],
};

export const resumeLineFor = (stop: StoryStop): StoryBeat[] => STORY_RESUME_LINES[stop.id] ?? [];
