/**
 * Renders the candidate "cut" sounds offline in Chrome (OfflineAudioContext), scores them and writes WAVs.
 * Criteria: crisp (attack < 5 ms), punchy (low-end share), not harsh (little energy > 6 kHz), short (< 0.4 s to -40 dB).
 * Usage: node scripts/sound-lab/cut-candidates.mjs
 */
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage();
const res = await p.evaluate(async () => {
  const SR = 44100, DUR = 0.6;
  const noise = (c, d) => { const bf = c.createBuffer(1, Math.ceil(SR * d), SR); const x = bf.getChannelData(0); for (let i = 0; i < x.length; i++) x[i] = Math.random() * 2 - 1; return bf; };
  const tone = (c, out, t, f, dur, type, gain, o = {}) => { const os = c.createOscillator(); os.type = type; os.frequency.setValueAtTime(f, t); if (o.glideTo) os.frequency.exponentialRampToValueAtTime(o.glideTo, t + dur); const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + (o.attack ?? 0.003)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); let n = os; if (o.filter) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.filter; os.connect(fl); n = fl; } n.connect(g).connect(out); os.start(t); os.stop(t + dur + 0.02); };
  const burst = (c, out, t, dur, gain, type, freq, o = {}) => { const s = c.createBufferSource(); s.buffer = noise(c, dur + 0.02); const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (o.q) f.Q.value = o.q; if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + dur); const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + dur + 0.02); };
  const shing = (c, out, t, g, k = 1, len = 0.32) => {
    burst(c, out, t, 0.06, 0.35 * g, 'bandpass', 1500 * k, { q: 1.4, sweepTo: 6000 * k });
    [[2093, 0.16], [3136 * 1.01, 0.11], [4699, 0.07], [5587, 0.04]].forEach(([f, a], i) => tone(c, out, t + 0.012, f * k, len * (1 - i * 0.15), 'sine', a * g, { glideTo: f * k * 0.97, attack: 0.002 }));
  };
  const C = {
    A_blade: (c, o) => { shing(c, o, 0, 1); tone(c, o, 0, 140, 0.12, 'sine', 0.35, { glideTo: 60, attack: 0.002 }); },
    B_slap: (c, o) => { burst(c, o, 0, 0.014, 0.9, 'highpass', 900); burst(c, o, 0, 0.045, 0.45, 'lowpass', 1200); tone(c, o, 0, 180, 0.09, 'sine', 0.7, { glideTo: 70, attack: 0.001 }); tone(c, o, 0.004, 3500, 0.05, 'sine', 0.12, { attack: 0.001 }); },
    C_slap_shing: (c, o) => { burst(c, o, 0, 0.012, 0.8, 'highpass', 1100); burst(c, o, 0, 0.04, 0.35, 'lowpass', 1400); tone(c, o, 0, 170, 0.1, 'sine', 0.65, { glideTo: 65, attack: 0.001 }); shing(c, o, 0.006, 0.75, 1, 0.22); },
  };
  const out = {};
  for (const [name, fn] of Object.entries(C)) {
    const c = new OfflineAudioContext(1, SR * DUR, SR);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000; lp.connect(c.destination);
    fn(c, lp);
    const buf = await c.startRendering(); const x = buf.getChannelData(0);
    let peak = 0, pi = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > peak) { peak = Math.abs(x[i]); pi = i; }
    let end = 0; for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > peak * 0.01) { end = i; break; }
    // crude spectrum of the first 4096 samples
    const N = 4096; let lo = 0, hi = 0, tot = 0, cen = 0;
    for (let k = 1; k < N / 2; k += 2) { let re = 0, im = 0; for (let n = 0; n < N; n += 1) { const a = 2 * Math.PI * k * n / N; re += x[n] * Math.cos(a); im -= x[n] * Math.sin(a); } const m = re * re + im * im; const f = k * SR / N; tot += m; cen += m * f; if (f < 250) lo += m; if (f > 6000) hi += m; }
    out[name] = { peak: +peak.toFixed(2), attackMs: +(pi / SR * 1000).toFixed(1), tailMs: Math.round(end / SR * 1000), centroidHz: Math.round(cen / tot), low: +(lo / tot).toFixed(2), harsh: +(hi / tot).toFixed(3), pcm: Array.from(x.slice(0, end + 2000)) };
  }
  return out;
});
mkdirSync('screenshots/release-3/audio', { recursive: true });
const wav = (pcm) => { const n = pcm.length, buf = Buffer.alloc(44 + n * 2); buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(44100, 24); buf.writeUInt32LE(88200, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40); const pk = Math.max(...pcm.map(Math.abs)) || 1; pcm.forEach((v, i) => buf.writeInt16LE(Math.round((v / pk) * 0.9 * 32767), 44 + i * 2)); return buf; };
for (const [k, v] of Object.entries(res)) { writeFileSync(`screenshots/release-3/audio/cut-${k}.wav`, wav(v.pcm)); delete v.pcm; console.log(k, JSON.stringify(v)); }
await b.close();
