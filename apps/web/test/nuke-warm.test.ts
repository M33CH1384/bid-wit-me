/**
 * Nuked-trick freeze fix (2026-11-05, owner report): at the trick Hana led with
 * the Big Joker and won — a NUKED trick (the Little Joker was in it too) — the
 * game "froze a bit" before her next lead. The state/driver path never blocked
 * (see leader-sequence + turn-actor pins): the beat's designed 5.15 s allowance
 * played WITHOUT its show. On the iOS path the blast picture is the photoreal
 * 2D nuke module, which (1) was cold-imported at detonation — the load-time
 * warm pass covers only the 3D blast — and (2) sits behind the Scene
 * frame-clock certification gate, which had no fallback: a starved canvas
 * means a late or silently dropped blast and a bare, silent hold.
 *
 * These pins hold the placement fix: the modules warm BEFORE their moment
 * (nuke at arm time, quake at hand start), and the certification wait is
 * bounded — the 1100 ms schedule and the certification gate stay exactly as
 * pinned in hero-presentation.test.ts; only the starved case fires late.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hostSrc = readFileSync(new URL('../src/photoreal/host.ts', import.meta.url), 'utf8');
const tableSrc = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');

describe('photoreal warm-up (the show loads before its moment, not during it)', () => {
  it('host exports warmPhotoreal, loading through the same LOAD table playPhotoreal uses', () => {
    expect(hostSrc).toContain('export function warmPhotoreal');
    expect(hostSrc).toContain('LOAD[name]()');
    // warmed once per name: a guard set keeps repeat calls free
    expect(hostSrc).toContain('warmed');
  });

  it('Table warms the nuke module when the live trick arms (both jokers in state)', () => {
    expect(tableSrc).toContain("warmPhotoreal('nuke')");
    expect(tableSrc).toContain('isNukeTrick(st.trick.plays)');
  });

  it('Table warms the quake module at hand start in joker modes (the Big Joker crack cue)', () => {
    expect(tableSrc).toContain("warmPhotoreal('quake')");
    expect(tableSrc).toContain("r.deck === 'joker54'");
  });
});

describe('nuke watchdog: the certification wait is bounded', () => {
  it('the 1100 ms schedule and the certification gate are untouched', () => {
    expect(tableSrc).toContain("fx.hold(1300, 'nukeWatch')");
    expect(tableSrc).toContain('}, 1100);');
    expect(tableSrc).toContain('nukeShownKey !== nukeKey');
  });

  it('a late key lets the blast fire when certification never arrives (starved frame clock)', () => {
    expect(tableSrc).toContain('nukeLateKey');
    expect(tableSrc).toContain('nukeLateKey !== nukeKey');
    // the fallback is a separate, later timer — never the 1100 ms schedule itself
    expect(tableSrc).toContain('}, 3000);');
  });
});
