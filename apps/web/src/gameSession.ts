/**
 * The two ways a player leaves an offline game. A game never keeps running behind Home:
 * the Table unmounts (which stops the bot loop, its timers and the scene), and both paths
 * cut game sound.
 *
 * - suspendGame: "Save & quit" today, "Save & go to menu" in the Leave game sheet. The save
 *   (written after every action by Table) stays in storage for Resume. It is paused and silent:
 *   nothing runs it until Resume mounts the Table again.
 * - quitGame: "Leave" today, "Quit game" in the Leave game sheet. The game is gone: the save and
 *   the per-tab refresh marker are deleted and every game sound is cut.
 *
 * A mid-game refresh never goes through either, so it still restores the game (#150).
 */
import { sound } from './audio';
import { offlineTalk } from './offlineTalk';
import { clearGame, markInGame } from './save';

/** The table screen mounted: game sound may play. */
export function enterTable(): void { sound.enterTable(); }

/** Off the table: refuse game sound, cut anything already scheduled, mute bot talk. */
export function silenceGame(): void {
  offlineTalk.sink = null;
  sound.leaveTable();
}

/** Keep the save for Resume; paused and silent until then. */
export function suspendGame(): void {
  silenceGame();
}

/** End the game for good: no save, no refresh marker, no sound. */
export function quitGame(): void {
  clearGame();
  markInGame(false);
  silenceGame();
}
