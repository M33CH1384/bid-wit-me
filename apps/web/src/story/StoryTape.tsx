/**
 * The story Tale of the Tape — narrative context, not stats (owner,
 * 2026-10-21). Shown as the sit-down's opening frame (before the intro
 * scene) and readable from the map ("Meet them"). Same content in both
 * themes; the stop's backdrop sits under an even scrim so tape → scene →
 * table reads as one continuous arrival.
 *
 * Layout (tape rework, owner 2026-10-21): every detail row is a fixed
 * two-column grid — a small-caps label column and a left-aligned value
 * column — never a flowing paragraph with an inline label. The threat
 * rides the same labeled-row system; the history line is a quiet
 * hairline caption in the story design family.
 */
import { buildStoryTape, type CoopRundown, type StoryBeatFacts, type StoryRundown, type StoryStop, type StoryTapeEntry } from '@spades/bots';
import StoryFace from './StoryFace';
import DeeRundownPanel from './DeeRundown';
import { storyBackdropUrl } from './storyBackdrop';

function TapeRow({ label, children }: { label: string; children: string }) {
  return (
    <p className="story-tape-row">
      <span className="story-tape-label">{label}</span>
      <span className="story-tape-value">{children}</span>
    </p>
  );
}

function TapeSide({ title, entries }: { title: string; entries: StoryTapeEntry[] }) {
  return (
    <div className="story-tape-side">
      <p className="story-tape-side-title">{title}</p>
      {entries.map((e) => (
        <div key={e.id} className="story-tape-entry" data-testid={`story-tape-${e.id}`}>
          <div className="story-tape-head">
            {e.id === 'you'
              ? <span className="story-face tape-face story-you-face" aria-hidden><span className="story-face-initial">{e.name.slice(0, 1)}</span></span>
              : <StoryFace characterId={e.id} name={e.name} className="tape-face" />}
            <div>
              <p className="story-tape-name">{e.name}</p>
              <p className="story-tape-role">{e.role}</p>
            </div>
          </div>
          <div className="story-tape-rows">
            <TapeRow label="Who">{e.who}</TapeRow>
            <TapeRow label="Known for">{e.knownFor}</TapeRow>
            <TapeRow label="The tell">{e.style}</TapeRow>
            <TapeRow label="The bond">{e.bond}</TapeRow>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StoryTape({ stop, facts, cta, onDone, rundown, rundownTrack, rundownAutoplay }: {
  stop: StoryStop;
  facts: StoryBeatFacts;
  cta: string;
  onDone: () => void;
  /** Dee's rundown for this sit-down: the SOLO set on the solo route
   *  (rundownFor, keyed to the player's facts — passed by StoryHome on
   *  both tape arrivals) or the co-op pair set in a story room
   *  (coopRundownFor, co-op spec §5.1). No rundown → no panel. */
  rundown?: CoopRundown | StoryRundown | null;
  rundownTrack?: string;
  /** Sit-down path only: the panel auto-plays once per (stop,
   *  variant). The map's "Meet them" arrival passes false — the
   *  panel opens whole and plays on tap. Default true. */
  rundownAutoplay?: boolean;
}) {
  const tape = buildStoryTape(stop, facts);
  return (
    <div className="story-tape" data-testid="story-tape">
      {stop.venueId && <div className="story-tape-bg" style={{ backgroundImage: `url(${storyBackdropUrl(stop)})` }} aria-hidden />}
      <div className="story-tape-inner">
        <p className="story-tape-title">TALE OF THE TAPE</p>
        <p className="story-tape-stakes" data-testid="story-tape-stakes">{tape.stakes}</p>
        <TapeRow label="The threat">{tape.threat}</TapeRow>
        {tape.terms && <TapeRow label="The terms">{tape.terms}</TapeRow>}
        {tape.history && <p className="story-tape-history" data-testid="story-tape-history">{tape.history}</p>}
        {rundown && <DeeRundownPanel rundown={rundown} track={rundownTrack ?? ''} autoplay={rundownAutoplay ?? true} />}
        <div className="story-tape-cols">
          <TapeSide title="You & Dee" entries={[tape.you, tape.dee]} />
          <TapeSide title="The Table" entries={tape.pair} />
        </div>
        <div className="story-script-actions">
          <span />
          <button type="button" className="btn primary" data-testid="story-tape-done" onClick={onDone}>{cta}</button>
        </div>
      </div>
    </div>
  );
}
