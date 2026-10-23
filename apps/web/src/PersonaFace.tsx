/**
 * A regular-table bot's persona portrait (owner, 2026-10-23: "give them
 * faces"): the persona × gender portrait from
 * /assets/personas/portraits/<persona>-<g>.webp, resolved from the bot's
 * name by the same persona / gender resolution its voice and plate tag use
 * (personaPortraitFor in @spades/bots) — so the face a player sees is the
 * voice they hear. Mirrors StoryFace exactly: the initial medallion is the
 * fallback AND the loading state, so if the art has not landed (or fails)
 * the initial renders exactly as it always has, with no broken-image icon
 * and no layout shift. `onError` lets a surface with a richer fallback
 * (the loading hold's nameplate) swap over when the art fails.
 */
import { useState } from 'react';
import { personaForName, personaPortraitFor, voiceGender } from '@spades/bots';
import './story/storyFace.css';

export default function PersonaFace({ name, className = '', onError }: {
  name: string;
  className?: string;
  onError?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const key = `${personaForName(name)}-${voiceGender(name)}`;
  return (
    <span className={`story-face persona-face ${className}`} data-testid={`persona-face-${key}`} aria-hidden>
      <span className="story-face-initial">{name.slice(0, 1)}</span>
      {!failed && (
        <img
          className="story-face-img"
          src={personaPortraitFor(name)}
          alt=""
          draggable={false}
          onError={() => { setFailed(true); onError?.(); }}
        />
      )}
    </span>
  );
}
