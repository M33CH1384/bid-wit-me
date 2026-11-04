/**
 * Story film — Chapter 1 (the Porch) scene manifest, in-repo mirror.
 *
 * The canonical manifest is ~/workspace/your_files/story-film/
 * MANIFEST-CH1.json (schema bwm.storyFilm/1, Lane A), generated from
 * SCRIPTS-CH1.md / the approved opening-chapter screenplay at master
 * c8fc9aefca09. This module carries the same data in typed form for
 * the selector (storyFilm.ts) and the player (StoryFilmScene.tsx).
 * If the two ever disagree, the canonical manifest wins and this file
 * is regenerated — never the other way around.
 *
 * VERBATIM GUARD (the rundownVideo.ts rule): every line text here is
 * verbatim from SCRIPTS-CH1.md, lineIds preserved. If the scripts are
 * ever rewritten, the affected scene's assetStatus must drop back to
 * 'to-generate' — a stale film never plays against new words.
 *
 * FOOTAGE STATUS: every scene is 'to-generate'. Rendering awaits the
 * owner's spend approval (ComfyUI lane); NO footage files exist, and
 * none are faked. While a scene is 'to-generate' the player presents
 * its poster as a clearly labeled PLACEHOLDER (see StoryFilmScene).
 * When footage lands, the files go to the asset paths below, the
 * scene's status flips to 'ready' here, and the same player plays
 * the real video — no other code changes.
 *
 * HONESTY: branch selection reads the same facts the beat selector
 * reads (StoryBeatFacts + the posted result's gameId). No scene
 * depicts a score, a decisive card, or an outcome the game did not
 * record — the lines below speak no numbers at all.
 */

export type FilmSceneType = 'teaser' | 'pregame' | 'post-win' | 'post-loss' | 'next-match-preview';
export type FilmAssetStatus = 'to-generate' | 'ready';

export interface FilmCue {
  lineId: string;
  /** story character id (STORY_CHARACTERS key) */
  speaker: string;
  text: string;
  cueStart: number;
  cueEnd: number;
}

export interface FilmPictureBeat { at: number; dur: number; note: string }

export interface FilmScene {
  id: string;
  type: FilmSceneType;
  title: string;
  screenplayScene: string;
  durationTargetSeconds: number;
  /** 'track' scenes are once per track (seenKey); 'gameId' scenes are
   *  keyed to the posted result's gameId (offered record). */
  oncePer: 'track' | 'gameId';
  /** the seen-store key for oncePer 'track' scenes (film.ch1.*) */
  seenKey?: string;
  assets: {
    video: string;
    poster: string;
    subtitles: string;
    status: FilmAssetStatus;
  };
  /** where the flow lands when the film cannot play: 'none' = the
   *  surface exactly as shipped without film; 'scriptPlayer' = the
   *  shipped beat scene of the named kind. */
  fallback: { mode: 'none' } | { mode: 'scriptPlayer'; beatsKind: 'intro' | 'outroWin' | 'outroLose' };
  lines: FilmCue[];
  pictureBeats: FilmPictureBeat[];
}

export const STORY_FILM_CHAPTER = {
  chapterId: 'ch1-porch',
  chapterTitle: 'Chapter 1 — The Porch',
  stopId: 'porch',
  nextStopId: 'barbershop',
  assetBase: '/story/film/ch1/',
} as const;

/** Speaker display names for subtitle cues (STORY_CHARACTERS names). */
export const FILM_SPEAKER_NAMES: Record<string, string> = {
  dee: 'Dee',
  uncleRay: 'Uncle Ray',
  pat: 'Pat',
  june: 'June',
};

export const FILM_SCENES: readonly FilmScene[] = [
  {
    id: 'ch1-teaser', type: 'teaser', title: "The Last Name", screenplayScene: 'F-00',
    durationTargetSeconds: 27.5, oncePer: 'track',
    seenKey: 'film.ch1.teaser',
    assets: { video: '/story/film/ch1/ch1-teaser.mp4', poster: '/story/film/ch1/ch1-teaser-poster.webp', subtitles: '/story/film/ch1/ch1-teaser.vtt', status: 'to-generate' },
    fallback: { mode: 'none' },
    lines: [
      { lineId: 'T-D02', speaker: 'dee', text: "Are all the names still at their tables?", cueStart: 3.0, cueEnd: 6.5 },
      { lineId: 'T-R02', speaker: 'uncleRay', text: "Every one — some got older, and none got easier.", cueStart: 6.5, cueEnd: 11.0 },
      { lineId: 'T-D03', speaker: 'dee', text: "And him?", cueStart: 11.0, cueEnd: 12.5 },
      { lineId: 'T-P02', speaker: 'pat', text: "Still keeps his own hours.", cueStart: 12.5, cueEnd: 15.0 },
      { lineId: 'T-R03', speaker: 'uncleRay', text: "Still winning.", cueStart: 15.0, cueEnd: 17.0 },
      { lineId: 'T-D05', speaker: 'dee', text: "I'm not building a bridge. I'm bringing a partner.", cueStart: 20.0, cueEnd: 24.0 },
      { lineId: 'T-R05', speaker: 'uncleRay', text: "Then the day just got honest.", cueStart: 24.0, cueEnd: 27.5 },
    ],
    pictureBeats: [
      { at: 0.0, dur: 3.0, note: "ECU route card; final name illegible by focus" },
      { at: 17.0, dur: 3.0, note: "Silent King-room cutaway; hand sets one card face down; no faces" },
    ],
  },
  {
    id: 'ch1-pregame', type: 'pregame', title: "A Chair Is Not a Seat", screenplayScene: 'P-01',
    durationTargetSeconds: 28.5, oncePer: 'track',
    seenKey: 'film.ch1.pregame',
    assets: { video: '/story/film/ch1/ch1-pregame.mp4', poster: '/story/film/ch1/ch1-pregame-poster.webp', subtitles: '/story/film/ch1/ch1-pregame.vtt', status: 'to-generate' },
    fallback: { mode: 'scriptPlayer', beatsKind: 'intro' },
    lines: [
      { lineId: 'P-P01', speaker: 'pat', text: "Take the far chair, baby. Half the lesson comes up those steps before the cards do.", cueStart: 3.5, cueEnd: 10.0 },
      { lineId: 'P-P03', speaker: 'pat', text: "I remember. You'd whisper the count and pretend you weren't hoping somebody would invite you in.", cueStart: 10.0, cueEnd: 18.0 },
      { lineId: 'P-D03', speaker: 'dee', text: "Did it work?", cueStart: 18.0, cueEnd: 19.5 },
      { lineId: 'P-P04', speaker: 'pat', text: "You're in a chair, aren't you?", cueStart: 19.5, cueEnd: 22.5 },
      { lineId: 'P-R03', speaker: 'uncleRay', text: "Chairs don't make you a player. Staying does.", cueStart: 22.5, cueEnd: 26.0 },
      { lineId: 'P-D05', speaker: 'dee', text: "Ask us after the first hand.", cueStart: 26.0, cueEnd: 28.5 },
    ],
    pictureBeats: [
      { at: 0.0, dur: 3.5, note: "Establishing wide; pair ascend the steps; Dee slows at the rail" },
    ],
  },
  {
    id: 'ch1-postwin', type: 'post-win', title: "In Pencil, In the Book", screenplayScene: 'P-02W',
    durationTargetSeconds: 25.0, oncePer: 'gameId',
    assets: { video: '/story/film/ch1/ch1-postwin.mp4', poster: '/story/film/ch1/ch1-postwin-poster.webp', subtitles: '/story/film/ch1/ch1-postwin.vtt', status: 'to-generate' },
    fallback: { mode: 'scriptPlayer', beatsKind: 'outroWin' },
    lines: [
      { lineId: 'W-D01', speaker: 'dee', text: "Say it again, Miss Pat. Slowly.", cueStart: 0.0, cueEnd: 3.5 },
      { lineId: 'W-P01', speaker: 'pat', text: "I don't repeat results for people who were sitting right here.", cueStart: 3.5, cueEnd: 8.0 },
      { lineId: 'W-R03', speaker: 'uncleRay', text: "You played like you belonged in the chair. Both of you.", cueStart: 11.5, cueEnd: 16.5 },
      { lineId: 'W-D05', speaker: 'dee', text: "I wish he'd seen the end of it.", cueStart: 16.5, cueEnd: 19.5 },
      { lineId: 'W-P04', speaker: 'pat', text: "Coleman's next. He'll smell that confidence before you reach his door.", cueStart: 19.5, cueEnd: 25.0 },
    ],
    pictureBeats: [
      { at: 8.0, dur: 3.5, note: "Insert: pencil marks the route card beside 'Porch'; ledger figures outside the readable plane" },
    ],
  },
  {
    id: 'ch1-postloss', type: 'post-loss', title: "The Chairs Stay Out", screenplayScene: 'P-02L',
    durationTargetSeconds: 26.0, oncePer: 'gameId',
    assets: { video: '/story/film/ch1/ch1-postloss.mp4', poster: '/story/film/ch1/ch1-postloss-poster.webp', subtitles: '/story/film/ch1/ch1-postloss.vtt', status: 'to-generate' },
    fallback: { mode: 'scriptPlayer', beatsKind: 'outroLose' },
    lines: [
      { lineId: 'L-D01', speaker: 'dee', text: "Don't make it gentle.", cueStart: 3.5, cueEnd: 5.5 },
      { lineId: 'L-P01', speaker: 'pat', text: "Ray.", cueStart: 5.5, cueEnd: 7.0 },
      { lineId: 'L-R02', speaker: 'uncleRay', text: "You lost because you started playing the room instead of your partner — not a tragedy, just information.", cueStart: 7.0, cueEnd: 15.5 },
      { lineId: 'L-P04', speaker: 'pat', text: "The book has today's result in it. It also has plenty of blank lines after.", cueStart: 15.5, cueEnd: 22.0 },
      { lineId: 'L-D06', speaker: 'dee', text: "Then we owe the table another try.", cueStart: 22.0, cueEnd: 26.0 },
    ],
    pictureBeats: [
      { at: 0.0, dur: 3.5, note: "Hold on the table; Dee does not look up; Ray does not reach for the cards; the radio clicks off" },
    ],
  },
  {
    id: 'ch1-preview', type: 'next-match-preview', title: "Metal Remembers", screenplayScene: 'B-01',
    durationTargetSeconds: 30.0, oncePer: 'track',
    seenKey: 'film.ch1.preview',
    assets: { video: '/story/film/ch1/ch1-preview.mp4', poster: '/story/film/ch1/ch1-preview-poster.webp', subtitles: '/story/film/ch1/ch1-preview.vtt', status: 'to-generate' },
    fallback: { mode: 'none' },
    lines: [
      { lineId: 'B-R01', speaker: 'uncleRay', text: "Before the street wakes up and improves the story, take this to Coleman.", cueStart: 0.0, cueEnd: 6.5 },
      { lineId: 'B-D01', speaker: 'dee', text: "You owed him money?", cueStart: 6.5, cueEnd: 8.5 },
      { lineId: 'B-R02', speaker: 'uncleRay', text: "Worse. I owed him the last word.", cueStart: 8.5, cueEnd: 11.5 },
      { lineId: 'B-P01', speaker: 'pat', text: "In nineteen eighty-one, that token bought the loser a haircut and the winner the right to stop talking.", cueStart: 11.5, cueEnd: 19.5 },
      { lineId: 'B-J01', speaker: 'june', text: "If that's Ray's token in your hand, wipe your feet twice. Once for the street, once for the history.", cueStart: 23.0, cueEnd: 30.0 },
    ],
    pictureBeats: [
      { at: 19.5, dur: 3.5, note: "The walk, one beat: steps to pavement, Dee's fingers close around the token, the Barbershop storefront fills the frame; Coleman a shape behind glass" },
    ],
  },];

export function filmSceneById(id: string): FilmScene | undefined {
  return FILM_SCENES.find((s) => s.id === id);
}

export function filmSceneByType(type: FilmSceneType): FilmScene | undefined {
  return FILM_SCENES.find((s) => s.type === type);
}
