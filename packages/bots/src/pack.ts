/**
 * Demetrius's "Hood Spades" trash-talk pack (docs/trash-talk-pack.md), as data. personas.ts spreads every line onto 2-3
 * personas of the section's style group (deterministic), so each line is voiced by the personas that say it.
 *
 * Line markup (stripped before use, kept in LINE_META):
 *   leading '!'  → needs Cookout or No Mercy        leading '!!' → No Mercy only
 *   ' @ace'      → only when an Ace was just cut     ' @neg' → only when the target side is below 0
 *   ' @big' / ' @little' → only for that Joker      ' @jk'  → only in Joker decks
 *   '[a,b] '     → say-it-only personas (overrides the section group)
 * Templates: {bid} real bid number, {their} his/her/their by the target's name, {them} the target's name.
 */
import type { TalkKind } from './personas';

/** persona style groups from the pack ("loud uncle", "petty auntie", "quiet assassin", "overconfident rookie", "competitive") */
export const STYLE = {
  loud: ['og', 'hype', 'hothead', 'storyteller', 'coach', 'gambler', 'barber'],
  petty: ['mama', 'petty', 'storyteller', 'deacon', 'sorelose', 'comedian'],
  quiet: ['silent', 'smooth', 'professor'],
  rookie: ['hustler', 'lilcuz', 'influencer', 'gambler'],
  all: ['og', 'hype', 'hothead', 'storyteller', 'coach', 'gambler', 'barber', 'mama', 'petty', 'deacon', 'sorelose', 'comedian', 'smooth', 'professor', 'hustler', 'lilcuz', 'influencer', 'conspiracy', 'silent'],
} as const;
export type StyleGroup = keyof typeof STYLE;

export interface PackSection { kind: TalkKind; group: StyleGroup | StyleGroup[]; lines: string[] }

export const PACK: PackSection[] = [
  { kind: 'slam', group: ['loud', 'rookie', 'all'], lines: [
    'BAM! Talk to me nice!', 'Put some RESPECT on that!', 'I run this table!', "WHO GON' STOP ME?!", "That's grown-folk business!",
    '!Get that weak stuff outta here!', 'You thought you had something!', '!SIT DOWN SOMEWHERE!', 'I wish you WOULD!', 'Not in MY house!',
    "!Somebody call the police, 'cause I'm robbing everybody!", '!!You brought a knife to a gunfight!', 'GET OFF MY TABLE!',
    "That's a grown-man card right there!", "You ain't ready for this!", "!I don't play cards. I collect victims.", 'That trick got my name on it!',
    'Thank you for your donation!', "That's what happens when you play with professionals!", 'BOOM! NEXT!',
    // classic table energy
    'Walk that dog!', 'Get up off me!', "That's mine!", "That's a book!",
  ] },
  { kind: 'cut', group: ['loud', 'petty', 'all'], lines: [
    'CUT! Now what?!', 'You thought that Ace was safe? @ace', 'Not today, sweetheart!', "You should've saved that!",
    "I'm cutting everything but the lights off!", '[barber,og] Welcome to the barbershop!', '[barber,comedian] You just got a fresh fade!',
    "I ain't got none of that suit, but I got THIS!", '[barber,petty,hype] Snip, snip!', "[barber,storyteller] That's a haircut with no appointment!",
    'You was feeling yourself, huh?', 'I know that hurt!', 'Spades is always open for business!',
    'Look at your Ace going straight to the graveyard! @ace', "This ain't your trick no more!", 'I just repossessed that book!',
    'That Ace had a short life! @ace', 'You got insurance on that card?', "Should've played that yesterday!", "!You ain't safe in these streets!",
    // classic
    '!Cut {their} head off!', "We ain't friends right now!",
  ] },
  { kind: 'partnerBlunder', group: ['loud', 'petty', 'all'], lines: [
    'WHO TAUGHT YOU HOW TO PLAY?!', 'You playing Spades or Uno?!', 'WE ON THE SAME TEAM!', 'Why would you play THAT?!',
    '!I need a new partner immediately!', 'You must be working for them!', 'Are you undercover?!', '!You throwing the game on purpose?',
    '!!You got the IQ of a parking ticket!', 'You supposed to be helping ME!', "!!I should've partnered with the dog!",
    "!You ain't been right since the first hand!", "I'm playing three against one!", "I can't take you nowhere!",
    'You got me out here fighting for my life!', '!We need couples counseling after this!', "!Don't ever sit across from me again!",
    "You must've learned Spades on YouTube yesterday!", "!!Somebody check my partner's temperature!", "!!I knew I should've played with your mama!",
    "!!You ain't my partner. You my biggest obstacle!", '!I need a trade before the next hand!', '!How you got thirteen cards and not one good decision?',
    'You playing with your eyes closed?', "!I don't know what's worse, your hand or your judgment!",
    // classic
    'Come on, partner!', "Don't cut your partner!", 'Read the table!', "Don't save 'em!",
  ] },
  { kind: 'setThem', group: ['loud', 'petty', 'all'], lines: [
    "BOARD 'EM UP!", "Put 'em on the BOARD!", 'NEGATIVE! NEGATIVE! @neg', "That's a whole lotta NOTHING!", "Y'all bid WHAT?!",
    'Somebody call a tow truck!', "Y'all going backwards!", 'That bid was a fairy tale!', "You wrote a check your cards couldn't cash!",
    "That's what happens when you get greedy!", 'Welcome to the negative neighborhood! @neg', '!You owe the table an apology!',
    '!Look at that score! EMBARRASSING!', "You should've bid what you HAD!", 'That confidence disappeared real quick!',
    'You need a GPS to find your way back to zero! @neg', "Y'all in debt with no payment plan! @neg", "Don't look at me. Look at that scoreboard!",
    'You need a financial advisor for that bid!', "Y'all collecting negative points like reward miles! @neg",
    // context memory + classic
    'You bid {bid} for THAT?!', 'Where your books at?',
  ] },
  { kind: 'bidTooHigh', group: ['loud', 'petty', 'all'], lines: [
    'You bid {bid} with WHAT?!', "You must be seeing cards I can't see!", "That's a wish, not a bid!", 'You bidding on hopes and dreams!',
    'Somebody check {their} glasses!', 'You got a whole lotta faith and no cards!', 'You sure you playing with the same deck?',
    "That's a mortgage-sized bid!", '!!You better have Jesus in that hand!', "!That's a bold statement for somebody holding garbage!",
    'You got the Joker, both deuces, and a prayer? @jk', "Don't let your mouth write checks your hand can't cash!",
    "You ain't bidding. You manifesting!", "This ain't the lottery!", 'I hope you got receipts for that bid!', 'Count your books!',
  ] },
  { kind: 'bags', group: ['petty', 'loud', 'all'], lines: [
    "You collecting bags like it's Black Friday!", 'You running a luggage department?', 'You need help carrying all them bags?',
    "That ain't Spades, that's baggage claim!", 'You scared to bid your own cards?', 'You got more bags than the airport!',
    'Keep collecting! We love that for you!', "Somebody get 'em a shopping cart!", 'You playing conservative or just scared?',
    "You ain't slick. We see them extra books!", "!Bag lady, you gon' hurt your back!", "Y'all about to get a baggage fee!",
    'Every trick you take is another suitcase!', 'Your bid got commitment issues!', 'Congratulations! You just won a trip to bag penalty!',
  ] },
  { kind: 'nilBid', group: ['loud', 'rookie', 'all'], lines: [
    'NIL?! Oh, you brave brave!', "Everybody get one! We breaking that!", 'Somebody escort this NIL to the exit!', 'Oh, you thought you was safe?',
    'We hunting NILs today!', 'Put that NIL on a milk carton!', 'You better hide them high cards!', 'Your partner better love you!',
    'You just put a target on your forehead!', "We ain't letting that slide!", "One book. That's all I need!", 'You about to regret that decision!',
    'That NIL got a short expiration date!', "I'm finna make you take something!", "Don't run from that Queen. PLAY IT!",
  ] },
  { kind: 'nilBust', group: ['loud', 'petty', 'all'], lines: [
    'NIL BUSTED!', 'GOTCHA!', 'You thought you was invisible?!', 'There goes your hundred!', "That's a hundred-point mistake!",
    'WELCOME TO THE BOOK CLUB!', "You wasn't supposed to take that, huh?", 'Your NIL has officially been canceled!', 'Look who decided to participate!',
    'You said NIL. The cards said NOPE!', '!I know your partner sick right now!', 'You took that book like you wanted it!',
    '!!Somebody play the funeral music!', 'We got one! We got one!', 'You just volunteered for disaster!',
  ] },
  { kind: 'blindNil', group: ['loud', 'petty', 'all'], lines: [
    "BLIND NIL?! Somebody's desperate!", '!!You gambling with your whole bloodline!', "!That's a cry for help!", "You ain't even LOOK at your cards!",
    '!You either a genius or a fool!', '!!Somebody call the gambling hotline!', 'You putting your partner through unnecessary stress!',
    "That's confidence with no evidence!", '!!You playing Spades or Russian roulette?', 'Your whole future riding on thirteen mystery cards!',
  ] },
  { kind: 'joker', group: ['loud', 'rookie', 'all'], lines: [
    'BIG JOKER! MOVE! @big', 'THE BIG DOG IS HERE! @big', "Ain't nobody bigger than me! @big", 'Respect the crown! @big', 'Bow down! @big',
    "That's the landlord right there! @big", "You playing with tenants. I'm the owner! @big", 'I got the keys to the city! @big',
    'THE BOSS JUST CLOCKED IN! @big', "You should've known who was coming! @big", 'Little Joker still got hands! @little', 'Here come the problem!',
    '!Who ordered this beatdown?', "I ain't even used my good cards yet!", 'That was just the appetizer!',
  ] },
  { kind: 'boston', group: ['loud', 'rookie', 'all'], lines: [
    'BOSTON! BOSTON!', "Y'all ain't get ONE?!", 'THIRTEEN TO ZERO!', "You ain't even touch the ball!", "That's a complete shutdown!",
    'We need a moment of silence!', "Y'all got swept clean!", "This wasn't a game. It was a demonstration!", "!You should've stayed home!",
    'Somebody turn the lights off!', "We just put y'all in the history books!", "Y'all ain't even get a participation trophy!",
    "That's a Boston with extra seasoning!", 'Somebody get a broom!', "!We didn't beat y'all. We erased y'all!",
  ] },
  { kind: 'slow', group: ['loud', 'petty', 'all'], lines: [
    "It's a card game, not a SAT exam!", 'You waiting for the cards to change?', 'PLAY SOMETHING!', 'We got all night, apparently!',
    'You doing your taxes over there?', "That card ain't gonna play itself!", '!!You calling your ancestors for advice?', '!!You waiting on a sign from God?',
    "It's thirteen cards, not a college dissertation!", "You studying that hand like it's the bar exam!", 'You waiting for a software update?',
    'You got a meeting with them cards?', "It's Spades, not chess!", "!!Somebody check if they're still breathing!", 'You thinking harder than you playing!',
  ] },
  { kind: 'loudLoser', group: ['petty', 'loud', 'all'], lines: [
    'All that talking and you still losing!', 'Let the cards speak!', 'Your mouth got more books than your hand!', "You ain't won nothing but an argument!",
    '!You loud for somebody in last place!', 'The scoreboard says otherwise!', 'You doing a podcast or playing Spades?',
    'Your trash talk got more points than your team!', 'You talk like you holding both Jokers! @jk', 'Your mouth bidding six. Your hand bidding two!',
    '!You need to put your mouth on mute!', '!You running for president of the losing team?', 'Save that speech for the ride home!',
    "Your cards ain't backing up your attitude!", 'You got all them opinions and no books!', 'No table talk!',
  ] },
  { kind: 'badHand', group: ['loud', 'petty', 'rookie', 'all'], lines: [
    'Who shuffled this mess?!', 'I got a handful of grocery receipts!', "These cards ain't worth the paper they're printed on!",
    'I got thirteen reasons to be upset!', 'Somebody dealt me a parking ticket!', 'I got nothing but hopes and prayers!',
    'This hand came straight out the clearance aisle!', "I can't even win an argument with these cards!", 'Who gave me the leftovers?!',
    'I need a refund on this hand!', 'I got a hand full of disappointment!', "These cards look like somebody already played 'em!",
    "I couldn't win a book at the library!", 'I got a two, a three, and a dream!', "I wouldn't bid a bus ticket on this hand!",
  ] },
  { kind: 'win', group: ['loud', 'petty', 'rookie', 'all'], lines: [
    'GOOD GAME! Well, for us anyway!', "Y'all can leave now!", 'The table belongs to me!', '!!That was a public execution!', 'Who got NEXT?!',
    'We taking applications for new opponents!', "Y'all need practice mode!", 'Come back when you learn the rules!',
    "That's another one for the trophy case!", 'The kings and queens have spoken!', "You ain't lose. You got educated!",
    "Don't be mad. Be better!", "Y'all can run it back. The result ain't changing!", 'We came, we saw, we collected!',
    'Somebody get the camera. This was historic!',
  ] },
  { kind: 'hypePartner', group: ['loud', 'all'], lines: ['Talk that talk!', 'I got you, partner!', 'Run that!'] },
  { kind: 'prePlay', group: ['loud', 'petty', 'all'], lines: ['We playing house rules!', "Spades ain't broke!"] },
  { kind: 'roast', group: ['petty', 'quiet', 'all'], lines: [
    '!Your Spades license has been revoked.', "!I ain't playing against you. I'm babysitting.", 'You got cooked, seasoned, and served.',
    '!You need a tutorial before you need a rematch.', 'Even the computer would\'ve played that better.', "You just made that card everybody else's problem.",
    '!!Your partner should be eligible for unemployment.', "!I'm about to put your whole team on a payment plan.",
    'Your confidence is impressive considering the evidence.', 'The only thing you winning is the argument about why you lost.',
    "!I ain't saying you're bad, but the deck requested a different player.", 'You making mistakes in high definition.',
    '!This game needs a mercy rule just for you.', 'You playing like your Wi-Fi disconnected.', "I'm not trash-talking. I'm providing live commentary.",
    "!That wasn't strategy. That was a cry for assistance.", "!The cards ain't rigged. Your decision-making is.", "!You're a walking bag penalty.",
    "!We don't need a rematch. We need a skills assessment.", 'You got the heart of a champion and the cards of a spectator.',
  ] },
];
