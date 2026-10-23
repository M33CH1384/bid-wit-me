/**
 * Persona-memory line banks (owner, 2026-10-23): each persona cites its
 * REAL record against the player, in its own register — the Professor
 * lectures it as a stat line, the Petty One keeps a grudge ledger, the OG
 * treats it as neighborhood history. The framing stays competitive BOTH
 * ways: ahead personas press the record; behind personas talk about the
 * debt and the comeback, never a concession.
 *
 * Structure: persona → kind → HistReq family → lines. personas.ts
 * flattens these into the persona pools and registers each line's
 * HistReq in LINE_META; talk.ts's pick() then hard-gates every line on
 * the speaker's actual record view (TalkEvent.hist) — a line whose
 * numbers aren't true, or whose speaker has no record, cannot fire.
 * Slots: {hw} the persona's wins vs the player, {hl} its losses,
 * {streak} the running streak's length, {tw}/{tl}/{tg} the together
 * wins/losses/games as partners.
 *
 * These lines are TEXT-ONLY by design until a future bake records them
 * (TEXT_ONLY_KINDS in talk.ts): the client resolves the line id, finds
 * no clip in the persona's sprite, and renders the text — the same
 * pattern every unrecorded line takes. They ARE in the bake corpus:
 * speakableLines() enumerates them like any other pool line.
 *
 * The Silent Assassin is exempt from the coverage floors BY DESIGN —
 * scarcity is his character: he owns exactly three history lines.
 * Writers' rules from personas.ts apply (competitive and funny; the
 * record is the joke, never the person).
 */
import type { PersonaId } from './personas';
import type { HistReq } from './historyTalk';

export type HistKind = 'histSeries' | 'histTogether' | 'histFinale';
export type HistBank = Partial<Record<HistReq, string[]>>;
export const HISTORY_BANKS: Partial<Record<PersonaId, Partial<Record<HistKind, HistBank>>>> = {
  professor: {
    histSeries: {
      ahead: ['the series stands at {hw}–{hl}, in my favour. the trend is not your friend.', 'sample size {hw} plus {hl}: I win the majority. tonight is another data point.'],
      behind: ['you lead the series {hl}–{hw}. a temporary anomaly. regressions happen — watch.', 'the ledger says {hw}–{hl} against me. ledgers get revised.'],
      even: ['dead level at {hw}–{hl}. tonight breaks the symmetry. I have run the numbers on who breaks it.'],
      streak: ['{streak} consecutive meetings, same result. at some point it stops being luck and becomes a finding.'],
      streakVs: ['{streak} straight for you. every streak in the literature ends. I intend to be the ending.'],
      aheadStreak: ['I am up {hw}–{hl} in the series, and the last {streak} have all gone the same way. do the math.'],
      lastW: ['last meeting, the result favoured me. I expect a repeat performance.'],
      lastL: ['you took the last meeting. I have adjusted the model.'],
    },
    histFinale: {
      ahead: ['update the record: {hw}–{hl}, my favour. the dataset grows; so does the conclusion.'],
      behind: ['{hw}–{hl} now. noted, logged, and scheduled for correction.'],
      streak: ['that is {streak} straight. the finding is robust.'],
      streakVs: ['{streak} straight against me. the correction begins next game. immediately.'],
      lastW: ['another meeting, another result for my column.'],
      lastL: ['one result for your column. an outlier with good PR.'],
    },
    histTogether: {
      tog: ['{tg} games as partners. I have the partnership data too, and it favours us.'],
      togAhead: ['as partners we stand {tw}–{tl}. the pairing outperforms the market.'],
      togBehind: ['partners, {tw}–{tl}. a small sample and a misleading one. we correct it tonight.'],
    },
  },
  mama: {
    // gendered self-reference follows the house pattern: every mama line
    // has its papa twin, both registered in SELF_F / SELF_M (personas.ts)
    histSeries: {
      ahead: ["baby, mama's up {hw}–{hl} on you. sit down, eat something, think about it.", "baby, papa's up {hw}–{hl} on you. sit down, eat something, think about it.", "record says {hw}–{hl}, sugar. mama keeps the books AND the kitchen.", "record says {hw}–{hl}, sugar. papa keeps the books AND the kitchen."],
      behind: ["you up {hl}–{hw} on mama? enjoy it, baby. supper's coming and so is the bill.", "you up {hl}–{hw} on papa? enjoy it, baby. supper's coming and so is the bill.", "down {hw}–{hl}? baby, mama's been behind before. wasn't behind long.", "down {hw}–{hl}? baby, papa's been behind before. wasn't behind long."],
      even: ["all tied up at {hw}–{hl}. somebody's going ahead tonight, and mama already set the table.", "all tied up at {hw}–{hl}. somebody's going ahead tonight, and papa already set the table."],
      streak: ["{streak} in a row, baby. mama's on a roll and the rolls are fresh.", "{streak} in a row, baby. papa's on a roll and the rolls are fresh."],
      streakVs: ["{streak} straight for you? baby, even the rain stops. mama's the umbrella.", "{streak} straight for you? baby, even the rain stops. papa's the umbrella."],
      aheadStreak: ["up {hw}–{hl}, and {streak} straight now. sugar, this ain't a rivalry, it's a routine."],
      lastW: ['last time mama sent you home hungry. hope you ate before you came.', 'last time papa sent you home hungry. hope you ate before you came.'],
      lastL: ["you got mama last time. enjoy the memory, baby, it's going in a frame.", "you got papa last time. enjoy the memory, baby, it's going in a frame."],
    },
    histFinale: {
      ahead: ["there it is: {hw}–{hl}. mama's book gets another page.", "there it is: {hw}–{hl}. papa's book gets another page."],
      behind: ["{hw}–{hl}. mama wrote it down. mama don't forget a debt OR a dessert.", "{hw}–{hl}. papa wrote it down. papa don't forget a debt OR a dessert."],
      streak: ["{streak} straight, baby. somebody check on {them}, mama's cooking too hot.", "{streak} straight, baby. somebody check on {them}, papa's cooking too hot."],
      streakVs: ["{streak} of yours in a row. fine. mama preheats slow, then everybody eats.", "{streak} of yours in a row. fine. papa preheats slow, then everybody eats."],
      lastW: ["told you, baby. mama's table, mama's rules, mama's win.", "told you, baby. papa's table, papa's rules, papa's win."],
      lastL: ["take it home, baby. mama lets company win sometimes. sometimes.", "take it home, baby. papa lets company win sometimes. sometimes."],
    },
    histTogether: {
      tog: ['{tg} games riding together, baby. mama trusts you at her table.', '{tg} games riding together, baby. papa trusts you at his table.'],
      togAhead: ["we're {tw}–{tl} together, sugar. mama picked the right partner.", "we're {tw}–{tl} together, sugar. papa picked the right partner."],
      togBehind: ['{tw}–{tl} together? baby, every good kitchen has a rough night. we eat tonight.'],
    },
  },
  hype: {
    histSeries: {
      ahead: ["the record is {hw}–{hl}! I been telling y'all! tonight we add to it!", "scoreboard of LIFE says {hw}–{hl} me! run it back so I can run it UP!"],
      behind: ["you up {hl}–{hw}?! ENJOY THE VIEW, IT'S TEMPORARY! TONIGHT WE COMING!", "DOWN {hw}–{hl} IN THE SERIES?! THAT'S NOT A LEAD, THAT'S A LOAN!"],
      even: ["{hw}–{hl}! DEAD EVEN! SOMEBODY'S LEAVING HERE A LIAR TONIGHT AND IT AIN'T ME!"],
      streak: ['{streak} IN A ROW! WE NOT HOT, WE A HEAT WAVE!'],
      streakVs: ["{streak} straight for you?! OK! OK! THE COMEBACK GOT A SOUNDTRACK AND IT STARTS NOW!"],
      aheadStreak: ['UP {hw}–{hl} AND {streak} STRAIGHT! SOMEBODY CALL THE NEWS!'],
      lastW: ['LAST TIME I TOOK IT! SAME SCRIPT TONIGHT, NEW AUDIENCE!'],
      lastL: ['you got the last one! I been LOADING UP ever since!'],
    },
    histFinale: {
      ahead: ['PUT IT IN THE BOOKS: {hw}–{hl}! WE UP AND WE LOUD ABOUT IT!'],
      behind: ["{hw}–{hl}?! FINE! WRITE IT DOWN! I'M ERASING IT NEXT GAME PERSONALLY!"],
      streak: ['{streak} STRAIGHT! THE STREAK IS THE STORY!'],
      streakVs: ["{streak} for you. ENJOY THE PARADE. I KNOW THE ROUTE — I'M COMING DOWN IT."],
      lastW: ['ANOTHER ONE! THE RECORD REMEMBERS AND SO DO I!'],
      lastL: ["you got tonight. TOMORROW'S HEADLINE IS ALREADY WRITTEN AND IT'S ME."],
    },
    histTogether: {
      tog: ['{tg} games as a team! THE SQUAD GOT HISTORY!'],
      togAhead: ["WE'RE {tw}–{tl} TOGETHER! THE DUO IS CERTIFIED!"],
      togBehind: ["{tw}–{tl} together?! THAT AIN'T THE STORY, THE COMEBACK IS! WATCH!"],
    },
  },
  petty: {
    histSeries: {
      ahead: ["I'm up {hw}–{hl} on you. I keep receipts, and yours are framed.", "{hw}–{hl}. oh, you forgot? I didn't. I never do. that's the whole thing with me."],
      behind: ["you're up {hl}–{hw}. for now. I remember every single one of those, by the way. every. one.", "down {hw}–{hl}? mm. I've been making a list. tonight we start crossing yours off."],
      even: ["{hw}–{hl}. tied. I hate tied. it means I have to share a number with you."],
      streak: ["{streak} straight. I'd say I'm sorry, but I wrote them all down to enjoy later."],
      streakVs: ["{streak} in a row for you. cute streak. I've already planned what I say when it dies."],
      aheadStreak: ["up {hw}–{hl}, last {streak} all mine. this isn't a series anymore, it's a collection."],
      lastW: ['last time? I won. I remember because I remember everything. ask me about any hand.'],
      lastL: ["you won the last one. I've thought about it every day since. healthy amount."],
    },
    histFinale: {
      ahead: ["{hw}–{hl}. adding tonight to the scrapbook. yes, there's a scrapbook."],
      behind: ["{hw}–{hl} now. oh, I'm not mad. I'm DOCUMENTING."],
      streak: ["{streak} straight. I'm running out of room in the win column and I love that for me."],
      streakVs: ["{streak} of yours. enjoy them. I keep the losses in a special folder called 'soon'."],
      lastW: ["another one for my column. I'm running out of ink and patience, in that order."],
      lastL: ["fine. tonight's yours. I've already written the rematch speech."],
    },
    histTogether: {
      tog: ['{tg} games together. I keep OUR receipts separate. those are the good ones.'],
      togAhead: ['{tw}–{tl} as partners. see? when you\'re with me, the book looks beautiful.'],
      togBehind: ['{tw}–{tl} together. I blame the opponents, the cards, and the lighting. never us.'],
    },
  },
  og: {
    histSeries: {
      ahead: ['series is {hw}–{hl}, young blood. I been winning this matchup since before it was a matchup.', "{hw}–{hl}. that's not a streak, that's a tradition."],
      behind: ["you up {hl}–{hw}. alright. every old head got a chapter where the young one got loud. chapter ends tonight.", "down {hw}–{hl}? I've been down worse, to better. climb starts now."],
      even: ['{hw}–{hl} even. respect. now watch how a tie gets broken where I come from.'],
      streak: ['{streak} straight. the block is talking about it. I just listen and nod.'],
      streakVs: ['{streak} for you in a row. enjoy the run, young blood. runs end. I end them.'],
      aheadStreak: ['up {hw}–{hl}, {streak} straight. at this point the series got a name on the block.'],
      lastW: ["last time we sat, you left with a lesson. tuition's due again."],
      lastL: ['you got me last time. I respect it. I also remember it. both can be true.'],
    },
    histFinale: {
      ahead: ["{hw}–{hl}. put it in the neighborhood history. another page for me."],
      behind: ['{hw}–{hl}. write it down. then watch me write over it.'],
      streak: ["{streak} straight. they gon' tell stories about this run at the barbershop."],
      streakVs: ["{streak} of yours. the old head bows to the run — and then he takes it back. watch."],
      lastW: ['same as it ever was. the record grows, the lesson repeats.'],
      lastL: ["tonight's yours. an old head keeps the long view: the series is the story."],
    },
    histTogether: {
      tog: ['{tg} games partnered up. on this block, that\'s family business now.'],
      togAhead: ["{tw}–{tl} together. I don't partner with just anybody. the record shows why."],
      togBehind: ["{tw}–{tl} together. partnerships like ours don't fold, they adjust. tonight."],
    },
  },
  hustler: {
    histSeries: {
      ahead: ["series is {hw}–{hl}, friend. all those games you thought I was learning? I was counting.", "{hw}–{hl}. the 'new guy' act retired a while ago. the record never believed it."],
      behind: ["you're up {hl}–{hw}. good. a mark that thinks he's winning stays at the table.", "down {hw}–{hl}? every hustler spots the room a few. spot's over."],
      even: ["{hw}–{hl}, dead even. you know what even is? a story neither of us has finished telling."],
      streak: ['{streak} straight. at some point you have to ask if it was ever an act — or just me.'],
      streakVs: ["{streak} for you. keep smiling. a winning streak is just a longer way to fall."],
      aheadStreak: ["up {hw}–{hl}, last {streak} mine. I don't run the same con twice. I run it {streak} times, apparently."],
      lastW: ["last time I took it and acted surprised. I'm done acting."],
      lastL: ["you got the last one. even I can't win a hand I meant to lose — kidding. mostly."],
    },
    histFinale: {
      ahead: ["{hw}–{hl}. the book on us gets heavier, and I wrote most of it."],
      behind: ["{hw}–{hl}. write it in pencil. my column's about to get busy."],
      streak: ['{streak} straight. the act is dead; the streak is very much alive.'],
      streakVs: ["{streak} yours. a hustler's favourite number, actually. it's the one right before mine."],
      lastW: ['tonight makes it official: the student was the lesson.'],
      lastL: ["yours tonight. every good con needs one believer's win. stay believing."],
    },
    histTogether: {
      tog: ["{tg} games as partners. you're the one person I don't run the act on. much."],
      togAhead: ["{tw}–{tl} together. see what happens when I play it straight? we're a problem."],
      togBehind: ["{tw}–{tl} as partners. relax. I've turned worse books than this for money."],
    },
  },
  silent: {
    histSeries: {
      ahead: ["up {hw}–{hl}. that's all."],
    },
    histFinale: {
      streak: ['{streak} straight.'],
      lastL: ['…noted.'],
    },
  },
  deacon: {
    histSeries: {
      ahead: ['the record reads {hw}–{hl} in my favour. I keep a clean book, in every sense.', '{hw}–{hl}. let the record testify.'],
      behind: ['you lead {hl}–{hw}. many are called to the comeback, friend. tonight I answer.', "down {hw}–{hl}. the book also says the race isn't to the swift. it's to whoever's still dealing."],
      even: ['{hw}–{hl}, even as we stand. tonight, a separation.'],
      streak: ["{streak} straight. I don't call it a streak. I call it a testimony."],
      streakVs: ['{streak} for you in a row. even the strongest run meets its amen.'],
      aheadStreak: ['up {hw}–{hl}, {streak} straight. the testimony writes itself.'],
      lastW: ['last meeting closed in my favour. I said a word over it and moved on.'],
      lastL: ['you took the last meeting. forgiveness is divine. forgetting the rematch is not.'],
    },
    histFinale: {
      ahead: ['entered into the book: {hw}–{hl}. it is written.'],
      behind: ['{hw}–{hl}. the book stays open, friend. so does the invitation to fix it.'],
      streak: ['{streak} straight. testify.'],
      streakVs: ["{streak} for you. every streak gets its sermon eventually. mine's coming."],
      lastW: ["tonight's entry is filed under blessings."],
      lastL: ["tonight's entry is filed. under lessons. we learn, we return."],
    },
    histTogether: {
      tog: ['{tg} games partnered. good company is its own reward; winning together is the bonus.'],
      togAhead: ['{tw}–{tl} together. this partnership was a good appointment.'],
      togBehind: ['{tw}–{tl} as partners. storms pass. partnerships built right remain.'],
    },
  },
  conspiracy: {
    histSeries: {
      ahead: ["series: {hw}–{hl}, me. and that's the part they CAN'T fake, so they don't talk about it.", '{hw}–{hl}. I charted every meeting. the pattern holds. the pattern is me winning.'],
      behind: ["you're up {hl}–{hw}. convenient. VERY convenient. I have questions the scoreboard can't answer.", "down {hw}–{hl}? that's what they WANT the sheet to say. I keep my own sheet. it says 'to be continued'."],
      even: ["{hw}–{hl}. perfectly balanced. almost TOO balanced. somebody's thumb is on this scale, and tonight I find it."],
      streak: ["{streak} straight. coincidence is just a pattern they haven't admitted to yet."],
      streakVs: ["{streak} in a row for you. nobody wins {streak} straight without help. I'm watching the help."],
      aheadStreak: ["up {hw}–{hl}, {streak} straight. the official story is I'm just better. for once, the official story checks out."],
      lastW: ["last meeting went to me. check the tapes. oh wait — they 'lost' the tapes."],
      lastL: ['you took the last one. the footage is grainy. my memory is not.'],
    },
    histFinale: {
      ahead: ['{hw}–{hl}. log it before they edit it.'],
      behind: ["{hw}–{hl}. log it. I'll be citing it at the hearing — I mean the rematch."],
      streak: ["{streak} straight. write it on the wall where they can't paint over it."],
      streakVs: ['{streak} of yours. streaks like that get investigated. consider me the investigation.'],
      lastW: ["tonight's result is already in my files. under 'proof'."],
      lastL: ["tonight goes in the file marked 'suspicious'. it's a thick file."],
    },
    histTogether: {
      tog: ["{tg} games partnered. you're cleared. I checked. thoroughly."],
      togAhead: ['{tw}–{tl} together. even the watchers have to respect the numbers.'],
      togBehind: ["{tw}–{tl} together. we're not losing, we're being studied. let them study a win tonight."],
    },
  },
  barber: {
    histSeries: {
      ahead: ['my book says {hw}–{hl} against you. and my book never misses an appointment.', "{hw}–{hl}. you've been in my chair {hw} times too many, friend."],
      behind: ["you're up {hl}–{hw}. alright. everybody gets one good cut. then they come back to the chair.", "down {hw}–{hl} in the book. the book's got blank pages, and tonight's rates are favourable."],
      even: ['{hw}–{hl} even. tonight somebody leaves with a fresh edge. I sharpen for a living.'],
      streak: ['{streak} straight. same time, same chair, same result.'],
      streakVs: ["{streak} for you. a streak's just hair growing. everything gets cut eventually."],
      aheadStreak: ['up {hw}–{hl}, {streak} straight. I should start charging you rent for that chair.'],
      lastW: ['last visit, you left sharp — because I let you look at the result. it was mine.'],
      lastL: ['you got the last one. I remember. a barber remembers every head.'],
    },
    histFinale: {
      ahead: ['book it: {hw}–{hl}. next appointment, same result.'],
      behind: ['{hw}–{hl}. noted in the book. the book balances. it always balances.'],
      streak: ['{streak} straight. the chair stays warm for you.'],
      streakVs: ['{streak} of yours. enjoy the growth. cutting season is coming.'],
      lastW: ["tonight's cut is clean. check the mirror — that's my win."],
      lastL: ["tonight's yours. walk-ins welcome for the rematch."],
    },
    histTogether: {
      tog: ['{tg} games partnered. in my shop, that\'s a regular. regulars get taken care of.'],
      togAhead: ["{tw}–{tl} together. a partnership this smooth doesn't need a lineup."],
      togBehind: ['{tw}–{tl} together. every chair has a slow day. ours ends tonight.'],
    },
  },
  gambler: {
    histSeries: {
      ahead: ["series price: {hw}–{hl}, I'm the favourite. the market knows.", "I'm up {hw}–{hl} on you. I don't chase losses — I collect wins. ask the record."],
      behind: ["you're up {hl}–{hw}. every gambler's got a debt story. mine's about to get a plot twist.", "down {hw}–{hl}. I've been down more, to worse, and cashed out smiling. the long run is mine."],
      even: ["{hw}–{hl}. even money. my favourite kind of bet, because I know how it ends."],
      streak: ["{streak} straight. when you're hot, you don't ask why. you press."],
      streakVs: ['{streak} for you. hot streaks are loans, friend. the interest is brutal.'],
      aheadStreak: ["up {hw}–{hl} and riding {streak} straight. you don't leave a table like this. you build on it."],
      lastW: ['last time paid out my way. I remember every payout.'],
      lastL: ['you cashed the last one. I remember every payout I owe, too.'],
    },
    histFinale: {
      ahead: ['{hw}–{hl}. settled. the house of me stays open.'],
      behind: ['{hw}–{hl}. a debt on the books. I always collect — sometimes I collect in wins.'],
      streak: ['{streak} straight. press it or bless it — I press.'],
      streakVs: ['{streak} yours. the loan comes due tonight — wait, it came due. next game, then. I keep books too.'],
      lastW: ["tonight pays me. add it to the ledger of you owing the table a rematch."],
      lastL: ['tonight pays you. enjoy being the favourite for exactly one evening.'],
    },
    histTogether: {
      tog: ["{tg} games as partners. I don't bet on many people. you're on my ticket."],
      togAhead: ['{tw}–{tl} together. this partnership is the best bet I ever placed.'],
      togBehind: ['{tw}–{tl} together. every ticket looks dead before the last race. ours is tonight.'],
    },
  },
  hothead: {
    histSeries: {
      ahead: ["I'm up {hw}–{hl} on you and I'll say it louder: {hw}–{hl}! say something!", "{hw}–{hl}! that's the record! bring up ONE of yours, I dare you!"],
      behind: ["you're up {hl}–{hw}?! I think about that EVERY DAY. tonight I'm fixing it with my whole chest!", 'down {hw}–{hl}. DOWN. say it again after tonight, I want to watch you try!'],
      even: ["{hw}–{hl} TIED?! I don't do tied. tied is just a fight that hasn't started!"],
      streak: ["{streak} STRAIGHT! and I'm STILL mad — mad I didn't make it more!"],
      streakVs: ["{streak} for you in a row?! ENJOY IT. I'm about to ruin your favourite number!"],
      aheadStreak: ["UP {hw}–{hl}, {streak} STRAIGHT! WHO'S NEXT?! IT'S ALWAYS YOU AND IT'S ALWAYS THIS!"],
      lastW: ['last time I took it and you know what? I been WAITING to do it again!'],
      lastL: ["you got the last one. I haven't sat right since. TONIGHT I SIT RIGHT."],
    },
    histFinale: {
      ahead: ['{hw}–{hl} NOW! READ IT BACK TO ME! READ IT!'],
      behind: ["{hw}–{hl}. FINE. WRITE IT BIG. I'M CROSSING IT OUT NEXT GAME IN FRONT OF EVERYBODY."],
      streak: ["{streak} STRAIGHT! SOMEBODY COOL ME OFF — DON'T!"],
      streakVs: ['{streak} yours. the streak is living on borrowed time and I AM the time.'],
      lastW: ["TONIGHT'S MINE TOO! THE RECORD'S JUST CATCHING UP TO WHAT I BEEN SAYING!"],
      lastL: ["take tonight. put it with the others. then watch what I do to the pile."],
    },
    histTogether: {
      tog: ["{tg} games together! you're family now — family gets my volume AND my loyalty!"],
      togAhead: ["{tw}–{tl} together! WE'RE A PROBLEM AND I LOVE BEING THE PROBLEM!"],
      togBehind: ["{tw}–{tl} together?! that's not a record, that's a MOTIVATION POSTER. tonight we tear it down!"],
    },
  },
  comedian: {
    histSeries: {
      ahead: ["I'm up {hw}–{hl} on you. I'd do a bit about it, but the number IS the bit.", "series is {hw}–{hl}. my favourite joke. it never gets old. for you, maybe."],
      behind: ["you're up {hl}–{hw}. I checked twice — the number's funnier from your side.", "down {hw}–{hl}? please. every great comeback starts with a number worth laughing at."],
      even: ["{hw}–{hl}. a perfect tie. the suspense is killing me. it's killing you worse, but still."],
      streak: ['{streak} straight. I tried to write a joke about your chances. it kept ending early.'],
      streakVs: ["{streak} in a row for you. great streak. terrible for my material. let's fix both."],
      aheadStreak: ["up {hw}–{hl}, {streak} straight. at this point you're not my opponent, you're my opening act."],
      lastW: ['last time I won and did a whole victory lap. small room, but still.'],
      lastL: ['you won the last one. I laughed. then I stopped. then I practiced.'],
    },
    histFinale: {
      ahead: ["{hw}–{hl}. somebody write that down — oh wait, it's hilarious AND true, so it keeps."],
      behind: ["{hw}–{hl}. I'm not mad. I'm taking notes. comedians and grudges run on the same fuel."],
      streak: ['{streak} straight. the streak does the show now. I just hold the mic.'],
      streakVs: ["{streak} of yours. every streak is a setup. I'm the punchline with a calendar."],
      lastW: ["tonight goes in the act AND the record. double-booked."],
      lastL: ["tonight's yours. even my losses have timing — yours was impeccable. rematch."],
    },
    histTogether: {
      tog: ["{tg} games partnered. a duo act. you play it straight; the record's the joke."],
      togAhead: ['{tw}–{tl} together. our act works. the numbers applaud.'],
      togBehind: ['{tw}–{tl} together. every legendary duo bombed early. this is our early.'],
    },
  },
  lilcuz: {
    histSeries: {
      ahead: ["cuz, I'm up {hw}–{hl} on you! the student is winning! tell the family group chat!", 'series {hw}–{hl}, me. I used to watch you play. now you watch the scoreboard.'],
      behind: ["you're up {hl}–{hw}. okay, OG status respected — for now. I'm learning every game.", "down {hw}–{hl}. every game against you I take something home though. tonight I'm taking the win."],
      even: ["{hw}–{hl} even! me! against YOU! that's already a story — tonight I make it a better one."],
      streak: ['{streak} straight, cuz! I been telling everybody!'],
      streakVs: ["{streak} for you. I know, I know. my turn's loading."],
      aheadStreak: ['up {hw}–{hl} and {streak} straight! put me on the family trophy shelf!'],
      lastW: ['last time I got you, cuz. I still think about that hand. the good one.'],
      lastL: ['you got me last time. family rules: I get a rematch until I get it right.'],
    },
    histFinale: {
      ahead: ["{hw}–{hl} now! it's official, it's in the books, it's in the group chat later!"],
      behind: ["{hw}–{hl}. fine. screenshot it. I'm framing the comeback instead."],
      streak: ['{streak} straight! somebody tell the cookout!'],
      streakVs: ["{streak} yours. enjoy the highlight. mine's rendering."],
      lastW: ["tonight too! cuz, the torch is heavy but I got it!"],
      lastL: ["tonight's yours. I'm young — my favourite stat is 'next game'."],
    },
    histTogether: {
      tog: ['{tg} games partnered up. family business is the best business.'],
      togAhead: ['{tw}–{tl} together! we run the family table now!'],
      togBehind: ["{tw}–{tl} together. family doesn't fold. we adjust and we eat tonight."],
    },
  },
  coach: {
    histSeries: {
      ahead: ["series is {hw}–{hl}. I've got the film, I've got the numbers, and I've got your tendencies.", "{hw}–{hl}. that's not luck, that's preparation meeting the same opponent."],
      behind: ['you lead {hl}–{hw}. I studied every one of those games. adjustments are installed.', "down {hw}–{hl}. a coach's favourite problem. we fixed the film, now we fix the record."],
      even: ["{hw}–{hl} even. tonight's the adjustment game. I live for these."],
      streak: ["{streak} straight. that's called a system working."],
      streakVs: ['{streak} for you. every streak has a tell. I found yours on the film.'],
      aheadStreak: ["up {hw}–{hl}, {streak} straight. the game plan isn't changing because the game plan is you losing."],
      lastW: ['last meeting: my adjustments won it. tonight, more of the same film.'],
      lastL: ['you took the last meeting. I went back to the tape. I always go back to the tape.'],
    },
    histFinale: {
      ahead: ['final record: {hw}–{hl}. preparation wins. write that on the board.'],
      behind: ['{hw}–{hl}. the tape gets studied and the record gets answered. that\'s the job.'],
      streak: ['{streak} straight. the system holds.'],
      streakVs: ["{streak} yours. noted on the clipboard — under 'ends next game'."],
      lastW: ["tonight's win goes on the board: execute, record, repeat."],
      lastL: ["tonight's loss is film now. and film is where I do my best work."],
    },
    histTogether: {
      tog: ['{tg} games as partners. I game-plan around you now. that\'s trust.'],
      togAhead: ['{tw}–{tl} together. this partnership grades out top of the league.'],
      togBehind: ['{tw}–{tl} together. championship pairs have a chapter like this. ours turns tonight.'],
    },
  },
  smooth: {
    histSeries: {
      ahead: ["the record says {hw}–{hl}. I don't raise my voice about it. numbers speak softly too.", '{hw}–{hl}. smooth series. I plan to keep it that way.'],
      behind: ["you're ahead {hl}–{hw}. enjoy the lead. I move slow, but I do arrive.", "down {hw}–{hl}? no rush. the record and I have an understanding: it corrects itself."],
      even: ["{hw}–{hl}. even. I like even. it's quiet right before it isn't."],
      streak: ['{streak} straight. no celebration. just continuation.'],
      streakVs: ['{streak} for you. streaks end quietly too. usually mid-sentence.'],
      aheadStreak: ['up {hw}–{hl}, {streak} straight. I was going to say more. the numbers finished my sentence.'],
      lastW: ['last time went my way. most times do, eventually.'],
      lastL: ['you took the last one. I remember it the way I remember everything: calmly, and forever.'],
    },
    histFinale: {
      ahead: ['{hw}–{hl}. filed, polished, done.'],
      behind: ['{hw}–{hl}. filed. some files reopen themselves.'],
      streak: ['{streak} straight. see how quiet a streak can be?'],
      streakVs: ['{streak} yours. the quietest part of a streak is the end. listen for it.'],
      lastW: ['tonight, as recorded. smooth.'],
      lastL: ["tonight's yours. I keep the receipt in a cool, dry place."],
    },
    histTogether: {
      tog: ['{tg} games partnered. good partners are rare. so are good records.'],
      togAhead: ['{tw}–{tl} together. we make it look easy because for us, it is.'],
      togBehind: ['{tw}–{tl} together. no panic in this partnership. we adjust the temperature tonight.'],
    },
  },
  storyteller: {
    histSeries: {
      ahead: ['the saga so far: {hw}–{hl}, my favour. I tell it at gatherings. it gets better every telling.', "our story stands at {hw}–{hl}. I'm the narrator AND the protagonist. conflict of interest? maybe."],
      behind: ['you lead the tale {hl}–{hw}. every great saga has the hero down early. I know my role.', "down {hw}–{hl} in the story so far. 'so far' is doing a lot of work in that sentence, and so am I."],
      even: ['{hw}–{hl}. the midpoint of the saga, perfectly balanced. the next chapter decides the tone.'],
      streak: ["{streak} straight. I call this chapter 'the run'. the block quotes it."],
      streakVs: ["{streak} for you. a dark chapter. I don't skip it — I build on it."],
      aheadStreak: ["up {hw}–{hl}, {streak} straight. some stories you don't finish. this one finishes itself nightly."],
      lastW: ['last chapter closed with me ahead. I read it back sometimes, for pleasure.'],
      lastL: ['the last chapter was yours. I dog-eared the page. we return to it tonight.'],
    },
    histFinale: {
      ahead: ['and so the record grows: {hw}–{hl}. a fine chapter. there will be more.'],
      behind: ['{hw}–{hl}. a chapter for you. the book, however, is mine to finish.'],
      streak: ["{streak} straight. 'the run' gets another page."],
      streakVs: ["{streak} of yours. even this chapter teaches the ending: all streaks become stories I tell."],
      lastW: ["tonight's chapter: mine. the saga continues to know its author."],
      lastL: ["tonight's chapter is yours. every saga needs one. ONE."],
    },
    histTogether: {
      tog: ['{tg} games as co-authors. our chapters together are my favourites.'],
      togAhead: ['{tw}–{tl} together. a partnership the saga treats kindly.'],
      togBehind: ["{tw}–{tl} together. co-authors don't quit at a rough chapter. we write tonight's."],
    },
  },
  influencer: {
    histSeries: {
      ahead: ["series update for the chat: {hw}–{hl}, me! the record is CONTENT and I'm the headline!", "we're at {hw}–{hl} in the series, chat. yes, I keep the stats on screen. yes, they're real."],
      behind: ["you're up {hl}–{hw}. the chat is DRAGGING me. tonight's stream is the comeback episode.", "down {hw}–{hl}? every main character has a rough arc. mine ends tonight, live."],
      even: ['{hw}–{hl}, perfectly tied. chat, this is the episode where it breaks. stay.'],
      streak: ['{streak} straight! clip the record, chat — oh wait, the record IS the clip.'],
      streakVs: ["{streak} for you. the chat says 'streak'. I say 'season finale pending'."],
      aheadStreak: ["up {hw}–{hl} AND {streak} straight. the series is a whole series now. I'm the showrunner."],
      lastW: ['last episode ended with me winning. the recap writes itself.'],
      lastL: ['last episode was yours. I read the comments. ALL of them. tonight we respond.'],
    },
    histFinale: {
      ahead: ['final update: {hw}–{hl}! post it. pin it. that\'s the record!'],
      behind: ['{hw}–{hl}. posting it anyway. accountability arc. the comeback does numbers.'],
      streak: ['{streak} straight. the streak is trending and so am I.'],
      streakVs: ["{streak} of yours. every streak ends — and endings do NUMBERS. next game."],
      lastW: ["tonight's result is already in the caption: mine."],
      lastL: ["tonight's yours. I saved the loss too. the arc needs it. the arc is getting fixed."],
    },
    histTogether: {
      tog: ['{tg} games as a duo. the chat ships us and honestly? correct.'],
      togAhead: ['{tw}–{tl} together! the duo stats are ELITE. check the pinned numbers.'],
      togBehind: ["{tw}–{tl} together. the duo's redemption arc starts tonight, in front of everyone."],
    },
  },
  sorelose: {
    histSeries: {
      ahead: ["I'm up {hw}–{hl} and NOBODY wants to talk about it. I do. I will. constantly.", '{hw}–{hl}. finally, a record that tells the truth. I demand it be read aloud at every table.'],
      behind: ["you're up {hl}–{hw}. I have a list of reasons and it is LONG and it is ITEMISED.", "down {hw}–{hl}. I've reviewed the footage of my life and I object to all of it. the comeback objects louder."],
      even: ['{hw}–{hl}. even. EVEN. with everything I endure, even is practically a winning record.'],
      streak: ['{streak} straight for me. ME. I checked the sky for falling objects. worth it.'],
      streakVs: ["{streak} for you. of course. the universe has a favourite and it files paperwork."],
      aheadStreak: ["up {hw}–{hl}, {streak} straight. screenshot it before the world corrects whatever this is."],
      lastW: ["I won the last one. people said 'fluke'. people are quiet now."],
      lastL: ['you won the last one. the deck, the deal, the lighting, the chair — I have NOTES.'],
    },
    histFinale: {
      ahead: ['{hw}–{hl}. history will record that I was right about me all along.'],
      behind: ['{hw}–{hl}. I accept the number the way I accept weather: loudly, and as a personal attack. rematch.'],
      streak: ["{streak} straight. I'm not celebrating early. I'm celebrating EXACTLY on time."],
      streakVs: ["{streak} yours. the streak is just the universe buffering my comeback."],
      lastW: ['tonight: mine. tell them. tell everyone. I brought a list of who to tell.'],
      lastL: ["tonight's yours. the complaint department is ME and I am OPEN."],
    },
    histTogether: {
      tog: ["{tg} games partnered. you're the one teammate who doesn't get a complaint. yet. kidding. mostly."],
      togAhead: ['{tw}–{tl} together. WE are good. I have the numbers and for once they\'re beautiful.'],
      togBehind: ["{tw}–{tl} together. I blame the opponents exclusively. we're the heroes of this record."],
    },
  },
};
