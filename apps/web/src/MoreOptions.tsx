import { type ReactNode, type Ref, useEffect, useRef, useState } from 'react';
import { useEscapeClose } from './useEscapeClose';
import Credits from './Credits';
import Feedback, { AboutRow } from './Feedback';
import { BotTrashTalkRow, ChatSoundsRow, NukeIntensityRow, ReduceEffectsRow, SoundFields, SoundQuickActions } from './SoundControls';
import { SetAnimRow } from './SetAnimPicker';
import ThemeToggle from './ThemeToggle';
import { CLASSIC_JOKER, makeRules } from '@spades/rules';
import { type Settings, settingsToRules } from './settings';
import { type SectionOpenMap, type SettingsSectionId, loadSectionOpen, saveSectionOpen } from './settingsSections';
import { TRUMP_SEP, trumpLadder, trumpLadderText } from './trumpLadder';
import { type TipsPref, saveTips } from './tips';
import { VENUE_DEFS, type VenueChoice } from './venues';
import { VenueSelect } from './VenueSelect';

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

/** One collapsible group card in the Settings sheet (owner, 2026-10-23):
 *  the header is a toggle (chevron affordance, aria-expanded); the body
 *  stays MOUNTED and folds on the .set-group-body height track, so folding
 *  never unmounts a control or loses its state — presentation only. */
export function SectionGroup({ label, open, onToggle, groupRef, testId, children }: {
  label: string; open: boolean; onToggle: () => void;
  groupRef?: Ref<HTMLElement>; testId?: string; children: ReactNode;
}) {
  return (
    <section className="set-group" aria-label={label} ref={groupRef} data-testid={testId}>
      <h3 className="sheet-h">
        <button type="button" className="set-group-toggle" aria-expanded={open} onClick={onToggle}>
          <span>{label}</span>
          <span className={`set-chev ${open ? 'open' : ''}`} aria-hidden>▾</span>
        </button>
      </h3>
      <div className={`set-group-body ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="set-group-inner">{children}</div>
      </div>
    </section>
  );
}

export const TALK_HINT: Record<Settings['talkIntensity'], string> = {
  family: 'Family Friendly: clean, light jokes only',
  cookout: 'Cookout: real table talk, nothing too personal (default)',
  nomercy: 'No Mercy: the full roast',
};

/** Every less-common option lives here — THE one settings sheet (owner, 2026-10-20):
 *  game speed, graphics, tips, sound + music, house rules, credits. The old separate
 *  speaker Sound sheet is retired; the speaker button opens THIS sheet, landed on the
 *  Sound & music group via initialSection="sound" (see settingsSheet.ts).
 *
 *  Sections are collapsible and House rules leads (owner, 2026-10-23): the
 *  house-rules group — formerly a Show/Hide disclosure buried in a "You"
 *  group that held nothing else — is now the first group, open by default;
 *  every group's arrangement persists per device (settingsSections.ts). A
 *  targeted entry (initialSection) forces its group open for that open only
 *  and never rewrites the stored arrangement. */
export default function MoreOptions({ settings: s, onChange, tips, onTips, onClose, initialSection, anchorSeq }: {
  settings: Settings; onChange: (s: Settings) => void; tips: TipsPref; onTips: (t: TipsPref) => void; onClose: () => void;
  /** Open landed on a group instead of the top (the speaker's sound landing). */
  initialSection?: 'sound';
  /** Bumped per open request so a repeat request while open re-lands the anchor. */
  anchorSeq?: number;
}) {
  const [credits, setCredits] = useState(false);
  const [feedback, setFeedback] = useState(false);
  // Section arrangement: the player's stored map (persisted per device),
  // plus a per-open forced section from a targeted entry (speaker → sound).
  const [openMap, setOpenMap] = useState<SectionOpenMap>(() => loadSectionOpen());
  const [forced, setForced] = useState<SettingsSectionId | null>(() => (initialSection === 'sound' ? 'sound' : null));
  useEffect(() => {
    if (initialSection === 'sound') setForced('sound');
  }, [initialSection, anchorSeq]);
  const isOpen = (id: SettingsSectionId) => forced === id || openMap[id];
  const toggleSection = (id: SettingsSectionId) => {
    const next: SectionOpenMap = { ...openMap, [id]: !isOpen(id) };
    setOpenMap(next);
    saveSectionOpen(next);
    if (forced === id) setForced(null);
  };
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });
  const rules = settingsToRules(s);
  const isJokerDeck = rules.deck === 'joker54';
  const esc = useEscapeClose(onClose);
  const soundGroupRef = useRef<HTMLElement>(null);
  // The speaker's landing: scroll the Sound & music group to the top of the sheet body.
  useEffect(() => {
    if (initialSection !== 'sound') return;
    const el = soundGroupRef.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  }, [initialSection, anchorSeq]);
  return (
    <>
    <div className="modal-backdrop sheet-backdrop" ref={esc} onClick={onClose}>
      <div className="sheet glass slant" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()} data-testid="more-options">
        <header className="sheet-head">
          <span className="panel-title">SETTINGS</span>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>CLOSE</button>
        </header>
        <div className="scroll sheet-body">
          <SectionGroup label="House rules" open={isOpen('house')} onToggle={() => toggleSection('house')}>
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
                    <option value="house">{trumpLadderText(makeRules('joker'), 5, 'short')}</option>
                    <option value="classic">{trumpLadder(makeRules('joker', { ...CLASSIC_JOKER }), 3, 'short').join(TRUMP_SEP)} … 2♠</option>
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
          </SectionGroup>
          <SectionGroup label="Play" open={isOpen('play')} onToggle={() => toggleSection('play')}>
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
          </SectionGroup>
          <SectionGroup label="Sound & music" open={isOpen('sound')} onToggle={() => toggleSection('sound')} groupRef={soundGroupRef} testId="settings-sound-group">
          <SoundQuickActions />
          <SoundFields />
          <ChatSoundsRow />
          <BotTrashTalkRow />
          </SectionGroup>
          <SectionGroup label="Look & effects" open={isOpen('look')} onToggle={() => toggleSection('look')}>
          <Row label="Appearance" hint="Neon Royale is the midnight-navy theme">
            <ThemeToggle />
          </Row>
          <Row label="Venue" hint={s.venue === 'random' ? 'A different spot every game' : VENUE_DEFS[s.venue ?? 'classic'].blurb}>
            <VenueSelect value={s.venue ?? 'classic'} onChange={(v) => set('venue', v)} testId="venue-select" />
          </Row>
          <Row label="Graphics" hint="Low saves battery">
            <Seg label="Graphics" value={s.quality} options={[['high', 'High'], ['low', 'Low']]} onChange={(v) => set('quality', v)} />
          </Row>
          <Row label="Turn up (slam mode)" hint="On: Standing plays slam hard. Off (default): Standing plays are gentle. Sitting's V-gesture slam always works.">
            <Toggle label="Turn up (slam mode)" value={s.turnUp === true} onChange={(v) => set('turnUp', v)} />
          </Row>
          <ReduceEffectsRow />
          <NukeIntensityRow />
          <SetAnimRow value={s.setAnim ?? 'auto'} onChange={(v) => set('setAnim', v)} />
          </SectionGroup>
          <SectionGroup label="Beta feedback & support" open={isOpen('beta')} onToggle={() => toggleSection('beta')}>
          <AboutRow onFeedback={() => setFeedback(true)} />
          <button type="button" className="link sheet-h gold-tab-row" onClick={() => setCredits(true)}>Credits &amp; licenses</button>
          </SectionGroup>
        </div>
      </div>
    </div>
    {credits && <Credits onClose={() => setCredits(false)} />}
    {feedback && <Feedback onClose={() => setFeedback(false)} />}
    </>
  );
}
