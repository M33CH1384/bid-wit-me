import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { dragSlamIntensity, tapPlaySlamIntensity, type DragSample } from '../src/slam';

const path = (pts: [number, number][]): DragSample[] => pts.map(([x, y], i) => ({ t: i * 16, x, y }));
const straight = path([[195, 700], [195, 690], [195, 670], [195, 650]]);
const vGesture = path([[195, 700], [195, 630], [195, 640], [195, 700], [180, 430]]);

describe('Turn up (slam mode) — opt-in, OFF by default', () => {
  it('defaults OFF for new and existing (old-save) players', () => {
    expect(DEFAULT_SETTINGS.turnUp).toBe(false);
    expect(normalizeSettings({}).turnUp).toBe(false);
    expect(normalizeSettings({ turnUp: undefined as never }).turnUp).toBe(false);
    expect(normalizeSettings({ turnUp: 'yes' as never }).turnUp).toBe(false);
    expect(normalizeSettings({ turnUp: true }).turnUp).toBe(true);
    expect(normalizeSettings({ turnUp: false }).turnUp).toBe(false);
  });

  it('Standing + mode OFF => no slam (drag and tap/toss)', () => {
    expect(dragSlamIntensity(straight, 'standing', false)).toBe(0);
    expect(dragSlamIntensity(straight, 'standing')).toBe(0); // default arg = off
    expect(tapPlaySlamIntensity('standing', false)).toBe(0);
    expect(tapPlaySlamIntensity('standing')).toBe(0);
  });

  it('Standing + mode ON => max slam 1.0 (drag and tap/toss, sent online)', () => {
    expect(dragSlamIntensity(straight, 'standing', true)).toBe(1);
    expect(tapPlaySlamIntensity('standing', true)).toBe(1);
  });

  it('Turn Up OFF gates the Sitting V-gesture too; ON preserves it; Sitting tap never auto-slams', () => {
    expect(dragSlamIntensity(vGesture, 'sitting', false)).toBe(0);
    expect(dragSlamIntensity(vGesture, 'sitting')).toBe(0); // default arg = off
    expect(dragSlamIntensity(vGesture, 'sitting', true)).toBe(1);
    expect(dragSlamIntensity(straight, 'sitting', true)).toBe(0);
    expect(dragSlamIntensity(straight, 'sitting', false)).toBe(0);
    expect(tapPlaySlamIntensity('sitting', true)).toBe(0);
    expect(tapPlaySlamIntensity('sitting', false)).toBe(0);
  });

  it('swipe-and-hold still places gently in BOTH Turn Up states (hold ages the V out, unchanged)', () => {
    // V legs complete by t=64, then the finger holds still and releases at t=1200 (>800 ms later)
    const swipeHold: DragSample[] = [
      { t: 0, x: 195, y: 700 }, { t: 16, x: 195, y: 630 }, { t: 32, x: 195, y: 640 },
      { t: 48, x: 195, y: 700 }, { t: 64, x: 180, y: 430 }, { t: 1200, x: 180, y: 430 },
    ];
    expect(dragSlamIntensity(swipeHold, 'sitting', false)).toBe(0);
    expect(dragSlamIntensity(swipeHold, 'sitting', true)).toBe(0);
  });

  it('no slam field is sent for a gated/gentle drag (Table only attaches a positive slam)', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('dragged && slam ? { slam }');
  });

  it('toggle lives by the YOU plate, in the game menu, and in Settings — all from Settings.turnUp', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('data-testid="turnup-toggle-plate"');
    expect(table).toContain('data-testid="turnup-toggle"');
    expect(table).toContain('const turnUp = settings.turnUp === true');
    expect(table).toContain('onTurnUp?.(!turnUp)');
    expect(table).toContain('turnUp={turnUp}'); // scene drag path
    expect(table).toContain('tapPlaySlamIntensity(effView, turnUp)'); // tap/toss + online slam field
    const more = readFileSync(new URL('../src/MoreOptions.tsx', import.meta.url), 'utf8');
    expect(more).toContain('Turn up (slam mode)');
    expect(more).toContain("set('turnUp', v)");
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('onTurnUp=');
    expect(app).toContain('saveSettings(s)');
    const online = readFileSync(new URL('../src/online/OnlineTable.tsx', import.meta.url), 'utf8');
    expect(online).toContain('onTurnUp=');
    expect(online).toContain('saveSettings({ ...loadSettings(), turnUp })');
    const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    expect(scene).toContain('dragSlamIntensity(d.trail, viewNow.current, turnUpNow.current)'); // live refs, not mount-time props
  });
});
