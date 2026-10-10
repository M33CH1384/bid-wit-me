/**
 * Bot personalities: ONE data file. Each persona has its own line pools, how often it talks, a TTS voice, and a slight
 * play-style lean (always within strong-bot bounds). Add a persona by adding an entry to PERSONAS (and a weight).
 *
 * Line templates: {me} speaker, {them} the player the moment is about, {partner} speaker's partner, {team} speaker's
 * team name, {opp} the other team's name, {card} the card, {bid} a bid number, {gap} the score gap.
 * Mild cursing (damn / hell / shit / ass) is written plainly and masked on screen when "Clean talk" is on.
 * Rules for writers: competitive and funny, never about race, gender, sexuality, religion or looks; no threats; no slurs.
 */

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
  | 'reveal';      // Hustler drops the act

export type PersonaId = 'professor' | 'mama' | 'hype' | 'petty' | 'og' | 'hustler' | 'silent';

export interface Persona {
  id: PersonaId;
  /** shown on the bot's plate tooltip (the Hustler shows `fakeTag` until revealed) */
  tag: string;
  fakeTag?: string;
  /** share of bot names that get this persona (out of the total) */
  weight: number;
  /** how chatty: multiplies every trigger's chance */
  freq: number;
  /** ALL CAPS speaker */
  caps?: boolean;
  voice: { pitch: number; rate: number; prefer: string[] };
  /** play-style lean: bid nudge (±1 at most, applied sometimes, kept legal and sane) and Nil willingness (-1..1) */
  lean: { bid: -1 | 0 | 1; nil: number };
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
  hypePartner: ["THAT'S MY PARTNER! {them}!", 'yes {them}! carry us!', '{them} cooking 🔥', 'I taught {them} that.', 'partner of the year: {them}.', '{them} with the big brain play.'],
};

export const PERSONAS: Record<PersonaId, Persona> = {
  professor: {
    id: 'professor', tag: 'The Professor', weight: 12, freq: 1,
    voice: { pitch: 0.95, rate: 0.95, prefer: ['Daniel', 'Google UK English Male', 'Arthur', 'Alex'] },
    lean: { bid: 0, nil: -0.3 },
    lines: {
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
    id: 'mama', tag: 'Big Mama', weight: 13, freq: 1.1,
    voice: { pitch: 1.05, rate: 0.9, prefer: ['Samantha', 'Google US English', 'Victoria', 'Karen'] },
    lean: { bid: 0, nil: 0 },
    lines: {
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
    id: 'hype', tag: 'The Hype Man', weight: 13, freq: 1.4, caps: true,
    voice: { pitch: 1.2, rate: 1.15, prefer: ['Fred', 'Google US English', 'Aaron', 'Alex'] },
    lean: { bid: 1, nil: 0.2 },
    lines: {
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
    id: 'petty', tag: 'The Petty One', weight: 12, freq: 1.2,
    voice: { pitch: 1.1, rate: 1.05, prefer: ['Tessa', 'Moira', 'Google UK English Female', 'Serena'] },
    lean: { bid: 0, nil: -0.2 },
    lines: {
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
    id: 'og', tag: 'The OG', weight: 13, freq: 0.9,
    voice: { pitch: 0.8, rate: 0.88, prefer: ['Ralph', 'Google US English', 'Bruce', 'Fred'] },
    lean: { bid: 0, nil: -0.4 },
    lines: {
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
    id: 'hustler', tag: 'The Hustler', fakeTag: 'Newbie', weight: 25, freq: 1,
    voice: { pitch: 1.0, rate: 1.0, prefer: ['Google US English', 'Alex', 'Samantha'] },
    lean: { bid: -1, nil: 0 },
    lines: {
      newbie: ['wait, which ones are trumps again?', 'is a 10 good?', 'sorry partner I\'m new lol', 'I just press the pretty cards', 'what\'s a book?', 'are jokers good or bad?', 'oops was I supposed to do that', 'how do I see my cards again', 'this game is so fun!! 😊', 'is it my turn? sorry!', 'my cousin said spades are strong?', 'is bagging a good thing?'],
      reveal: ['…I lied.', 'newbie my ass 😈', 'gotcha 😈', 'oh you thought I was new? that\'s cute.', 'the act is over. sit down.', 'hustled. 🎩'],
      prePlay: ['oh I got something.', 'watch closely now.', 'you\'re not ready.'],
      cut: ['hustled again 😈', 'still think I\'m new, {them}?'],
      setThem: ['the newbie set you, {opp}. let that sink in.', 'hustled out of {bid} books 🎩'],
      win: ['the newbie won. tell everybody.'],
    },
  },
  silent: {
    id: 'silent', tag: 'Silent Assassin', weight: 12, freq: 0.25,
    voice: { pitch: 0.7, rate: 0.85, prefer: ['Google UK English Male', 'Daniel', 'Bruce'] },
    lean: { bid: 0, nil: -0.5 },
    lines: {
      prePlay: ['…'],
      cut: ['quiet.', 'sit.', 'mine.'],
      setThem: ['set.', 'down you go.', 'counted.'],
      win: ['gg.'],
      lose: ['…'],
    },
  },
};

/** Persona of a bot name: deterministic (same name → same persona, so players learn who's who). */
export function personaForName(name: string): PersonaId {
  let h = 2166136261;
  for (const ch of name) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619); }
  const ids = Object.keys(PERSONAS) as PersonaId[];
  const total = ids.reduce((s, id) => s + PERSONAS[id].weight, 0);
  let x = (h >>> 0) % total;
  for (const id of ids) { x -= PERSONAS[id].weight; if (x < 0) return id; }
  return ids[0]!;
}
