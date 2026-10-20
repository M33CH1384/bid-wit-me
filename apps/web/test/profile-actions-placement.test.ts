/** Profile action-row placement (Demetrius 2026-10-20): the Chat / Friends /
 *  Block / Report row used to sit far down the profile, between Achievements
 *  and Stats. He circled it in a screenshot and sent it up: "These items need
 *  to be moved under the presence or inline with it." The row now renders
 *  INSIDE the profile header, directly under the presence line, on both the
 *  Social profile view and the in-game profile modal (where the quick-send DM
 *  box + Sent confirmation travel with it). These source pins keep a future
 *  edit from drifting the row back down the page.
 *
 *  Consolidation (same day, owner screenshot of LovleyT714's profile): the Rep
 *  block — Level/title, both division · Elo chips, coins — moved INTO the same
 *  header, under the action row, and the standalone REP section further down
 *  was deleted; the summary stats grid lost its 2v2 rating / Cutthroat tiles
 *  (they duplicated the division chips). One combined profile area at the top,
 *  like the /profile header card. The ★ Friends state also stopped being bare
 *  gold text in the row: it wears the row's chip chrome in social.css.
 *
 *  Unification (same day, owner's third pass at this): the Rep block itself —
 *  Level/title, XP progress bar, both division chips, coins — is now ONE shared
 *  component (src/RepBlock.tsx) rendered by all three profile surfaces, so the
 *  Social view, the modal and the /profile header card carry the identical
 *  combined block and can't drift apart again. The /profile header gained the
 *  division chips it was missing; Social/modal gained the XP bar. Content pins
 *  therefore live against RepBlock.tsx, and the surfaces pin their <RepBlock>
 *  call sites. On /profile, the social-links inputs are also hidden behind an
 *  Edit links button unless the owner is actively editing them. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const social = readFileSync(new URL('../src/social/Social.tsx', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../src/social/ProfileModal.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/social/social.css', import.meta.url), 'utf8');
const repBlock = readFileSync(new URL('../src/RepBlock.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/profile/ProfilePage.tsx', import.meta.url), 'utf8');

const count = (src: string, needle: string) => src.split(needle).length - 1;

describe('Social profile: action row under the presence line', () => {
  const profile = social.slice(social.indexOf('function Profile('));
  it('exactly one action row — no duplicate left down the page', () => {
    expect(count(profile, 'className="soc-prof-acts"')).toBe(1);
  });
  it('the row renders after the presence line, before the stats grid; the Rep block follows it, still inside the header', () => {
    const presence = profile.indexOf('data-testid="profile-online"');
    const acts = profile.indexOf('className="soc-prof-acts"');
    expect(presence).toBeGreaterThan(-1);
    expect(acts).toBeGreaterThan(presence);
    expect(profile.indexOf('className="soc-stats"')).toBeGreaterThan(acts);
    const rep = profile.indexOf('testid="profile-rep"');
    expect(rep).toBeGreaterThan(acts);
    expect(rep).toBeLessThan(profile.indexOf('className="soc-stats"'));
  });
  it('the row is inside the header block (before the social-links chips that follow the header)', () => {
    const acts = profile.indexOf('className="soc-prof-acts"');
    expect(acts).toBeGreaterThan(-1);
    expect(profile.indexOf('<SocialLinksChips')).toBeGreaterThan(acts);
    expect(profile.indexOf('<SocialLinksChips')).toBeGreaterThan(profile.indexOf('testid="profile-rep"'));
  });
  it('the row keeps every action and handler (Chat, Invite, friend states, Block, Report)', () => {
    expect(profile).toContain('social.openDm(pid)');
    expect(profile).toContain('data-testid="profile-add"');
    expect(profile).toContain('data-testid="profile-accept"');
    expect(profile).toContain('data-testid="profile-block"');
    expect(profile).toContain("social.report('user', { user: pid })");
  });
});

describe('Profile modal: action row under the presence line', () => {
  const card = modal.slice(modal.indexOf('function ProfileCard'));
  it('exactly one action row — no duplicate left under the Rep section', () => {
    expect(count(card, 'className="soc-prof-acts"')).toBe(1);
  });
  it('the row renders after the presence line, before the stats grid; the Rep block closes the header after it', () => {
    const presence = card.indexOf('soc-online-status');
    const acts = card.indexOf('className="soc-prof-acts"');
    expect(presence).toBeGreaterThan(-1);
    expect(acts).toBeGreaterThan(presence);
    expect(card.indexOf('className="soc-stats"')).toBeGreaterThan(acts);
    const rep = card.indexOf('testid="profile-modal-rep"');
    expect(rep).toBeGreaterThan(acts);
    expect(rep).toBeLessThan(card.indexOf('className="soc-stats"'));
  });
  it('the quick-send DM box and its Sent confirmation travel with the row, inside the header before the Rep block', () => {
    const acts = card.indexOf('className="soc-prof-acts"');
    const box = card.indexOf('profile-modal-compose');
    const sent = card.indexOf('data-testid="profile-modal-dm-sent"');
    const rep = card.indexOf('testid="profile-modal-rep"');
    expect(box).toBeGreaterThan(acts);
    expect(sent).toBeGreaterThan(acts);
    expect(rep).toBeGreaterThan(box);
    expect(rep).toBeGreaterThan(sent);
  });
  it('the blocked note travels with the row too', () => {
    const acts = card.indexOf('className="soc-prof-acts"');
    const note = card.indexOf('Unblock them to message.');
    expect(note).toBeGreaterThan(acts);
    expect(card.indexOf('testid="profile-modal-rep"')).toBeGreaterThan(note);
  });
});

describe('header CSS: the row wraps as a full-width line under the header text', () => {
  it('the header wraps and the relocated children span the full width', () => {
    expect(css).toContain('.soc-prof-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap;');
    expect(css).toContain('.soc-prof-head > .soc-prof-acts,');
    expect(css).toContain('.soc-prof-head > .profile-modal-compose,');
    expect(css).toContain('.soc-prof-head > .soc-prof-rep { flex: 1 1 100%');
    expect(css).toContain('flex: 1 1 100%');
  });
});

describe('consolidated header: one profile area at the top (Demetrius 2026-10-20)', () => {
  const profile = social.slice(social.indexOf('function Profile('));
  const card = modal.slice(modal.indexOf('function ProfileCard'));
  it('exactly one Rep block per surface — the standalone REP section is gone', () => {
    expect(count(profile, 'testid="profile-rep"')).toBe(1);
    expect(count(card, 'testid="profile-modal-rep"')).toBe(1);
    expect(profile).not.toContain('<h4>Rep</h4>');
    expect(card).not.toContain('<h4>Rep</h4>');
  });
  it('the shared Rep block carries level/title, both division chips and coins; both surfaces feed it the cred payload', () => {
    expect(repBlock).toContain('Level {level.level}');
    expect(repBlock).toContain('divLabel(team.division)} · {team.elo}');
    expect(repBlock).toContain('divLabel(cutthroat.division)} · {cutthroat.elo}');
    expect(repBlock).toContain('🪙 {coins.toLocaleString()}');
    for (const src of [profile, card]) {
      expect(src).toContain('level={cred.level}');
      expect(src).toContain('team={cred.rank.team}');
      expect(src).toContain('cutthroat={cred.rank.cutthroat}');
      expect(src).toContain('coins={cred.coins?.balance}');
    }
  });
  it('the summary stats keep games + wins only — the rating tiles that duplicated the chips are gone', () => {
    for (const src of [profile, card]) {
      expect(src).not.toContain('<small>2v2 rating</small>');
      expect(src).not.toContain('<small>Cutthroat</small>');
      expect(src).toContain('<small>online games</small>');
      expect(src).toContain('<small>wins</small>');
    }
  });
  it('achievements still render below, as their own section', () => {
    expect(profile).toContain('<h4>Achievements</h4>');
    expect(card).toContain('<h4>Achievements</h4>');
  });
  it('the summary stats grids get two columns for their two tiles', () => {
    expect(css).toContain('.soc-profile > .soc-stats:not(.small), .profile-modal-body > .soc-stats { grid-template-columns: repeat(2, 1fr); }');
  });
});

describe('unified Rep block: the XP bar rides in the header on every surface', () => {
  it('RepBlock renders the bar with the /profile semantics (into-level / for-level)', () => {
    expect(repBlock).toContain('className="xp-bar"');
    expect(repBlock).toContain('{level.xpIntoLevel}/{level.xpForNext} XP');
    expect(repBlock).toContain('data-testid={testid}');
    expect(repBlock).toContain('data-testid={`${testid}-xp`}');
  });
  it('all three surfaces render the one shared component — no per-surface Rep markup left', () => {
    expect(social).toContain("import { RepBlock } from '../RepBlock';");
    expect(modal).toContain("import { RepBlock } from '../RepBlock';");
    expect(page).toContain("import { RepBlock } from '../RepBlock';");
    expect(page).toContain('testid="prof-rep"');
    expect(page).toContain('team={profile.rank.team}');
    expect(page).toContain('cutthroat={profile.rank.cutthroat}');
    // the /profile header's hand-rolled level line + bar are gone (RepBlock owns them now)
    expect(page).not.toContain('className="prof-level"');
    expect(page).not.toContain('className="xp-bar"');
  });
  it('on /profile the block sits inside the header card, before the coins block', () => {
    const head = page.indexOf('className="prof-header glass"');
    const rep = page.indexOf('<RepBlock');
    expect(head).toBeGreaterThan(-1);
    expect(rep).toBeGreaterThan(head);
    expect(rep).toBeLessThan(page.indexOf('className="prof-coins"'));
  });
});

describe('theme parity: the profile is the same profile in Classic and Neon', () => {
  it('no profile component branches on the theme — Neon only styles via CSS', () => {
    const profile = social.slice(social.indexOf('function Profile('));
    const card = modal.slice(modal.indexOf('function ProfileCard'));
    for (const src of [profile, card, page, repBlock]) {
      expect(src).not.toContain('data-theme');
      expect(src).not.toContain('useTheme');
      expect(src).not.toContain("theme === 'neon'");
      expect(src).not.toContain('theme === "neon"');
    }
  });
});

describe('social-links editor: inputs hidden unless actively editing (own /profile)', () => {
  it('starts collapsed, with an Edit links button and a muted empty state', () => {
    expect(page).toContain('const [editing, setEditing] = useState(false);');
    expect(page).toContain('data-testid="social-edit"');
    expect(page).toContain('>Edit links</button>');
    expect(page).toContain('No links yet');
  });
  it('the text inputs render only inside the editing branch, after the collapsed return', () => {
    const collapsed = page.indexOf('if (!editing) {');
    expect(collapsed).toBeGreaterThan(-1);
    expect(page.indexOf('data-testid={`social-input-${p.id}`}')).toBeGreaterThan(collapsed);
    expect(page.indexOf('data-testid="social-edit"')).toBeLessThan(page.indexOf('data-testid={`social-input-${p.id}`}'));
  });
  it('edit mode keeps the server save flow and gains a Cancel that discards', () => {
    expect(page).toContain('data-testid="social-save"');
    expect(page).toContain("'/api/profile/me/social-links'");
    expect(page).toContain('data-testid="social-cancel"');
    expect(page).toContain('setEditing(false);');
  });
});

describe('friend-status chrome: no bare text among the boxed buttons', () => {
  it('the ★ Friends tag wears the same fill/border/radius as the row buttons', () => {
    const tag = css.slice(css.indexOf('.soc-friend-tag {'), css.indexOf('}', css.indexOf('.soc-friend-tag {')));
    expect(tag).toContain('background: rgba(var(--edge-rgb),.14)');
    expect(tag).toContain('border: 1px solid rgba(var(--edge-rgb),.45)');
    expect(tag).toContain('border-radius: 8px');
    expect(tag).toContain('padding: 6px 10px');
  });
  it('both surfaces render the tag inside the action row', () => {
    const profile = social.slice(social.indexOf('function Profile('));
    const card = modal.slice(modal.indexOf('function ProfileCard'));
    for (const src of [profile, card]) {
      const acts = src.indexOf('className="soc-prof-acts"');
      const tag = src.indexOf('soc-friend-tag');
      expect(tag).toBeGreaterThan(acts);
    }
  });
});
