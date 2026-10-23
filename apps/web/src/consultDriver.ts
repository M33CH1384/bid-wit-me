/**
 * Partner consultation driver (CONSULT_SPEC.md): the Table-side engine
 * that schedules and delivers the partner's pre-bid consultation, the
 * settle line, opponent conferral, the one-time partner introduction,
 * and Dee's post-hand acknowledgment — and holds bot bids for exactly
 * the beats the spec allows (§5.4 / §6.2), never the human's clock.
 *
 * Everything spoken is built by @spades/bots consultTalk from the same
 * partnerBidIntent() number the bid coach shows and the placed bid is
 * drawn from — this driver never invents or adjusts a number. Delivery
 * is chat + the consultation voice path (talkPrefs.speakConsult: cast
 * fence absolute in story scope, persona sprites at regular tables,
 * text-only on a missing take — never a substitute voice).
 *
 * Offline tables only: Table constructs the driver only when there is
 * no online source (§6.4 — online play is excluded in v1), and the
 * driver is inert without a partner seat (cutthroat, §5.5).
 */
import { type GameState, viewFor } from '@spades/rules';
import {
  type BotLevel, type ConsultLine, type PersonaId,
  ackApplies, buildAck, buildConferLine, buildConsultation, buildCoverLine, buildIntroduction,
  buildSettle, decomposeClaim, newConsultTalkState, partnerBidIntent, personaForName,
  type ConsultTalkState,
} from '@spades/bots';
import { offlineTalk } from './offlineTalk';
import { consultClipDurationMs, speakConsult } from './talkPrefs';
import type { SeatPos } from './spatial';

/* ------------------------------------------------------------------ */
/* First-meet store (§5.1): device-local, one entry per partner name.  */
/* ------------------------------------------------------------------ */

const MET_KEY = 'bwm.metPartners.v1';
export interface MetPartner { metAt: number; matches: number }

export function loadMetPartners(): Record<string, MetPartner> {
  try {
    const j = JSON.parse(localStorage.getItem(MET_KEY) ?? 'null') as unknown;
    return j && typeof j === 'object' ? (j as Record<string, MetPartner>) : {};
  } catch { return {}; }
}
function saveMetPartners(m: Record<string, MetPartner>): void {
  try { localStorage.setItem(MET_KEY, JSON.stringify(m)); } catch { /* storage off — introductions just re-fire */ }
}
export function hasMetPartner(name: string): boolean { return !!loadMetPartners()[name]; }
/** Written the moment the introduction fires (§5.1). */
export function markPartnerMet(name: string): void {
  const m = loadMetPartners();
  if (!m[name]) { m[name] = { metAt: Date.now(), matches: 1 }; saveMetPartners(m); }
}
export function bumpPartnerMatch(name: string): void {
  const m = loadMetPartners();
  if (m[name]) { m[name] = { ...m[name], matches: m[name].matches + 1 }; saveMetPartners(m); }
}

/* ------------------------------------------------------------------ */
/* Session: the per-match decision state (exported for the pins).      */
/* ------------------------------------------------------------------ */

export class ConsultSession {
  talk: ConsultTalkState = newConsultTalkState();
  /** physical-deal keys (`seed:handNo:misdeals`) whose consultation fired or was mooted */
  firedConsults = new Set<string>();
  /** hand keys whose settle decision was taken (one chance per hand) */
  settleDecided = new Set<string>();
  /** the current hand's consultation clip end (performance.now clock; 0 = no voiced consult) */
  consultClipEndAt = 0;
  consultHandKey = '';
  /** partner claim + true read recorded at consultation time, per handNo */
  claimsByHand = new Map<number, { claim: number | 'nil'; read: number }>();
  /** confer bookkeeping per hand key */
  conferByHand = new Map<string, { count: number; seats: Set<number>; lastAtBidsPlaced: number }>();
  /** idempotent bid-delay decisions per `${handKey}:${seat}` */
  conferDecisions = new Map<string, number>();
  /** Dee's acknowledgment: at most one per match (§4) */
  ackUsed = false;
  introDone = false;
}

export interface ConsultDeps {
  story: boolean;
  names: string[];
  /** the human's partner seat, or −1 (cutthroat / no partner) */
  partnerSeat: number;
  humanSeat: number;
  levelFor: (seat: number) => BotLevel;
  /** live speed multiplier (SPEEDS[speed]) */
  k: () => number;
  push: (name: string, text: string) => void;
  seatPos: (seat: number) => SeatPos | undefined;
  /** story: the King leg-2 window for Dee's board family */
  kingLeg2: () => boolean;
  /** the human tapped a partner-talk hint this hand (suppresses the trim settle variant, §6.2) */
  humanHinted: (handNo: number) => boolean;
  /** the human announced Nil via a partner-talk preset this hand (§3.2.4 cover) */
  humanNilAnnounced: (handNo: number) => boolean;
}

const handKeyOf = (st: GameState): string => `${st.seed}:${st.handNo}:${st.misdeals ?? 0}`;

export class ConsultDriver {
  readonly session = new ConsultSession();
  private timers = new Set<number>();
  private latest: GameState | null = null;
  private prev: GameState | null = null;
  private lastCtx = { dealing: false, misdealShowing: false };
  private scheduledKey = '';
  private deferrals = 0;
  private matchBumped = false;
  private hook: ((seat: number, st: GameState) => number) | null = null;

  constructor(private deps: ConsultDeps) {}

  attach(): void {
    this.hook = (seat, st) => this.bidDelay(seat, st);
    offlineTalk.bidDelayHook = this.hook;
  }
  dispose(): void {
    if (offlineTalk.bidDelayHook === this.hook) offlineTalk.bidDelayHook = null;
    for (const t of this.timers) window.clearTimeout(t);
    this.timers.clear();
  }
  private after(ms: number, fn: () => void): void {
    const id = window.setTimeout(() => { this.timers.delete(id); fn(); }, Math.max(0, ms));
    this.timers.add(id);
  }
  private get active(): boolean { return this.deps.partnerSeat >= 0; }
  private partnerName(): string { return this.deps.names[this.deps.partnerSeat] ?? ''; }
  private partnerPersona(): PersonaId {
    return this.deps.story ? 'lilcuz' : personaForName(this.partnerName());
  }

  /** Called by Table on every state change (and on dealing-flag flips). */
  onState(st: GameState, ctx: { dealing: boolean; misdealShowing: boolean }): void {
    this.prev = this.latest;
    this.latest = st;
    this.lastCtx = ctx;
    if (!this.active) return;
    if (!this.matchBumped) {
      this.matchBumped = true;
      if (hasMetPartner(this.partnerName())) bumpPartnerMatch(this.partnerName());
    }
    this.watchSettle(st);
    this.watchAck(st);
    // Consultation scheduling (§6.1): once per physical deal, at
    // deal-complete + 600 ms (a mid-hand resume fires ~1 s after the
    // table settles instead — §6.3).
    const key = handKeyOf(st);
    if (st.phase === 'bidding' && !ctx.dealing && !ctx.misdealShowing
      && st.bids[this.deps.partnerSeat] == null
      && !this.session.firedConsults.has(key) && this.scheduledKey !== key) {
      this.scheduledKey = key;
      this.deferrals = 0;
      const resumedMidHand = st.bids.some((b) => b !== null);
      this.after(resumedMidHand ? 1000 : 600, () => this.fireConsult(key));
    }
  }

  private fireConsult(key: string): void {
    const st = this.latest;
    if (!st || handKeyOf(st) !== key) return;
    if (this.session.firedConsults.has(key)) return;
    if (st.phase !== 'bidding') { this.session.firedConsults.add(key); return; }
    if (this.lastCtx.misdealShowing) { this.session.firedConsults.add(key); return; } // §5.5 — the redeal re-consults under its own key
    const pSeat = this.deps.partnerSeat;
    if (st.bids[pSeat] != null) { this.session.firedConsults.add(key); return; } // §5.5 — already bid; the settle still covers the total
    // Story (§6.3): scripted beats outrank consultation — wait for the
    // first gap ≥ 800 ms after the pending scripted delivery; if two
    // bids have landed by then, the line drops to text-only.
    let textOnly = false;
    if (this.deps.story) {
      const busyUntil = offlineTalk.voiceBusyUntil;
      if (busyUntil > performance.now() + 40 && this.deferrals < 4) {
        this.deferrals++;
        this.after(busyUntil + 800 - performance.now(), () => this.fireConsult(key));
        return;
      }
      textOnly = st.bids.filter((b) => b !== null).length >= 2;
    }
    this.session.firedConsults.add(key);
    const view = viewFor(st, pSeat);
    const level = this.deps.levelFor(pSeat);
    const board = {
      scores: st.scores, bags: st.bags,
      mySide: pSeat % Math.max(1, st.scores.length),
      kingLeg2: this.deps.story && this.deps.kingLeg2(),
    };
    const line = buildConsultation({
      view, level, persona: this.partnerPersona(), dee: this.deps.story,
      state: this.session.talk, rnd: Math.random, board,
      humanBid: ((): number | 'nil' | 'blindNil' | null => {
        const b = st.bids[this.deps.humanSeat];
        return typeof b === 'number' || b === 'nil' || b === 'blindNil' ? b : null;
      })(),
      humanNilAnnounced: this.deps.humanNilAnnounced(st.handNo),
    });
    // Record the anchored claim + true read for the settle trim check
    // and Dee's acknowledgment — from the same view, at the same moment.
    const claim = partnerBidIntent(view, level);
    if (claim !== null) {
      this.session.claimsByHand.set(st.handNo, {
        claim,
        read: view.hand ? decomposeClaim(view.hand, view).read : 0,
      });
    }
    // The one-time introduction (§5.1) rides the same slot, immediately
    // before the consultation line — regular tables only, never Dee,
    // never story (her presence there is a separate feature).
    if (!this.deps.story && !this.session.introDone && !hasMetPartner(this.partnerName())) {
      this.session.introDone = true;
      markPartnerMet(this.partnerName());
      const intro = buildIntroduction(this.partnerPersona(), this.partnerName(), this.session.talk, Math.random);
      if (intro) {
        this.deliver(this.partnerName(), intro, this.partnerPersona(), pSeat, key, textOnly);
        // Hold the partner's bid slot through the intro + the consult
        // line that follows it, so the two beats land in order.
        this.session.consultClipEndAt = Math.max(this.session.consultClipEndAt, performance.now() + 2600);
        this.after(1500, () => { if (line) this.deliverLine(line, key, textOnly); });
        return;
      }
    }
    if (line) this.deliverLine(line, key, textOnly);
  }

  /** Deliver a consultation-family line: chat (verbatim + the §3.3
   * rider on number-free lines), voice where a take exists, and the
   * talk layer's right-of-way stamp (noteConsult). */
  private deliverLine(line: ConsultLine, key: string, textOnly: boolean): void {
    const name = this.partnerName();
    const text = line.rider && typeof line.claim === 'number' ? `${line.text}  · thinks ${line.claim}` : line.text;
    this.deliver(name, text, this.partnerPersona(), this.deps.partnerSeat, key, textOnly, line);
  }

  private deliver(name: string, text: string, persona: PersonaId, seat: number, key: string, textOnly: boolean, line?: ConsultLine): void {
    this.deps.push(name, text);
    const raw = line?.raw ?? text;
    const clipKey = line?.clipSuffix;
    if (textOnly) {
      offlineTalk.noteConsult(1200);
      this.session.consultHandKey = key;
      return;
    }
    speakConsult(name, raw, clipKey, persona, this.deps.seatPos(seat), this.latest?.rules.playerCount ?? 4);
    void consultClipDurationMs(name, raw, clipKey, persona).then((d) => {
      offlineTalk.noteConsult(d ?? 1200);
      if (d !== null) {
        this.session.consultClipEndAt = Math.max(this.session.consultClipEndAt, performance.now() + d);
        this.session.consultHandKey = key;
      }
    }).catch(() => { offlineTalk.noteConsult(1200); });
  }

  /* ---------------- settle (§5.3) ---------------- */

  private watchSettle(st: GameState): void {
    const prev = this.prev;
    if (!prev || prev.handNo !== st.handNo || (prev.misdeals ?? 0) !== (st.misdeals ?? 0)) return;
    const h = this.deps.humanSeat, p = this.deps.partnerSeat;
    const wasBoth = prev.bids[h] != null && prev.bids[p] != null;
    const isBoth = st.bids[h] != null && st.bids[p] != null;
    if (isBoth && !wasBoth) this.maybeSettle(st);
  }

  private maybeSettle(st: GameState): void {
    const key = handKeyOf(st);
    if (this.session.settleDecided.has(key)) return;
    this.session.settleDecided.add(key);
    if (Math.random() >= 0.75) return;
    const hBid = st.bids[this.deps.humanSeat];
    const pBid = st.bids[this.deps.partnerSeat];
    if (hBid == null || pBid == null) return;
    const persona = this.partnerPersona();
    const name = this.partnerName();
    // Nil-instead: no total exists. When the HUMAN went dark, the
    // partner's beat is the cover promise; when the PARTNER went dark,
    // their consultation already carried it — no second line.
    if (hBid === 'nil' || hBid === 'blindNil') {
      if (typeof pBid !== 'number') return;
      const cover = buildCoverLine(persona, this.deps.story, this.session.talk, Math.random);
      if (cover) this.settleDeliver(st, name, cover, persona, key);
      return;
    }
    if (typeof hBid !== 'number' || typeof pBid !== 'number') return;
    const claimRec = this.session.claimsByHand.get(st.handNo);
    const trimmed = !!claimRec && typeof claimRec.claim === 'number' && pBid < claimRec.claim
      && !this.deps.humanHinted(st.handNo);
    const line = buildSettle({
      persona, dee: this.deps.story, state: this.session.talk, rnd: Math.random,
      total: hBid + pBid, trimmed,
    });
    if (line) this.settleDeliver(st, name, line.text, persona, key, line);
  }

  private settleDeliver(st: GameState, name: string, text: string, persona: PersonaId, key: string, line?: ConsultLine): void {
    const now = performance.now();
    // Scripted beat / big moment within ±1.5 s: the settle is suppressed
    // (offlineTalk.voiceBusyUntil is the room's high-priority marker;
    // the consultation's own stamp is the consultClipEndAt window and
    // downgrades to text-only below instead of reading as a script).
    const busyUntil = offlineTalk.voiceBusyUntil;
    if (busyUntil > now + 40 && busyUntil > this.session.consultClipEndAt + 50) return;
    if (busyUntil <= now + 40 && busyUntil > now - 1500 && busyUntil > this.session.consultClipEndAt + 50) return;
    const consultRecent = this.session.consultHandKey === key
      && this.session.consultClipEndAt > 0 && now - this.session.consultClipEndAt < 3500;
    const textOnly = consultRecent || (persona === 'silent' && !this.deps.story);
    this.deps.push(name, text);
    if (textOnly) return;
    const raw = line?.raw ?? text;
    const clipKey = line?.clipSuffix;
    speakConsult(name, raw, clipKey, persona, this.deps.seatPos(this.deps.partnerSeat), st.rules.playerCount);
    void consultClipDurationMs(name, raw, clipKey, persona)
      .then((d) => { if (d) offlineTalk.noteHighPriority(performance.now(), d); })
      .catch(() => { /* text already delivered */ });
  }

  /* ---------------- Dee's acknowledgment (§4) ---------------- */

  private watchAck(st: GameState): void {
    const prev = this.prev;
    if (!prev || st.history.length <= prev.history.length) return;
    if (!this.deps.story || this.session.ackUsed) return;
    const record = st.history[st.history.length - 1]!;
    const rec = this.session.claimsByHand.get(record.handNo);
    if (!rec || typeof rec.claim !== 'number') return;
    const side = record.sides[this.deps.partnerSeat % Math.max(1, st.scores.length)];
    if (!side) return;
    if (Math.random() >= 0.3) return;
    const kind = ackApplies(rec.claim, rec.read, {
      teamSet: side.contractMade === false,
      teamMadeBy: side.contractMade ? side.contractTricks - side.contract : null,
      skill: this.deps.levelFor(this.deps.partnerSeat),
    });
    if (!kind) return;
    const line = buildAck(kind, this.session.talk, Math.random);
    if (!line) return;
    this.session.ackUsed = true;
    this.after(1600, () => {
      const name = this.partnerName();
      this.deps.push(name, line);
      speakConsult(name, line, undefined, 'lilcuz', this.deps.seatPos(this.deps.partnerSeat), st.rules.playerCount);
      void consultClipDurationMs(name, line, undefined, 'lilcuz')
        .then((d) => { if (d) offlineTalk.noteHighPriority(performance.now(), d); })
        .catch(() => { /* text already delivered */ });
    });
  }

  /* ---------------- bid delays: partner clip + confer (§5.4/§6.2) ---------------- */

  bidDelay(seat: number, st: GameState): number {
    if (!this.active || st.phase !== 'bidding' || !st.rules.partnerships) return 0;
    const key = handKeyOf(st);
    const now = performance.now();
    if (seat === this.deps.partnerSeat) {
      // §6.2: the partner doesn't bid over their own consultation clip.
      if (this.session.consultHandKey === key && this.session.consultClipEndAt > now) {
        const base = 650 * this.deps.k();
        return Math.max(0, Math.min(this.session.consultClipEndAt - (now + base), 3000 - base));
      }
      // The beat is scheduled but hasn't landed yet (the partner bids
      // first in this rotation): hold a provisional beat so the line
      // isn't talked over by its own bid landing.
      if (this.scheduledKey === key && !this.session.firedConsults.has(key) && st.bids[seat] == null) return 900;
      return 0;
    }
    if (seat === this.deps.humanSeat) return 0;
    return this.conferDelay(seat, st, key);
  }

  private conferDelay(seat: number, st: GameState, key: string): number {
    const dkey = `${key}:${seat}`;
    const decided = this.session.conferDecisions.get(dkey);
    if (decided !== undefined) return decided;
    const decide = (ms: number): number => { this.session.conferDecisions.set(dkey, ms); return ms; };
    // Skips (§5.4): fast speeds, the human mid-decision, the hand's first
    // bid (never stack a beat ahead of the partner consultation), and
    // the bid right before the human's own (don't perform on their wait).
    if (this.deps.k() < 1) return decide(0);
    if (offlineTalk.humanDeciding) return decide(0);
    const n = st.rules.playerCount;
    const bidsPlaced = st.bids.filter((b) => b !== null).length;
    if (bidsPlaced === 0) return decide(0);
    if ((seat + 1) % n === this.deps.humanSeat && st.bids[this.deps.humanSeat] == null) return decide(0);
    const per = (this.session.conferByHand.get(key) ?? { count: 0, seats: new Set<number>(), lastAtBidsPlaced: -10 });
    if (per.count >= 2 || per.seats.has(seat)) return decide(0);
    if (per.lastAtBidsPlaced === bidsPlaced - 1) return decide(0); // never consecutive
    if (Math.random() >= 0.55) return decide(0);
    const pSeat = (seat + 2) % n;
    const pView = viewFor(st, pSeat);
    if (!pView.hand) return decide(0); // unrevealed: no honest claim exists
    const pName = this.deps.names[pSeat] ?? '';
    const pPersona = personaForName(pName);
    const claim = buildConsultation({
      view: pView, level: this.deps.levelFor(pSeat), persona: pPersona,
      state: this.session.talk, rnd: Math.random,
      board: { scores: st.scores, bags: st.bags, mySide: pSeat % Math.max(1, st.scores.length) },
      gridOnly: true,
    });
    if (!claim) return decide(0);
    // It fires: record the caps before delivering.
    per.count++; per.seats.add(seat); per.lastAtBidsPlaced = bidsPlaced;
    this.session.conferByHand.set(key, per);
    const bidderName = this.deps.names[seat] ?? '';
    const voiced = !this.deps.story && Math.random() < 0.6; // story confers are text-only in v1
    const formB = Math.random() >= 0.7;
    const claimText = `→ ${bidderName}: ${claim.text}`;
    if (formB) {
      const ask = buildConferLine('ask', personaForName(bidderName), this.session.talk, Math.random);
      if (ask) {
        this.deps.push(bidderName, ask);
        if (voiced) {
          speakConsult(bidderName, ask, undefined, personaForName(bidderName), this.deps.seatPos(seat), n);
          void consultClipDurationMs(bidderName, ask, undefined, personaForName(bidderName))
            .then((d) => { if (d) offlineTalk.noteHighPriority(performance.now(), Math.min(d, 900)); }).catch(() => {});
        }
      }
      const claimVoiced = voiced && Math.random() < 0.5; // second line text-only ~half the time
      this.after(650, () => {
        this.deps.push(pName, claimText);
        if (claimVoiced) {
          speakConsult(pName, claim.raw, claim.clipSuffix, pPersona, this.deps.seatPos(pSeat), n);
          void consultClipDurationMs(pName, claim.raw, claim.clipSuffix, pPersona)
            .then((d) => { if (d) offlineTalk.noteHighPriority(performance.now(), Math.min(d, 900)); }).catch(() => {});
        }
      });
      return decide(voiced ? 900 : 500);
    }
    this.deps.push(pName, claimText);
    if (voiced) {
      speakConsult(pName, claim.raw, claim.clipSuffix, pPersona, this.deps.seatPos(pSeat), n);
      void consultClipDurationMs(pName, claim.raw, claim.clipSuffix, pPersona)
        .then((d) => { if (d) offlineTalk.noteHighPriority(performance.now(), Math.min(d, 900)); }).catch(() => {});
    }
    return decide(voiced ? 800 : 400);
  }
}
