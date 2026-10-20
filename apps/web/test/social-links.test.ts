/** Social links (Demetrius 2026-10-20): the chip row only renders server-normalized links, in platform order. */
import { describe, expect, it } from 'vitest';
import { SOCIAL_PLATFORMS, socialLinkEntries } from '../src/socialLinks';

describe('socialLinkEntries', () => {
  it('returns the fixed platform set', () => {
    expect(SOCIAL_PLATFORMS.map((p) => p.id)).toEqual(['instagram', 'x', 'tiktok', 'youtube', 'facebook', 'twitch']);
  });
  it('orders by platform and carries label + url', () => {
    const entries = socialLinkEntries({ twitch: 'https://www.twitch.tv/demo', instagram: 'https://www.instagram.com/demo' });
    expect(entries.map((e) => e.id)).toEqual(['instagram', 'twitch']);
    expect(entries[0]).toMatchObject({ label: 'Instagram', url: 'https://www.instagram.com/demo' });
  });
  it('drops unknown platforms, blanks and non-strings', () => {
    expect(socialLinkEntries({ myspace: 'https://myspace.com/demo', x: '', youtube: 42 as unknown as string })).toEqual([]);
  });
  it('is empty for no links', () => {
    expect(socialLinkEntries(null)).toEqual([]);
    expect(socialLinkEntries(undefined)).toEqual([]);
    expect(socialLinkEntries({})).toEqual([]);
  });
});
