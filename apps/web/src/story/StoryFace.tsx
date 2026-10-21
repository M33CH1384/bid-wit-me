/**
 * A story character's portrait (art pass, 2026-10-21): the real portrait
 * from /assets/story/portraits/<id>.webp over the initial medallion. The
 * medallion is the fallback AND the loading state — if the art has not
 * landed (or fails), the initial renders exactly as it always has, with
 * no broken-image icon and no layout shift.
 */
import { useState } from 'react';
import { storyPortraitFor } from '@spades/bots';
import './storyFace.css';

export default function StoryFace({ characterId, name, className = '' }: { characterId: string; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`story-face ${className}`} data-testid={`story-face-${characterId}`} aria-hidden>
      <span className="story-face-initial">{name.slice(0, 1)}</span>
      {!failed && (
        <img
          className="story-face-img"
          src={storyPortraitFor(characterId)}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
