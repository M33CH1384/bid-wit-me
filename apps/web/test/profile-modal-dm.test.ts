/** In-game profile modal quick-send DM (owner's correction, Demetrius 2026-10-20):
 *  "I don't want it to open a thread I just want it to have the text box like the chat
 *  reply but in this case it directly sends the dm." These pins keep the modal's DM a
 *  quick-send box on the card — one message through the normal social.dm path — and
 *  stop it regressing into a thread view or a panel navigation. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const modal = readFileSync(new URL('../src/social/ProfileModal.tsx', import.meta.url), 'utf8');

describe('profile modal quick-send DM', () => {
  it('has a Message toggle revealing an inline input + Send on the card', () => {
    expect(modal).toContain('data-testid="profile-modal-message"');
    expect(modal).toContain('data-testid="profile-modal-dm-input"');
    expect(modal).toContain('data-testid="profile-modal-dm-send"');
    expect(modal).toContain('{!me && !blocked && msgOpen && (');
  });
  it('sends through the normal DM path — and never opens a thread or the panel', () => {
    expect(modal).toContain('social.dm(pid, t)');
    expect(modal).not.toContain("social.open('messages'");
    expect(modal).not.toContain('dmWith');
    expect(modal).not.toContain('DmThread');
    expect(modal).not.toContain('dmHistory');
  });
  it('respects the DM length cap and refuses blank drafts', () => {
    expect(modal).toContain('maxLength={SOCIAL_LIMITS.chatMax}');
    expect(modal).toContain('disabled={!draft.trim()}');
    expect(modal).toContain('if (!t) return;');
  });
  it('after sending: draft cleared, box collapsed, brief in-place Sent confirmation', () => {
    expect(modal).toContain("setDraft('')");
    expect(modal).toContain('setMsgOpen(false)');
    expect(modal).toContain('setSent(true)');
    expect(modal).toContain('data-testid="profile-modal-dm-sent"');
  });
  it('a dead socket surfaces the store error instead of a false Sent (draft kept)', () => {
    expect(modal).toContain("if (s.status !== 'open') { social.dm(pid, t); return; }");
  });
  it('blocked pairs see the blocked state, not a send box; messaging yourself is hidden', () => {
    expect(modal).toContain('You blocked {target.name}. Unblock them to message.');
    expect(modal).toContain('{!blocked && <button type="button" aria-expanded={msgOpen} data-testid="profile-modal-message"');
    expect(modal).toContain('{!me && !blocked && msgOpen && (');
  });
});
