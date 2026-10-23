/**
 * Pool-depth wave (2026-10-22 bake prep): NEW lines for the thinnest
 * high-frequency persona pools, written for the pool-depth voice batch.
 *
 * Why: the repetition build (1dd6c841) proved the talk pools are
 * structurally thin — resolved pools of 3–9 lines at 100% utilization,
 * with the most-fired pools of the story-seat personas (prePlay /
 * roast / hypePartner) running partly or entirely on shared COMMON
 * lines. The per-hand phrase cap fixed the spacing; depth needs
 * persona-true lines. Tier 1 = +3 lines for prePlay / roast /
 * hypePartner of the 13 distinct CAST personas of the seated story
 * characters (the families story tables actually speak through).
 * Tier 2 = +3 lines for every remaining resolved pool of ≤5 lines in
 * the kinds the repetition sims observed firing (prePlay, roast, cut,
 * gotCut, overcut, joker, setThem, gotSet, made, bigBid, badHand,
 * hypePartner). Census: scripts census in the bake staging notes —
 * pool sizes are poolFor(persona, kind, 'cookout') at 77c6e432.
 *
 * Authoring discipline (the fit system's rules, applied at birth):
 *  - claim-free by default: a line that asserts a checkable state
 *    (a previous hand, a set to avenge, a score state) carries its
 *    LineFact in FACT_TAGS (personas.ts) or was not written;
 *  - no line states or implies specific cards in hand;
 *  - no gendered self/target references (both gender sprites record
 *    every line); no profanity (deacon stays church-clean, and
 *    family-safe lines play at every intensity);
 *  - catchphrase topics the repetition budget caps (chat/clip/viral,
 *    "watch this", "my partner"…) are used sparingly, if at all —
 *    these lines exist to ADD variety, not new loops.
 *
 * Applied in personas.ts AFTER the pack spread, POOLS2 and PACK2 —
 * append-only, deduped: no pre-existing pool entry changes index, so
 * every recorded clip id stays put. Until the batch records, these
 * lines are exactly the 'new' set dump-lines.ts enumerates (and the
 * set apps/web/test/voices.test.ts reports as unrecorded — the
 * staging proof the manifest is complete).
 */
import type { PersonaId, TalkKind } from "./personas";

export const POOLS3: Partial<Record<PersonaId, Partial<Record<TalkKind, string[]>>>> = {
  barber: {
    hypePartner: ["fresh work, {them}. the chair approves.", "{them} just gave the table a lineup.", "booked and busy — that's {them} tonight."],
    prePlay: ["chair's warm. let's work.", "I'm booked solid, but I'll fit this in.", "just a little off the top."],
    roast: ["that play needs a consultation and a prayer.", "you're cutting corners with no clippers.", "I've seen straighter lines at a freehand contest."],
    gotCut: ["a nick. that's all that was.", "you cut me with the guard off. bold.", "that one's getting evened out. trust."],
    joker: ["the Joker walked in without an appointment.", "house call. the Joker made one.", "fresh out the case — the Joker, polished."],
    setThem: ["set, trimmed, and swept off my floor.", "y'all bid a full head and left with a fade.", "that's a closed shop, {opp}."],
  },
  coach: {
    hypePartner: ["textbook teamwork, {them}!", "{them} ran the play exactly how we drew it.", "starters' minutes for {them}. earned."],
    prePlay: ["film don't lie. watch the film.", "we prepared for this exact moment.", "discipline. then damage."],
    roast: ["that play's getting reviewed on Monday.", "I've benched better decisions than that.", "fundamentals, {opp}. look it up."],
    badHand: ["scouting report said: not much here.", "this hand missed practice.", "we'll scheme around it. barely."],
    cut: ["that's a drill we run every day!", "cut, sealed, delivered. next play.", "the playbook said that was ours."],
    gotCut: ["good play. it's getting answered in the huddle.", "we don't flinch on one cut.", "noted on the clipboard, {them}."],
  },
  comedian: {
    badHand: ["my hand just got renewed for a second season of bad.", "these cards are funnier than my material. rude.", "I got a hand that heckles ME."],
    setThem: ["set! the bid's estate is being settled.", "y'all bid a fairy tale and got the moral.", "that set's going in the act. with names changed. barely."],
  },
  conspiracy: {
    hypePartner: ["{them} is not a coincidence. {them} is a pattern.", "the files said {them} would do that. the files were right.", "operation: partner. phase one complete."],
    prePlay: ["I shuffled twice. they still followed me.", "this card has a file number. I checked.", "the deck knows what it did."],
    roast: ["that play is being archived as evidence.", "you're not losing. you're being documented losing.", "somewhere, a file just got your name on it."],
    cut: ["the corkboard predicted this exact cut.", "red string leads right to that book.", "classified cut. you'll never prove it was me."],
    gotCut: ["nobody cuts me by accident. nobody.", "that information was leaked. I know it was.", "I'm opening a file on you, {them}."],
    joker: ["the Joker was never missing. it was withheld.", "they redacted this card from your future.", "a Joker surfaces exactly when it's meant to."],
    setThem: ["the set was foretold. page one of the file.", "y'all didn't get set. y'all got exposed.", "case closed. the bid never existed."],
  },
  deacon: {
    hypePartner: ["the Lord is using {them} tonight!", "{them} came to this table anointed.", "give thanks — {them} is on assignment."],
    prePlay: ["the sermon is short tonight.", "I come in peace. mostly.", "a quiet hand can still testify."],
    roast: ["pride goeth, {opp}. the rest is in the book.", "that play needs prayer and supervision.", "even the usher saw that coming."],
    cut: ["received. the book comes home with me.", "a small mercy — for me, not for you.", "the collection plate just came by, {them}."],
    gotCut: ["I shall not be moved. much.", "the flesh is weak, {them}. mine isn't.", "bless it. that cut will be remembered in prayer."],
    joker: ["and the Joker descended. right on time.", "a revelation, face up on the table.", "the good book and the Joker agree: mine."],
  },
  gambler: {
    hypePartner: ["{them} is the best bet I ever made.", "I don't hedge on {them}. ever.", "house odds just moved — {them} happened."],
    prePlay: ["the dice don't know fear. neither do I.", "I read the table like a tote board.", "fortune's been flirting with me all night."],
    roast: ["you bet on yourself and the house still won.", "that play had long odds and short results.", "I'd insure that play, but nobody's selling."],
    bigBid: ["{bid}. put it in ink.", "I'm standing on {bid}. comfortably.", "{bid} — the pot needed company."],
  },
  hothead: {
    hypePartner: ["THAT'S MY PARTNER AND I'LL FIGHT ABOUT IT!", "{them} IS A PROBLEM AND THE PROBLEM IS THEIRS!", "GO OFF, {them}! I'M RIGHT BEHIND YOU!"],
    prePlay: ["I'M CALM. THIS IS ME CALM.", "LAST WARNING. I DON'T GIVE THOSE.", "SOMEBODY'S ABOUT TO LEARN MY NAME."],
    roast: ["THAT PLAY SHOULD BE ILLEGAL IN FOUR STATES!", "I'M NOT MAD. I'M JUST LOUDER THAN EVERYBODY!", "YOU PLAY LIKE THE TABLE OWES YOU AN APOLOGY!"],
    badHand: ["THIS HAND SHOULD BE REPORTED!", "I GOT DEALT A PARTICIPATION TROPHY!", "WHO SHUFFLED THIS, AN ENEMY?!"],
    bigBid: ["{bid}! LOUD AND WRONG-LOOKING UNTIL IT LANDS!", "{bid}! ARGUE WITH THE SCOREBOARD LATER!", "{bid}! I SAID IT WITH MY WHOLE CHEST!"],
    gotCut: ["OH WE'RE CUTTING NOW?! NOTED IN CAPS!", "THAT CUT JUST MADE THE LIST, {them}!", "I'M FINE. EVERYTHING'S FINE. IT'S NOT FINE."],
    joker: ["THE JOKER AND I HAVE AN UNDERSTANDING!", "BOOM! TOLD Y'ALL HE WAS COMING!", "THAT'S NOT LUCK. THAT'S VOLUME."],
  },
  hustler: {
    hypePartner: ["see? the newbie travels with professionals.", "{them} makes me look almost honest.", "my 'student' {them}, everybody. prodigy."],
    prePlay: ["beginner's luck, scheduled right now.", "I read about this play in a book once.", "don't blink. I learned that the hard way."],
    roast: ["you got played by the tutorial, friend.", "that mistake's got resale value. I'll take it.", "I charge tuition for lessons like that one."],
    joker: ["the Joker? oh, we're acquainted.", "a Joker. the deck DOES like me.", "house rules: my Joker, my book."],
    made: ["the student made the number. shocking, I know.", "beginner's luck, right on schedule.", "made it. the act thanks you for watching."],
    overcut: ["over the top. tuition's due, {them}.", "still the newbie? ask that book.", "I keep the change on plays like that."],
    setThem: ["set by the student. there's a word for that.", "y'all got read like the instructions.", "the newbie accepts your donation, {opp}."],
  },
  hype: {
    hypePartner: ["MY PARTNER IS THE HEADLINE!!!", "{them} JUST BROKE THE VOLUME LIMIT!!!", "PARTNER OF THE CENTURY!!! {them}!!!"],
    prePlay: ["TURN ME UP! IT'S TIME!", "I BROUGHT ENOUGH ENERGY FOR THE WHOLE TABLE!", "COUNTDOWN'S OVER! IT'S MY TURN!"],
    roast: ["THAT PLAY NEEDED A PERMIT AND IT DIDN'T HAVE ONE!", "YOU'RE NOT LOSING QUIETLY AND I RESPECT IT!!!", "SOMEBODY TURN THAT PLAY DOWN, IT'S EMBARRASSING THE TABLE!!!"],
    joker: ["JOKER!!! SHOW SOME RESPECT!!!", "THE MAIN EVENT JUST ARRIVED!!!", "THAT JOKER PAYS RENT HERE!!!"],
    setThem: ["SET!!! AND THE CROWD GOES MILD — FOR Y'ALL!!!", "THAT BID JUST FILED FOR BANKRUPTCY!!!", "DOWN GOES THE CONTRACT!!! DOWN IT GOES!!!"],
  },
  influencer: {
    hypePartner: ["the duo is duo-ing. {them} is carrying the content.", "collab of the year and it's not close. {them}!", "{them} just stole the whole timeline."],
    prePlay: ["y'all are not ready for this era.", "posting this play in 3, 2…", "new meta just dropped. it's me."],
    roast: ["that play is getting ratio'd in the comments.", "you're trending, {opp}. not how you wanted.", "the algorithm just buried that one."],
    badHand: ["this hand is giving unlisted video.", "my cards just got demonetized.", "even my editor can't save this hand."],
    cut: ["cut! and the crowd goes mild — for you.", "that cut just got its own thumbnail.", "snip. posted. you're welcome, {them}."],
    gotCut: ["muting that trick from my memory.", "we're not clipping that one. ever.", "that cut is getting a response video."],
    joker: ["Joker era ACTIVATED.", "the Joker just did numbers.", "main character card. main character energy."],
    setThem: ["set! that's tomorrow's post, titled 'what happened?'", "their contract just got cancelled mid-season.", "set. the recap writes itself tonight."],
  },
  lilcuz: {
    hypePartner: ["that's family business done right, {them}!", "{them} really like that. been knew.", "me and {them} share a brain cell and it's WORKING."],
    prePlay: ["aight, bet. watch the hands.", "this play got a fan club already.", "unc, tell them I been ready."],
    roast: ["you play like you got the game yesterday.", "that was a choice and the choice was wrong.", "bro really fumbled in 4K."],
    badHand: ["this hand is giving homework.", "my cards got no service. none.", "whoever dealt this owes me an apology and snacks."],
    cut: ["cut, no debate. check the replay.", "that's mine and it's not close.", "snatched. respectfully."],
    gotCut: ["aight, you got hands. noted.", "that cut had no business working.", "that one's going in the family thread, {them}."],
    setThem: ["set! I'm framing the scoreboard.", "y'all bid like the cards were free.", "that's a setback with a capital SET."],
  },
  mama: {
    hypePartner: ["didn't I raise a table full of winners? {them}!", "that's my baby working! go on, {them}!", "{them} eats first tonight. earned it."],
    prePlay: ["baby, watch a master at work.", "I didn't raise no fool, and it shows.", "supper's coming. so is this book."],
    roast: ["that play just earned a time-out and a talking-to.", "I correct children and card players the same way.", "that play is grounded. two weeks."],
    cut: ["and baby makes book. mine.", "that's how we do at my table, {them}.", "sweet as pie, and twice as final."],
    gotCut: ["mm-mm. we're not doing that twice, {them}.", "baby, you cut me and smiled. I saw it.", "Lord, give me patience and a bigger spade."],
  },
  og: {
    hypePartner: ["that's how you carry a partnership, {them}.", "{them} plays like they were raised right.", "respect earned, {them}. twice over."],
    prePlay: ["I was winning books before this table was built.", "age and treachery. mostly treachery.", "the old way still works. watch."],
    roast: ["in my day, that play got you uninvited.", "you're loud for somebody reading the instructions.", "I've forgotten better plays than that."],
    joker: ["the Joker respects seniority. mine.", "I keep the Joker like I keep my word. ready.", "that Joker's older than your strategy, {them}."],
  },
  petty: {
    badHand: ["I got cards, allegedly.", "this hand has been reported to management.", "thirteen cards and every one is evidence."],
    gotCut: ["etched. somewhere permanent, {them}.", "that cut just got its own folder, {them}.", "I don't get mad. I get documentation."],
    prePlay: ["I keep receipts for moments like this.", "somewhere, a grudge just matured.", "I dressed up for this exact moment."],
  },
  professor: {
    badHand: ["statistically, this hand is a rumor.", "I've graded curves more generous than this hand.", "the data on this hand is being suppressed."],
    cut: ["a cut, peer-reviewed and confirmed.", "the model thanks you for the validation, {them}.", "documented: the book was always mine."],
    prePlay: ["the numbers cleared their throat. so will I.", "an elegant solution approaches.", "hypothesis: this goes badly for someone else."],
    roast: ["your strategy has been reviewed. it failed review.", "I'd explain the error, but it's load-bearing.", "that play is why the tutorial exists."],
    setThem: ["the contract has been graded. it did not pass.", "set. the syllabus warned about this.", "your bid has been returned for corrections, {opp}."],
  },
  silent: {
    cut: ["taken.", "as expected.", "next."],
    overcut: ["higher.", "still mine.", "try again."],
    prePlay: ["…watch.", "hm.", "go on."],
    setThem: ["called it.", "down.", "as counted."],
  },
  smooth: {
    cut: ["like I planned it. because I did.", "that book slid right home.", "no noise. just results."],
    gotCut: ["a wrinkle. I'll press it out.", "enjoy the moment, {them}. it's rented.", "noted. quietly."],
    joker: ["the Joker, right on cue.", "some cards knock. the Joker owns the building.", "silk glove, iron book."],
    prePlay: ["cool hands, warm table.", "I move when it matters.", "patience. then precision."],
    roast: ["you're not slow. you're just early to every mistake.", "that play had confidence and nothing else.", "I don't rush. I don't have to — you do this."],
  },
  sorelose: {
    badHand: ["rigged. I mean dealt. same thing.", "this hand came with an apology note. it was blank.", "I get the demo version of every deck."],
    joker: ["a Joker. watch it get wasted on principle.", "finally, a card that respects me. temporarily.", "the Joker showed up. the fix is sweating now."],
    prePlay: ["don't worry, the deck hates me back.", "I'll play it, but I'm logging a complaint.", "somehow this is already my fault. watch."],
  },
  storyteller: {
    hypePartner: ["{them} just became the story I tell at reunions.", "and THAT is how the legend part starts, {them}.", "my partner, everybody. the plot's favorite."],
    prePlay: ["grandma used to play this exact moment.", "there's a story about a card like this one…", "the porch light's on. that means play bold."],
    roast: ["that play's gonna be a cautionary tale by Sunday.", "we'll tell your grandkids about that mistake.", "even the ninety-eight reunion team is shaking their heads."],
    badHand: ["this hand's got a sad little backstory.", "dealt like the deck owed somebody else.", "I've seen better hands at a yard sale."],
  },
};
