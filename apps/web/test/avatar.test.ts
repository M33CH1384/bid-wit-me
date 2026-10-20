/** Profile pictures (Demetrius 2026-10-19): the pic beats the initial, camera off included. */
import { describe, expect, it } from 'vitest';
import { avatarSrcFor, faceOf, socialUidOf, validateAvatarDataUrl } from '../src/avatar';

const PIC = 'data:image/png;base64,' + btoa('\x89PNG' + 'x'.repeat(100));

describe('avatarSrcFor', () => {
  it('returns the data URL only when it is a real image data URL', () => {
    expect(avatarSrcFor(PIC)).toBe(PIC);
    expect(avatarSrcFor(null)).toBeNull();
    expect(avatarSrcFor(undefined)).toBeNull();
    expect(avatarSrcFor('https://x/y.png')).toBeNull();
    expect(avatarSrcFor('data:text/plain;base64,AAAA')).toBeNull();
  });
});

describe('faceOf', () => {
  it('prefers the picture over the initial — camera-off players get the pic, not a letter', () => {
    const withPic = faceOf(PIC, 'Demetrius');
    expect(withPic).toEqual({ kind: 'pic', src: PIC });
  });
  it('falls back to the initial when there is no picture', () => {
    expect(faceOf(null, 'Demetrius')).toEqual({ kind: 'initial', letter: 'D' });
    expect(faceOf(undefined, '  boo ')).toEqual({ kind: 'initial', letter: 'B' });
    expect(faceOf(null, '')).toEqual({ kind: 'initial', letter: '?' });
  });
});

describe('socialUidOf', () => {
  it('strips the u: prefix from account ids; guests resolve to nothing', () => {
    expect(socialUidOf('u:abc123')).toBe('abc123');
    expect(socialUidOf('g:xyz')).toBeUndefined();
    expect(socialUidOf(null)).toBeUndefined();
    expect(socialUidOf(undefined)).toBeUndefined();
  });
});

describe('validateAvatarDataUrl', () => {
  it('mirrors the server rules for a good and a bad data URL', () => {
    expect(validateAvatarDataUrl(PIC).ok).toBe(true);
    const bad = validateAvatarDataUrl('data:image/gif;base64,AAAA');
    expect(bad.ok).toBe(false);
    expect(validateAvatarDataUrl(null).ok).toBe(false);
  });
});
