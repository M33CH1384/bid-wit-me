# Trash-talk pack — wave 2 (written 2026-10-21, BAKED + SHIPPED 2026-10-21)

New bot-commentary lines written for the 2026-10-21 commentary overhaul. They waited here
until the voice bake existed on this VM; it does now, and **this pack is baked, wired and
live**: `PACK2` lives in `packages/bots/src/pack2.ts` (spread after the POOLS2
redistribution in personas.ts — a deliberate deviation from the original instruction
below, so the redistribution's line indices, which are line ids, never move; PACK2 lines
mint only fresh indices), and `COMMON_EXTRA` is append-merged into COMMON the same way.

The bake pipeline (in-repo, reproducible): `scripts/voice-bake/dump-lines.ts` dumps every
speakable line with its spoken take (`packages/bots/src/takes.ts`), and
`scripts/voice-bake/bake-sprites.py` synthesizes with Kokoro-82M v1.0 (kokoro-onnx) in
each persona-gender's official voice, processes to the corpus norms (5 ms-window trim at
−35 dB, −16 LUFS, −1 dBFS limiter, 10 ms fades) and rebuilds the sprites append-only:
existing clips keep their decoded audio and durations, pronunciation re-bakes replace
their segment in place, new clips append. Pronunciation respellings live in
`packages/bots/src/pronounce.ts`, shared with the Web Speech fallback. The pack data
below is kept verbatim as the historical record of what was written.

What shipped WITHOUT waiting for the bake (same overhaul): the rotation fix in talk.ts
`pick()` (fact/Ace-preferred slices no longer reset the anti-repeat memory), the
context-routed `collectionBanter` (the card-collection banter now runs through the talk
engine instead of a memoryless random pack draw), persona score-gap mood (`gapBias`),
match-point + bags-trouble moments, and pools2.ts — a redistribution that re-homes lines
each persona has ALREADY recorded into the kinds that were starving.

## PACK2 sections (persona-spread, pack markup)

```ts
export const PACK2: PackSection[] = [
  {
    kind: 'made', group: ['petty', 'loud'], lines: [
      'Contract? Covered.',
      'We said what we said, then we did it.',
      'Made it. Put it in the minutes.',
      "That's not luck, that's arithmetic.",
      'Bid it. Made it. Next question.',
      "We don't miss contracts over here.",
      'Another contract in the books.',
      "Made. Like we always do.",
      'The bid was a promise. Promise kept.',
      'Textbook contract. Frame it.',
      'We collect contracts like rent.',
      "Made it look boring. It wasn't.",
      "That's how a hand is supposed to end.",
      'Signed, sealed, delivered — again.',
      'We budgeted those books perfectly.',
      'Made. Somebody update the record.',
    ],
  },
  {
    kind: 'gotSet', group: ['all', 'petty'], lines: [
      'Set? Us? I need a recount.',
      'That hand never happened. Moving on.',
      "We got set and I'm still cute.",
      'A set is just a plot twist.',
      'Ok that one is going in the burn book.',
      "We'll get it back with interest.",
      'Set today, set UP tomorrow.',
      "I'm not mad. I'm already over it.",
      'That contract had other plans.',
      'We move like it never happened.',
      "Set. And I still showed up cute.",
      'The deck and I are not speaking.',
      "One set won't write our story.",
      "We'll wear it. Briefly. Very briefly.",
      'That hand is under review.',
      'Setback received. Comeback loading.',
      '[lilcuz] set?? nah that is actually crazy.',
      '[lilcuz] we got set and I am not even shocked. ok I am shocked.',
      '[coach] a set is film study. we will be back.',
      '[coach] we got set. noted, drilled, fixed by Thursday.',
      '[smooth] set. it happens to the smooth ones too.',
      '[storyteller] we got set. grandma is hearing about this.',
      '[influencer] we got set on main. deleting later.',
    ],
  },
  {
    kind: 'wheels', group: ['loud', 'all'], lines: [
      'WHEELS! Ten books, zero apologies.',
      'Somebody check the odometer.',
      'We just drove through that hand.',
      'Ten books. The top is DOWN.',
      'Wheels so clean they squeak.',
      'That hand had a chauffeur: us.',
      "Ten! Count em twice, we don't mind.",
      "We didn't win that hand, we lapped it.",
      'Wheels up, windows down.',
      "That's a parade, not a hand.",
      "Ten books and the tank's still full.",
      'Highway robbery, and we drove off.',
      '[hype] WHEELS!!! TEN OF THEM THANGS!!!',
      '[hype] START THE PARADE! WHEELS!',
      '[gambler] wheels. the long shot came home.',
      '[gambler] ten books. I shoulda bet the house.',
      '[coach] wheels. that is the drill working.',
      '[coach] ten books. everybody eats.',
    ],
  },
  {
    kind: 'nilMade', group: ['quiet', 'all'], lines: [
      'Nil. Made. Bow down.',
      'Zero. The most beautiful number.',
      'They came for my nil and left empty.',
      'Untouchable all hand long.',
      'I finished with nothing and everything.',
      'The nil survives another day.',
      'No books were harmed. Or taken.',
      'Ghost mode: complete.',
      'They hunted. I vanished.',
      'A clean nil is a work of art.',
      '[og] nil made. patience pays the bills.',
      '[og] zero books. grown and quiet about it.',
      '[smooth] nil, no sweat on the brow.',
      '[smooth] untouched. I make it look easy.',
    ],
  },
  {
    kind: 'streak', group: ['loud', 'petty'], lines: [
      'Three straight. This is a pattern now.',
      'The streak is a lifestyle.',
      "We don't cool off. We reload.",
      'Another one. The heater purrs.',
      'Winning is just our default setting.',
      'Three hands, three statements.',
      'The furnace is fed again.',
      "Keep the streak warm, we're not done.",
    ],
  },
  {
    kind: 'onNotice', group: ['loud', 'petty'], lines: [
      'On notice! One more and goodnight.',
      'That shot is gonna leave a mark.',
      'The notice is official, {opp}.',
      'Shot! The table felt that one.',
      'One more hand like that, {opp}…',
      'Notice served. Clock started.',
      "Y'all are one mistake from the couch.",
      'Shot once. Twice is a funeral.',
    ],
  },
  {
    kind: 'shotOut', group: ['loud', 'all'], lines: [
      'SHOT OUT. End of the road, {opp}.',
      'Two shots. No overtime.',
      'The table has spoken: shot out.',
      'Shot out and shut down.',
      "That's the whole movie, {opp}.",
      'Shot out! Clear the seat.',
    ],
  },
  {
    kind: 'gotNuked', group: ['all', 'petty'], lines: [
      'A nuke. On ME. The nerve.',
      'My Little Joker just got evicted.',
      "That's not a play, that's a war crime.",
      'Nuked and noted, {them}.',
      'I want that reviewed by the league.',
      'The mushroom cloud is still over my seat.',
    ],
  },
  {
    kind: 'gotRan', group: ['all', 'petty'], lines: [
      'Ran the board? Show-offs.',
      'They really played every card like that.',
      "A run. On us. I'm ill.",
      "Okay, parade's over. Deal again.",
      'We witnessed a robbery in real time.',
      "Ran it. We'll remember the route.",
    ],
  },
  {
    kind: 'duck', group: ['petty', 'quiet'], lines: [
      'Ducking in 4K, {them}.',
      'That little card told a big story.',
      'Hiding the good stuff, {them}?',
      'A duck that loud should be a bid.',
      'I clocked that duck from here.',
      "You can't tiptoe past this table.",
      "That's not a duck, that's a confession.",
      'Saving it for what, the sequel?',
    ],
  },
  {
    kind: 'overcut', group: ['loud', 'petty'], lines: [
      'Higher. Always higher.',
      'You cut, I raised the rent.',
      'Overcut! Levels, {them}. Levels.',
      'That spade had a spade.',
      'Anything you do, I do bigger.',
      "Top card takes it. That's me.",
      'Escalated. Quickly.',
      'Over the top and out the door.',
      'Your cut met its manager.',
      'Cut answered. Next.',
    ],
  },
  {
    kind: 'roastBid', group: ['petty', 'loud'], lines: [
      '{bid}? The whole table heard that.',
      'That bid came with a prayer book.',
      "{bid} is a number, not a plan.",
      "Y'all bid like books grow on trees.",
      'That total needs adult supervision.',
      'Scared money and loud money. Both lose.',
      "{bid}? I'll bring the calculator.",
      'That bid is writing fiction.',
    ],
  },
  {
    kind: 'blindNil', group: ['all', 'loud'], lines: [
      'Blind nil?! The confidence is illegal.',
      'Thirteen face-down maybes.',
      'No peeking? I could never.',
      "That's not a bid, that's a trust fall.",
      'Blind nil. The table is stressed.',
      'You bid the mystery box!',
      'Either a legend or a lesson incoming.',
      'Eyes closed, heart full, cards unknown.',
    ],
  },
  {
    kind: 'roast', group: ['petty', 'loud', 'all'], lines: [
      'That play had a family meeting and still chose wrong.',
      "I'm putting that on the fridge of bad plays.",
      'You play like the tutorial skipped you.',
      "That's going in the yearbook.",
      "Somebody's partner is sighing right now.",
      'The audacity has great cardio.',
      'That move needs a support group.',
      "I've seen better decisions at a buffet.",
      "That play is a documentary now.",
      'You got main-character energy and side-quest cards.',
      'Bold strategy. Shame about everything else.',
      "That's not a slump, that's a pattern.",
      'The table saw it. The table judges.',
      "We'll be quoting that play all night.",
    ],
  },
  {
    kind: 'bags', group: ['petty', 'all'], lines: [
      "Bags! The meter is running, {opp}.",
      'Another bag for the collection.',
      "Y'all are bagging like it pays rent.",
      'Careful — the bag counter never sleeps.',
      'Those bags are about to get expensive.',
      "One more bag and it's a penalty party.",
      'The bags are piling up over there, {opp}.',
      'Bag check! Too many, {opp}.',
      "Y'all taking books you don't even need.",
      "Greed looks good until the bags bill comes.",
    ],
  },
  {
    kind: 'nilBust', group: ['loud', 'petty'], lines: [
      'The nil just popped like a balloon.',
      'BUSTED. We take those.',
      "One book. That's all it ever takes.",
      'The nil is canceled, effective now.',
      'Welcome back to taking books, {them}.',
      'Hunted. Found. Busted.',
      'That nil had a good run.',
      'The target has been neutralized.',
    ],
  },
  {
    kind: 'bidTooHigh', group: ['petty', 'loud'], lines: [
      '{bid}?! Somebody drug-test that bid.',
      '{bid} books. In THIS hand?',
      'That bid is on stilts.',
      'You bidding or auditioning?',
      "{bid}. The confidence is the only big thing here.",
      'That number has no business here.',
      'A bid that big needs a permit.',
      'Hope your cards got the memo, {them}.',
    ],
  },
  {
    kind: 'bigBid', group: ['loud', 'all'], lines: [
      "{bid} and the table felt it.",
      'We bid like we mean it.',
      "{bid}. No hesitation in this voice.",
      'Big bid. Bigger delivery coming.',
      "That's a number with a spine.",
      "{bid} — and we're just getting started.",
    ],
  },
  {
    kind: 'boston', group: ['loud', 'all'], lines: [
      'BOSTON! All thirteen, no survivors.',
      'A clean Boston. The broom is out.',
      'Thirteen to zero. Historic.',
      "They didn't touch a single book.",
      'Boston! Somebody check on {opp}.',
      'That hand should be illegal in Boston.',
      'Every book. Every single one.',
      'A Boston with our name on it.',
    ],
  },
  {
    kind: 'win', group: ['loud', 'all', 'quiet'], lines: [
      'Another one for the highlight reel.',
      'GG. The table stays ours.',
      'We came with a plan and left with the game.',
      'Championship behavior, start to finish.',
      'The final score is the whole review.',
      "Who's next? The throne is warm.",
      '[professor] the outcome was priced in three hands ago.',
      '[deacon] give thanks, then check the scoreboard.',
      '[smooth] never rushed, never worried. GG.',
      '[silent] done.',
      '[storyteller] and that is one for the family group chat.',
      '[petty] winning this is going in my bio.',
      '[mama] and I am proud of every one of you. every single one.',
      '[hustler] good game. pure luck, every hand.',
      '[barber] GG. the shop is closed. we won.',
      '[comedian] we won. I will be signing autographs by the door.',
      '[lilcuz] dub secured. somebody tell the group chat.',
    ],
  },
  {
    kind: 'lose', group: ['all', 'petty'], lines: [
      'Lost the game, kept the dignity. Rematch.',
      'That one is getting appealed.',
      "We'll be back. Louder.",
      'A loss is just data. Rematch.',
      'The sequel starts now. Deal.',
      "Enjoy the crown. It's borrowed.",
      '[comedian] we lost. the crowd demanded an encore anyway.',
      '[sorelose] a loss. of course. the deck has it out for me.',
    ],
  },
  {
    kind: 'slam', group: ['loud', 'all'], lines: [
      'That book landed with a thud.',
      'Collected, with authority.',
      'Down it goes. Mine.',
      "That's a book with a bass line.",
      'Slammed it shut.',
      'Another one for the shelf.',
    ],
  },
  {
    kind: 'joker', group: ['loud', 'all'], lines: [
      'The Joker just clocked in.',
      "That's not a card, that's a landlord.",
      'Joker energy: unmatched.',
      'The crown jewel just dropped.',
      "Everybody sit up. The Joker's here.",
      'That Joker had an appointment with this trick.',
    ],
  },
  {
    kind: 'nuke', group: ['loud', 'all'], lines: [
      '☢️ Detonation complete.',
      'Big over Little. Physics.',
      "That's a mushroom cloud over {opp}.",
      'Nuked so hard the table shook.',
    ],
  },
  {
    kind: 'gotCut', group: ['petty', 'all'], lines: [
      "Cut? On me? Bold and rude.",
      "That one's getting answered.",
      "Ok, {them}. It's personal now.",
      "A cut for the highlight reel. Theirs, unfortunately.",
      'I felt that in my score.',
      'Noted. Revenge is scheduled.',
    ],
  },
  {
    kind: 'hypePartner', group: ['loud', 'all'], lines: [
      "Partner! That's the one!",
      'My partner woke up dangerous.',
      "That's chemistry, {them}!",
      'We practice that. Daily.',
      'Partner of the hand, no contest.',
      '{them} is in their BAG tonight.',
    ],
  },
  {
    kind: 'badHand', group: ['all', 'quiet'], lines: [
      'I got dealt a screensaver.',
      'These cards are decorative only.',
      'A hand only a mother could love.',
      "I'm playing with coupons, not cards.",
      'Thirteen cards and not one friend.',
      'This hand is a before picture.',
    ],
  },
  {
    kind: 'loudLoser', group: ['petty', 'loud'], lines: [
      'Volume up, books down.',
      'The commentary team is losing.',
      'Loud and wrong is a tough combo.',
      'Your voice is bidding more than your hand.',
      "Talk is cheap. Books aren't.",
      'Mic loud, score quiet.',
    ],
  },
  {
    kind: 'rematch', group: ['all', 'loud'], lines: [
      'Run it back. I double-dog dare you.',
      "Again. The cards owe me.",
      'Sequel season starts now.',
      "Deal. I've already forgotten that loss.",
      'One more game for the road.',
      'Rematch. My favorite word.',
    ],
  },
  {
    kind: 'prePlay', group: ['loud', 'petty', 'all'], lines: [
      'The table is about to learn something.',
      "I've been quiet. That ends now.",
      "This one's been loading all hand.",
      "Y'all ready? You're not, but ok.",
      'A little gift is coming.',
      'Eyes on me. Briefly.',
      'I cook now.',
      "Something's about to change hands.",
      "That seat's about to feel it.",
      'No spoilers. Just watch.',
      'I brought options.',
      'The temperature just changed.',
      "My cards have been patient. I haven't.",
      "Let's make it interesting.",
      '[og] forty years of this. watch and learn.',
      '[lilcuz] I been labbing this play all week.',
      '[influencer] hold on, chat, watch this one.',
      '[coach] execution time. just like practice.',
    ],
  },
  {
    kind: 'matchPoint', group: ['loud', 'petty', 'all'], lines: [
      "Match point and we're smiling.",
      'One hand from the crown, {opp}.',
      'The finish line is right there.',
      "Match point! Somebody's nervous. Not us.",
      'Next hand writes the headline.',
      'We can taste it from here.',
      "One more hand, {opp}. That's all we need.",
      'Match point energy is different.',
      'The trophy just leaned closer.',
      'One hand between us and glory.',
      'This is where legends clock in.',
      'Match point. Act accordingly.',
      '[hype] MATCH POINT!!! CAN YOU FEEL IT?!',
      '[gambler] one hand from the payout. all in.',
      '[sorelose] match point. the deck will find a way to ruin it.',
      '[sorelose] one hand away. I refuse to celebrate early.',
      '[hype] ONE HAND FROM THE CROWN!!!',
      '[storyteller] one hand from the story they tell about us.',
    ],
  },
  {
    kind: 'cut', group: ['loud', 'petty', 'all'], lines: [
      '[professor] as forecast. the void was documented three tricks ago.',
      '[mama] baby, we eat first and brag later.',
      '[barber] a clean cut. I do those professionally.',
      '[gambler] cashed. the house sends its regards.',
      '[conspiracy] I mapped that cut on a corkboard. it checked out.',
      '[hothead] CUT! and I will NOT be calming down!',
    ],
  },
  {
    kind: 'setThem', group: ['loud', 'petty'], lines: [
      '[deacon] pride goeth, and the set followeth.',
      '[lilcuz] set! that is tough, no cap.',
      '[coach] that set was in the game plan, believe it or not.',
      '[hustler] set! I mean — wow, how did that happen.',
    ],
  },
  {
    kind: 'made', group: ['all', 'quiet'], lines: [
      '[professor] the model holds. again.',
      '[barber] clean work. the chair is open for the next hand.',
      '[hothead] MADE IT! and I am STILL mad!',
      '[sorelose] made it. finally, the deck behaves.',
      '[mama] see? set the table and the books come to you.',
      '[professor] contract fulfilled. the variance was acceptable.',
      '[professor] made as modeled. peer review pending.',
      '[barber] another satisfied customer. made.',
      '[hype] MADE IT! SOMEBODY SOUND THE HORN!',
      '[hype] CONTRACT CRUSHED! WE DO THIS!',
    ],
  },
];

```

## COMMON_EXTRA (shared fallback lines, appended to COMMON)

```ts
export const COMMON_EXTRA: Partial<Record<TalkKind, string[]>> = {
  prePlay: ['my turn? say less.', 'I been waiting on this one.', 'watch the table, not me.', "this one got a little spice on it.", "no rush. I know what I'm doing.", "y'all feel that? that's pressure."],
  cut: ['cut! thank you, next.', 'that book never stood a chance.', 'snatched. right out the air.', 'mine now. take a picture.'],
  gotCut: ['ok, that one stung a little.', 'you been holding that all hand?', 'fine. FINE. take it.', 'I see how it is, {them}.'],
  overcut: ['anything you can cut, I can cut higher.', "top that. oh wait, you can't.", 'levels to this, {them}.', 'you brought a spade, I brought a bigger one.', 'over. the. top. every time.', "that's how you answer a cut."],
  joker: ['the Joker does what it wants.', 'big card energy.', "that's not luck, that's inventory.", 'Joker down. room got quiet.', 'hold that, {them}.'],
  nuke: ['Big Joker eats Little Joker. every time.', 'nuked. wipe the table off.', '☢️ mushroom cloud over {opp}.'],
  gotNuked: ['my Little Joker deserved better.', 'a nuke? in this economy?', 'ok that was just mean, {them}.', "I'm writing that one down.", 'the disrespect is noted.'],
  setThem: ['set! read the scoreboard.', "y'all reached and came up short.", 'that contract just expired.', 'bid it, missed it, own it.', 'the math was NOT mathing for {opp}.'],
  gotSet: ['set happens. next hand.', "we'll wear that one. briefly.", 'ok. that hand is deleted from my memory.', 'a setback is a setup, right? right?', 'we move. quickly.', "that one's on the whole table. not just me.", 'shake it off. cards coming.'],
  gotRan: ['they ran it. all of it. rude.', 'a whole run. I need a minute.', 'ran the board like they owned the deed.', 'every card. that was a parade, not a play.', 'we just got ran on. noted.'],
  made: ['contract signed, sealed, delivered.', 'we do this every hand. check the tape.', 'made it look routine because it is.', 'books counted. bid covered. next.', "that's called finishing your plate.", 'no drama. just made.', 'we came, we bid, we collected.', 'textbook. frame it.', 'another one in the books. literally.'],
  bigBid: ['{bid} and I mean every one of them.', 'big bid, bigger follow-through.', "we don't bid scared over here.", '{bid}. write it in pen.', "that's not hope, that's a plan."],
  roastBid: ["{bid} total? that's not a bid, that's a wish.", "y'all bid like the books come with the deck.", "{bid}? somebody's optimistic.", 'that bid needs a co-signer.', 'cute number. shame about the cards.'],
  wheels: ['WHEELS! somebody open the garage.', "ten books and the top is down.", "we didn't play that hand, we drove it.", 'all gas, no brakes. wheels!', 'ten of them thangs. count em.', 'the highway is ours tonight.', 'WHEELS UP. again.'],
  nilMade: ['zero books. that\'s called discipline.', 'nil, sealed. nobody touched me.', 'I dodged every book like rent day.', 'nothing. I took NOTHING. beautiful.', 'the nil stands. frame it.', 'invisible all hand. that\'s the job.', 'no books, no problem. points please.', "they hunted me all hand. I'm still here."],
  nilBust: ['BUSTED. the nil is dead.', 'one book is all it took. one.', 'the hunt is over, {them}.', 'you can come out from under the table now.'],
  bags: ['bags on bags on bags, {opp}.', 'that luggage fee is gonna hurt.', 'ten bags is a hundred points. just saying, {opp}.', 'keep feeding the bag counter.'],
  duck: ['ducking? in public, {them}?', 'I saw that little card, {them}.', 'hiding something over there?', 'that duck had a whole choreography.', "you can't hide from the table, {them}.", 'quiet cards tell loud stories.', 'noted: {them} is holding out.'],
  slow: ["the hand ain't getting younger, {them}.", "we're aging gracefully over here, {them}."],
  streak: ["that's three straight. pattern?", 'the heater is officially a furnace.', 'win, win, win. boring at this point.', "somebody check us for a pulse. we're hot.", 'three in a row. write it down.', 'the streak eats again.', "y'all making this a habit for us."],
  win: ["scoreboard doesn't stutter. GG.", "and that's the lesson for today.", "we'll leave the light on for y'all. GG.", 'another trophy for the shelf.', 'good game. better team won.'],
  lose: ['cards were dealt by a hater. rematch.', 'we lost the game, not the argument.', 'that deck owes me money.', "run it back. I wasn't done.", 'a fluke with good lighting. rematch.'],
  rematch: ['same teams. I like our odds better.', 'shuffle up. I got a short memory.', "again. and this time I'm awake.", 'deal em. the sequel is better.', 'one more. for the documentary.'],
  slam: ['book, with emphasis.', 'that one had a sound effect.', 'down goes another one.', 'collected. loudly.', 'that book had my name engraved.'],
  partnerBlunder: ['partner, we need a quick meeting. now.', "I'm gonna pretend that was strategy.", "we'll discuss it in the car, partner."],
  bidTooHigh: ['{bid}? with whose cards?', 'that bid is doing a lot of talking.', 'hope is not a strategy, {them}.', '{bid} books need {bid} miracles.', 'bold of you to bid the whole deck.'],
  nilBid: ['a nil? bold. we\'ll be by to collect.', 'nil on the board. hunt mode: on.', 'you sure about that, {them}? we are.', 'everybody sees the target, right?', 'nil. noted, circled, underlined.'],
  blindNil: ['blind nil! the table just gasped.', "no look? that's either genius or a cry for help.", 'blind nil. I respect the chaos.', "didn't look, didn't flinch. ok then.", 'thirteen mysteries and a dream.'],
  boston: ["thirteen to nothing. a BOSTON in bold.", 'every single book. that\'s a broom job.', 'a Boston. they gonna feel that tomorrow.', 'swept. not a book out of place.', 'all thirteen. somebody frame this hand.'],
  loudLoser: ['all that commentary, no books to match.', 'the loudest seat has the lightest books.', 'talking is free. books cost more.', 'check the score, then check the volume.', 'your mic is on but your cards are off.'],
  badHand: ["I got a hand full of apologies.", "these cards wouldn't win a raffle.", 'who dealt this, an enemy?', 'thirteen cards, zero friends.', "I've seen better hands on a clock."],
  roast: ['that play is going in the group chat.', "I'm not mad. I'm taking notes.", 'interesting. and by interesting I mean wrong.', "the confidence is the best part of your game.", "we saw it. everybody saw it."],
  onNotice: ["one more shot and it's a wrap, {opp}.", 'on notice and on borrowed time.', "the notice is posted. clock's ticking.", 'shot once. the table remembers.', 'next hand could be the last one, {opp}.'],
  shotOut: ["shot out. party's over, {opp}.", "two shots. that's the game.", 'the door is that way, {opp}.', 'shot out! somebody call them a ride.', 'and just like that, the table got lighter.'],
  hypePartner: ['my partner is a problem tonight!', "that's family right there, {them}!", 'partner came to WORK.', 'we built different, {them}.'],
  matchPoint: ['one hand from the trophy. can y\'all feel it?', 'match point. nobody blink.', 'we can see the finish line from here.', 'one more hand like that and it\'s over.', 'match point! the table just got quiet.', 'so close I can hear the trophy.', 'next hand could be the whole story.', 'match point. play it like you mean it.', 'one hand away. ONE.', 'the crown is right there. reach.'],
};
```
