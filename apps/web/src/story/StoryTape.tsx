/**
 * The story Tale of the Tape — narrative context, not stats (owner,
 * 2026-10-21). Shown as the sit-down's opening frame (before the intro
 * scene) and readable from the map ("Meet them"). Same content in both
 * themes; the scene's venue backdrop and letterbox family carry over so
 * tape → scene → table reads as one continuous arrival.
 */
import { buildStoryTape, type StoryBeatFacts, type StoryStop, type StoryTapeEntry } from '@spades/bots';
import StoryFace from './StoryFace';
import { storyBackdropUrl } from './storyBackdrop';

function TapeSide({ title, entries }: { title: string; entries: StoryTapeEntry[] }) {
  return (
    <div className="story-tape-side">
      <p className="story-tape-side-title">{title}</p>
      {entries.map((e) => (
        <div key={e.id} className="story-tape-entry" data-testid={`story-tape-${e.id}`}>
          <div className="story-tape-head">
            {e.id === 'you'
              ? <span className="story-face tape-face" aria-hidden><span className="story-face-initial">Y</span></span>
              : <StoryFace characterId={e.id} name={e.name} className="tape-face" />}
            <div>
              <p className="story-tape-name">{e.name}</p>
              <p className="story-tape-role">{e.role}</p>
            </div>
          </div>
          <p className="story-tape-row"><span>Who</span>{e.who}</p>
          <p className="story-tape-row"><span>Known for</span>{e.knownFor}</p>
          <p className="story-tape-row"><span>The tell</span>{e.style}</p>
          <p className="story-tape-row"><span>The bond</span>{e.bond}</p>
        </div>
      ))}
    </div>
  );
}

export default function StoryTape({ stop, facts, cta, onDone }: {
  stop: StoryStop;
  facts: StoryBeatFacts;
  cta: string;
  onDone: () => void;
}) {
  const tape = buildStoryTape(stop, facts);
  return (
    <div className="story-tape" data-testid="story-tape">
      {stop.venueId && <div className="story-scene-bg" style={{ backgroundImage: `url(${storyBackdropUrl(stop)})` }} aria-hidden />}
      <div className="story-tape-inner">
        <p className="story-tape-title">TALE OF THE TAPE</p>
        <p className="story-tape-stakes" data-testid="story-tape-stakes">{tape.stakes}</p>
        <p className="story-tape-threat">{tape.threat}</p>
        {tape.history && <p className="story-tape-history" data-testid="story-tape-history">{tape.history}</p>}
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
