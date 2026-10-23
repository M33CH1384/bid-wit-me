import { useEffect } from 'react';
import type { StoryStop } from '@spades/bots';
import { sound } from '../audio';

/**
 * Scene audio (audio-pass contract, 2026-10-21): the stop's venue bed +
 * original score mood start WITH the scene — you hear the place before
 * the first line — via sound.setStoryStop(stop.id) (theme / sparse /
 * danger / king per stop, plus the Rec Center's gym bed), and the story
 * motif stings the scene in. On unmount the stop clears (setStoryStop
 * null + the menu context, which also clears it) so nothing bleeds onto
 * other screens; the table mounts the same venue when play begins.
 *
 * Extracted from StoryHome (Phase 4): the co-op room's tape / scene /
 * finale surfaces mount the same component — enterTable is the voice
 * gate's contract, and a surface that renders story dialogue without it
 * renders that dialogue silent (the solo meet-them bug, 77c6e432).
 */
export function SceneAudio({ stop }: { stop: StoryStop }) {
  useEffect(() => {
    sound.enterContext('game');
    sound.enterTable();
    sound.setStoryStop(stop.id);
    sound.storySting('scene');
    return () => {
      sound.setStoryStop(null);
      sound.leaveTable();
      sound.enterContext('menu');
    };
  }, [stop.id]);
  return null;
}
