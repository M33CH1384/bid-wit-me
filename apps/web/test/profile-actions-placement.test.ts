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
 *  block — Level/title, both plain-rating chips, coins — moved INTO the same
 *  header, under the action row, and the standalone REP section further down
 *  was deleted; the summary stats grid lost its 2v2 rating / Cutthroat tiles
 *  (they duplicated the division chips). One combined profile area at the top,
 *  like the /profile header card. The ★ Friends state also stopped being bare
 *  gold text in the row: it wears the row's chip chrome in social.css.
 *
 *  Unification (same day, owner's third pass at this): the Rep block itself —
 *  Level/title, XP progress bar, both rating chips, coins — is now ONE shared
 *  component (src/RepBlock.tsx) rendered by all three profile surfaces, so the
 *  Social view, the modal and the /profile header card carry the identical
 *  combined block and can't drift apart again. The /profile header gained the
 *  division chips it was missing; Social/modal gained the XP bar. Content pins
 *  therefore live against RepBlock.tsx, and the surfaces pin their <RepBlock>
 *  call sites. The self-view editors (picture, tagline, social links) are
 *  hidden behind a single Edit profile button unless the owner taps it.
 *
 *  Reorder (same day, owner's next annotated screenshot): the action row moved
 *  again — to directly UNDER the Rep block ("Can we move this section down
 *  under the level / coin section"), superseding the under-presence placement
 *  above; the whole row must also fit on ONE line ("let's fit it all on one
 *  line" — it wrapped, Report dropping to a second row), so social.css makes
 *  the row nowrap with compact header-scoped chips. And the coins chip lost
 *  its 🪙 emoji ("that emoji you have for coins don't work for me") —
 *  RepBlock draws a CoinIcon SVG in its place.
 *
 *  ONE PROFILE (same day, owner's verdict on the whole structure): "I really
 *  don't get why we have a rep profile and then a completely separate profile
 *  page if I tap on my name from the players menu — it's confusing and bad
 *  user experience." The two full-profile implementations (ProfilePage's
 *  tabbed page and Social.tsx's Profile) are now ONE component —
 *  src/profile/ProfileView.tsx — rendered by both hosts (the /profile route
 *  and the Social panel) for self and others alike. The pins below that used
 *  to read Social.tsx's Profile or ProfilePage's internals now read
 *  ProfileView: same order, same content, one home. The tabbed body means
 *  achievements live behind the Achievements tab (their own section, below
 *  the header, as before — one tap away instead of a scroll). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const social = readFileSync(new URL('../src/social/Social.tsx', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../src/social/ProfileModal.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/social/social.css', import.meta.url), 'utf8');
const repBlock = readFileSync(new URL('../src/RepBlock.tsx', import.meta.url), 'utf8');
const view = readFileSync(new URL('../src/profile/ProfileView.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/profile/ProfilePage.tsx', import.meta.url), 'utf8');

const count = (src: string, needle: string) => src.split(needle).length - 1;

describe('Unified profile: action row under the Rep block', () => {
  const profile = view.slice(view.indexOf('export function ProfileView('));
  it('exactly one action row — no duplicate left down the page', () => {
    expect(count(profile, 'className="soc-prof-acts"')).toBe(1);
  });
  it('the Rep block renders after the presence line, the action row follows it, both still inside the header before the stats summary', () => {
    const presence = profile.indexOf('data-testid="profile-online"');
    const rep = profile.indexOf('testid="profile-rep"');
    const acts = profile.indexOf('className="soc-prof-acts"');
    expect(presence).toBeGreaterThan(-1);
    expect(rep).toBeGreaterThan(presence);
    expect(acts).toBeGreaterThan(rep);
    expect(profile.indexOf('className="soc-stats wins-summary"')).toBeGreaterThan(acts);
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

describe('Profile modal: action row under the Rep block', () => {
  const card = modal.slice(modal.indexOf('function ProfileCard'));
  it('exactly one action row — no duplicate left under the Rep section', () => {
    expect(count(card, 'className="soc-prof-acts"')).toBe(1);
  });
  it('the Rep block renders after the presence line, the action row follows it, both before the stats grid', () => {
    const presence = card.indexOf('soc-online-status');
    const rep = card.indexOf('testid="profile-modal-rep"');
    const acts = card.indexOf('className="soc-prof-acts"');
    expect(presence).toBeGreaterThan(-1);
    expect(rep).toBeGreaterThan(presence);
    expect(acts).toBeGreaterThan(rep);
    expect(card.indexOf('className="soc-stats"')).toBeGreaterThan(acts);
  });
  it('the quick-send DM box and its Sent confirmation travel with the row, inside the header after the Rep block', () => {
    const rep = card.indexOf('testid="profile-modal-rep"');
    const acts = card.indexOf('className="soc-prof-acts"');
    const box = card.indexOf('profile-modal-compose');
    const sent = card.indexOf('data-testid="profile-modal-dm-sent"');
    expect(box).toBeGreaterThan(acts);
    expect(sent).toBeGreaterThan(acts);
    expect(box).toBeGreaterThan(rep);
    expect(sent).toBeGreaterThan(rep);
  });
  it('the blocked note travels with the row too', () => {
    const rep = card.indexOf('testid="profile-modal-rep"');
    const acts = card.indexOf('className="soc-prof-acts"');
    const note = card.indexOf('Unblock them to message.');
    expect(note).toBeGreaterThan(acts);
    expect(note).toBeGreaterThan(rep);
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
  const profile = view.slice(view.indexOf('export function ProfileView('));
  const card = modal.slice(modal.indexOf('function ProfileCard'));
  it('exactly one Rep block per surface — the standalone REP section is gone', () => {
    expect(count(profile, 'testid="profile-rep"')).toBe(1);
    expect(count(card, 'testid="profile-modal-rep"')).toBe(1);
    expect(profile).not.toContain('<h4>Rep</h4>');
    expect(card).not.toContain('<h4>Rep</h4>');
  });
  it('the shared Rep block carries level/title, both rating chips and coins; both surfaces feed it the cred payload', () => {
    expect(repBlock).toContain('Level {level.level}');
    expect(repBlock).toContain('⚔ Rating {team.elo}');
    expect(repBlock).toContain('🔪 Rating {cutthroat.elo}');
    // one-title rule (owner, 2026-10-20): the LEVEL title is the only named
    // title — the chips carry NO division name, just the plain rating
    expect(repBlock).not.toContain('divLabel(');
    expect(repBlock).not.toContain('DIV_LABEL');
    expect(repBlock).toContain('<CoinIcon /> {coins.toLocaleString()}');
    expect(repBlock).not.toContain('🪙');
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
  it('achievements render as their own section below the header (the Achievements tab in the full view, a section in the modal)', () => {
    expect(profile).toContain("{ id: 'achievements', label: 'Achievements' }");
    expect(profile).toContain('className="ach-grid"');
    expect(card).toContain('<h4>Achievements</h4>');
  });
  it('the summary stats grids get two columns for their two tiles', () => {
    expect(css).toContain('.profile-view .soc-stats.wins-summary, .profile-modal-body > .soc-stats { grid-template-columns: repeat(2, 1fr); }');
  });
});

describe('unified Rep block: the XP bar rides in the header on every surface', () => {
  it('RepBlock renders the bar with the /profile semantics (into-level / for-level)', () => {
    expect(repBlock).toContain('className="xp-bar"');
    expect(repBlock).toContain('{level.xpIntoLevel}/{level.xpForNext} XP');
    expect(repBlock).toContain('data-testid={testid}');
    expect(repBlock).toContain('data-testid={`${testid}-xp`}');
  });
  it('both hosts render the one shared ProfileView, which renders the one shared RepBlock — no per-surface Rep markup left', () => {
    expect(view).toContain("import { RepBlock } from '../RepBlock';");
    expect(modal).toContain("import { RepBlock } from '../RepBlock';");
    expect(view).toContain('testid="profile-rep"');
    expect(social).toContain("import { ProfileView } from '../profile/ProfileView';");
    expect(social).toContain('<ProfileView host="panel"');
    expect(page).toContain("import { ProfileView } from './ProfileView';");
    expect(page).toContain('<ProfileView host="page" />');
    // the old /profile header's hand-rolled level line, bar and coins block are gone (RepBlock owns them now)
    expect(page).not.toContain('className="prof-level"');
    expect(page).not.toContain('className="xp-bar"');
    expect(view).not.toContain('className="prof-coins"');
  });
  it('in the unified view the block sits inside the one header, before the tabs', () => {
    const head = view.indexOf('className="soc-prof-head"');
    const rep = view.indexOf('<RepBlock');
    expect(head).toBeGreaterThan(-1);
    expect(rep).toBeGreaterThan(head);
    expect(rep).toBeLessThan(view.indexOf('className="prof-tabs"'));
  });
});

describe('one line: the action row never wraps (Demetrius 2026-10-20)', () => {
  it('the row is a nowrap flex line — no wrap rule left on it', () => {
    expect(css).toContain('.soc-prof-acts { display: flex; flex-wrap: nowrap; gap: 5px; align-items: center; }');
    expect(css).not.toContain('.soc-prof-acts { display: flex; flex-wrap: wrap;');
  });
  it('chips carry compact header-scoped sizing and labels that cannot wrap — they shrink to fit', () => {
    expect(css).toContain('.soc-prof-acts button, .soc-prof-acts .soc-friend-tag { white-space: nowrap; min-width: 0; }');
    expect(css).toContain('.soc-prof-head .soc-prof-acts button { padding: 6px 7px; font-size: 12px; min-height: 40px;');
    expect(css).toContain('.soc-prof-head .soc-prof-acts .soc-friend-tag { padding: 6px 7px; font-size: 12px; min-height: 40px; }');
  });
  it('both surfaces render the single row these rules apply to', () => {
    const profile = view.slice(view.indexOf('export function ProfileView('));
    const card = modal.slice(modal.indexOf('function ProfileCard'));
    expect(count(profile, 'className="soc-prof-acts"')).toBe(1);
    expect(count(card, 'className="soc-prof-acts"')).toBe(1);
  });
});

describe('coins chip: a drawn coin, no emoji (Demetrius 2026-10-20)', () => {
  it('RepBlock renders the CoinIcon SVG in the chip and keeps the number formatting', () => {
    expect(repBlock).toContain('export function CoinIcon({ size = 15 }');
    expect(repBlock).toContain('<svg width={size} height={size} viewBox="0 0 24 24"');
    expect(repBlock).toContain('id="bwm-coin-g"');
    expect(repBlock).toContain('<CoinIcon /> {coins.toLocaleString()}');
    expect(repBlock).not.toContain('🪙');
  });
});

describe('theme parity: the profile is the same profile in Classic and Neon', () => {
  it('no profile component branches on the theme — Neon only styles via CSS', () => {
    const profile = view.slice(view.indexOf('export function ProfileView('));
    const card = modal.slice(modal.indexOf('function ProfileCard'));
    for (const src of [profile, card, page, repBlock]) {
      expect(src).not.toContain('data-theme');
      expect(src).not.toContain('useTheme');
      expect(src).not.toContain("theme === 'neon'");
      expect(src).not.toContain('theme === "neon"');
    }
  });
});

describe('profile editors: hidden behind one Edit profile button (Demetrius 2026-10-20)', () => {
  it('one gate for the whole stack: an Edit profile button that flips to Done', () => {
    expect(view).toContain('const [editing, setEditing] = useState(false);');
    expect(view).toContain('data-testid="profile-edit"');
    expect(view).toContain("{editing ? 'Done' : 'Edit profile'}");
    // the whole editor stack (picture, tagline, links) renders only in edit mode
    expect(view).toContain('{me && cred && editing && (');
    expect(view.indexOf('data-testid="avatar-upload"')).toBeGreaterThan(view.indexOf('{me && cred && editing && ('));
    expect(view.indexOf('data-testid="tagline-input"')).toBeGreaterThan(view.indexOf('{me && cred && editing && ('));
    expect(view.indexOf('<SocialLinksEditor')).toBeGreaterThan(view.indexOf('{me && cred && editing && ('));
  });
  it('the links editor lost its own collapse — one gate, not two', () => {
    expect(view).not.toContain('data-testid="social-edit"');
    expect(view).not.toContain('>Edit links</button>');
    expect(view).not.toContain('No links yet');
    expect(view).toContain('data-testid={`social-input-${p.id}`}');
  });
  it('edit mode keeps the server save flow and a Cancel that discards the draft', () => {
    expect(view).toContain('data-testid="social-save"');
    expect(view).toContain("'/api/profile/me/social-links'");
    expect(view).toContain('data-testid="social-cancel"');
    expect(view).toContain('const cancel = () => { setDraft(blank()); setErr(null); };');
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
    const profile = view.slice(view.indexOf('export function ProfileView('));
    const card = modal.slice(modal.indexOf('function ProfileCard'));
    for (const src of [profile, card]) {
      const acts = src.indexOf('className="soc-prof-acts"');
      const tag = src.indexOf('soc-friend-tag');
      expect(tag).toBeGreaterThan(acts);
    }
  });
});
