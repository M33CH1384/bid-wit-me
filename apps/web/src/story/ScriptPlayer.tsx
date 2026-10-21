/**
 * Story script player: one beat at a time — portrait, name, line — tap to
 * advance, skippable at any point. Presentation follows the versus-intro
 * family (a card, a name, a line that lands); the beats themselves are data
 * from @spades/bots (storyScripts.ts), selected by stored facts.
 */
import { useState } from 'react';
import { STORY_CHARACTERS, type StoryBeat } from '@spades/bots';

export function speakerName(speaker: string): string {
  if (speaker === 'you') return 'You';
  return STORY_CHARACTERS[speaker]?.name ?? speaker;
}

export function speakerBlurb(speaker: string): string {
  if (speaker === 'you') return 'That\u2019s you. The one running the route.';
  return STORY_CHARACTERS[speaker]?.blurb ?? '';
}

export default function ScriptPlayer({ beats, cta, onDone }: {
  beats: StoryBeat[];
  /** label of the final advance button */
  cta: string;
  onDone: () => void;
}) {
  const [i, setI] = useState(0);
  const beat = beats[Math.min(i, beats.length - 1)];
  if (!beat) { onDone(); return null; }
  const last = i >= beats.length - 1;
  const name = speakerName(beat.speaker);
  return (
    <div className="story-script" data-testid="story-script">
      <div className="story-script-card" onClick={() => { if (!last) setI(i + 1); }} role={last ? undefined : 'button'} aria-label={last ? undefined : 'Next line'}>
        <div className="story-script-face" aria-hidden>{name.slice(0, 1)}</div>
        <div className="story-script-body">
          <p className="story-script-name">{name}</p>
          <p className="story-script-line">{beat.line}</p>
          <p className="story-script-hint">{last ? '' : 'Tap to continue'}</p>
        </div>
      </div>
      <div className="story-script-actions">
        <button type="button" className="btn ghost" data-testid="story-script-skip" onClick={onDone}>Skip</button>
        {last
          ? <button type="button" className="btn primary" data-testid="story-script-done" onClick={onDone}>{cta}</button>
          : <button type="button" className="btn primary" data-testid="story-script-next" onClick={() => setI(i + 1)}>Next</button>}
      </div>
    </div>
  );
}
