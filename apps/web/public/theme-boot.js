// Pre-paint theme (served from 'self' so the CSP needs no 'unsafe-inline'; classic, blocking, in <head>): apply the stored theme before first paint so a Neon Royale
// user never flashes Classic. Keep in sync with src/theme.ts (key bwm.theme.v1).
try {
  var t = JSON.parse(localStorage.getItem('bwm.theme.v1') || 'null');
  if (t && t.theme === 'neon') {
    document.documentElement.dataset.theme = 'neon';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#070914');
  }
} catch (e) { /* absent/corrupt → Classic (no attribute) */ }
