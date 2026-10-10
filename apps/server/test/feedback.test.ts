import { describe, expect, it } from 'vitest';
import { FEEDBACK_LIMITS, adminHtml, notifyOwner, parseFeedback, rateOk, tokenOk } from '../src/feedback';

const png = 'data:image/png;base64,' + btoa('\x89PNG fake bytes');
const ok = { type: 'bug', message: 'Cards overlap on my phone', name: 'Dee', email: 'dee@example.com', context: { v: '0.3.0' }, shots: [png] };

describe('feedback validation', () => {
  it('accepts a normal message with a screenshot', () => {
    const p = parseFeedback(ok);
    expect(p.ok && p.value.shots[0]!.mime).toBe('image/png');
    expect(p.ok && p.spam).toBe(false);
  });
  it('rejects bad type / short or long message / bad email / too many or too big shots / bad context', () => {
    expect(parseFeedback({ ...ok, type: 'rant' }).ok).toBe(false);
    expect(parseFeedback({ ...ok, message: ' x ' }).ok).toBe(false);
    expect(parseFeedback({ ...ok, message: 'x'.repeat(FEEDBACK_LIMITS.messageMax + 1) }).ok).toBe(false);
    expect(parseFeedback({ ...ok, email: 'not-an-email' }).ok).toBe(false);
    expect(parseFeedback({ ...ok, shots: [png, png, png, png] }).ok).toBe(false);
    expect(parseFeedback({ ...ok, shots: ['data:text/html;base64,AAAA'] }).ok).toBe(false);
    expect(parseFeedback({ ...ok, shots: [`data:image/jpeg;base64,${'A'.repeat(2_100_000)}`] }).ok).toBe(false);
    expect(parseFeedback({ ...ok, context: 'x' }).ok).toBe(false);
    expect(parseFeedback({ ...ok, context: { big: 'x'.repeat(5000) } }).ok).toBe(false);
  });
  it('name and email are optional', () => {
    expect(parseFeedback({ type: 'idea', message: 'Add a tournament mode' }).ok).toBe(true);
  });
  it('honeypot marks spam', () => {
    const p = parseFeedback({ ...ok, website: 'http://spam' });
    expect(p.ok && p.spam).toBe(true);
  });
});

describe('rate limit + token', () => {
  it('5 per IP per sliding hour', () => {
    const now = 10_000_000;
    expect(rateOk([now - 1, now - 2, now - 3, now - 4], now)).toBe(true);
    expect(rateOk([now - 1, now - 2, now - 3, now - 4, now - 5], now)).toBe(false);
    expect(rateOk([now - 3_600_001, now - 3_700_000, now - 4_000_000, now - 5_000_000, now - 6_000_000], now)).toBe(true);
  });
  it('token must match exactly; unset token = locked', () => {
    expect(tokenOk('abc', 'abc')).toBe(true);
    expect(tokenOk('abd', 'abc')).toBe(false);
    expect(tokenOk(null, 'abc')).toBe(false);
    expect(tokenOk('abc', undefined)).toBe(false);
  });
  it('admin page escapes user text', () => {
    const html = adminHtml([{ id: 1, created: 0, type: 'bug', message: '<script>x</script>', name: '', email: '', context: '{}', shots: [7] }], 'tok', 'https://w');
    expect(html).not.toContain('<script>x');
    expect(html).toContain('/api/feedback/shot/7?token=tok');
  });
});

describe('email notifier', () => {
  const p = parseFeedback(ok);
  const fb = p.ok ? p.value : (null as never);
  it('skips silently without both secrets', async () => {
    let called = false;
    const f = (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch;
    expect(await notifyOwner({}, fb, 1, 'u', f)).toBe('skipped');
    expect(await notifyOwner({ FEEDBACK_EMAIL_TO: 'a@b.co' }, fb, 1, 'u', f)).toBe('skipped');
    expect(called).toBe(false);
  });
  it('posts to Resend when configured', async () => {
    let body: Record<string, unknown> = {};
    const f = (async (_u: string, init: RequestInit) => { body = JSON.parse(init.body as string); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    expect(await notifyOwner({ FEEDBACK_EMAIL_TO: 'owner@x.co', RESEND_API_KEY: 'k' }, fb, 3, 'u', f)).toBe('sent');
    expect(body.to).toEqual(['owner@x.co']);
    expect(body.reply_to).toBe('dee@example.com');
  });
});
