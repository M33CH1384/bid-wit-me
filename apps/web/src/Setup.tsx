import Credits from './Credits';
import { SoundFields } from './SoundControls';
import { type ReactNode, useState } from 'react';
import { cardLabel, trumpOrder } from '@spades/rules';
import { type ModeKey, type Settings, MODES, settingsToRules } from './settings';
import { navigate } from './online/nav';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onStart: () => void;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="row">
      <span className="row-label">{label}{hint && <small>{hint}</small>}</span>
      <span className="row-control">{children}</span>
    </label>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={`toggle ${value ? 'on' : ''}`} aria-pressed={value} onClick={() => onChange(!value)}>
      <span />
    </button>
  );
}

export default function Setup({ settings: s, onChange, onStart }: Props) {
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });
  const rules = settingsToRules(s);
  const isJokerDeck = rules.deck === 'joker54';
  const order = trumpOrder(rules).slice(0, 5).map((c) => (c === 'BJ' ? 'Big 🃏' : c === 'LJ' ? 'Little 🃏' : cardLabel(c)));

  return (
    <div className="setup">
      <header className="setup-hero">
        <img className="logo" src="/assets/bwm-wordmark-white.svg" alt="" />
        <h1 className="sr-only">Bid Wit Me</h1>
        <p className="tagline">Spades · Joker · Cutthroat · Ace Down</p>
        <p>Pick a mode, then play against bots or online with friends.</p>
      </header>

      <section className="modes">
        {MODES.map((m) => (
          <button key={m.key} type="button" className={`mode ${s.mode === m.key ? 'selected' : ''}`} onClick={() => set('mode', m.key as ModeKey)}>
            <span className="mode-title">{m.title}</span>
            <span className="mode-players">{m.players}</span>
            <span className="mode-blurb">{m.blurb}</span>
          </button>
        ))}
      </section>

      <div className="summary">
        <span>Trumps: {order.join(' › ')} …</span>
        <span>Target {rules.targetScore}{rules.losingFloor !== null ? ` · floor ${rules.losingFloor}` : ''}</span>
      </div>

      <section className="panel">
        {s.mode.startsWith('cutthroat') && (
          <div className="row deck-choice">
            <span className="row-label">Deck<small>{s.cutthroatDeck === 'joker54' ? 'Jokers + 2♦ are trumps' : 'No jokers, A♠ is the top trump'}</small></span>
            <span className="seg" role="radiogroup" aria-label="Deck">
              {(['joker54', 'standard52'] as const).map((d) => (
                <button key={d} type="button" role="radio" aria-checked={s.cutthroatDeck === d} className={s.cutthroatDeck === d ? 'on' : ''} onClick={() => set('cutthroatDeck', d)}>
                  {d === 'joker54' ? 'Joker' : 'Standard 52'}
                </button>
              ))}
            </span>
          </div>
        )}
        <Row label="Bots">
          <select value={s.botLevel} onChange={(e) => set('botLevel', e.target.value as Settings['botLevel'])}>
            <option value="easy">Easy</option>
            <option value="normal">Normal</option>
          </select>
        </Row>
        <Row label="Graphics" hint="Low: no shadows/HDRI, smaller textures">
          <select value={s.quality} onChange={(e) => set('quality', e.target.value as Settings['quality'])}>
            <option value="high">High</option>
            <option value="low">Low (battery saver)</option>
          </select>
        </Row>
        <Row label="Game speed">
          <select value={s.speed} onChange={(e) => set('speed', e.target.value as Settings['speed'])}>
            <option value="relaxed">Relaxed</option>
            <option value="normal">Normal</option>
            <option value="fast">Fast</option>
          </select>
        </Row>
        <SoundFields />
        <button type="button" className="link" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} House rules</button>
        {open && (
          <div className="house">
            <Row label="Target score">
              <select value={String(s.targetScore)} onChange={(e) => set('targetScore', e.target.value === 'default' ? 'default' : Number(e.target.value))}>
                <option value="default">Default ({s.mode.startsWith('cutthroat') ? 300 : 500})</option>
                <option value="250">250</option>
                <option value="300">300</option>
                <option value="500">500</option>
              </select>
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
      </section>

      <button type="button" className="primary big" onClick={onStart}>Play vs bots</button>
      <button type="button" className="primary big online-cta" style={{ marginTop: 10 }} data-testid="play-online" onClick={() => navigate('/online')}>Play online</button>
      <button type="button" className="link credits-link" onClick={() => setCredits(true)}>Credits &amp; licenses</button>
      {credits && <Credits onClose={() => setCredits(false)} />}
    </div>
  );
}
