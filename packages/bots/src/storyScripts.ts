/**
 * Story Mode scripts: first-pass intro / outro beats for every stop, written
 * in each pair's voice from the brief. Beats are DATA — the script player
 * (apps/web/src/story/ScriptPlayer.tsx) just walks the list.
 *
 * The variant selector is fact-driven, per the brief's awareness design:
 * stored per-stop facts (attempts / cleared on this track) pick the variant.
 * Phase 1 ships first-visit and loss-return intros; the Phase 2 awareness
 * variants (cleared solo → co-op, different partner, …) slot into
 * `beatsFor` the same way, keyed off the same stored facts.
 */
import type { StoryStop } from './story';

export interface StoryBeat {
  /** a STORY_CHARACTERS id, or 'you' (the player) */
  speaker: string;
  line: string;
}

export interface StoryScript {
  /** first visit to this stop on this track */
  intro: StoryBeat[];
  /** back after losing here (attempts > 0, not yet cleared) */
  introReturn: StoryBeat[];
  outroWin: StoryBeat[];
  outroLose: StoryBeat[];
}

const b = (speaker: string, line: string): StoryBeat => ({ speaker, line });

export const STORY_SCRIPTS: Record<string, StoryScript> = {
  porch: {
    intro: [
      b('dee', 'Okay. Deep breath. Stop one — Uncle Ray and Pat, on the porch where half this block learned Spades.'),
      b('uncleRay', 'Well look who it is! Dee, baby, you brought company to my porch?'),
      b('pat', 'Ray, hush. Baby, sit down. House rules: we play to 250, nobody\u2019s in a hurry, and the loser washes the glasses.'),
      b('uncleRay', 'And I teach while I play. By the end you gon\u2019 know exactly how you lost. Shuffle up!'),
    ],
    introReturn: [
      b('uncleRay', 'Back on my porch already? Glasses ain\u2019t even dry from last time.'),
      b('pat', 'Sit on down, baby. Same 250. Ray been practicing his victory speech all morning.'),
    ],
    outroWin: [
      b('uncleRay', 'Ha! Beat on my own porch. Pat, write this down somewhere — Dee and company are for real.'),
      b('pat', 'Next table\u2019s the Barbershop, baby. Mr. Coleman plays it by the book. The whole book.'),
      b('dee', 'One down. Ten to go. We really doing this, huh?'),
    ],
    outroLose: [
      b('uncleRay', 'And THAT is the lesson for today. No charge.'),
      b('pat', 'Run it back whenever you\u2019re ready, baby. Table\u2019s still warm.'),
    ],
  },
  barbershop: {
    intro: [
      b('mrColeman', 'Mind the clippers. You\u2019re Dee\u2019s friend? Then you know why you\u2019re here.'),
      b('june', 'This shop has run a table since before the street had a name. Ace Down here — no jokers, no shortcuts.'),
      b('mrColeman', 'Textbook Spades, played the way it was taught to me. Let\u2019s see if the new school studied.'),
      b('dee', 'No jokers at all? Okay… textbook it is.'),
    ],
    introReturn: [
      b('june', 'Back for another lesson. Good. The book doesn\u2019t change — students do.'),
      b('mrColeman', 'Same chairs, same rules. Ace Down. Sit.'),
    ],
    outroWin: [
      b('mrColeman', 'Clean. Correct. …You play like you were raised right. The Rec Center is next, Lord help you.'),
      b('june', 'Those boys play loud and fast. Don\u2019t let the noise in your head — it\u2019s their whole strategy.'),
    ],
    outroLose: [
      b('june', 'The book says that\u2019s what happens. Come back when you\u2019ve read it.'),
      b('mrColeman', 'No shame in it. Everybody loses in this chair before they win in it.'),
    ],
  },
  'rec-center': {
    intro: [
      b('lilMan', 'AYE! AYE! LOOK WHO WALKED IN! DEE! AND DEE\u2019S FRIEND! Y\u2019ALL READY TO LOSE QUICK?!'),
      b('trey', 'TWENTY SECONDS A MOVE, NO CRYING, NO THINKING — THINKING IS FOR PEOPLE WITH TIME!'),
      b('dee', '…I told you they were a lot. Just play your cards. Don\u2019t try to out-talk them, nobody can.'),
    ],
    introReturn: [
      b('lilMan', 'THEY CAME BACK! THEY CAME BACK TO THE REC! TREY, THEY CAME BACK!'),
      b('trey', 'SAME SPEED! FASTER, EVEN! CLOCK\u2019S ALREADY RUNNING IN MY HEAD!'),
    ],
    outroWin: [
      b('lilMan', '…they beat us. TREY. THEY BEAT US AT OUR OWN SPEED.'),
      b('trey', 'I\u2019M NOT MAD. I\u2019M JUST TALKING LOUD BECAUSE I DON\u2019T KNOW HOW ELSE TO PROCESS THIS.'),
      b('dee', 'My ears are ringing but we WON. Cookout next — the Twins. They\u2019re… different.'),
    ],
    outroLose: [
      b('lilMan', 'TOO SLOW! TOO SLOW! THE CLOCK ATE Y\u2019ALL UP!'),
      b('trey', 'COME BACK WHEN YOUR BRAIN CATCHES UP TO YOUR HANDS!'),
    ],
  },
  cookout: {
    intro: [
      b('keisha', 'Oh good, you\u2019re—'),
      b('teisha', '—right on time. We saved you the seats by the grill.'),
      b('dee', 'See? Like that. They do that the whole game. Bids too. Don\u2019t let it get to you.'),
      b('keisha', 'Get to them? We would never—'),
      b('teisha', '—we\u2019re lovely. Sit. Eat later. Play now.'),
    ],
    introReturn: [
      b('teisha', 'The ones who lost came—'),
      b('keisha', '—back. We knew before the gate opened. Sit, sit.'),
    ],
    outroWin: [
      b('keisha', 'They actually—'),
      b('teisha', '—beat us. Both of us. At the same time. That\u2019s… new.'),
      b('dee', 'The Corner next. Smoke and Redd. No jokes over there — play sharp and keep your nils close.'),
    ],
    outroLose: [
      b('teisha', 'Told you at the gate how this—'),
      b('keisha', '—ends. Plate\u2019s by the grill when you\u2019re ready to try again.'),
    ],
  },
  corner: {
    intro: [
      b('smoke', '…You Dee? Heard the route brought you to my corner.'),
      b('redd', 'Five hundred. No stories, no lessons. You bid it, you better have it. And if you\u2019re thinking nil — don\u2019t. We hunt those.'),
      b('dee', 'Okay he\u2019s not playing. Neither of them are. Heads up the whole way.'),
    ],
    introReturn: [
      b('smoke', 'Back again. Table\u2019s still warm.'),
      b('redd', 'Nothing changed over here. It won\u2019t. Run it.'),
    ],
    outroWin: [
      b('smoke', '…Hmph. Clean work. The block\u2019s gon\u2019 hear about this one.'),
      b('redd', 'Church Basement next. Don\u2019t let the sweet talk fool you — Mae sets people for fun.'),
      b('dee', 'We beat the CORNER. Okay. Okay! I\u2019m starting to believe this is real.'),
    ],
    outroLose: [
      b('redd', 'That\u2019s what the Corner does. Come back when your bids mean something.'),
      b('smoke', '…Door\u2019s open. It always is. Winning here ain\u2019t.'),
    ],
  },
  'church-basement': {
    intro: [
      b('sisterMae', 'Well bless your hearts, look at you two, running the whole route! Sit, babies. Lemonade?'),
      b('deaconFord', 'Down here we play sweet — and nils count double, praise be. Two hundred a nil, made or busted.'),
      b('sisterMae', 'Dee, sugar, your grandmother would want me to be kind. She did NOT say anything about the cards.'),
      b('dee', 'Double nils. So one good nil hand swings the whole game. Noted — carefully.'),
    ],
    introReturn: [
      b('sisterMae', 'Back in the basement! The Lord loves a persistent spirit.'),
      b('deaconFord', 'Same as before — nils double. You remember. We remember too.'),
    ],
    outroWin: [
      b('sisterMae', 'Well. Bless MY heart. Beaten in my own basement, fair and square.'),
      b('deaconFord', 'The Rooftop next, children. Poet talks in circles and Seven doesn\u2019t talk at all. Pray before you go.'),
    ],
    outroLose: [
      b('sisterMae', 'Oh, babies. The basement keeps the lights on for rematches. Come on back now.'),
      b('deaconFord', 'A setback is just a setup, that\u2019s what I always say.'),
    ],
  },
  rooftop: {
    intro: [
      b('poet', 'Two climbers reach the roof where the quiet man waits. The sky has seen this game before. It ended… how it ends.'),
      b('dee', 'That\u2019s Poet. That\u2019s how he talks. The quiet one is Seven — blind nils are live up here, worth 300, and Seven LOVES them.'),
      b('poet', 'The cards are already dealt, friends. We are only here to watch you notice.'),
    ],
    introReturn: [
      b('poet', 'The climbers return. The roof remembers. Seven remembers. Seven always remembers.'),
      b('dee', 'Still not a word out of him. Okay. Blind nils live — watch his seat.'),
    ],
    outroWin: [
      b('poet', 'And so the sky learns a new ending. …Seven nodded. That\u2019s the highest honor this roof gives.'),
      b('dee', 'The High-Rise next. Velvet and the Accountant. Money table — every point counted twice, once on paper and once in pride.'),
    ],
    outroLose: [
      b('poet', 'The roof keeps what it catches. Climb again when the wind changes.'),
      b('dee', 'He never said a word and somehow that loss felt personal. Run it back.'),
    ],
  },
  'high-rise': {
    intro: [
      b('velvet', 'Penthouse rules, darlings: everything up here is expensive, including mistakes.'),
      b('accountant', 'Five hundred points. I have counted every card played on this floor since 2016. Yours will be added.'),
      b('dee', 'She\u2019s a sharp, he\u2019s a calculator. Nothing cute, nothing free. Play the percentages and trust me.'),
    ],
    introReturn: [
      b('accountant', 'Returning parties. Your previous engagement has been noted, itemized, and filed under "unfinished."'),
      b('velvet', 'Sit, darlings. The view isn\u2019t the only thing up here that\u2019s beautiful and unforgiving.'),
    ],
    outroWin: [
      b('accountant', '…The ledger balances in your favor. I do not say this often. I do not say it twice.'),
      b('velvet', 'The Pj\u2019s next, darlings — the Captains, on their own street. Win there and the whole block says your names.'),
    ],
    outroLose: [
      b('velvet', 'Charged to experience, darlings. The elevator runs both ways.'),
      b('accountant', 'Rematch entries are still open. For now.'),
    ],
  },
  'the-pjs': {
    intro: [
      b('captainBlock', 'So the route\u2019s real. You made it to the Pj\u2019s — MY table, under MY light.'),
      b('dee', 'That\u2019s Captain Block. And Brick… who is just going to stare at us, apparently. This is the venue\u2019s own all-star team.'),
      b('captainBlock', 'Everybody shining on this route got stopped right here. Standard Joker, five hundred. Earn it.'),
    ],
    introReturn: [
      b('captainBlock', 'Back under the streetlight. Brick kept your chairs. She does that. It\u2019s not kindness.'),
      b('dee', 'Same table, same Captains. We know what they do now — no excuses this time.'),
    ],
    outroWin: [
      b('captainBlock', '…On my own street. Alright. ALRIGHT. You\u2019ve earned what\u2019s next — one more table before the King. The Legends.'),
      b('dee', 'Queenie and Ace?! We have to beat the LEGENDS to even SEE the King? …Okay. Okay. Let\u2019s go meet history.'),
    ],
    outroLose: [
      b('captainBlock', 'The Pj\u2019s don\u2019t give it away. Not to tourists. Come back and take it.'),
      b('dee', 'So close to the end and the street said no. We run it back — that\u2019s all.'),
    ],
  },
  legends: {
    intro: [
      b('queenie', 'Well. Look what the route dragged in. Ace, baby, they beat the CAPTAINS.'),
      b('ace', 'Mm-hm. I watched. Good cards. Better manners than most who climb up here asking for the King.'),
      b('queenie', 'House rule, babies: nobody sits with the King until WE say they\u2019re ready. Five hundred. Show us.'),
      b('dee', 'No pressure, right? Just the two greatest players the block ever produced, deciding if we\u2019re worthy.'),
    ],
    introReturn: [
      b('ace', 'The hopefuls again. Queenie, they\u2019ve got the one thing you can\u2019t teach.'),
      b('queenie', 'Stubborn. Same as us at their age. Sit down, babies — legends\u2019 rules, same as before.'),
    ],
    outroWin: [
      b('queenie', 'That\u2019s it. That\u2019s the game I used to play. Ace — tell him.'),
      b('ace', 'Already done. The King knows you\u2019re coming. He\u2019s known since the Porch, if we\u2019re honest.'),
      b('dee', 'This is it. The last table. Whatever happens — thank you for running this with me. Now let\u2019s go take his crown.'),
    ],
    outroLose: [
      b('queenie', 'Not yet, babies. The King eats "almost" for breakfast. Come back when it\u2019s all the way in you.'),
      b('ace', 'Cards\u2019ll be here. So will we. That\u2019s more promise than most get.'),
    ],
  },
  king: {
    intro: [
      b('king', 'So the stories are true. Porch to Pj\u2019s, and now my table. Sit down, both of you.'),
      b('dee', 'That\u2019s him. That\u2019s actually him. And the quiet one is his ringer — nobody even knows his name.'),
      b('king', 'Full game. Seven-fifty. I\u2019ve been undefeated since the lights went out in \u201903, and I have no plans that involve losing tonight. Play well. You\u2019ll need all of it.'),
    ],
    introReturn: [
      b('king', 'Back at my table. Most don\u2019t come twice. The ringer respects it — look, he almost nodded.'),
      b('dee', 'We know how he plays now. All of it. One more run — the real one.'),
    ],
    outroWin: [
      b('king', '…Ha. HA! Since \u201903, and it took YOU two. Take it — the block is yours. Both of yours.'),
      b('dee', 'WE DID IT. The whole route. Porch to King. …I\u2019m gonna tell this story forever, and nobody\u2019s gonna believe the half of it.'),
      b('king', 'Champions of the route. Now — defending a crown is a whole different game. The block will be watching.'),
    ],
    outroLose: [
      b('king', 'Close isn\u2019t a crown. But it\u2019s closer than most ever get. My table keeps a chair for you. Earn the other one again.'),
      b('dee', 'We came THIS far. We are not ending on a loss at the last table. Run. It. Back.'),
    ],
  },
};

export type StoryBeatKind = 'intro' | 'outroWin' | 'outroLose';

/** Stored per-stop facts the variant selector reads (Phase 2 adds more keys; this shape stays). */
export interface StoryBeatFacts {
  /** games already played at this stop on this track */
  attempts: number;
  /** this stop is cleared on this track */
  cleared: boolean;
}

/**
 * Pick the beats for a moment. Data/fact-driven by design: Phase 1 branches
 * on first-visit vs loss-return; Phase 2's awareness variants key off the
 * same facts object.
 */
export function beatsFor(stop: StoryStop, kind: StoryBeatKind, facts: StoryBeatFacts): StoryBeat[] {
  const script = STORY_SCRIPTS[stop.id];
  if (!script) return [];
  if (kind === 'intro') return facts.attempts > 0 && !facts.cleared ? script.introReturn : script.intro;
  return kind === 'outroWin' ? script.outroWin : script.outroLose;
}
