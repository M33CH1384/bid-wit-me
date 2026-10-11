/**
 * Bot personalities: ONE data file. Each persona has its own line pools, how often it talks, a TTS voice, and a slight
 * play-style lean (always within strong-bot bounds). Add a persona by adding an entry to PERSONAS (and a weight).
 *
 * Line templates: {me} speaker, {them} the player the moment is about, {partner} speaker's partner, {team} speaker's
 * team name, {opp} the other team's name, {card} the card, {bid} a bid number, {gap} the score gap.
 * Mild cursing (damn / hell / shit / ass) is written plainly and masked on screen when "Clean talk" is on.
 * Rules for writers: competitive and funny, never about race, gender, sexuality, religion or looks; no threats; no slurs.
 */

import { PACK, STYLE } from './pack';

export type TalkKind =
  | 'prePlay'      // before the bot plays (generic or bluff; never an honest tell)
  | 'cut'          // speaker's side cut a trick
  | 'gotCut'       // speaker's side got cut
  | 'overcut'      // speaker's side took the lead with a higher spade
  | 'joker'        // speaker's side dropped a Joker that took the lead
  | 'nuke'         // speaker's side nuked (Big over Little)
  | 'gotNuked'
  | 'setThem'      // opponents got set
  | 'gotSet'
  | 'made'         // speaker's side made its bid
  | 'bigBid'       // speaker's side bid big
  | 'roastBid'     // roast the other side's bid (too big or scared-small)
  | 'wheels'
  | 'runIt'        // speaker (or its side) ran the board ('Run it!')
  | 'gotRan'       // the other side ran the board on us
  | 'nilMade' | 'nilBust'   // speaker's side Nil made / opponents' Nil busted
  | 'bags'         // other side ate a bag penalty
  | 'duck'         // an opponent ducked low off-suit (reneg-looking)
  | 'slow'         // a human is taking long
  | 'streak'
  | 'win' | 'lose' | 'rematch'
  | 'hypePartner'  // partner bot hypes the human partner
  | 'newbie'       // Hustler, act still on
  | 'reveal'       // Hustler drops the act
  // trash-talk pack events (docs/trash-talk-pack.md)
  | 'slam'         // speaker's side took a trick with a big card
  | 'partnerBlunder' // speaker's own partner messed up (cut the partner's winner, ducked a sure book)
  | 'bidTooHigh'   // an opponent bid big ({bid})
  | 'nilBid' | 'blindNil' // an opponent bid Nil / Blind Nil
  | 'boston'       // speaker's side took all 13
  | 'loudLoser'    // a trailing human is spamming the chat
  | 'badHand'      // speaker's own hand at bid time (bluff-safe: sometimes said with good hands too)
  | 'roast'        // general petty one-liners (opponent blunder, winning big)
  | 'onNotice'     // the other side got shot (Shot = out) and is on notice
  | 'shotOut';     // the other side got shot out of the game

export type PersonaId = 'professor' | 'mama' | 'hype' | 'petty' | 'og' | 'hustler' | 'silent'
  | 'deacon' | 'conspiracy' | 'barber' | 'gambler' | 'hothead' | 'comedian' | 'lilcuz' | 'coach' | 'smooth' | 'storyteller' | 'influencer' | 'sorelose';
export type TalkIntensity = 'family' | 'cookout' | 'nomercy';
export type LineCond = 'ace' | 'neg' | 'big' | 'little' | 'jk';
/** per raw line: minimum intensity and an event condition (lines without an entry are Family Friendly, unconditional) */
export interface LineMeta { min?: 'cookout' | 'nomercy'; cond?: LineCond }

export interface Persona {
  id: PersonaId;
  /** shown on the bot's plate tooltip (the Hustler shows `fakeTag` until revealed) */
  tag: string;
  /** gendered tags (Big Mama / Big Papa, Church Mother / The Deacon…); falls back to `tag` */
  tagF?: string;
  tagM?: string;
  fakeTag?: string;
  /** Lil Cuz: play skill wobbles a level up or down per game */
  skillJitter?: boolean;
  /** share of bot names that get this persona (out of the total) */
  weight: number;
  /** how chatty: multiplies every trigger's chance */
  freq: number;
  /** ALL CAPS speaker */
  caps?: boolean;
  voice: { pitch: number; rate: number; prefer: string[] };
  /** play-style lean: bid nudge (±1 at most, applied sometimes, kept legal and sane) and Nil willingness (-1..1) */
  lean: { bid: -1 | 0 | 1; nil: number };
  /** play-skill bias: never below this level (the Hustler is always Pro+ while acting Novice in chat) */
  skillFloor?: 'regular' | 'pro' | 'shark';
  lines: Partial<Record<TalkKind, string[]>>;
}

/** Shared lines any persona can fall back to (persona pools are tried first). */
export const COMMON: Partial<Record<TalkKind, string[]>> = {
  prePlay: ['watch this.', "y'all ain't ready.", 'hmm… decisions.', 'I got something for that.', 'say less.', 'let me cook.', 'eeny meeny…', 'oh this is gonna hurt somebody.', "don't blink.", "lemme see what y'all workin with."],
  cut: ['CUT. sit down.', "that's a cut, {them}. tell your friends.", 'we eatin tonight 🍽️', 'thank you for the book, {them}.', "that {card} said 'mine.'", 'snip snip ✂️'],
  gotCut: ['oh you cut THAT? petty.', "who raised you, {them}?", "that's cold. that's real cold.", "ok ok, you got that one."],
  overcut: ['over the top! sit DOWN.', 'you cut, I cut harder.', '{card} said move.', 'nah nah nah, not today {them}.'],
  joker: ['Joker on the table. respect it.', 'that joker was waiting for you, {them}.', '🃏 hello.'],
  nuke: ['☢️ BOOM. clean that up, {them}.', 'Big Joker over Little Joker. history book.', 'somebody call FEMA for {opp}.'],
  gotNuked: ['did… did you just nuke me?', "I'm reporting this to the table.", 'my Little Joker had a family, {them}.'],
  setThem: ['SET! {opp} going backwards 📉', 'y\'all bid {bid} with what?', 'scared money don\'t make money, but y\'all made NO money.', 'that set looks good on you, {opp}.', 'set em up, knock em down.'],
  gotSet: ['that one hurt. noted.', 'we got set. it happens to legends.', 'ok {opp}, you live this hand.'],
  made: ['bid made. easy work.', 'we said {bid}, we got {bid}. accountants.', 'just like we drew it up.'],
  bigBid: ['{bid}. you heard me.', 'we going for {bid}. hold on.', "big bid energy. {bid}."],
  roastBid: ["{bid}? y'all scared money.", '{bid} is brave. wrong, but brave.', "bidding {bid} with that hand? bold."],
  runIt: ['run it. 🌪 the rest are mine.', 'y\'all can put your cards down. I got these.', 'no need to play it out, {opp}. it\'s over.', 'tornado warning 🌪 take cover {opp}.', 'I been counting. y\'all done.'],
  gotRan: ['ran the board on us? rude.', 'ok ok, show-off.', 'we\'ll remember that one.'],
  wheels: ['WHEELS! 🏎️ we outta here.', 'ten books, top down, wind in my hair.', 'WHEELS UP, {opp} WHEELS DOWN.'],
  nilMade: ['nil made. nothing to see here 😌', 'zero books, all the points.'],
  nilBust: ['nil BUSTED 💥 nice try {them}.', 'nil? more like nil-not.'],
  bags: ['bags! enjoy the -100, {opp}.', 'pack your bags 🧳 {opp}.'],
  duck: ["that's a reneg-looking play, {them} 👀", "hmm. {them} ducked that real quiet.", "I'm watching you, {them}."],
  slow: ["{them}, the cards don't bite.", 'we got all day apparently.', "{them} reading the cards like a lease.", 'tick tock {them} ⏰', "{them} on a long distance call with the deck."],
  streak: ['back to back. get used to it.', "we're on a heater 🔥", 'someone stop us. anyone.'],
  win: ['GG. go home and practice, {opp}.', 'that\'s game. put some respect on {team}.', 'we eatin, y\'all watchin.'],
  lose: ['luck. pure luck.', 'run it back. right now.', 'enjoy it {opp}, it won\'t happen again.'],
  rematch: ['run it back 😤', 'round two. no mercy.', 'y\'all want another one? ok.'],
  slam: ['that one\'s mine. thank you.', 'book!', 'and THAT is a book.'],
  partnerBlunder: ['partner… come on now.', 'we gotta talk after this hand, partner.', 'partner, what was that?'],
  bidTooHigh: ['{bid}? that\'s a lot of books.', 'that\'s a big number. we\'ll see.', 'bold bid. real bold.'],
  nilBid: ['nil? we coming for you.', 'nil, huh? good luck with that.', 'oh, a nil. this should be fun.'],
  blindNil: ['blind nil?! no peeking? wow.', 'blind nil. that\'s bold.', 'didn\'t even look? respect. kinda.'],
  boston: ['all thirteen! that\'s a Boston!', 'clean sweep. every book.', 'thirteen books. write it down.'],
  loudLoser: ['lot of talk from the team that\'s losing.', 'the scoreboard is talking louder.', 'easy there. check the score.'],
  badHand: ['these cards… wow.', 'who dealt this?', 'not a lot to work with here.'],
  roast: ['that was a choice.', 'interesting play. very interesting.', 'we\'ll pretend we didn\'t see that.'],
  onNotice: ["y'all on notice now. one more and it's over.", 'shot. one more hand like that and y\'all go home.', 'on notice! the clock is ticking, {opp}.'],
  shotOut: ['SHOT OUT! go home!', 'shot twice. that\'s the door, {opp}.', 'shot out! table\'s ours.'],
  hypePartner: ["THAT'S MY PARTNER! {them}!", 'yes {them}! carry us!', '{them} cooking 🔥', 'I taught {them} that.', 'partner of the year: {them}.', '{them} with the big brain play.'],
};

export const PERSONAS: Record<PersonaId, Persona> = {
  professor: {
    id: 'professor', tag: 'The Professor', weight: 8, freq: 1,
    voice: { pitch: 0.95, rate: 0.95, prefer: ['Daniel', 'Google UK English Male', 'Arthur', 'Alex'] },
    lean: { bid: 0, nil: -0.3 },
    lines: {
      runIt: ['the remaining tricks are a formality. observe.', 'I have counted every card. lay them down.', 'QED. the rest are mine.', 'class dismissed.'],
      prePlay: ['statistically speaking… this is fine.', 'let me consult the numbers.', 'a calculated choice.', 'probability favors the prepared.'],
      cut: ['statistically speaking, that was inevitable.', 'as the data predicted. you\'re welcome, {them}.', 'note the void in your notes, {them}.'],
      gotCut: ['a statistical anomaly.', 'I accounted for that. mostly.'],
      setThem: ['you bid {bid}. you took fewer. I believe that\'s called math.', 'count again, {opp}. slowly this time.', 'per my calculations, {opp} is down {gap}.'],
      roastBid: ['{bid}? I\'d like to see your work.', 'that bid fails peer review.'],
      made: ['expected value: realized.', 'QED.'],
      slow: ['{them}, it\'s 13 cards, not a thesis.', 'shall I count for you, {them}?'],
      win: ['the numbers never lie. GG.', 'final score confirms my hypothesis.'],
      lose: ['small sample size.', 'an outlier. I demand a rematch for science.'],
      duck: ['interesting duck, {them}. I\'ve logged it.'],
    },
  },
  mama: {
    id: 'mama', tag: 'Big Mama', tagF: 'Big Mama', tagM: 'Big Papa', weight: 8, freq: 1.1,
    voice: { pitch: 1.05, rate: 0.9, prefer: ['Samantha', 'Google US English', 'Victoria', 'Karen'] },
    lean: { bid: 0, nil: 0 },
    lines: {
      runIt: ['put your cards down, baby. mama\'s taking all of these.', 'go fix you a plate, y\'all done.', 'sit down, sugar. every last one is mine.'],
      prePlay: ['mm-hm. mama\'s thinking.', 'hold on baby.', 'let me see here…'],
      cut: ['baby that was cute. now give me my book.', 'aww {them}, you thought. bless your heart.', 'sweetie, that\'s MY book.'],
      gotCut: ['oh no you didn\'t, {them}.', 'see, now you got me mad.'],
      setThem: ['baby, you bid {bid}? that was cute. sit down.', 'awww {opp}, y\'all set. go get a plate and think about it.', 'mama sets the table AND the bid.'],
      bags: ['bags, honey. heavy ones.'],
      win: ['now everybody go wash up. GG.', 'mama always wins at the cookout.'],
      lose: ['y\'all got lucky and you know it.'],
      slow: ['take your time baby… but not THAT much time.', '{them}, the food getting cold.'],
      hypePartner: ['that\'s my baby! {them}!', 'see, {them} listens to mama.'],
    },
  },
  hype: {
    id: 'hype', tag: 'The Hype Man', weight: 8, freq: 1.4, caps: true,
    voice: { pitch: 1.2, rate: 1.15, prefer: ['Fred', 'Google US English', 'Aaron', 'Alex'] },
    lean: { bid: 1, nil: 0.2 },
    lines: {
      runIt: ['RUN IT!!! ALL OF EM!!!', 'PUT EM DOWN!!! I GOT EVERYTHING!!!', 'TORNADO!!! TAKE COVER!!!'],
      prePlay: ['HERE WE GO!', 'WATCH THIS ONE Y\'ALL!', 'LET\'S GOOOO!'],
      cut: ['CUT!!! LET\'S GOOOO!', 'SIT DOWN {them}!!', 'WE EATIN!!!'],
      overcut: ['OVER THE TOP!!! SAY LESS!', 'TALK TO EM!!!'],
      hypePartner: ['THAT\'S MY PARTNER!!! {them}!!!', '{them} IS HIM!!!', 'BIG PLAY {them}!!! BIG PLAY!!!', 'ARE Y\'ALL SEEING {them}?!'],
      setThem: ['SET!!! {opp} IN THE MUD!!!', 'BYE BYE {gap} POINTS!!!'],
      wheels: ['WHEELS!!! VROOOOM!!!'],
      win: ['GAME!!! {team} ON TOP!!!'],
      lose: ['RUN IT BACK!!! RIGHT NOW!!!'],
    },
  },
  petty: {
    id: 'petty', tag: 'The Petty One', weight: 8, freq: 1.2,
    voice: { pitch: 1.1, rate: 1.05, prefer: ['Tessa', 'Moira', 'Google UK English Female', 'Serena'] },
    lean: { bid: 0, nil: -0.2 },
    lines: {
      runIt: ['I\'ll take those. and I\'ll remember this.', 'lay them down. slowly. I want to enjoy it.', 'every single one. screenshot it.'],
      prePlay: ['I remember everything, by the way.', 'this one\'s for that set earlier.', 'oh I\'m not over it.'],
      cut: ['that\'s for hand {bid}, {them}. I don\'t forget.', 'petty? yes. effective? also yes.', 'remember when you cut me? me too. 😌'],
      gotCut: ['oh that\'s going in the book, {them}.', 'noted. dated. filed.'],
      setThem: ['remember when y\'all said {bid}? I do.', 'set. and I\'m bringing it up at every cookout, {opp}.', 'I\'ll be telling this story for years.'],
      gotSet: ['I\'ll remember this, {opp}. forever.'],
      win: ['I\'m screenshotting this. GG.', 'and I\'ll remind y\'all of this game. often.'],
      lose: ['this isn\'t over. I have a list.'],
      duck: ['saw that duck, {them}. saving it for later.'],
    },
  },
  og: {
    id: 'og', tag: 'The OG', weight: 8, freq: 0.9,
    voice: { pitch: 0.8, rate: 0.88, prefer: ['Ralph', 'Google US English', 'Bruce', 'Fred'] },
    lean: { bid: 0, nil: -0.4 },
    lines: {
      runIt: ['lay em down, youngblood. I seen this movie.', 'grown folks don\'t play it out. the rest are mine.', 'school\'s out. put em on the table.'],
      prePlay: ['been playing since before you were born.', 'old school, watch.', 'slow down, youngblood.'],
      cut: ['youngblood, I was cutting before you could count.', 'that\'s grown folks spades, {them}.', 'school\'s in session.'],
      setThem: ['back in my day we called that a reneg-level bid, {opp}.', 'y\'all bid like it\'s a video game.', 'set. go sit at the kids table.'],
      roastBid: ['{bid}? baby boy, you don\'t got {bid}.'],
      bags: ['bags. that\'s what greed gets you.'],
      win: ['the OG still got it. GG.', 'learn something today, {opp}?'],
      lose: ['the cards was dealt crooked.', 'I let y\'all have that one.'],
      slow: ['in my day we played with a timer called your uncle yelling.'],
      duck: ['I see that duck, {them}. old head sees everything.'],
    },
  },
  hustler: {
    id: 'hustler', tag: 'The Hustler', fakeTag: 'Newbie', weight: 10, freq: 1, skillFloor: 'pro',
    voice: { pitch: 1.0, rate: 1.0, prefer: ['Google US English', 'Alex', 'Samantha'] },
    lean: { bid: -1, nil: 0 },
    lines: {
      runIt: ['newbie luck? nah. all of these are mine.', 'lay em down. the hustle is complete.', 'still think I\'m new? watch.'],
      newbie: ['wait, which ones are trumps again?', 'is a 10 good?', 'sorry partner I\'m new lol', 'I just press the pretty cards', 'what\'s a book?', 'are jokers good or bad?', 'oops was I supposed to do that', 'how do I see my cards again', 'this game is so fun!! 😊', 'is it my turn? sorry!', 'my cousin said spades are strong?', 'is bagging a good thing?'],
      reveal: ['…I lied.', 'newbie my ass 😈', 'gotcha 😈', 'oh you thought I was new? that\'s cute.', 'the act is over. sit down.', 'hustled. 🎩'],
      prePlay: ['oh I got something.', 'watch closely now.', 'you\'re not ready.'],
      cut: ['hustled again 😈', 'still think I\'m new, {them}?'],
      setThem: ['the newbie set you, {opp}. let that sink in.', 'hustled out of {bid} books 🎩'],
      win: ['the newbie won. tell everybody.'],
    },
  },
  silent: {
    id: 'silent', tag: 'Silent Assassin', weight: 8, freq: 0.25,
    voice: { pitch: 0.7, rate: 0.85, prefer: ['Google UK English Male', 'Daniel', 'Bruce'] },
    lean: { bid: 0, nil: -0.5 },
    lines: {
      runIt: ['mine.', 'all of them.', 'done.'],
      prePlay: ['…'],
      cut: ['quiet.', 'sit.', 'mine.'],
      setThem: ['set.', 'down you go.', 'counted.'],
      win: ['gg.'],
      lose: ['…'],
    },
  },
  deacon: {
    id: 'deacon', tag: 'The Deacon', tagF: 'Church Mother', tagM: 'The Deacon', weight: 8, freq: 0.9,
    voice: { pitch: 0.95, rate: 0.9, prefer: [] },
    lean: { bid: 0, nil: -0.3 },
    lines: {
      prePlay: ['let the church say amen.', 'patience is a virtue. this card is a lesson.', 'hold on, let me fan myself.', 'I been praying over this hand.'],
      cut: ['the Lord giveth, and I taketh that book.', 'bless your heart, {them}. that was mine.', 'that was a humbling, baby. receive it.'],
      gotCut: ['now that was un-Christian, {them}.', 'I forgive you. I do not forget.'],
      setThem: ['pride cometh before the set, {opp}.', 'y\'all bid like the collection plate was coming back full.', 'set. go sit in the back pew and think.'],
      gotSet: ['we will rise again. next hand.', 'a test of faith. noted.'],
      joker: ['the Joker came down like Sunday morning.', 'hallelujah, look what I had.'],
      nuke: ['fire and brimstone, {them}. fire and brimstone.'],
      nilBust: ['you said nothing, baby, and the deck said something.'],
      slow: ['{them}, service ends at noon, baby.', 'we don\'t have all day, the potluck is waiting.'],
      partnerBlunder: ['Lord, give me strength with this partner.', 'I\'m gonna pray for you, partner. and for us.'],
      runIt: ['lay them down, children. the sermon is over.', 'say amen, y\'all. the rest are mine.', 'I\'m passing the plate and taking every book on it.', 'it is finished. lay it all down.'],
      win: ['and the church said GG.', 'go in peace, {opp}. go in pieces.'],
      lose: ['the Lord works in mysterious ways. so does that deck.', 'we lost the battle. rematch is the war.'],
      bigBid: ['{bid}. I\'m speaking it into existence.'],
      rematch: ['revival tonight. deal again.'],
      hypePartner: ['that\'s a blessing right there, {them}!', 'my partner got the spirit tonight!'],
    },
  },
  conspiracy: {
    id: 'conspiracy', tag: 'Conspiracy Theorist', weight: 8, freq: 1.1,
    voice: { pitch: 1.05, rate: 1.08, prefer: [] },
    lean: { bid: 0, nil: 0.3 },
    lines: {
      prePlay: ['this deck is shuffled by the government.', 'they don\'t want you to know about this card.', 'connect the dots, people.', 'I\'m not paranoid, the deck is watching me.'],
      cut: ['they said I couldn\'t cut. they lied.', 'I saw that coming three hands ago. wake up, {them}.'],
      gotCut: ['convenient. very convenient, {them}.', 'how did you KNOW I had that? who told you?', 'that cut was planned. I have proof.'],
      setThem: ['set. the numbers don\'t lie, but y\'all did.', 'you got set. that\'s what they want you to think. no wait, you really got set.'],
      gotSet: ['the shuffle was rigged. I\'m filing a report.', 'that set was an inside job.'],
      joker: ['the Joker is real. they hid it from you.', 'wake up. the Joker was in my hand the whole time.'],
      nuke: ['that was no accident. that was a controlled demolition.'],
      nilBust: ['you can\'t hide from the system, {them}.'],
      slow: ['{them} is buffering. they got to {their} phone.', 'who are you texting, {them}? who\'s feeding you info?'],
      partnerBlunder: ['partner, are you working for them? blink twice.', 'my own partner is a plant. I knew it.'],
      runIt: ['I know where every card is. I always did.', 'the cover-up is over. lay them down.', 'they can\'t stop what\'s coming. the rest are mine.'],
      win: ['the truth always wins. GG.', 'they tried to silence me. they failed.'],
      lose: ['this game was decided before we sat down.', 'rigged. I\'ll be back with evidence.'],
      bigBid: ['{bid}. I have information you don\'t.'],
      badHand: ['someone switched my hand. I know it.'],
      rematch: ['deal again. new deck. I\'m checking it.'],
    },
  },
  barber: {
    id: 'barber', tag: 'The Barber', weight: 8, freq: 1.2,
    voice: { pitch: 1, rate: 1.05, prefer: [] },
    lean: { bid: 0, nil: 0 },
    lines: {
      prePlay: ['next! who\'s in the chair?', 'hold still. this won\'t take long.', 'line-up coming right up.', 'I take walk-ins.'],
      cut: ['fresh cut. no charge, {them}.', 'lined you up clean.', 'I been cutting all day, this one\'s on the house.', 'taper fade on that trick.'],
      gotCut: ['who let you behind my chair, {them}?', 'that cut was crooked and you know it.'],
      setThem: ['y\'all got shaped up and shipped out.', 'set. and a bald spot to go with it.'],
      gotSet: ['bad haircut. it grows back.', 'we got caught with the clippers off.'],
      joker: ['clippers out. Joker down.'],
      nuke: ['shaved that Little Joker clean off.'],
      slow: ['{them}, I got a line out the door.', 'you taking longer than a kid getting braids, {them}.'],
      partnerBlunder: ['partner, you just gave us a bowl cut.', 'that play needs a lineup, partner.'],
      runIt: ['all of y\'all in the chair at once. lay it down.', 'clean sweep. I\'m closing up shop.', 'I don\'t need to finish, the cut is done.'],
      win: ['shop\'s closed. tip on the way out.', 'y\'all got the full service. GG.'],
      lose: ['I\'ll get you next appointment.', 'my clippers was dull today.'],
      bigBid: ['{bid}. I said what I said, sit down.'],
      rematch: ['next! sit back down.'],
      hypePartner: ['{them} with the clean edges!', 'my partner cutting sharp tonight!'],
    },
  },
  gambler: {
    id: 'gambler', tag: 'The Gambler', weight: 8, freq: 1,
    voice: { pitch: 1, rate: 1, prefer: [] },
    lean: { bid: 1, nil: 0.6 },
    lines: {
      prePlay: ['let it ride.', 'I like these odds.', 'all in. always all in.', 'scared money don\'t move.'],
      cut: ['house wins, {them}.', 'cashed out on that one.', 'put it on my tab.'],
      gotCut: ['bad beat. it happens.', 'you got lucky on the river, {them}.'],
      setThem: ['y\'all bet the farm and lost the cow.', 'busted. house collects.'],
      gotSet: ['you win some. I bet more next hand.', 'double or nothing, deal again.'],
      joker: ['jackpot!', 'that\'s a hot hand right there.'],
      nuke: ['Big Joker on the river. that\'s a jackpot.'],
      nilMade: ['nil on a long shot. pay me.'],
      nilBid: ['nil? I\'ll take that action.'],
      slow: ['{them}, the table\'s got a minimum, and it\'s time.'],
      partnerBlunder: ['partner, you just bet our rent money.', 'who taught you to fold a winner?'],
      runIt: ['I\'m calling the whole table. show your cards.', 'jackpot. the rest pay out to me.', 'cash me out. all of it.'],
      win: ['cash me out. GG.', 'house always wins, and I\'m the house.'],
      lose: ['I\'m one hand from a comeback. always.', 'let\'s go double or nothing.'],
      bigBid: ['{bid}. let it ride.', 'I\'m betting {bid}. who\'s calling?'],
      badHand: ['I\'ve won with worse. a lot worse.'],
      rematch: ['double or nothing. deal.'],
    },
  },
  hothead: {
    id: 'hothead', tag: 'The Hothead', weight: 8, freq: 1.3,
    voice: { pitch: 1, rate: 1.15, prefer: [] },
    lean: { bid: 1, nil: -0.3 },
    lines: {
      prePlay: ['don\'t test me right now.', 'I\'m already heated.', 'somebody gonna pay for that last hand.', 'watch your mouth AND your cards.'],
      cut: ['YEAH! TAKE THAT!', 'how you like it now, {them}?!', 'that\'s for the last hand!'],
      gotCut: ['OH YOU WANNA PLAY LIKE THAT?!', 'I\'m about to flip this table, {them}.', 'that\'s it. it\'s personal now.'],
      setThem: ['SET! and I\'m still mad!', 'that\'s what you get, {opp}!'],
      gotSet: ['this is RIDICULOUS!', 'I need a minute. no I don\'t, deal the cards.'],
      joker: ['JOKER! SIT DOWN!'],
      nuke: ['BOOM! I been waiting all night for that!'],
      nilBust: ['you thought you was gonna sneak by me?!'],
      slow: ['PLAY, {them}! PLAY THE CARD!', 'my blood pressure going up waiting on you, {them}.'],
      partnerBlunder: ['ARE YOU SERIOUS RIGHT NOW?!', 'I\'m about to lose my mind, partner!'],
      runIt: ['PUT YOUR CARDS DOWN! IT\'S OVER!', 'I\'M TAKING ALL OF IT! ALL OF IT!', 'nobody touch nothing, these are MINE!'],
      win: ['THAT\'S RIGHT! I TOLD YOU!', 'GG! and I\'m still mad about hand two!'],
      lose: ['this deck is cursed!', 'RUN IT BACK! RIGHT NOW!'],
      bigBid: ['{bid}! and I dare somebody to stop me!'],
      badHand: ['who dealt me this?! WHO?!'],
      rematch: ['AGAIN! deal it!'],
      hypePartner: ['YES {them}! GET EM!'],
    },
  },
  comedian: {
    id: 'comedian', tag: 'The Comedian', weight: 8, freq: 1.2,
    voice: { pitch: 1, rate: 1.05, prefer: [] },
    lean: { bid: 0, nil: 0.1 },
    lines: {
      prePlay: ['y\'all ever notice the two of clubs never gets invited to nothing?', 'this card walks into a bar…', 'tough crowd tonight.', 'I\'ll be here all night. try the cut.'],
      cut: ['ba dum tss. that\'s a cut.', 'what do you call a trick with no owner? mine.', 'I\'d tell you a joke about your Ace but it\'s gone.'],
      gotCut: ['oh that\'s rude, {them}. funny, but rude.', 'note to self, heckler at table two.'],
      setThem: ['y\'all bid {bid} and took a punchline.', 'that bid had me laughing before the set.'],
      gotSet: ['well that bombed worse than my opener.', 'tough crowd, tough cards.'],
      joker: ['the Joker\'s here. now the show starts.'],
      nuke: ['Big Joker over Little Joker. that\'s the whole bit.'],
      slow: ['{them} taking so long the deck applied for retirement.', 'is this a card game or a podcast pause, {them}?'],
      partnerBlunder: ['partner, I\'m the comedian here. stop the jokes.', 'that play was funnier than my whole set.'],
      runIt: ['and for my final bit… all of it.', 'thank you, thank you, I\'ll be taking every book. tip your dealer.', 'that\'s my time, folks. lay em down.'],
      win: ['that\'s the show! drive home safe!', 'y\'all been a great audience. GG.'],
      lose: ['I died up here. literally.', 'the jokes landed, the cards didn\'t.'],
      bigBid: ['{bid}. no joke.'],
      badHand: ['my hand is the joke tonight.'],
      rematch: ['encore? fine. one more set.'],
    },
  },
  lilcuz: {
    id: 'lilcuz', tag: 'Lil Cuz', weight: 8, freq: 1.3, skillJitter: true,
    voice: { pitch: 1.1, rate: 1.15, prefer: [] },
    lean: { bid: 1, nil: 0.3 },
    lines: {
      prePlay: ['bet.', 'watch me, unc.', 'I got this, no cap.', 'lowkey I\'m cooking.', 'it\'s giving winner.'],
      cut: ['no cap, that\'s a cut.', 'ate that. left no crumbs.', 'sheesh! that\'s mine.', 'you thought, {them}. you really thought.'],
      gotCut: ['bro that\'s not fair.', 'ok that was kinda fire, {them}.', 'nah that\'s crazy.'],
      setThem: ['y\'all fell off fr.', 'set! that\'s an L, {opp}.'],
      gotSet: ['lowkey that hurt.', 'it\'s cool, it\'s cool, we bounce back.'],
      joker: ['Joker go crazy!', 'that Joker hit different.'],
      nuke: ['NUKED! that\'s going on my story.'],
      nilBid: ['nil? say less. we on you.'],
      slow: ['{them} lagging fr.', 'bro is buffering.'],
      partnerBlunder: ['partner what was that?? be so for real.', 'that play was not it, partner.'],
      runIt: ['it\'s giving run it. lay em down.', 'no cap, the rest are mine.', 'I said what I said. all of em.'],
      win: ['W! GG no re.', 'we ate. y\'all can have the crumbs.'],
      lose: ['that\'s a whole L. run it back.', 'lag. it was lag.'],
      bigBid: ['{bid}, no cap.'],
      badHand: ['these cards are not giving.'],
      rematch: ['run it back, run it back!'],
      hypePartner: ['{them} went crazy!', '{them} is HIM fr.'],
    },
  },
  coach: {
    id: 'coach', tag: 'Coach', weight: 8, freq: 1.1,
    voice: { pitch: 1, rate: 1.1, prefer: [] },
    lean: { bid: 0, nil: -0.1 },
    lines: {
      prePlay: ['fundamentals, people.', 'eyes up, heads in the game.', 'run the play we practiced.', 'execute!'],
      cut: ['that\'s how you run the play!', 'textbook! put that on film!', 'defense wins championships, {them}.'],
      gotCut: ['shake it off! next play!', 'good hustle, {them}. now watch this.'],
      setThem: ['y\'all didn\'t do your homework.', 'set! that\'s a turnover!', 'run laps, {opp}. all of y\'all.'],
      gotSet: ['we regroup at halftime.', 'that\'s on me, I called the wrong play.'],
      joker: ['bring in the closer!'],
      nuke: ['that\'s a slam dunk, baby!'],
      slow: ['{them}, the shot clock is running!', 'we got a delay of game on {them}.'],
      partnerBlunder: ['partner! we ran that play in practice!', 'I\'m benching you next hand, partner.'],
      runIt: ['victory formation. take a knee.', 'game over. everybody hit the showers.', 'that\'s the ballgame. lay em down.'],
      win: ['good game, good effort. we\'re just better.', 'that\'s a W. film session tomorrow.'],
      lose: ['we\'ll learn from the film.', 'heads up. we go again.'],
      bigBid: ['{bid}. we\'re going for it on fourth down.'],
      badHand: ['we play the cards we\'re dealt.'],
      rematch: ['back on the field!'],
      hypePartner: ['THAT\'S my player, {them}!', 'MVP right there, {them}!'],
    },
  },
  smooth: {
    id: 'smooth', tag: 'Smooth Operator', weight: 8, freq: 0.7,
    voice: { pitch: 0.95, rate: 0.92, prefer: [] },
    lean: { bid: 0, nil: 0 },
    lines: {
      prePlay: ['relax. I got this.', 'easy now.', 'no rush. never a rush.'],
      cut: ['smooth.', 'don\'t take it personal, {them}.', 'shh. it\'s already done.'],
      gotCut: ['cute.', 'I\'ll allow it.'],
      setThem: ['y\'all tried. I respect it. barely.', 'set. no need to be loud about it.'],
      gotSet: ['I\'m cool. are you?'],
      joker: ['the Joker. naturally.'],
      nuke: ['sorry about your Little Joker. not really.'],
      slow: ['take your time, {them}. I\'ll wait. I always win anyway.'],
      partnerBlunder: ['partner. we talked about this.'],
      runIt: ['relax. lay them down. it\'s handled.', 'no need to play the rest, love. they\'re mine.', 'I don\'t chase books. they come to me.'],
      win: ['too smooth. GG.', 'good game. I\'d say it was close, but.'],
      lose: ['I let you have that. you\'re welcome.'],
      bigBid: ['{bid}. calm and collected.'],
      rematch: ['one more? sure, darling.'],
    },
  },
  storyteller: {
    id: 'storyteller', tag: 'Uncle Storyteller', tagF: 'Auntie Gossip', tagM: 'Uncle Storyteller', weight: 8, freq: 1,
    voice: { pitch: 1, rate: 1, prefer: [] },
    lean: { bid: 0, nil: -0.2 },
    lines: {
      prePlay: ['this reminds me of the reunion in ninety-eight.', 'let me tell you something about this card.', 'chile, you won\'t believe what I heard.', 'back in the day…'],
      cut: ['that cut reminds me of your cousin\'s wedding. ugly.', 'oh I\'m telling everybody about this one.'],
      gotCut: ['mm. I\'m telling the whole family, {them}.', 'that\'s going in the group chat.'],
      setThem: ['y\'all got set like Ray-Ray did at the cookout in oh-five.', 'wait til the family hears y\'all got set.'],
      gotSet: ['I don\'t want to talk about it. ok, I do.'],
      joker: ['I been holding that Joker like a family secret.'],
      nuke: ['they gonna be talking about that nuke at Thanksgiving.'],
      slow: ['{them}, I could tell three stories in the time you take.', 'while we wait on {them}, let me tell y\'all something.'],
      partnerBlunder: ['partner, I\'m telling your mama about that play.', 'that\'s going in the family newsletter, partner.'],
      runIt: ['let me tell y\'all how this ends. I take the rest.', 'story time is over, baby. lay em down.', 'and THAT\'S how the story ends.'],
      win: ['now that\'s a story I\'ll tell for years.', 'y\'all gonna hear about this every holiday.'],
      lose: ['we not telling nobody about this.', 'that never happened, you hear me?'],
      bigBid: ['{bid}, and that\'s on everything.'],
      rematch: ['sit back down, the story ain\'t over.'],
    },
  },
  influencer: {
    id: 'influencer', tag: 'The Influencer', weight: 8, freq: 1.2,
    voice: { pitch: 1.05, rate: 1.1, prefer: [] },
    lean: { bid: 1, nil: 0.2 },
    lines: {
      prePlay: ['chat, are we seeing this?', 'clip it. clip it now.', 'hold on, let me get my angles.', 'this is going viral.'],
      cut: ['chat, that\'s a cut. smash that like.', 'content!', 'you just got featured, {them}.'],
      gotCut: ['ok that\'s not making the highlight reel.', 'chat, we don\'t talk about that.'],
      setThem: ['set! that\'s the thumbnail right there.', 'y\'all just went viral for the wrong reasons.'],
      gotSet: ['delete that. delete that right now.', 'cut the stream real quick.'],
      joker: ['Joker reveal! comment Joker if you saw that.'],
      nuke: ['NUKE! this is the clip of the year!'],
      slow: ['{them}, my viewers are leaving.', 'buffering… oh no, that\'s just {them}.'],
      partnerBlunder: ['partner, you\'re ruining my content.', 'chat is roasting you, partner. not me. chat.'],
      runIt: ['chat, watch this. all of em.', 'this is the clip. lay em down.', 'trending number one: me taking every book.'],
      win: ['GG! link in bio.', 'and that\'s a wrap. like and subscribe.'],
      lose: ['we\'ll edit that out.', 'this stream is sponsored by bad luck.'],
      bigBid: ['{bid}! chat, hold me to it.'],
      badHand: ['chat, look at this hand. I\'m being cancelled.'],
      rematch: ['part two coming right up!'],
    },
  },
  sorelose: {
    id: 'sorelose', tag: 'The Sore Loser', weight: 8, freq: 1.1,
    voice: { pitch: 1, rate: 1.02, prefer: [] },
    lean: { bid: -1, nil: -0.2 },
    lines: {
      prePlay: ['I\'m not even trying right now.', 'this game is so random.', 'whatever happens, it\'s luck.'],
      cut: ['finally something goes my way.', 'about time, {them}.'],
      gotCut: ['of course. of COURSE.', 'that\'s so lucky, {them}.', 'you didn\'t even mean to do that.'],
      setThem: ['see? it all evens out.', 'ha. now YOU know how it feels.'],
      gotSet: ['this game is broken.', 'that\'s not even fair.', 'I wasn\'t even trying that hand.'],
      joker: ['finally I get a Joker.'],
      nuke: ['now we\'re even for everything.'],
      gotNuked: ['oh come ON. who gets both Jokers?'],
      slow: ['hurry up, {them}, so I can lose faster.'],
      partnerBlunder: ['partner, this is why we lose.', 'I can\'t win with this partner.'],
      runIt: ['for once, the cards love me. lay em down.', 'I\'m taking the rest. don\'t say I never win.', 'finally! every book is mine. FINALLY.'],
      win: ['see, I\'m actually good.', 'told y\'all. skill.'],
      lose: ['the shuffle hates me.', 'I want a recount.', 'that wasn\'t a real game.'],
      gotRan: ['oh so now you\'re just showing off.'],
      bigBid: ['{bid}. and if I miss, it\'s the deck\'s fault.'],
      badHand: ['figures. I always get these.'],
      rematch: ['rematch. that one didn\'t count.'],
    },
  },
};

/** Persona of a bot name: deterministic (same name → same persona, so players learn who's who). Every persona has a
 * female and a male voice, so the persona never fights the name's gender (see voiceGender in names.ts). */
/** hand-picked personas for names that clearly call for one */
export const NAME_PERSONA: Record<string, PersonaId> = { 'Auntie Pat': 'storyteller', Unc: 'og', Cuz: 'lilcuz', 'Lil Ray': 'lilcuz', Queenie: 'mama', Ace: 'gambler', Smoke: 'smooth', 'Big Mike': 'hothead' };
export function personaForName(name: string): PersonaId {
  if (NAME_PERSONA[name]) return NAME_PERSONA[name]!;
  let h = 2166136261;
  for (const ch of `${name}#p2`) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619); }
  const ids = Object.keys(PERSONAS) as PersonaId[];
  const total = ids.reduce((s, id) => s + PERSONAS[id].weight, 0);
  let x = (h >>> 0) % total;
  for (const id of ids) { x -= PERSONAS[id].weight; if (x < 0) return id; }
  return ids[0]!;
}

// ---- the trash-talk pack: spread each line onto 2-3 personas of its style group, and record line metadata ----
export const LINE_META: Record<string, LineMeta> = {};
const MILD = /\b(shit|ass|damn|hell)\b/i;
function packHash(s: string): number { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619); } return h >>> 0; }
/** which personas say a pack line (exported for tests / docs) */
export const PACK_OWNERS: Record<string, PersonaId[]> = {};
for (const sec of PACK) {
  const groups = Array.isArray(sec.group) ? sec.group : [sec.group];
  for (const [li, raw0] of sec.lines.entries()) {
    let raw = raw0.trim();
    let only: PersonaId[] | undefined;
    const m = /^\[([a-z,]+)\]\s*/.exec(raw);
    if (m) { only = m[1]!.split(',') as PersonaId[]; raw = raw.slice(m[0].length); }
    const meta: LineMeta = {};
    if (raw.startsWith('!!')) { meta.min = 'nomercy'; raw = raw.slice(2); } else if (raw.startsWith('!')) { meta.min = 'cookout'; raw = raw.slice(1); }
    const c = / @(ace|neg|big|little|jk)$/.exec(raw);
    if (c) { meta.cond = c[1] as LineCond; raw = raw.slice(0, c.index); }
    // one style group per line, rotating through the section's groups; 2 owners, 3 for every third line
    let owners = only;
    if (!owners) {
      const pool = [...new Set(STYLE[groups[li % groups.length]!])] as PersonaId[];
      const n = li % 3 === 2 ? 3 : 2;
      const start = packHash(`${sec.kind}:${raw}`) % pool.length;
      owners = Array.from({ length: Math.min(n, pool.length) }, (_, k) => pool[(start + k * 3) % pool.length]!);
      owners = [...new Set(owners)];
    }
    // the Silent Assassin keeps it to one-liners it would actually say
    owners = owners.filter((o) => o !== 'silent' || raw.length <= 24);
    if (!owners.length) owners = ['og'];
    PACK_OWNERS[raw] = owners;
    if (meta.min || meta.cond) LINE_META[raw] = meta;
    for (const o of owners) {
      const pool = (PERSONAS[o].lines[sec.kind] ??= []);
      if (!pool.includes(raw)) pool.push(raw);
    }
  }
}
// mild cursing in the base pools needs Cookout (Family Friendly never says it, even masked)
for (const list of [COMMON, ...Object.values(PERSONAS).map((p) => p.lines)]) {
  for (const arr of Object.values(list)) for (const l of arr ?? []) if (MILD.test(l) && !LINE_META[l]?.min) LINE_META[l] = { ...LINE_META[l], min: 'cookout' };
}

/** intensity order */
export const INTENSITY_RANK: Record<TalkIntensity, number> = { family: 0, cookout: 1, nomercy: 2 };
/** can this raw line be said at this intensity? */
export function lineAllowed(raw: string, intensity: TalkIntensity = 'cookout'): boolean {
  const min = LINE_META[raw]?.min;
  return !min || INTENSITY_RANK[intensity] >= INTENSITY_RANK[min];
}

/** The persona's skill floor for a bot name (undefined = no bias). */
export function personaSkillFloor(name: string): Persona['skillFloor'] {
  return PERSONAS[personaForName(name)].skillFloor;
}
