import { type ReactNode, useState } from 'react';
import Credits from './Credits';
import { ReduceEffectsRow, SoundFields } from './SoundControls';
import { type Settings, settingsToRules } from './settings';
import { type TipsPref, saveTips } from './tips';

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
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>
      ))}
    </span>
  );
}

/** Every less-common option lives here (one gear sheet): game speed, graphics, tips, sound + music, house rules, credits. */
export default function MoreOptions({ settings: s, onChange, tips, onTips, onClose }: {
  settings: Settings; onChange: (s: Settings) => void; tips: TipsPref; onTips: (t: TipsPref) => void; onClose: () => void;
}) {
  const [house, setHouse] = useState(false);
  const [credits, setCredits] = useState(false);
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
          <Row label="Graphics" hint="Low saves battery">
            <Seg label="Graphics" value={s.quality} options={[['high', 'High'], ['low', 'Low']]} onChange={(v) => set('quality', v)} />
          </Row>
          <h3 className="sheet-h">Sound &amp; music</h3>
          <SoundFields />
          <ReduceEffectsRow />
          <button type="button" className="link sheet-h" aria-expanded={house} onClick={() => setHouse(!house)}>{house ? '▾' : '▸'} House rules</button>
          {house && (
            <div className="house">
              <Row label="First hand: books bid themselves" hint="No bidding in hand 1 · 10 points per book">
                <Toggle label="First hand: books bid themselves" value={s.firstHandBidsItself !== false} onChange={(v) => set('firstHandBidsItself', v)} />
              </Row>
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
              <Row label={rules.partnerships ? 'Minimum team bid' : 'Minimum bid'}>
                <select value={s.minTeamBid} onChange={(e) => set('minTeamBid', Number(e.target.value))}>
                  {[0, 2, 4, 5].map((n) => <option key={n} value={n}>{n === 0 ? 'None' : n}</option>)}
                </select>
              </Row>
              <Row label="Nil allowed"><Toggle value={s.nilAllowed} onChange={(v) => set('nilAllowed', v)} /></Row>
              <Row label="Blind Nil">
                <select value={s.blindNil} onChange={(e) => set('blindNil', e.target.value as Settings['blindNil'])}>
                  <option value="behind100">When behind by 100+</option>
                  <option value="always">Always</option>
                  <option value="off">Off</option>
                </select>
              </Row>
              {rules.partnerships && (
                <>
                  <Row label="Blind Nil card exchange"><Toggle value={s.blindNilExchange === 2} onChange={(v) => set('blindNilExchange', v ? 2 : 0)} /></Row>
                  <Row label="Failed-nil tricks help partner" hint="Off: they count as bags"><Toggle value={s.nilTricksCountForPartner} onChange={(v) => set('nilTricksCountForPartner', v)} /></Row>
                </>
              )}
              <Row label="Bag penalty">
                <select value={s.bags} onChange={(e) => set('bags', e.target.value as Settings['bags'])}>
                  <option value="10/100">10 bags = −100</option>
                  <option value="10/50">10 bags = −50</option>
                  <option value="5/50">5 bags = −50</option>
                </select>
              </Row>
              <Row label="10 for 200"><Toggle value={s.tenForTwoHundred} onChange={(v) => set('tenForTwoHundred', v)} /></Row>
            </div>
          )}
          <button type="button" className="link sheet-h" onClick={() => setCredits(true)}>Credits &amp; licenses</button>
        </div>
      </div>
    </div>
    {credits && <Credits onClose={() => setCredits(false)} />}
    </>
  );
}
