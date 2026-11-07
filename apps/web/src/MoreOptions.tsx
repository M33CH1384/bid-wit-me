import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref, useEffect, useRef, useState } from 'react';
import { useEscapeClose } from './useEscapeClose';
import Credits from './Credits';
import Feedback, { AboutRow } from './Feedback';
import { BotTrashTalkRow, ChatSoundsRow, NukeIntensityRow, ReduceEffectsRow, SoundFields, SoundQuickActions } from './SoundControls';
import { MotionViewRow } from './MotionViewRow';
import { EyeZoomRow } from './EyeZoomRow';
import { requestEyeCalibration } from './eyeZoom';
import { SetAnimRow } from './SetAnimPicker';
import ThemeToggle from './ThemeToggle';
import { CLASSIC_JOKER, makeRules } from '@spades/rules';
import { type Settings, settingsToRules, targetScoreOptions } from './settings';
import { SETTINGS_SECTION_ORDER, type SectionOpenMap, type SettingsSectionId, loadSectionOpen, saveSectionOpen } from './settingsSections';
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

/** The landscape rail layout's media query — MUST match the .set-rail /
 *  .rail-active block in styles.css exactly. It is the one signal the JS
 *  side reads to know which presentation is on screen, so every ARIA
 *  state below is derived from the SAME presentation the player sees
 *  (responsive audit 2026-11-05, Finding C: landscape CSS force-showed
 *  the rail-selected section while aria-hidden still followed the
 *  portrait accordion map — visible sections were hidden from AT and
 *  focusable inside an aria-hidden subtree). */
export const SETTINGS_RAIL_QUERY = '(orientation: landscape) and (max-height: 540px), (orientation: landscape) and (min-width: 1000px)';

function useRailLayout(): boolean {
  const read = () => {
    try {
      return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(SETTINGS_RAIL_QUERY).matches
        : false;
    } catch { return false; }
  };
  const [rail, setRail] = useState<boolean>(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(SETTINGS_RAIL_QUERY);
    const onChange = () => setRail(mq.matches);
    onChange();
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    return () => { if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange); };
  }, []);
  return rail;
}

/** One collapsible group card in the Settings sheet (owner, 2026-10-23):
 *  the header is a toggle (chevron affordance, aria-expanded); the body
 *  stays MOUNTED and folds on the .set-group-body height track, so folding
 *  never unmounts a control or loses its state — presentation only.
 *
 *  `open` is the EFFECTIVE-open value for the layout on screen (the
 *  caller derives it from the one activeSection + the stored map, see
 *  MoreOptions): it drives the fold class, aria-expanded, aria-hidden
 *  AND inert from a single value, so a body that is rendered visible is
 *  always the body that is exposed and focusable, and a hidden body is
 *  unfocusable in both orientations. In rail layout the body is also
 *  the rail tab's tabpanel (id + role + aria-labelledby complete the
 *  tab pattern); in portrait it carries no panel role — the accordion
 *  header above it is its semantics there. */
export function SectionGroup({ label, open, onToggle, groupRef, testId, children, railActive, sectionId, railLayout }: {
  label: string; open: boolean; onToggle: () => void;
  groupRef?: Ref<HTMLElement>; testId?: string; children: ReactNode;
  /** S2 landscape tab rail: this group is the rail's selected tab (CSS shows only it, unfolded). */
  railActive?: boolean;
  /** Stable section id: wires the rail tab (aria-controls) to this body (tabpanel). */
  sectionId?: SettingsSectionId;
  /** True when the landscape rail layout is the presentation on screen. */
  railLayout?: boolean;
}) {
  return (
    <section className={`set-group${railActive ? ' rail-active' : ''}`} aria-label={label} ref={groupRef} data-testid={testId}>
      <h3 className="sheet-h">
        <button type="button" className="set-group-toggle" aria-expanded={open} onClick={onToggle}>
          <span>{label}</span>
          <span className={`set-chev ${open ? 'open' : ''}`} aria-hidden>▾</span>
        </button>
      </h3>
      <div
        className={`set-group-body ${open ? 'open' : ''}`}
        id={sectionId ? `settings-panel-${sectionId}` : undefined}
        role={railLayout && sectionId ? 'tabpanel' : undefined}
        aria-labelledby={railLayout && sectionId ? `settings-tab-${sectionId}` : undefined}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="set-group-inner">{children}</div>
      </div>
    </section>
  );
}

const RAIL_TABS: [SettingsSectionId, string][] = [['house', 'House rules'], ['play', 'Play'], ['sound', 'Sound & music'], ['look', 'Look & effects'], ['beta', 'Feedback']];

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
  // Section arrangement: the player's stored map (persisted per device).
  const [openMap, setOpenMap] = useState<SectionOpenMap>(() => loadSectionOpen());
  // ONE session active section (responsive audit 2026-11-05, Findings C+D).
  // Before this, the sheet kept three unsynchronised stores — the persisted
  // accordion map, a session landscape tab, and the speaker's forced
  // section — and rotation silently changed which one the layout read, so
  // the visible section changed under the player. Now:
  //   activeSection — where the player IS this open. Initialised from a
  //     targeted entry (the speaker's sound landing, whose "forced open,
  //     never stored" semantics it generalises), else the first stored-open
  //     section, else null (nothing session-presented). Set by rail clicks,
  //     by accordion opens, and by the speaker landing — and by NOTHING
  //     else. It is never persisted: bwm.settingsSections.v1 keeps its
  //     exact shape and is written only by explicit accordion toggles.
  //   presentedOpen(id) — portrait presentation: the stored arrangement,
  //     plus the active section presented open (the old `forced` read,
  //     generalised from 'sound'-only to whichever section is active).
  //   effectiveOpen(id) — the single value SectionGroup consumes: in rail
  //     layout it is "is the selected tab"; in portrait, presentedOpen.
  const [activeSection, setActiveSection] = useState<SettingsSectionId | null>(() => (
    initialSection === 'sound' ? 'sound' : (SETTINGS_SECTION_ORDER.find((id) => openMap[id]) ?? null)
  ));
  useEffect(() => {
    if (initialSection === 'sound') setActiveSection('sound');
  }, [initialSection, anchorSeq]);
  const railLayout = useRailLayout();
  /** The tab the rail shows: the active section, or House (the rail's
   *  long-standing default landing) when nothing is session-active. */
  const railSelected: SettingsSectionId = activeSection ?? 'house';
  const presentedOpen = (id: SettingsSectionId) => activeSection === id || openMap[id];
  const effectiveOpen = (id: SettingsSectionId) => (railLayout ? railSelected === id : presentedOpen(id));
  const toggleSection = (id: SettingsSectionId) => {
    const wasOpen = presentedOpen(id);
    const next: SectionOpenMap = { ...openMap, [id]: !wasOpen };
    setOpenMap(next);
    saveSectionOpen(next);
    if (!wasOpen) setActiveSection(id);
    else if (activeSection === id) {
      // Takeover semantics (the old forced-toggle rule, generalised):
      // deliberately folding the active section persists the fold and
      // hands active to the next stored-open section, if any.
      setActiveSection(SETTINGS_SECTION_ORDER.find((x) => next[x]) ?? null);
    }
  };
  /** Rail navigation: moves the active section ONLY — never the stored map. */
  const selectSection = (id: SettingsSectionId) => setActiveSection(id);
  /** Complete tab pattern: arrows cycle, Home/End jump; selection follows focus. */
  const onRailKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const len = RAIL_TABS.length;
    const cur = Math.max(0, RAIL_TABS.findIndex(([id]) => id === railSelected));
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (cur + 1) % len;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (cur - 1 + len) % len;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = len - 1;
    if (next === null) return;
    e.preventDefault();
    const id = RAIL_TABS[next]![0];
    setActiveSection(id);
    e.currentTarget.querySelector<HTMLElement>(`[data-testid="settings-tab-${id}"]`)?.focus();
  };
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });
  const rules = settingsToRules(s);
  const isJokerDeck = rules.deck === 'joker54';
  const esc = useEscapeClose(onClose);
  const soundGroupRef = useRef<HTMLElement>(null);
  // Dialog focus lifecycle (Finding C): the sheet is modal (aria-modal
  // below), so on open focus moves INTO it, and on close it returns to
  // the control that opened it (the gear / the speaker), captured here
  // before the move. No other sheet in the app traps focus, so this
  // follows the house pattern — initial focus + restoration only; a
  // focus trap is a flagged follow-up, not invented here.
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const invoker = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    sheetRef.current?.focus({ preventScroll: true });
    return () => { if (invoker && invoker.isConnected) invoker.focus({ preventScroll: true }); };
  }, []);
  // The Music switch must never sit clipped at the sheet body's bottom fold.
  // Owner report (2026-10-31): "Music settings button doesn't work when I'm in
  // landscape." The landing below pins the group's top to the scrollport's top;
  // the Music switch sits a fixed ~308px under the group top, and a landscape
  // phone's scrollport is only ~280–320px tall, so the switch lands exactly on
  // the fold — at 932×430 its centre is 1px past the clip (the visible sliver
  // invites a tap that lands on the sheet itself), at 844×390 it falls below
  // the viewport entirely. Portrait's tall scrollport never clips it. So after
  // any landing on this group, if the switch's bottom is past the fold (and
  // the switch itself is below the fold's top — a player who scrolled deeper
  // is left alone), scroll the body the minimum that puts it fully in view.
  const revealMusicSwitch = () => {
    const el = soundGroupRef.current;
    if (!el) return;
    const body = el.closest('.sheet-body');
    const sw = el.querySelector<HTMLElement>('[data-testid="music-switch"]');
    if (!body || !sw) return;
    const br = body.getBoundingClientRect();
    const sr = sw.getBoundingClientRect();
    if (sr.bottom > br.bottom && sr.top > br.top) body.scrollTop += sr.bottom - br.bottom + 2;
  };
  // The speaker's landing: scroll the Sound & music group to the top of the sheet body.
  useEffect(() => {
    if (initialSection !== 'sound') return;
    const el = soundGroupRef.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
    revealMusicSwitch();
  }, [initialSection, anchorSeq]);
  // The same fold clip waits on the gear path: open Settings, tap the
  // Sound & music rail tab in landscape — same reveal.
  useEffect(() => { if (activeSection === 'sound') revealMusicSwitch(); }, [activeSection]);
  return (
    <>
    <div className="modal-backdrop sheet-backdrop" ref={esc} onClick={onClose}>
      <div className="sheet glass slant" role="dialog" aria-modal="true" aria-label="Settings" ref={sheetRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} data-testid="more-options">
        <header className="sheet-head">
          <span className="panel-title">SETTINGS</span>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>✕</button>
        </header>
        <nav className="set-rail" role="tablist" aria-label="Settings sections" data-testid="settings-rail" onKeyDown={onRailKeyDown}>
          {RAIL_TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" id={`settings-tab-${id}`} aria-controls={`settings-panel-${id}`} aria-selected={railSelected === id} tabIndex={railSelected === id ? 0 : -1} className={railSelected === id ? 'on' : ''} data-testid={`settings-tab-${id}`} onClick={() => selectSection(id)}>{label}</button>
          ))}
        </nav>
        <div className="scroll sheet-body">
          <SectionGroup railActive={railSelected === 'house'} sectionId="house" railLayout={railLayout} label="House rules" open={effectiveOpen('house')} onToggle={() => toggleSection('house')}>
              <Row label="Target score" hint={`First to ${rules.targetScore} takes the game`}>
                <Seg label="Target score" value={s.targetScore} options={targetScoreOptions(s)} onChange={(v) => set('targetScore', v)} />
              </Row>
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
          <SectionGroup railActive={railSelected === 'play'} sectionId="play" railLayout={railLayout} label="Play" open={effectiveOpen('play')} onToggle={() => toggleSection('play')}>
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
          <SectionGroup railActive={railSelected === 'sound'} sectionId="sound" railLayout={railLayout} label="Sound & music" open={effectiveOpen('sound')} onToggle={() => toggleSection('sound')} groupRef={soundGroupRef} testId="settings-sound-group">
          <SoundQuickActions />
          <SoundFields />
          <ChatSoundsRow />
          <BotTrashTalkRow />
          </SectionGroup>
          <SectionGroup railActive={railSelected === 'look'} sectionId="look" railLayout={railLayout} label="Look & effects" open={effectiveOpen('look')} onToggle={() => toggleSection('look')}>
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
          <MotionViewRow value={s.motionView === true} onChange={(v) => set('motionView', v)} />
          <EyeZoomRow value={s.eyeZoom === true} calibrated={!!s.eyeZoomCal} onChange={(v) => set('eyeZoom', v)} onCalibrate={() => requestEyeCalibration()} />
          <ReduceEffectsRow />
          <NukeIntensityRow />
          <SetAnimRow value={s.setAnim ?? 'auto'} onChange={(v) => set('setAnim', v)} />
          </SectionGroup>
          <SectionGroup railActive={railSelected === 'beta'} sectionId="beta" railLayout={railLayout} label="Beta feedback & support" open={effectiveOpen('beta')} onToggle={() => toggleSection('beta')}>
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
