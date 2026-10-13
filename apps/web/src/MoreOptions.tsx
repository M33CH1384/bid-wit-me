import { type ReactNode, useState } from 'react';
import Credits from './Credits';
import Feedback, { AboutRow } from './Feedback';
import { BotTrashTalkRow, NukeIntensityRow, ReduceEffectsRow, SoundFields } from './SoundControls';
import { TeamNameField, myTeamName, useMyTeamName } from './TeamName';
import { type Settings, settingsToRules } from './settings';
import { type TipsPref, saveTips } from './tips';
import { BADGES, useBadges } from './badges';
import { VENUE_DEFS, VENUE_LIST, type VenueChoice } from './venues';

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="row">
      <span className="row-label">{label}{hint && <small>{hint}</small>}</span>
      <span className="row-control">{children}</span>
    </label>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" className={`toggle ${value ? 'on' : ''}`} role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)}>
      <span />
    </button>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <span className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" role="radio" aria-label={text} aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>
      ))}
    </span>
  );
}

export const TALK_HINT: Record<Settings['talkIntensity'], string> = {
  family: 'Family Friendly: clean, light jokes only',
  cookout: 'Cookout: real table talk, nothing too personal (default)',
  nomercy: 'No Mercy: the full roast',
};

/** Every less-common option lives here (one gear sheet): game speed, graphics, tips, sound + music, house rules, credits. */
export default function MoreOptions({ settings: s, onChange, tips, onTips, onClose }: {
  settings: Settings; onChange: (s: Settings) => void; tips: TipsPref; onTips: (t: TipsPref) => void; onClose: () => void;
}) {
  const [house, setHouse] = useState(false);
  const [credits, setCredits] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });
  const rules = settingsToRules(s);
  const isJokerDeck = rules.deck === 'joker54';
  return (
    <>
    <div className="modal-backdrop sheet-backdrop" onClick={onClose}>
      <div className="sheet glass slant" role="dialog" aria-label="More options" onClick={(e) => e.stopPropagation()} data-testid="more-options">
        <header className="sheet-head">
          <span className="panel-title">MORE OPTIONS</span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </header>
        <div className="scroll sheet-body">
          <Row label="Tips while you play" hint="Coach marks + bid coach, until you turn them off">
            <Toggle label="Tips" value={tips.on} onChange={(on) => { const t = { on, asked: true }; saveTips(t); onTips(t); }} />
          </Row>
          <Row label="Game speed">
            <Seg label="Game speed" value={s.speed === 'turbo' ? 'fast' : s.speed} options={[['slow', 'Slow'], ['relaxed', 'Chill'], ['normal', 'Normal'], ['fast', 'Fast']]} onChange={(v) => set('speed', v)} />
          </Row>
          <Row label="Bot skill" hint={s.botLevel === 'mixed' ? 'Each bot rolls its own level (hidden): find out by playing' : 'Every bot plays at this level'}>
            <select data-testid="bot-skill" value={s.botLevel} onChange={(e) => set('botLevel', e.target.value as Settings['botLevel'])}>
              <option value="mixed">Mixed (default)</option><option value="novice">Novice</option><option value="regular">Regular</option><option value="pro">Pro</option><option value="shark">Shark</option>
            </select>
          </Row>
          <Row label="Trash talk" hint={TALK_HINT[s.talkIntensity ?? 'cookout']}>
            <Seg label="Trash talk intensity" value={s.talkIntensity ?? 'cookout'} options={[['family', 'Family'], ['cookout', 'Cookout'], ['nomercy', 'No Mercy']]} onChange={(v) => set('talkIntensity', v)} />
          </Row>
          <Row label="Venue" hint={s.venue === 'random' ? 'A different spot every game' : VENUE_DEFS[s.venue ?? 'classic'].blurb}>
            <select data-testid="venue-select" aria-label="Venue" value={s.venue ?? 'classic'} onChange={(e) => set('venue', e.target.value as VenueChoice)}>
              {VENUE_LIST.map((v) => <option key={v.id} value={v.id}>{v.emoji} {v.name}{v.id === 'classic' ? ' (default)' : ''}</option>)}
              <option value="random">🎲 Random</option>
            </select>
          </Row>
          <Row label="Graphics" hint="Low saves battery">
            <Seg label="Graphics" value={s.quality} options={[['high', 'High'], ['low', 'Low']]} onChange={(v) => set('quality', v)} />
          </Row>
          <h3 className="sheet-h">Sound &amp; music</h3>
          <SoundFields />
          <ReduceEffectsRow />
          <NukeIntensityRow />
          <BotTrashTalkRow />
          <TeamNameRow />
          <BadgesRow />
          <button type="button" className="link sheet-h" aria-expanded={house} onClick={() => setHouse(!house)}>{house ? '▾' : '▸'} House rules</button>
          {house && (
            <div className="house">
              <Row label="First hand: books bid themselves" hint="No bidding in hand 1 · 10 points per book">
                <Toggle label="First hand: books bid themselves" value={s.firstHandBidsItself !== false} onChange={(v) => set('firstHandBidsItself', v)} />
              </Row>
              <Row label="Shot = out" hint={rules.partnerships ? 'Shot (set) on hand 1, or two hands in a row, loses the game' : 'A player shot (set) on hand 1, or twice in a row, loses the game'}>
                <Toggle label="Shot = out" value={s.shotOut !== false} onChange={(v) => set('shotOut', v)} />
              </Row>
              {rules.partnerships && (
                <Row label="Minimum books / bid" hint="Every hand. Hand 1: fewer books is a shot. Later: bids must reach it.">
                  <select data-testid="first-hand-min" value={String(s.firstHandMin ?? 'default')} onChange={(e) => { const v = e.target.value; set('firstHandMin', v === 'default' || v === 'off' ? v : (Number(v) as 3 | 4 | 5)); }}>
                    <option value="default">Default (4)</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="off">Off</option>
                  </select>
                </Row>
              )}
              <Row label="Losing floor −200"><Toggle value={s.losingFloor === 'on'} onChange={(v) => set('losingFloor', v ? 'on' : 'off')} /></Row>
              {isJokerDeck && (
                <Row label="Joker trump order" hint={s.jokerOrder === 'house' ? '2♣ 2♥ removed · 2♦ is a spade' : '2♥ 2♦ removed'}>
                  <select value={s.jokerOrder} onChange={(e) => set('jokerOrder', e.target.value as Settings['jokerOrder'])}>
                    <option value="house">BJ › LJ › 2♦ › 2♠ › A♠</option>
                    <option value="classic">BJ › LJ › A♠ … 2♠</option>
                  </select>
                </Row>
              )}
              {isJokerDeck && s.jokerOrder === 'classic' && (
                <Row label="2♠ ranks under the jokers"><Toggle value={s.deuceOfSpadesHigh} onChange={(v) => set('deuceOfSpadesHigh', v)} /></Row>
              )}
              <Row label="Spades must be broken"><Toggle value={s.spadesMustBeBroken} onChange={(v) => set('spadesMustBeBroken', v)} /></Row>
              <Row label="2♣ leads first trick" hint={rules.firstLead !== s.firstLead ? 'not available: 2♣ removed' : undefined}>
                <Toggle value={s.firstLead === 'twoOfClubs'} onChange={(v) => set('firstLead', v ? 'twoOfClubs' : 'leftOfDealer')} />
              </Row>
              {rules.partnerships ? (
                <Row label="Minimum team bid">
                  <select value={s.minTeamBid} onChange={(e) => set('minTeamBid', Number(e.target.value))}>
                    {[0, 2, 4, 5].map((n) => <option key={n} value={n}>{n === 0 ? 'None' : n}</option>)}
                  </select>
                </Row>
              ) : (
                <Row label="Minimum books / bid" hint="Every hand. Hand 1: fewer books is a shot. Nil is off.">
                  <select data-testid="cut-min-bid" value={s.cutMinBid ?? 1} onChange={(e) => set('cutMinBid', Number(e.target.value) as Settings['cutMinBid'])}>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}{n === 1 ? ' (default)' : ''}</option>)}
                  </select>
                </Row>
              )}
              {rules.partnerships && <Row label="Nil allowed"><Toggle value={s.nilAllowed} onChange={(v) => set('nilAllowed', v)} /></Row>}
              {rules.partnerships ? (
                <Row label="Blind Nil">
                  <select value={s.blindNil} onChange={(e) => set('blindNil', e.target.value as Settings['blindNil'])}>
                    <option value="behind100">When behind by 100+</option>
                    <option value="always">Always</option>
                    <option value="off">Off</option>
                  </select>
                </Row>
              ) : null}
              {rules.partnerships && (
                <>
                  <Row label="Blind Nil card exchange"><Toggle value={s.blindNilExchange === 2} onChange={(v) => set('blindNilExchange', v ? 2 : 0)} /></Row>
                  <Row label="Failed-nil tricks help partner" hint="Off: they count as bags"><Toggle value={s.nilTricksCountForPartner} onChange={(v) => set('nilTricksCountForPartner', v)} /></Row>
                </>
              )}
              <Row label="Bags and penalties" hint={s.bagsOn === false ? 'Off: books over your bid score nothing' : undefined}><Toggle label="Bags and penalties" value={s.bagsOn !== false} onChange={(v) => set('bagsOn', v)} /></Row>
              {s.bagsOn !== false && <Row label="Bag penalty">
                <select value={s.bags} onChange={(e) => set('bags', e.target.value as Settings['bags'])}>
                  <option value="10/100">10 bags = −100</option>
                  <option value="10/50">10 bags = −50</option>
                  <option value="5/50">5 bags = −50</option>
                </select>
              </Row>}
              <Row label="10 for 200"><Toggle value={s.tenForTwoHundred} onChange={(v) => set('tenForTwoHundred', v)} /></Row>
            </div>
          )}
          <h3 className="sheet-h">Beta feedback &amp; support</h3>
          <AboutRow onFeedback={() => setFeedback(true)} />
          <button type="button" className="link sheet-h" onClick={() => setCredits(true)}>Credits &amp; licenses</button>
        </div>
      </div>
    </div>
    {credits && <Credits onClose={() => setCredits(false)} />}
    {feedback && <Feedback onClose={() => setFeedback(false)} />}
    </>
  );
}

/** Offline: name your team (team modes). Empty = "You & <partner>". */
function TeamNameRow() {
  const v = useMyTeamName();
  return (
    <div className="sf-row team-row">
      <span>Your team name<small className="sf-note"> · team modes, offline</small></span>
      <TeamNameField value={v} placeholder="You & your partner" onSave={(x) => myTeamName.set(x)} testId="offline-team-name" />
    </div>
  );
}

/** Earned badges (local for now). */
export function BadgesRow() {
  const list = useBadges();
  return (
    <div className="sf-row badges-row" data-testid="badges-row">
      <span>Badges</span>
      <span className="badge-list">
        {list.length === 0 ? <small className="sf-note">None yet. Keep playing.</small> : list.map((b) => {
          const d = BADGES[b.id];
          return <span key={b.id} className="badge-chip" title={`${d?.desc ?? b.id} · ${new Date(b.earnedAt).toLocaleDateString()}`} data-testid={`badge-${b.id}`}>{d?.icon ?? '★'} {d?.name ?? b.id}</span>;
        })}
      </span>
    </div>
  );
}
