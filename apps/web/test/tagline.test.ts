/** Profile taglines (Demetrius 2026-10-20): only real http(s) URLs become links — everything else stays inert text. */
import { describe, expect, it } from 'vitest';
import { linkifyTagline, LINK_LABEL_MAX, type TaglineSegment } from '../src/tagline';

const links = (segs: TaglineSegment[]) => segs.filter((s) => s.kind === 'link');
const joined = (segs: TaglineSegment[]) => segs.map((s) => (s.kind === 'text' ? s.text : s.href)).join('');

describe('linkifyTagline', () => {
  it('plain text passes through untouched', () => {
    expect(linkifyTagline('King of the block, no links here')).toEqual([{ kind: 'text', text: 'King of the block, no links here' }]);
    expect(linkifyTagline('')).toEqual([]);
  });

  it('linkifies http and https URLs, keeping the surrounding text', () => {
    const segs = linkifyTagline('beats at https://example.com/me and http://foo.bar/x pull up');
    expect(segs).toEqual([
      { kind: 'text', text: 'beats at ' },
      { kind: 'link', href: 'https://example.com/me', label: 'https://example.com/me' },
      { kind: 'text', text: ' and ' },
      { kind: 'link', href: 'http://foo.bar/x', label: 'http://foo.bar/x' },
      { kind: 'text', text: ' pull up' },
    ]);
    expect(joined(segs)).toBe('beats at https://example.com/me and http://foo.bar/x pull up');
  });

  it('never linkifies javascript:, data: or other schemes', () => {
    const s = 'run javascript:alert(1) or data:text/html;base64,PHNjcmlwdD4= lol';
    const segs = linkifyTagline(s);
    expect(links(segs)).toEqual([]);
    expect(joined(segs)).toBe(s);
  });

  it('bare domains and www. without a scheme stay text (only real URLs link)', () => {
    const s = 'find me at example.com or www.example.com sometime';
    expect(links(linkifyTagline(s))).toEqual([]);
    expect(joined(linkifyTagline(s))).toBe(s);
  });

  it('markup-shaped text stays verbatim text — nothing is ever injected as HTML', () => {
    const s = '<img src=x onerror=alert(1)> https://ok.example.com <script>alert(2)</script>';
    const segs = linkifyTagline(s);
    expect(links(segs)).toEqual([{ kind: 'link', href: 'https://ok.example.com', label: 'https://ok.example.com' }]);
    expect(segs[0]).toEqual({ kind: 'text', text: '<img src=x onerror=alert(1)> ' });
    expect(segs[2]).toEqual({ kind: 'text', text: ' <script>alert(2)</script>' });
  });

  it('sentence punctuation is not swallowed into the link', () => {
    expect(linkifyTagline('see https://a.com/x.')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', href: 'https://a.com/x', label: 'https://a.com/x' },
      { kind: 'text', text: '.' },
    ]);
    expect(linkifyTagline('(https://a.com/x)')).toEqual([
      { kind: 'text', text: '(' },
      { kind: 'link', href: 'https://a.com/x', label: 'https://a.com/x' },
      { kind: 'text', text: ')' },
    ]);
  });

  it('keeps balanced parens that belong to the URL', () => {
    const u = 'https://en.wikipedia.org/wiki/Spades_(card_game)';
    const segs = linkifyTagline(u);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ kind: 'link', href: u });
  });

  it('an https:// shape that does not parse to a dotted host stays text', () => {
    const s = 'broken https://nodot link';
    expect(links(linkifyTagline(s))).toEqual([]);
    expect(joined(linkifyTagline(s))).toBe(s);
  });

  it('long URLs keep the full href but get a truncated label', () => {
    const u = `https://example.com/${'a'.repeat(60)}`;
    const segs = linkifyTagline(u);
    expect(segs).toHaveLength(1);
    const link = segs[0]!;
    expect(link.kind).toBe('link');
    if (link.kind === 'link') {
      expect(link.href).toBe(u);
      expect(link.label.length).toBeLessThanOrEqual(LINK_LABEL_MAX);
      expect(link.label).toContain('…');
    }
  });
});
