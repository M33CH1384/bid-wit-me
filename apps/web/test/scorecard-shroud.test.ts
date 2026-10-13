import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type GameState, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { Intermission } from '../src/Intermission';
import { ScorePad } from '../src/ScorePad';
import { HOLE_SLOTS, clearTeamHoles, markHolePunched, markSheetPlayed, rememberHoles } from '../src/shotMarks';

function toHandOver(mode: 'joker' | 'cutthroat'): GameState {
  const rules = mode === 'cutthroat' ? makeRules('cutthroat', { playerCount: 3, targetScore: 300 }) : makeRules('joker', { targetScore: 500 });
  let st = newGame(rules, `shroud-${mode}`);
  for (let g = 0; g < 8000 && st.phase !== 'handOver' && st.phase !== 'gameOver'; g++) {
    const t = pendingTurn(st);
    if (!t) break;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  return st;
}

/** Replace history with numeric-bid hands. `sideShots[hand]` lists the sides set that hand. Hand 1 is index 0. */
function stamp(st: GameState, sideShots: number[][], opts: { shotOut?: boolean; lost?: number[] } = {}): GameState {
  const last = st.history.at(-1)!;
  const history = sideShots.map((shotSides, i) => ({
    ...last,
    handNo: i + 1,
    bids: last.bids.map(() => 4),
    sides: last.sides.map((s) => ({
      ...s,
      contract: 4,
      contractMade: shotSides.includes(s.side) ? false as const : true,
      contractTricks: shotSides.includes(s.side) ? 1 : 4,
    })),
  }));
  const lost = opts.lost;
  const result = lost ? {
    endReason: 'shotOut' as const,
    shotOut: lost,
    finalScores: st.scores,
    placements: st.scores.map(() => 1),
    winners: [0],
  } : null;
  return {
    ...st,
    rules: { ...st.rules, shotOut: opts.shotOut !== false },
    result,
    history,
    handNo: history.length,
    phase: lost ? 'gameOver' : 'handOver',
  };
}

function recap(st: GameState, names: string[]) {
  return renderToStaticMarkup(createElement(Intermission, {
    st, names, mySide: 0, secs: null, online: false, unread: 0, chatOpen: false,
    onReady: () => {}, onScorePad: () => {}, onChat: () => {},
  }));
}

function pad(st: GameState, names: string[]) {
  return renderToStaticMarkup(createElement(ScorePad, {
    st, names, onClose: () => {}, sideName: (side: number) => names[side] ?? `Side ${side}`,
  }));
}

function holeImgs(html: string): string[] {
  return [...html.matchAll(/<img\b([^>]*)>/g)].map((m) => m[1] ?? '').filter((attrs) => attrs.includes('/shot/hole.png'));
}

function caption(html: string): string {
  const m = html.match(/<p class="tod"[\s\S]*?<\/p>/);
  return (m?.[0] ?? '').replace(/<[^>]+>/g, '').replace(/\u00a0|&nbsp;|&#160;/g, ' ');
}

describe('scorecard caution tape and shroud', () => {
  const names = ['You', 'Hana', 'Mei', 'Jamal'];
  beforeEach(() => clearTeamHoles());

  it('tapes the panel on a shot after hand 1, and leaves the other side clear', () => {
    const html = recap(stamp(toHandOver('joker'), [[], [1]]), names);
    expect(html).toContain('data-testid="recap-side-1" data-blast="yes" data-tape="yes" data-sheet="no" data-siren="no"');
    expect(html).toContain('class="tt-team blast taped tape-in notice"');
    expect(html).toContain('data-testid="recap-tape-1"');
    expect(html).toContain('src="/shot/tape.png"');
    expect(html.match(/src="\/shot\/tape.png"/g)).toHaveLength(2);
    expect(html).toContain('class="tape a"');
    expect(html).toContain('class="tape b"');
    expect(html).toContain('data-testid="recap-holes-1"');
    expect(html).toContain('data-holes="1"');
    expect(html).toContain('data-punched="0"');
    const holes = holeImgs(html);
    expect(holes).toHaveLength(1);
    expect(holes[0]).toContain('left:62%');
    expect(holes[0]).toContain('class="hole-in"');
    expect(html).not.toContain('left:14%');
    expect(html).not.toContain('left:13%');
    expect(html).not.toContain('left:78%');
    expect(html).toContain('data-testid="recap-shot-stamp-1"');
    expect(html).toContain('>SHOT<');
    expect(html).toContain('data-testid="recap-notice-1"');
    expect(html).toContain('>ON NOTICE<');
    expect(html).not.toContain('SHOT · ON NOTICE');
    expect(html).not.toContain('>SET<');
    expect(html).not.toContain('data-testid="recap-shroud-1"');
    expect(html).not.toContain('time-of-death');
    expect(html).not.toContain('recap-tape-0');
    expect(html).toContain('data-testid="recap-side-0" data-blast="no" data-tape="no" data-sheet="no" data-siren="no"');
    expect(html).toContain('data-testid="recap-line-1"');
  });

  it('pulls the tape off once they make their books', () => {
    const html = recap(stamp(toHandOver('joker'), [[], [1], []]), names);
    expect(html).toContain('data-testid="recap-side-1" data-blast="no" data-tape="no" data-sheet="no" data-siren="no"');
    expect(html).not.toContain('recap-tape-');
    expect(html).not.toContain('recap-holes-');
    expect(html).not.toContain('recap-shroud-');
    expect(html).toContain('data-holes="1"');
    expect(html).toContain('data-punched="1"');
    expect(pad(stamp(toHandOver('joker'), [[], [1], []]), names)).toContain('data-holes="1"');
    expect(html).not.toContain('time-of-death');
    expect(html).not.toContain('tape-in');
    expect(html).toContain('data-testid="recap-line-1"');
  });

  it('drapes the sheet, RIP, and the siren when the recorded result is a shot-out', () => {
    const html = recap(stamp(toHandOver('joker'), [[], [1], [1]], { lost: [1] }), names);
    expect(html).toContain('data-testid="recap-side-1" data-blast="yes" data-tape="no" data-sheet="yes" data-siren="yes"');
    expect(html).toContain('class="tt-team blast shrouded sheet-in sheet-wait"');
    expect(html).toContain('data-holes="2"');
    expect(html).toContain('data-punched="1,0"');
    const holes = holeImgs(html);
    expect(holes).toHaveLength(2);
    expect(holes[0]).toContain('left:62%');
    expect(holes[0]).not.toContain('hole-in');
    expect(holes[1]).toContain('left:14%');
    expect(holes[1]).toContain('top:calc(100% - 40px)');
    expect(holes[1]).toContain('class="hole-in"');
    expect(html).not.toContain('left:78%');
    expect(html).toContain('data-testid="recap-shroud-1"');
    expect(html).toContain('data-testid="recap-rip-1"');
    expect(html).toContain('alt="RIP"');
    expect(html).toContain('src="/shot/rip.png"');
    expect(html).toContain('srcSet="/shot/sheet.webp"');
    expect(html).not.toContain('>RIP<');
    expect(html).toContain('data-testid="police-lights"');
    expect(html).toContain('data-testid="police-rim"');
    expect(html).toContain('data-testid="recap-tape-1"');
    expect(html).toContain('class="tape a"');
    expect(html).toContain('class="tape b"');
    expect(html).toContain('data-testid="recap-line-1"');
    expect(html).not.toContain('recap-shroud-0');
    expect(html).toContain('data-testid="time-of-death"');
    expect(html).toContain('data-hand="3"');
    expect(caption(html)).toBe('Time of death: Hand 3');
  });

  it('keeps the same holes on a second render and on the score pad, and does not replay a punch', () => {
    const st = stamp(toHandOver('joker'), [[], [1], [1]], { lost: [1] });
    const first = recap(st, names);
    expect(holeImgs(first)).toHaveLength(2);
    expect(first.match(/class="hole-in"/g)).toHaveLength(1);
    const board = pad(st, names);
    expect(board).toContain('data-testid="pad-board-side"');
    expect(board).toContain('data-holes="2"');
    expect(board).toContain('data-punched="1,0"');
    const again = rememberHoles(st.seed, 1, 2, 1);
    const same = rememberHoles(st.seed, 1, 2, 1);
    expect(same).toBe(again);
    expect(HOLE_SLOTS).toHaveLength(3);
    markHolePunched(st.seed, 1, 1);
    markSheetPlayed(st.seed, 1);
    const second = recap(st, names);
    const holes = holeImgs(second);
    expect(holes).toHaveLength(2);
    expect(holes[0]).toContain('left:62%');
    expect(holes[1]).toContain('left:14%');
    expect(second).not.toContain('hole-in');
    expect(second).not.toContain('sheet-in');
    expect(second).toContain('data-holes="2"');
    expect(second).toContain('data-punched="1,1"');
    const boardAfter = pad(st, names);
    expect(boardAfter).toContain('data-holes="2"');
    expect(boardAfter).toContain('data-punched="1,1"');
    const noticed = stamp(toHandOver('joker'), [[], [1]]);
    clearTeamHoles();
    const one = recap(noticed, names);
    expect(holeImgs(one)).toHaveLength(1);
    markHolePunched(noticed.seed, 1, 0);
    const oneAgain = recap(noticed, names);
    expect(holeImgs(oneAgain)).toHaveLength(1);
    expect(oneAgain).not.toContain('hole-in');
    expect(oneAgain).toContain('left:62%');
    expect(pad(noticed, names)).toContain('data-punched="1"');
  });

  it('counts one hole per shot through four, and sheets only on a recorded elimination', () => {
    const base = toHandOver('joker');
    const one = recap(stamp(base, [[], [1]], { shotOut: false }), names);
    expect(holeImgs(one)).toHaveLength(1);
    expect(one).toContain('data-holes="1"');
    expect(one).toContain('left:62%');
    expect(one).not.toContain('recap-shroud-');
    expect(one).not.toContain('recap-shot-tally-');
    expect(one).toContain('>ON NOTICE<');

    clearTeamHoles();
    const two = recap(stamp(base, [[], [1], [1]], { shotOut: false }), names);
    const twoHoles = holeImgs(two);
    expect(twoHoles).toHaveLength(2);
    expect(twoHoles[0]).toContain('left:62%');
    expect(twoHoles[0]).not.toContain('hole-in');
    expect(twoHoles[1]).toContain('left:14%');
    expect(twoHoles[1]).toContain('class="hole-in"');
    expect(two).toContain('data-holes="2"');
    expect(two).not.toContain('recap-shroud-');
    expect(two).toContain('>ON NOTICE<');

    clearTeamHoles();
    const three = recap(stamp(base, [[], [1], [1], [1]], { shotOut: false }), names);
    const threeHoles = holeImgs(three);
    expect(threeHoles).toHaveLength(3);
    expect(threeHoles[0]).not.toContain('hole-in');
    expect(threeHoles[1]).not.toContain('hole-in');
    expect(threeHoles[2]).toContain('left:78%');
    expect(threeHoles[2]).toContain('top:145px');
    expect(threeHoles[2]).toContain('class="hole-in"');
    expect(three).toContain('data-holes="3"');
    expect(three).not.toContain('recap-shroud-');
    expect(three).not.toContain('recap-shot-tally-');

    clearTeamHoles();
    const four = recap(stamp(base, [[], [1], [1], [1], [1]], { shotOut: false }), names);
    expect(holeImgs(four)).toHaveLength(3);
    expect(four).not.toContain('hole-in');
    expect(four).toContain('data-holes="4"');
    expect(four).toContain('data-punched="1,1,1"');
    expect(four).toContain('data-testid="recap-shot-tally-1"');
    expect(four).toContain('>x4<');
    expect(four).toContain('data-testid="recap-shot-stamp-1"');
    expect(four).toContain('>ON NOTICE<');
    expect(four).not.toContain('recap-shroud-');
    expect(pad(stamp(base, [[], [1], [1], [1], [1]], { shotOut: false }), names)).toContain('data-holes="4"');

    clearTeamHoles();
    const pending = recap(stamp(base, [[], [1], [1]]), names);
    expect(holeImgs(pending)).toHaveLength(2);
    expect(pending).toContain('data-tape="yes" data-sheet="no"');
    expect(pending).not.toContain('recap-shroud-');

    clearTeamHoles();
    const eliminated = recap(stamp(base, [[], [1], [1]], { lost: [1] }), names);
    expect(eliminated).toContain('data-sheet="yes"');
    expect(eliminated).toContain('sheet-wait');
    expect(holeImgs(eliminated)).toHaveLength(2);
    expect(eliminated).not.toContain('>ON NOTICE<');
  });

  it('a hand-1 shot-out shows the tape and the sheet, and a non-loss stays tape', () => {
    const html = recap(stamp(toHandOver('joker'), [[1]], { lost: [1] }), names);
    expect(html).toContain('data-testid="recap-side-1" data-blast="yes" data-tape="yes" data-sheet="yes" data-siren="yes"');
    expect(html).toContain('class="tt-team blast taped tape-in shrouded sheet-in sheet-wait"');
    expect(html).toContain('data-testid="recap-tape-1"');
    expect(html).toContain('src="/shot/tape.png"');
    expect(html).toContain('data-testid="recap-holes-1"');
    expect(holeImgs(html)).toHaveLength(1);
    expect(html).toContain('data-holes="1"');
    expect(html).not.toContain('left:14%');
    expect(html).not.toContain('recap-notice-');
    expect(html).not.toContain('>ON NOTICE<');
    expect(html).toContain('data-testid="recap-rip-1"');
    expect(html).toContain('data-testid="police-lights"');
    expect(html).toContain('data-testid="recap-line-1"');
    expect(html).toContain('data-hand="1"');
    expect(caption(html)).toBe('Time of death: Hand 1');
    const off = recap(stamp(toHandOver('joker'), [[1]], { shotOut: false }), names);
    expect(off).toContain('data-tape="yes" data-sheet="no" data-siren="no"');
    expect(off).not.toContain('recap-shroud-');
    expect(off).not.toContain('police-lights');
    expect(off).not.toContain('time-of-death');
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    const play = audio.slice(audio.indexOf('play(name: Sfx'), audio.indexOf('private sample'));
    expect(play.indexOf('if (!this.settings.on')).toBeLessThan(play.indexOf("case 'siren'"));
    expect(play.indexOf('if (!this.settings.on')).toBeLessThan(play.indexOf("case 'docSting'"));
    expect(play).toContain("case 'siren': return this.siren");
    expect(play).toContain("case 'docSting': return this.docSting");
    expect(audio).toContain('Original synthesis, no sampled recording');
    expect(audio).toContain('no third-party license');
    expect(audio).toContain('Not based on any show theme');
    const recapSrc = readFileSync(new URL('../src/Intermission.tsx', import.meta.url), 'utf8');
    expect(recapSrc).toContain("sound.play('siren'");
    expect(recapSrc).toContain("sound.play('docSting'");
    expect(recapSrc).toContain('if (!sheetOn || sirened.current === sirenKey) return');
    expect(recapSrc).toContain('shotCovers(r, st.history, st.result)');
    expect(recapSrc).not.toContain('shotCounts');
    expect(recapSrc).toContain('covers.some((c) => c.sheet)');
    expect(recapSrc).toContain('Time of death: Hand ${rec.handNo}');
  });

  it('a Cutthroat hand-1 elimination shows tape and the sheet on that player', () => {
    const html = recap(stamp(toHandOver('cutthroat'), [[2]], { lost: [2] }), ['You', 'Ace', 'Bea']);
    expect(html).toContain('data-testid="recap-side-2" data-blast="yes" data-tape="yes" data-sheet="yes" data-siren="yes"');
    expect(html).toContain('class="tt-team blast taped tape-in shrouded sheet-in sheet-wait"');
    expect(html).toContain('data-testid="recap-tape-2"');
    expect(holeImgs(html)).toHaveLength(1);
    expect(html).toContain('data-testid="recap-shroud-2"');
    expect(html).not.toContain('recap-shroud-0');
    expect(html).not.toContain('recap-tape-0');
    expect(caption(html)).toBe('Time of death: Hand 1');
  });

  it('tapes that Cutthroat player’s own panel', () => {
    const html = recap(stamp(toHandOver('cutthroat'), [[], [2]]), ['You', 'Ace', 'Bea']);
    expect(html).toContain('tt-recap crowded');
    expect(html).toContain('data-testid="recap-side-2" data-blast="yes" data-tape="yes" data-sheet="no" data-siren="no"');
    expect(html).toContain('class="tt-team blast taped tape-in notice"');
    expect(html).toContain('data-testid="recap-tape-2"');
    expect(html).toContain('data-testid="recap-holes-2"');
    expect(html).toContain('data-testid="recap-shot-stamp-2"');
    expect(html).not.toContain('recap-holes-0');
    expect(html).not.toContain('recap-tape-0');
    expect(html).not.toContain('recap-tape-1');
    expect(html).toContain('data-testid="recap-line-2"');
  });

  it('elimination triggers the siren cue, and a shot that is not a loss does not', () => {
    const lost = recap(stamp(toHandOver('joker'), [[], [1], [1]], { lost: [1] }), names);
    expect(lost).toContain('data-sheet="yes" data-siren="yes"');
    expect(lost).toContain('data-testid="police-rim"');
    const notice = recap(stamp(toHandOver('joker'), [[], [1]], { shotOut: false }), names);
    expect(notice).toContain('data-sheet="no" data-siren="no"');
    expect(notice).not.toContain('data-testid="police-rim"');
    const src = readFileSync(new URL('../src/Intermission.tsx', import.meta.url), 'utf8');
    const cue = src.slice(src.indexOf('const sheetOn'), src.indexOf('data-testid="table-talk"'));
    expect(cue).toContain('if (!sheetOn || sirened.current === sirenKey) return');
    expect(cue).toContain("sound.play('siren'");
    expect(cue).toContain('waitSheet.size ? 0.4 : 0.05');
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    const play = audio.slice(audio.indexOf('play(name: Sfx'), audio.indexOf('private sample'));
    expect(play.startsWith('play(name: Sfx')).toBe(true);
    expect(play.indexOf('if (!this.settings.on || !this.unlocked) return')).toBeLessThan(play.indexOf("case 'siren'"));
    expect(audio).toContain('const v = this.settings.on ? this.settings.volume ** 1.6 : 0');
    expect(audio).toContain('o.connect(filter).connect(gain).connect(this.sfxBus!)');
    expect(audio).toContain('Goes out the sfx bus, so mute and the volume slider apply');
  });

  it('keeps the tape and the sheet at phone widths, and skips only their entrance when motion is reduced', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(css).toContain('animation: tape-slap 260ms cubic-bezier(.2, 1.3, .3, 1)');
    expect(css).toContain('opacity: 0.95');
    expect(css).toContain('brightness(.85)');
    expect(css).toContain('#FF4D4D');
    expect(css).toContain('.tt-team.taped { clip-path: none; overflow: visible; }');
    expect(css).toContain('overflow: visible; border: 1px solid #FF4D4D');
    expect(css).toContain('translateX(4px) rotate(-1.5deg)');
    expect(css).toContain('0 0 24px rgba(255,60,60,.25)');
    expect(css).toContain('inset 0 0 48px rgba(255,60,60,.12)');
    expect(css).toContain('color: #FF6B6B');
    expect(css).toContain('text-shadow: 0 2px 0 #140810');
    expect(css).toContain('left: -14px');
    expect(css).toContain('width: calc(100% + 28px)');
    expect(css).toContain('height: 28px');
    expect(css).toContain('rotate(8deg)');
    expect(css).toContain('rotate(-8deg)');
    expect(css).toContain('width: 46px');
    expect(css).toContain('width: 44px; height: 44px');
    expect(css).toContain('animation-delay: 400ms');
    expect(css).toContain('animation-delay: 850ms');
    expect(css).not.toContain('top: -8px');
    expect(css).not.toContain('right: -8px');
    expect(css).toMatch(/\.tt-run-show \{[^}]*background:/);
    expect(css).toMatch(/\.tt-run-show \{[^}]*appearance:\s*none/);
    expect(css).not.toContain('rotate(-12deg)');
    expect(css).not.toContain('rotate(12deg)');
    expect(css).not.toContain('ff6a1a');
    expect(css).not.toContain('blast-cracks');
    expect(css).not.toContain('muzzle-flash');
    expect(css).toContain('animation: sheet-drop 450ms cubic-bezier(.3, 1.4, .4, 1)');
    expect(css).toContain('mix-blend-mode: multiply');
    expect(css).toContain('opacity: 0.92');
    expect(css).toContain('rotate(-4deg)');
    expect(css).toContain('#FF2A2A');
    expect(css).toContain('#2A5BFF');
    expect(css).toContain('mix-blend-mode: soft-light');
    expect(css).toContain('animation: police-red 1.2s');
    expect(css).toContain('animation: police-blue 1.2s');
    expect(css).toContain('animation: fold-ripple');
    expect(css).toContain('top: calc(54px + env(safe-area-inset-top))');
    expect(css).toContain('.tt-chat-btn { position: fixed; z-index: 1025; top: calc(54px + env(safe-area-inset-top)); right: calc(8px + env(safe-area-inset-right));');
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\}/g)].map((m) => m[0]);
    const entrance = blocks.find((b) => b.includes('.caution-x') && b.includes('.shroud'));
    expect(entrance).toContain('animation: none');
    expect(entrance).not.toContain('display: none');
    expect(css).not.toMatch(/@media[^{]*max-width[^{]*\{[^}]*(caution-x|\.shroud|police-lights|\.rip|\.tod|shot-holes)/);
    expect(css).toContain('animation: tod-key');
    const tod = blocks.find((b) => b.includes('.tod'));
    expect(tod).toContain('animation: none');
    expect(tod).toContain('opacity: 1');
    expect(tod).not.toContain('display: none');
    expect(css).toContain('animation: police-red');
    expect(css).toContain('animation: police-blue');
    const dim = blocks.find((b) => b.includes('police-lights') || b.includes('police-red'));
    expect(dim).toBeUndefined();
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain("endReason === 'shotOut' && !shotRecapAck");
    expect(table).toContain('setShotRecapAck(true)');
    expect(table).toContain('ran the rest');
    expect(table).not.toContain('Run it — cleared hands');
    const recapSrc = readFileSync(new URL('../src/Intermission.tsx', import.meta.url), 'utf8');
    expect(recapSrc).toContain("haptic([30], 'shot-hole')");
    expect(recapSrc).not.toContain('shot-card');
    expect(recapSrc).toContain("haptic([80, 40, 160], 'sheet-drop')");
    expect(recapSrc).toContain('rememberHoles');
    expect(recapSrc).not.toContain('BlastMarks');
    expect(recapSrc).not.toContain('PELLETS');
    const tape = readFileSync(new URL('../public/shot/tape.png', import.meta.url));
    const hole = readFileSync(new URL('../public/shot/hole.png', import.meta.url));
    const sheet = readFileSync(new URL('../public/shot/sheet.png', import.meta.url));
    expect(tape.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(hole.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(sheet.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(tape.length).toBeGreaterThan(8000);
    expect(hole.length).toBeGreaterThan(4000);
    expect(sheet.length).toBeGreaterThan(8000);
  });
});
