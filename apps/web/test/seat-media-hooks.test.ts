// @vitest-environment happy-dom
/**
 * SeatMedia hook-order regression (owner report 2026-11-03: online tables
 * freezing mid-game — React error #300, "Rendered fewer hooks than
 * expected", on /t/ routes across builds a51cf2d, 852c0e3 and 8562a5b).
 *
 * SeatMedia called two useEffects AFTER its early returns (the !human /
 * !mesh return and the isMe returns), so one mounted instance ran 7 hooks
 * on the early path and 9 on the full path. Seat lifecycles flip that
 * path WITHIN one table mount in ordinary online play:
 *   - a human seat becomes a bot mid-game (leave -> vacated bot, room.ts
 *     vacatedSeat; kick -> "a bot takes their seat"),
 *   - a spectator takes a seat and every plate's isMe/occupant shifts,
 *   - the video mesh arrives or goes away under a mounted table.
 * full -> early threw #300 and killed the table's render (the frozen
 * last frame players force-closed out of); early -> full is the #310
 * twin. These renders pin the invariant: ANY sequence of seat / mesh /
 * isMe states through one mounted SeatMedia renders cleanly.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/audio', () => ({
  useSoundSettings: () => ({}),
  sound: {
    voiceChatGeneration: 0,
    voiceMuted: () => false,
    attachVoiceChat: () => false,
    updateVoiceChat: () => {},
    detachVoiceChat: () => {},
    setVoiceMuted: () => {},
  },
}));
vi.mock('../src/avatar', async () => {
  const React = await import('react');
  return {
    useAvatar: () => null,
    AvatarCircle: ({ name }: { name: string }) => React.createElement('span', null, (name || '?').charAt(0)),
  };
});
vi.mock('../src/profileTap', () => ({ openPlayerProfile: () => {}, profileTargetOf: () => null }));

import { SeatMedia, type KickInfo } from '../src/online/Media';
import type { SeatInfo } from '@spades/protocol';
import type { VideoMesh, VideoState } from '../src/online/video';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const human: SeatInfo = { kind: 'human', playerId: 'p2', name: 'Lovley', connected: true, media: { cam: false, mic: false }, uid: 'u2' };
const bot: SeatInfo = { kind: 'bot', name: 'Imani', level: 'pro' };
const mesh = { toggleHidden: () => {} } as unknown as VideoMesh;
const kick: KickInfo = { host: true, votes: 0, need: 2, voted: false, onKick: () => {} };
const fakeStream = { getVideoTracks: () => [], getAudioTracks: () => [], getTracks: () => [] } as unknown as MediaStream;

function vs(over: Partial<VideoState> = {}): VideoState {
  return {
    cam: false, mic: false, local: null, remote: {}, conn: {}, needsTap: false,
    muted: [], limited: [], music: {}, hidden: [], error: null, ducked: [],
    ...over,
  } as unknown as VideoState;
}

type SeatMediaProps = Parameters<typeof SeatMedia>[0];
const base: SeatMediaProps = { seat: human, isMe: false, mesh, vs: vs(), kick, seatPos: 'top', playerCount: 4 };

let root: Root | null = null;
let el: HTMLDivElement | null = null;
const logs: string[] = [];
let restoreError: typeof console.error | null = null;

beforeEach(() => {
  logs.length = 0;
  HTMLVideoElement.prototype.play = () => Promise.resolve();
  // happy-dom's srcObject setter rejects non-MediaStream values; the test's
  // fake streams are plain objects, so give the property a plain accessor.
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get() { return (this as { _so?: unknown })._so ?? null; },
    set(v: unknown) { (this as { _so?: unknown })._so = v; },
  });
  restoreError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
  };
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root?.unmount());
  el?.remove();
  root = null;
  el = null;
  if (restoreError) console.error = restoreError;
});

/** Render (or re-render) one mounted SeatMedia; returns the surfaced error, if any. */
function render(props: SeatMediaProps): unknown {
  let thrown: unknown = null;
  try {
    act(() => { root!.render(createElement(SeatMedia, props)); });
  } catch (e) {
    thrown = e;
  }
  return thrown;
}

function expectClean(thrown: unknown) {
  const hookLog = logs.find((l) => /Rendered (fewer|more) hooks/.test(l));
  expect(thrown === null ? '' : String((thrown as Error)?.message ?? thrown), 'render threw').toBe('');
  expect(hookLog, 'hooks-order error logged').toBeUndefined();
}

describe('SeatMedia hook order across seat lifecycle flips', () => {
  it('human seat replaced by a bot mid-game (leave / kick) does not throw', () => {
    expectClean(render(base));
    expect(document.querySelector('[data-testid="initial-p2"]'), 'human plate controls render').toBeTruthy();
    expectClean(render({ ...base, seat: bot }));
    expect(el!.firstChild, 'bot seat renders no media bubble').toBeNull();
    // and back again (a fresh human in the same seat within the mount)
    expectClean(render(base));
    expect(document.querySelector('[data-testid="initial-p2"]')).toBeTruthy();
  });

  it('the video mesh arriving / leaving under a mounted table does not throw', () => {
    expectClean(render({ ...base, mesh: null }));
    expectClean(render(base));
    expect(document.querySelector('[data-testid="initial-p2"]')).toBeTruthy();
    expectClean(render({ ...base, mesh: null }));
  });

  it('taking a seat (isMe flips onto a mounted plate) does not throw', () => {
    const selfVs = vs({ cam: true, local: fakeStream });
    expectClean(render({ ...base, isMe: true, vs: selfVs }));
    expect(document.querySelector('[data-testid="self-video"]'), 'own bubble renders').toBeTruthy();
    expectClean(render({ ...base, isMe: false, vs: selfVs }));
    expectClean(render({ ...base, isMe: true, vs: selfVs }));
    expect(document.querySelector('[data-testid="self-video"]')).toBeTruthy();
  });
});
