/** 'Run it!' callouts a HUMAN claimer says (bots say their persona's own runIt line). All Family Friendly. */
export const RUN_IT_CALLOUTS: readonly string[] = [
  "Lay 'em down. These are ALL mine.",
  "Read 'em and weep.",
  "Y'all can put your cards away.",
  'Every last book. Count it.',
  "Game's over, I'm just making it official.",
  "Don't bother. I got the rest.",
  'Run it! Take notes.',
  "That's the whole hand, baby.",
  "No need to play it out. I'm that good.",
  'Clean sweep. Pass the broom.',
];
/** timeline (ms from the claim): big face-up zoom with the line, then the slam, the cascade, the tornado */
export const RUN_ZOOM_MS = 1500;
/** the claimer's cards drop to the table in slow motion: this long until the impact */
export const RUN_SLAM_MS = 1100;
export const RUN_CASCADE_MS = 380;
export const RUN_TORNADO_AFTER_MS = 1100 + 650; // slow-mo slam, a beat of pain, then the tornado
export const RUN_TORNADO_MS = 2100;
