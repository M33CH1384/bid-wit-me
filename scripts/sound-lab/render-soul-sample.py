#!/usr/bin/env python3
"""In-house renderer for the Bid Wit Me soul sample (menu theme + Porch score).

Original compositions, synthesized note-by-note with numpy — no samples, no
stock audio. Instruments: Rhodes-style electric piano (FM-ish partial stack),
round electric bass, brushed kit (shaped noise), soft horn swells (detuned
saws through a dark lowpass), muted guitar chops (Karplus-Strong), vinyl
crackle. Mastered warm (soft clip + gentle top roll-off) and loop-wrapped so
the files cycle seamlessly under the game's music decks.

Usage: python3 render_soul.py [menu|porch|both]
Outputs WAV next to this script; the caller encodes to 128k MP3.

Porch revision (2026-10-23, owner-directed): the original Porch take (68 BPM,
brushes only, sparse shells — mode 'porch-legacy', kept for provenance) read
"super corny... sleepy" to the owner. Mode 'porch' now renders PORCH PARTY:
the same pipeline re-arranged as upbeat old-school R&B — 100 BPM, a real
backbeat, a walking bass, Rhodes stabs with anticipation chords, swung
offbeat guitar chops, and horn stabs kept on a leash. Same key (D minor) and
the same D-F-A-C signature motif, so the Porch still belongs to the same
record as the story score. The menu theme is unchanged.
"""
import sys
import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100
rng = np.random.default_rng(20261023)


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def onepole_lp(x, f):
    a = 1 - np.exp(-2 * np.pi * f / SR)
    y = np.empty_like(x)
    acc = 0.0
    # lfilter with a simple one-pole is fine via scipy
    from scipy.signal import lfilter
    return lfilter([a], [1.0, -(1 - a)], x)


def adsr(n, attack, decay, sustain, release):
    env = np.zeros(n)
    a = min(int(attack * SR), n)
    d = min(int(decay * SR), max(0, n - a))
    r = min(int(release * SR), max(0, n - a - d))
    s = max(0, n - a - d - r)
    if a:
        env[:a] = np.linspace(0, 1, a)
    if d:
        env[a:a + d] = np.linspace(1, sustain, d)
    if s:
        env[a + d:a + d + s] = sustain
    if r:
        env[a + d + s:] = np.linspace(sustain, 0, r)
    return env


def place(buf, sig, at_s):
    i = int(at_s * SR)
    if i < 0:
        sig = sig[-i:]
        i = 0
    j = min(len(buf), i + len(sig))
    if i < len(buf) and j > i:
        buf[i:j] += sig[:j - i]


# ---------------- instruments ----------------

def rhodes(midi, dur, vel=0.5):
    """Electric piano: sine stack — fundamental + fast-decaying bell partial +
    a whisper of 2nd harmonic — with slow tremolo. Velocity brightens the bell."""
    f = midi_hz(midi)
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = adsr(n, 0.004, min(1.4, dur * 0.6), 0.32, min(0.5, dur * 0.35))
    bell_env = np.exp(-t * (3.2 - 1.4 * vel))
    y = np.sin(2 * np.pi * f * t) * env
    y += (0.28 + 0.45 * vel) * np.sin(2 * np.pi * f * 3.98 * t + 0.4) * bell_env * env
    y += 0.12 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t * 1.8)
    trem = 1 - 0.16 * (0.5 + 0.5 * np.sin(2 * np.pi * 4.6 * t + 0.7))
    return y * trem * vel * 0.5


def bass_note(midi, dur, vel=0.6, pop=False):
    f = midi_hz(midi)
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = adsr(n, 0.012, 0.25, 0.72, 0.09)
    sweep = 260 + 700 * np.exp(-t * 9)
    y = np.sin(2 * np.pi * f * t) + 0.38 * np.sin(2 * np.pi * 2 * f * t) + 0.13 * np.sin(2 * np.pi * 3 * f * t)
    y = np.tanh(y * 1.1)
    # cheap lowpass sweep via cumulative filtering approximation: two one-poles
    y = onepole_lp(y, 900)
    if pop:
        y += 0.35 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 22)
    return y * env * vel * 0.62


def noise_burst(dur, hp=None, bp=None, q=0.8):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    if bp:
        bw = bp / max(q, 0.2)
        lo = max(40.0, np.sqrt(bp * bp + (bw / 2) ** 2) - bw / 2)
        hi = min(SR * 0.49, lo + bw)
        sos = butter(2, [lo, hi], btype='bandpass', fs=SR, output='sos')
        x = sosfilt(sos, x)
    if hp:
        sos = butter(2, hp, btype='highpass', fs=SR, output='sos')
        x = sosfilt(sos, x)
    return x


def brush_swirl(dur, vel=0.3):
    x = noise_burst(dur, bp=3400, q=0.6)
    n = len(x)
    t = np.arange(n) / SR
    env = (np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.5)
    return x * env * vel * 0.20


def kick(vel=0.5):
    dur = 0.30
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 44 + 78 * np.exp(-t * 26)
    ph = np.cumsum(2 * np.pi * f / SR)
    return np.sin(ph) * np.exp(-t * 11) * vel * 0.85


def stick(vel=0.4):
    dur = 0.09
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = noise_burst(dur, hp=5200) * np.exp(-t * 70) * 0.5
    x += np.sin(2 * np.pi * 1750 * t) * np.exp(-t * 55) * 0.4
    return x * vel


def brush_snare(vel=0.35):
    dur = 0.22
    t = np.arange(int(dur * SR)) / SR
    x = noise_burst(dur, bp=1900, q=0.7) * np.exp(-t * 16)
    return x * vel * 0.8


def horn_swell(midis, dur, vel=0.22):
    """Soft brass pad: detuned saws per note through a dark lowpass, slow bloom,
    late vibrato. Reads as a horn section breathing, not a synth lead."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for m in midis:
        f = midi_hz(m)
        vib = 1 + 0.004 * np.sin(2 * np.pi * 5.1 * t) * np.clip((t - dur * 0.35) / (dur * 0.3), 0, 1)
        for det in (-0.06, 0.0, 0.06):
            ph = np.cumsum(2 * np.pi * f * (1 + det / 100) * vib / SR)
            saw = 2 * (ph / (2 * np.pi) - np.floor(ph / (2 * np.pi) + 0.5))
            y += saw
    y = onepole_lp(y, 820)
    env = adsr(n, dur * 0.38, dur * 0.2, 0.8, dur * 0.3)
    return y * env * vel * 0.16


def guitar_chop(midis, vel=0.3):
    """Karplus-Strong muted string-ish pluck, very short — a rhythm chop."""
    dur = 0.30
    n = int(dur * SR)
    y = np.zeros(n)
    for m in midis:
        f = midi_hz(m)
        N = max(2, int(SR / f))
        line = rng.standard_normal(N) * 0.9
        out = np.zeros(n)
        idx = 0
        prev = 0.0
        for i in range(n):
            cur = line[idx]
            new = 0.996 * 0.5 * (cur + prev)
            out[i] = cur
            line[idx] = new
            prev = cur
            idx = (idx + 1) % N
        y += out
    env = np.exp(-np.arange(n) / SR * 9)
    return y * env * vel * 0.30


def crackle(dur, vel=0.5):
    n = int(dur * SR)
    y = rng.standard_normal(n)
    sos = butter(1, 3800, btype='highpass', fs=SR, output='sos')
    y = sosfilt(sos, y) * 0.012 * vel  # surface hiss
    pops = int(dur * 2.6)
    for _ in range(pops):
        i = rng.integers(0, n - 200)
        amp = (rng.random() ** 2.2) * 0.24 * vel
        dec = rng.integers(30, 160)
        seg = amp * np.exp(-np.arange(dec) * 0.09) * (1 if rng.random() > 0.5 else -1)
        y[i:i + dec] += seg
    return y


def humanize(t, vel):
    return t + rng.uniform(-0.006, 0.006), vel * rng.uniform(0.92, 1.08)


def hat_tick(vel=0.14, open_hat=False):
    """Closed hat: a very short highpassed noise tick. The backbeat's clock —
    the thing the brush-only Porch take didn't have."""
    dur = 0.28 if open_hat else 0.05
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = noise_burst(dur, hp=7600)
    return x * np.exp(-t * (16 if open_hat else 95)) * vel


def horn_stab(midis, dur=0.4, vel=0.17):
    """Short brass hit: the swell's detuned saws with a fast envelope and a
    slightly brighter lowpass — punctuation, not a pad."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for m in midis:
        f = midi_hz(m)
        for det in (-0.05, 0.0, 0.05):
            ph = 2 * np.pi * f * (1 + det / 100) * t
            y += 2 * (ph / (2 * np.pi) - np.floor(ph / (2 * np.pi) + 0.5))
    y = onepole_lp(y, 1500)
    env = adsr(n, 0.012, 0.12, 0.3, min(0.16, dur * 0.4))
    return y * env * vel * 0.15


# ---------------- arrangements ----------------
# Rootless soul voicings (3-5-7-9 shells), bass roots separate.
DM9 = [53, 57, 60, 64]
GM9 = [53, 57, 58, 62]
BB9 = [53, 57, 60, 62]
FM9 = [52, 55, 57, 60]
EM7B5 = [52, 55, 58, 62]
A7S5 = [55, 61, 65]
CH = {'Dm9': (DM9, 38), 'Gm9': (GM9, 43), 'Bb9': (BB9, 46), 'Fm9': (FM9, 41),
      'Em7b5': (EM7B5, 40), 'A7#5': (A7S5, 45)}

MENU_CHORDS = ['Dm9', 'Dm9', 'Gm9', 'Gm9', 'Dm9', 'Dm9', 'Em7b5', 'A7#5',
               'Bb9', 'Bb9', 'Dm9', 'Fm9', 'Em7b5', 'A7#5', 'Dm9', 'A7#5']
PORCH_CHORDS = ['Dm9', 'Dm9', 'Gm9', 'Dm9', 'Bb9', 'Gm9', 'Em7b5', 'A7#5',
                'Dm9', 'Dm9', 'Gm9', 'Dm9', 'Fm9', 'Bb9', 'Em7b5', 'A7#5']
# Groove-only voicings (same rootless shell style): a IV9 and a bVII9 for the
# turnaround colour, and F's shell under its proper major-9 name.
CH.update({'C9': ([52, 58, 62, 67], 36), 'G9': ([53, 57, 59, 62], 43),
           'Fmaj9': ([52, 55, 57, 60], 41)})
GROOVE_CHORDS = ['Dm9', 'Dm9', 'Gm9', 'Gm9', 'Dm9', 'Dm9', 'Em7b5', 'A7#5',
                 'Bb9', 'Bb9', 'Fmaj9', 'Fmaj9', 'Gm9', 'G9', 'Em7b5', 'A7#5',
                 'Dm9', 'Dm9', 'Gm9', 'G9', 'Dm9', 'C9', 'Em7b5', 'A7#5']
GROOVE_BPM = 100
SWING = 0.055  # beats of delay on offbeat 8ths — the old-school roll
MOTIF = [74, 77, 81, 84]  # D5 F5 A5 C6 — the story signature (D-F-A-C)


def render(chords, bpm, *, drums='full', guitar=False, horns_from=None,
           motif_bars=(), sparse=False, seed=7):
    global rng
    rng = np.random.default_rng(seed)
    spb = 60.0 / bpm
    bar = 4 * spb
    total = bar * len(chords) + 3.0  # tail room (wrapped later)
    mix = np.zeros(int(total * SR))
    for bi, name in enumerate(chords):
        bt = bi * bar
        tones, root = CH[name]
        # Rhodes: a held shell + syncopated stabs (menu), or long shells (porch)
        if sparse:
            for m in tones:
                t0, v = humanize(bt + 0.02, 0.34)
                place(mix, rhodes(m, bar * 0.96, v), t0)
            t0, v = humanize(bt + 2 * spb, 0.16)
            for m in tones[:2]:
                place(mix, rhodes(m, spb * 1.4, v), t0)
        else:
            for m in tones:
                t0, v = humanize(bt + 0.02, 0.30)
                place(mix, rhodes(m, bar * 1.02, v), t0)
            for off, vv in ((1.5 * spb, 0.30), (3.5 * spb, 0.24)):
                t0, v = humanize(bt + off, vv)
                for m in tones:
                    place(mix, rhodes(m, spb * 0.9, v), t0)
        # Bass
        if sparse:
            t0, v = humanize(bt, 0.55)
            place(mix, bass_note(root, bar * 0.55, v), t0)
            t0, v = humanize(bt + 2 * spb, 0.34)
            place(mix, bass_note(root + 7, spb * 1.2, v), t0)
        else:
            line = [(0.0, root, 0.95, 0.62), (1.5 * spb, root, 0.4, 0.4),
                    (2.0 * spb, root + 7, 0.5, 0.44), (2.5 * spb, root + 12, 0.35, 0.4),
                    (3.5 * spb, root + 10 if name != 'A7#5' else root + 8, 0.45, 0.46)]
            for off, mm, dd, vv in line:
                t0, v = humanize(bt + off, vv)
                place(mix, bass_note(mm, dd * spb / 0.5 * 0.5, v, pop=(off == 2.5 * spb)), t0)
        # Drums
        if drums in ('full', 'light'):
            place(mix, brush_swirl(bar * 1.0, 0.30 if not sparse else 0.22), bt)
            beats = (0.0, 2 * spb) if drums == 'full' else (0.0,)
            for b in beats:
                t0, v = humanize(bt + b, 0.5 if not sparse else 0.3)
                place(mix, kick(v), t0)
            t0, v = humanize(bt + 3.5 * spb, 0.42)
            place(mix, kick(v * 0.7), t0)
            for b in (1 * spb, 3 * spb):
                t0, v = humanize(bt + b, 0.34 if not sparse else 0.24)
                place(mix, brush_snare(v), t0)
                t0, v = humanize(bt + b, 0.3)
                place(mix, stick(v * 0.5), t0)
        elif drums == 'swirl':
            place(mix, brush_swirl(bar, 0.20), bt)
            if bi % 2 == 1:
                t0, v = humanize(bt + 3 * spb, 0.22)
                place(mix, brush_snare(v), t0)
        # Guitar chops (menu, offbeat 8ths, not every bar)
        if guitar and bi % 2 == 0 and bi > 0:
            for off in (0.5 * spb, 1.5 * spb, 2.5 * spb, 3.5 * spb):
                t0, v = humanize(bt + off, 0.20)
                place(mix, guitar_chop(tones, v), t0)
        # Horn swells across chord pairs
        if horns_from is not None and bi >= horns_from and bi % 2 == 0:
            place(mix, horn_swell(tones[:3], bar * 1.9, 0.20 if not sparse else 0.13), bt + 0.1)
        # Signature motif, played soft on the top
        if bi in motif_bars:
            for i, m in enumerate(MOTIF):
                t0, v = humanize(bt + i * spb * 0.98, 0.30 if not sparse else 0.24)
                place(mix, rhodes(m, spb * 1.5, v), t0)
    return mix, bar * len(chords)


def render_groove(seed=41):
    """PORCH PARTY — the Porch score as upbeat old-school R&B (100 BPM, 24 bars,
    57.6 s seamless loop). Built from the same instruments as the rest of the
    sample; what changed is the arrangement: a backbeat with hats, a bass that
    walks into every bar, Rhodes stabs that anticipate the next chord, swung
    guitar chops, and horn stabs only at the section heads."""
    global rng
    rng = np.random.default_rng(seed)
    spb = 60.0 / GROOVE_BPM
    bar = 4 * spb
    chords = GROOVE_CHORDS
    mix = np.zeros(int((bar * len(chords) + 3.0) * SR))
    for bi, name in enumerate(chords):
        bt = bi * bar
        tones, root = CH[name]
        nxt = chords[(bi + 1) % len(chords)]
        ntones, nroot = CH[nxt]
        # Rhodes: shell on 1, syncopated stabs on the and-of-2 / and-of-4,
        # and — when the chord changes — the next chord anticipated on beat 4.
        for m in tones:
            t0, v = humanize(bt + 0.01, 0.32)
            place(mix, rhodes(m, spb * 1.7, v), t0)
        for off, vv in ((1.5, 0.29), (3.5, 0.25)):
            t0, v = humanize(bt + (off + SWING) * spb, vv)
            for m in tones:
                place(mix, rhodes(m, spb * 0.8, v), t0)
        if nxt != name:
            t0, v = humanize(bt + 3.0 * spb, 0.17)
            for m in ntones[1:]:
                place(mix, rhodes(m, spb * 0.5, v), t0)
        # Bass: walks — root, octave colour, fifth, chord walk-note, pop, then
        # a whole-step / half-step approach into the next bar's root.
        target = nroot
        while target < root + 7:
            target += 12
        while target > root + 19:
            target -= 12
        walk2 = 8 if name == 'A7#5' else 10
        line = [(0.0, root, 0.9, 0.66, False), (1.0, root + 12, 0.38, 0.46, False),
                (1.5, root + 7, 0.38, 0.52, False), (2.0, root + walk2, 0.42, 0.54, False),
                (2.5, root + 12, 0.32, 0.48, True), (3.0, target - 2, 0.4, 0.52, False),
                (3.5, target - 1, 0.34, 0.46, False)]
        for off, mm, dd, vv, pop in line:
            t0, v = humanize(bt + off * spb, vv)
            place(mix, bass_note(mm, dd * spb, v, pop=pop), t0)
        # Drums: hats on every 8th (offbeats swung), a quiet shaker bed, the
        # backbeat on 2 and 4 (brush + stick crack), kick on 1, 3 and the
        # and-of-4 pickup, with a ghost on the and-of-2 in odd bars.
        for k in range(8):
            t0, v = humanize(bt + (k * 0.5 + (SWING if k % 2 == 1 else 0.0)) * spb,
                             0.155 if k % 2 == 0 else 0.115)
            place(mix, hat_tick(v), t0)
        place(mix, brush_swirl(bar, 0.12), bt)
        for b in (1.0, 3.0):
            t0, v = humanize(bt + b * spb, 0.52)
            place(mix, brush_snare(v), t0)
            t0, v = humanize(bt + b * spb, 0.50)
            place(mix, stick(v), t0)
        for off, vv in ((0.0, 0.66), (2.0, 0.60)):
            t0, v = humanize(bt + off * spb, vv)
            place(mix, kick(v), t0)
        t0, v = humanize(bt + (3.5 + SWING) * spb, 0.50)
        place(mix, kick(v), t0)
        if bi % 2 == 1:
            t0, v = humanize(bt + (1.5 + SWING) * spb, 0.30)
            place(mix, kick(v), t0)
        # Guitar chops on the offbeats, alternating full shell / top notes.
        chop_tones = tones if bi % 2 == 0 else tones[1:]
        for off in (0.5, 1.5, 2.5, 3.5):
            t0, v = humanize(bt + (off + SWING) * spb, 0.15)
            place(mix, guitar_chop(chop_tones, v), t0)
        # Horn stabs: section heads only — bar 9, bar 17, and a two-hit
        # answer at bar 21.
        if bi in (8, 16):
            place(mix, horn_stab(tones[:3], 0.42, 0.17), bt + 0.02)
        if bi == 20:
            place(mix, horn_stab(tones[:3], 0.36, 0.16), bt + 0.02)
            t0, v = humanize(bt + (1.5 + SWING) * spb, 0.15)
            place(mix, horn_stab(tones[:3], 0.30, v), t0)
        # Top-line answers (Rhodes, soft): over the two A7#5 bars, then the
        # D-F-A-C signature motif walking into the final turnaround.
        if bi == 7:
            phrase = [(0.5, 73), (1.5, 69), (2.5, 77)]
        elif bi == 15:
            phrase = [(0.5, 77), (1.5, 76), (2.5, 74)]
        else:
            phrase = []
        for off, m in phrase:
            t0, v = humanize(bt + (off + SWING) * spb, 0.21)
            place(mix, rhodes(m, spb * 1.1, v), t0)
        if bi == 22:
            for i, m in enumerate(MOTIF):
                t0, v = humanize(bt + i * spb, 0.23)
                place(mix, rhodes(m, spb * 1.4, v), t0)
    return mix, bar * len(chords)


def finish(mix, loop_len, *, hiss=0.5):
    """Vinyl character, warm master, seamless loop wrap, level set."""
    n = len(mix)
    mix = mix + crackle(n / SR, vel=hiss)
    mix = np.tanh(mix * 1.12)
    mix = onepole_lp(mix, 10600)
    target = int(loop_len * SR)
    x = int(2.5 * SR)
    body = mix[:target + x].copy()
    # wrap: last x seconds fold into the first x
    body[:x] = body[:x] * np.linspace(0, 1, x) ** 0.7 + body[target:target + x] * (np.linspace(1, 0, x) ** 0.7)
    out = body[:target]
    rms = np.sqrt(np.mean(out ** 2)) + 1e-9
    out = out * (10 ** (-17.5 / 20) / rms)
    peak = np.max(np.abs(out))
    if peak > 0.89:
        out *= 0.89 / peak
    return out.astype(np.float32)


def write_wav(path, y):
    import wave
    import struct
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(struct.pack('<%dh' % len(y), *(np.clip(y, -1, 1) * 32767).astype(np.int16)))


if __name__ == '__main__':
    which = sys.argv[1] if len(sys.argv) > 1 else 'both'
    if which in ('menu', 'both'):
        mix, llen = render(MENU_CHORDS, 74, drums='full', guitar=True,
                           horns_from=8, motif_bars=(14,), seed=11)
        write_wav('menu-soul.wav', finish(mix, llen))
        print('menu-soul.wav written')
    if which in ('porch', 'both'):
        mix, llen = render_groove()
        write_wav('porch-theme.wav', finish(mix, llen, hiss=0.30))
        print('porch-theme.wav written (Porch Party — the groove take)')
    if which == 'porch-legacy':
        # The original sample take ("Porchlight", 68 BPM sparse) — rejected by
        # the owner 2026-10-23; kept reproducible for provenance only.
        mix, llen = render(PORCH_CHORDS, 68, drums='swirl', guitar=False,
                           horns_from=4, motif_bars=(6, 14), sparse=True, seed=23)
        write_wav('porch-theme-legacy.wav', finish(mix, llen, hiss=0.32))
        print('porch-theme-legacy.wav written')
