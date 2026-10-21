import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The in-game table controls (owner 2026-10-20): chat, camera and mic used to hide
 * behind ONE collapsible tray whose button face was just 💬⋯ — it read as "chat"
 * while also holding the camera and mic, so a new player had no idea they were
 * in there. The controls are now a slim vertical RAIL on the right edge of the
 * table: chat, camera and mic are separate, always-visible buttons (each with
 * its own icon + word label), in the same off-the-felt pocket the tray used.
 * These pins keep the rail from regressing back into a single mystery icon.
 */
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

const table = src('Table.tsx');
const railStart = table.indexOf('data-testid="ctl-rail"');
const railBlock = table.slice(table.lastIndexOf('<div', railStart), table.indexOf('</div>', railStart) + '</div>'.length);

describe('table controls rail', () => {
  it('the rail exists and the mystery tray toggle is gone', () => {
    expect(railStart).toBeGreaterThan(-1);
    expect(table).toContain('ctl-cluster ctl-rail');
    expect(table).not.toContain('tray-toggle');
    expect(table).not.toContain('data-testid="ctl-tray"');
    expect(table).not.toContain('Open controls: camera, mic, voice, chat');
  });

  it('chat is its own labelled button on the rail, with the unread badge on it', () => {
    expect(railBlock).toContain('chat-toggle');
    expect(railBlock).toContain('💬<small>CHAT</small>');
    expect(railBlock).toContain("aria-label={open ? 'Hide chat' : 'Show chat'}");
    expect(railBlock).toContain('data-testid="rail-unread"');
    // the badge only shows while chat is closed, exactly as the tray's did
    expect(railBlock).toContain('{!open && unread > 0 &&');
  });

  it('camera/mic (extra) and talk-trash render on the rail, after chat — nothing is collapsed away', () => {
    const chatAt = railBlock.indexOf('chat-toggle');
    const extraAt = railBlock.indexOf('{extra}');
    const trashAt = railBlock.indexOf('{trash}');
    expect(chatAt).toBeGreaterThan(-1);
    expect(extraAt).toBeGreaterThan(chatAt);
    expect(trashAt).toBeGreaterThan(extraAt);
    // no expand/collapse state gates the rail's contents any more
    expect(railBlock).not.toContain('useState');
    expect(table).not.toMatch(/tray \? 'expanded'/);
  });

  it('camera and mic stay separate toggles with their own labels and state (MediaBar)', () => {
    const media = src('online/Media.tsx');
    expect(media).toContain("aria-label={vs.cam ? 'Turn camera off' : 'Turn camera on'}");
    expect(media).toContain("aria-label={vs.mic ? 'Mute microphone' : 'Turn microphone on'}");
    expect(media).toContain('<small>{vs.cam ? \'ON\' : \'CAM\'}</small>');
    expect(media).toContain('<small>{vs.mic ? \'ON\' : \'MIC\'}</small>');
    // offline tables show the same two buttons, disabled, so the home of cam/mic is never a secret
    expect(media).toContain('data-testid="av-offline"');
  });

  it('the rail is vertical and right-docked in the tray\u2019s old off-the-felt pocket, both orientations', () => {
    const css = src('styles.css');
    const railRule = css.slice(css.indexOf('.ctl-rail,'), css.indexOf('.ctl-rail .av-bar'));
    expect(railRule).toContain('flex-direction: column');
    expect(railRule).toContain('right: calc(8px + env(safe-area-inset-right))');
    expect(railRule).toContain('bottom: calc(23vh + 8px + env(safe-area-inset-bottom))');
    // short landscape shares the exact same anchor rule (no second, drifting position)
    expect(railRule).toContain('.table-screen.short .ctl-rail');
    // the dead tray styles are gone
    expect(css).not.toContain('.tray-toggle');
    expect(css).not.toContain('.ctl-tray');
  });

  it('the layout engine still treats the rail as an obstacle the plates avoid', () => {
    // the no-overlap guarantee is active, not hopeful: Scene measures .ctl-cluster
    // rects when placing plates, and Coach lists it among its obstacles — the rail
    // keeps the .ctl-cluster class so both keep working.
    expect(src('three/Scene.tsx')).toContain('.ctl-cluster');
    expect(src('Coach.tsx')).toContain('.ctl-cluster');
    expect(railBlock).toContain('ctl-cluster');
  });

  it('the rail carries no theme-conditional behaviour (parity: same controls both themes)', () => {
    expect(railBlock).not.toContain('data-theme');
    expect(railBlock).not.toContain('neon');
  });
});
