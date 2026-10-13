import { type TableRules, hostMinimum, shotOutOn } from '@spades/rules';
import { SKILL_SETTING_LABEL, TALK_INTENSITY_LABEL, type TalkIntensity, skillSettingOf } from '@spades/bots';
import { modeTitle, rulesSummary } from './settings';

const NUKE_LABEL = { full: 'Full Nuke', classic: 'Classic', off: 'Off' } as const;

/** The rules locked for the running game (online: the server enforces it; offline: fixed when the game started). */
export function lockedRows(r: TableRules, o: { nuke?: keyof typeof NUKE_LABEL; skill?: unknown; intensity?: TalkIntensity; micMute?: boolean }): [string, string][] {
  const min = hostMinimum(r);
  return [
    ['Mode', `${modeTitle(r)}${r.partnerships ? '' : r.deck === 'joker54' ? ' · Joker deck' : ' · Standard 52'}`],
    ['Table', rulesSummary(r)],
    ['Target', String(r.targetScore)],
    ['Minimum books / bid', min > 0 ? String(min) : 'Off'],
    ['Shot = out', shotOutOn(r) ? 'On' : 'Off'],
    ['First hand bids itself', r.firstHandBidsItself ? 'On' : 'Off'],
    ['Nil / Blind Nil', `${r.nil.allowed ? `Nil ${r.nil.value}` : 'No Nil'} · ${r.blindNil.allowed ? `Blind Nil ${r.blindNil.value}` : 'no Blind Nil'}`],
    ['Bags', r.bagsOn !== false && r.bagsPerPenalty > 0 ? `${r.bagsPerPenalty} bags = −${r.bagPenalty}` : 'Off'],
    ...(r.deck === 'joker54' && o.nuke ? [['Nuke', NUKE_LABEL[o.nuke]] as [string, string]] : []),
    ...(o.skill !== undefined ? [['Bot skill', SKILL_SETTING_LABEL[skillSettingOf(o.skill)]] as [string, string]] : []),
    ...(o.intensity ? [['Trash talk', TALK_INTENSITY_LABEL[o.intensity]] as [string, string]] : []),
    ...(r.partnerships && o.micMute !== undefined ? [['Partner mic mute', o.micMute ? 'On' : 'Off'] as [string, string]] : []),
  ];
}

export function LockedRulesPanel({ rules, online = false, ...o }: { rules: TableRules; online?: boolean } & Parameters<typeof lockedRows>[1]) {
  const rows = lockedRows(rules, o);
  return (
    <div className="panel locked-rules" data-testid="locked-rules">
      <div className="panel-title"><span aria-hidden>🔒</span> Locked for this game</div>
      <dl>{rows.map(([k, v]) => <div key={k} className="locked-row"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <p className="hint">{online ? 'A rematch or a new game unlocks them. Pace settings (timer, Table Talk, AFK) can still change.' : 'House rules apply from your next game. Sound, voices and effects stay yours to change.'}</p>
    </div>
  );
}
