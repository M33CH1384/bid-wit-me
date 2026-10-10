declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
declare const __BUILD_DATE__: string;

/** Build stamp (injected by vite.config.ts; falls back in tests). */
export const VERSION = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
  sha: typeof __GIT_SHA__ === 'string' ? __GIT_SHA__ : 'dev',
  date: typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '',
  channel: 'beta',
};
export const versionLine = (v = VERSION) => [`v${v.version} ${v.channel}`, v.sha, v.date].filter(Boolean).join(' · ');
