import { useState } from 'react';
import { SET_ANIMS, setAnimForStop, setAnimUnlockLine, setAnimUnlocked } from './setAnims';
import { useClearedStoryStops } from './storyDecks';

/**
 * The set-animation picker (Settings → Look & effects). Deck-picker pattern:
 * the full roster is visible, locked rows are grayed with 🔒 + their
 * "Clear <stop> in Story Mode" line, and only earned animations can be
 * equipped. "Match the room" (auto) is the default: at a venue with a
 * matching earned animation, that one plays; otherwise nothing does —
 * there is no free default set animation (owner, 2026-10-21).
 */
export function SetAnimPicker({ value, onChange, cleared }: {
  value: string;
  onChange: (v: string) => void;
  cleared: ReadonlySet<string> | null;
}) {
  return (
    <div className="setanim-list" role="radiogroup" aria-label="Set animation" data-testid="setanim-picker">
      <button
        type="button" role="radio" aria-checked={value === 'auto'}
        className={`setanim-opt ${value === 'auto' ? 'on' : ''}`}
        data-testid="setanim-opt-auto"
        onClick={() => onChange('auto')}
      >
        <span className="setanim-name">Match the room</span>
        <small>Play the venue's own set animation where you've earned it</small>
      </button>
      {SET_ANIMS.map((def) => {
        const unlocked = setAnimUnlocked(def, cleared);
        return (
          <button
            key={def.stopId}
            type="button" role="radio" aria-checked={value === def.stopId}
            disabled={!unlocked}
            className={`setanim-opt ${value === def.stopId ? 'on' : ''} ${unlocked ? '' : 'locked'}`}
            data-testid={`setanim-opt-${def.stopId}`}
            aria-label={unlocked ? `${def.name} — ${def.stopName}` : `${def.name} — locked. ${setAnimUnlockLine(def)}`}
            onClick={() => { if (unlocked) onChange(def.stopId); }}
          >
            <span className="setanim-name">{unlocked ? '' : '🔒 '}{def.name} <i>· {def.stopName}</i></span>
            <small>{unlocked ? def.blurb : setAnimUnlockLine(def)}</small>
          </button>
        );
      })}
    </div>
  );
}

/** The Settings row: a gold-tab expand (the House-rules pattern) over the picker. */
export function SetAnimRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const { cleared } = useClearedStoryStops();
  const equipped = value === 'auto' ? null : setAnimForStop(value);
  return (
    <>
      <button type="button" className="link sheet-h gold-tab-row" aria-expanded={open} data-testid="setanim-row" onClick={() => setOpen(!open)}>
        Set animation <span className="value-chip">{equipped ? equipped.name : 'Match the room'}</span>
      </button>
      {open && <SetAnimPicker value={value} onChange={onChange} cleared={cleared} />}
    </>
  );
}
