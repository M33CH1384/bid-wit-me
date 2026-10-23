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
/** Claim → tornado done. The score screen opens when this elapses (no extra trick hold or toast beat). */
export const RUN_SHOW_MS = RUN_ZOOM_MS + RUN_TORNADO_AFTER_MS + RUN_TORNADO_MS;
/**
 * ☢☢ MEGA run (the claimer ran it with BOTH Jokers — see runPlayout.mega): the detonation's
 * pin-point starts this long after the slam begins, so the white flash lands exactly on the
 * slow-mo cards' impact (the slam's last frames), not after it.
 */
export const RUN_MEGA_DETONATE_MS = 800;
/** Mega: the blast blows the felt clear first; the tornado starts this long after the slam (550 ms later than an ordinary run). */
export const RUN_MEGA_TORNADO_AFTER_MS = RUN_TORNADO_AFTER_MS + 550;
/** Mega: the whole show runs this much longer than an ordinary run's (blast 4.4 s + the delayed tornado). */
export const RUN_MEGA_SHOW_EXTRA_MS = 900;
