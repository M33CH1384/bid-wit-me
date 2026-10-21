#!/usr/bin/env python3
"""
Sprite bake for Bid Wit Me's recorded bot voices (Kokoro-82M v1.0, kokoro-onnx).

Input: a worklist from scripts/voice-bake/dump-lines.ts (every clip every sprite must
contain, with its spoken take and state have|rebake|new). For each sprite:
  - existing clips keep their exact decoded PCM (sliced by the current manifest),
  - 'rebake' clips are re-synthesized with the corrected pronunciation and replace
    their segment in place (later offsets in that sprite shift; the manifest is
    regenerated from the real segment lengths),
  - 'new' clips are synthesized and appended after the existing ones.
Synthesis uses each persona-gender's official Kokoro voice at its PERSONA_VOICES speed;
every clip is processed with the corpus norms (trim, -16 LUFS via pyloudnorm, -1 dBFS
peak ceiling, 10 ms edge fades — the same chain as scripts/voice-bake/bake.py).
Layout: 250 ms lead-in, 250 ms between clips, 250 ms tail (index.json: gapMs 250).
Outputs into an out dir: <key>.webm (Opus 20 kbps), <key>.m4a (AAC-LC 32 kbps),
<key>.json (manifest), index.json (updated counts/durations/bytes).
Resumable: synthesized clips are cached as PCM under <cache>/<sprite>/<sha1>.f32;
a sprite is only (re)assembled when all its clips exist.

Run with the studio venv:  ~/workspace/_voicebake/venv/bin/python bake-sprites.py \
    --worklist ~/workspace/_voicebake/worklist.json \
    --src apps/web/public/voices/v2 --out ~/workspace/_voicebake/out-v2 \
    --models ~/workspace/_voicebake/models
"""
import argparse, hashlib, json, subprocess, sys, time
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from kokoro_onnx import Kokoro

SR = 24000
GAP = int(SR * 0.25)
METER = pyln.Meter(SR)


def process(samples: np.ndarray) -> np.ndarray:
    """trim → -16 LUFS → brickwall limit at -1 dBFS → 10 ms edge fades.

    The shipped corpus sits at -16.2±0.3 LUFS per clip with peaks never above
    -1 dBFS — a limiter, not a gain ceiling (a ceiling drags cresty clips down
    to -18..-21 LUFS; measured against the shipped sprites 2026-10-21)."""
    x = np.asarray(samples, dtype=np.float32).reshape(-1)
    # trim: 5 ms RMS windows, -35 dB relative to the peak window, 25 ms pads — the
    # combination that reproduces shipped clip durations to within ±15 ms across a
    # 12-line battery of known takes (the shipped durations have 5 ms granularity)
    win = int(SR * 0.005)
    n = (len(x) // win) * win
    if n == 0:
        return x
    rms = np.sqrt(np.mean(x[:n].reshape(-1, win) ** 2, axis=1) + 1e-12)
    peak = rms.max()
    on = np.nonzero(rms > peak * 10 ** (-35 / 20))[0]
    if len(on):
        pad = int(SR * 0.025)
        x = x[max(0, on[0] * win - pad): min(len(x), (on[-1] + 1) * win + pad)]
    loud = METER.integrated_loudness(x.astype(np.float64))
    if np.isfinite(loud):
        x = pyln.normalize.loudness(x, loud, -16.0).astype(np.float32)
    ceil = 10 ** (-1 / 20)
    if len(x) and np.max(np.abs(x)) > ceil:
        # feedforward limiter: the gain a sample needs to sit at the ceiling, applied
        # with instant attack (the overshoot sample itself is ducked to the ceiling)
        # and an ~80 ms exponential release; loudness moves <0.2 LUFS
        need = np.minimum(1.0, ceil / np.maximum(np.abs(x), 1e-9))
        rel = 1.0 - np.exp(-1.0 / (SR * 0.080))
        out = np.empty_like(need)
        g = 1.0
        for i, v in enumerate(need):
            g = v if v < g else g + (v - g) * rel
            out[i] = g
        x = x * out
    fade = int(SR * 0.010)
    if len(x) > 2 * fade:
        ramp = np.linspace(0, 1, fade, dtype=np.float32)
        x[:fade] *= ramp
        x[-fade:] *= ramp[::-1]
    return x


def decode_pcm(m4a: Path) -> np.ndarray:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(m4a), '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def encode(pcm: np.ndarray, dst_base: Path) -> tuple[int, int]:
    raw = pcm.astype(np.float32).tobytes()
    base = ['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-']
    subprocess.run(base + ['-c:a', 'libopus', '-b:a', '20k', '-ar', '48000', str(dst_base.with_suffix('.webm'))],
                   input=raw, check=True)
    subprocess.run(base + ['-c:a', 'aac', '-b:a', '32k', '-ar', str(SR), str(dst_base.with_suffix('.m4a'))],
                   input=raw, check=True)
    return dst_base.with_suffix('.webm').stat().st_size, dst_base.with_suffix('.m4a').stat().st_size


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--worklist', required=True)
    ap.add_argument('--src', required=True, help='current voices/v2 dir')
    ap.add_argument('--out', required=True)
    ap.add_argument('--models', required=True)
    ap.add_argument('--cache', default=None)
    ap.add_argument('--only', default=None, help='comma-separated sprite keys to limit to')
    args = ap.parse_args()
    src, out = Path(args.src), Path(args.out)
    cache = Path(args.cache) if args.cache else out.parent / 'pcm-cache'
    out.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    work = json.loads(Path(args.worklist).read_text())['sprites']
    only = set(args.only.split(',')) if args.only else None
    # nilMade first: sprites whose new clips include the starved kinds lead the run
    starved = {'nilMade', 'nilSet', 'made', 'wheels', 'streak', 'gotNuked', 'shotOut', 'onNotice', 'boston', 'gotRan', 'matchPoint', 'bags'}
    work.sort(key=lambda s: -sum(1 for c in s['clips'] if c['state'] == 'new' and c['kind'] in starved))

    kokoro = Kokoro(str(Path(args.models) / 'kokoro-v1.0.onnx'), str(Path(args.models) / 'voices-v1.0.bin'))
    index = json.loads((src / 'index.json').read_text())
    t0 = time.time()
    synth_count = 0

    for sprite in work:
        key = sprite['key']
        if only and key not in only:
            continue
        manifest = json.loads((src / f'{key}.json').read_text())
        old_clips: dict[str, list[int]] = manifest['clips']
        todo = [c for c in sprite['clips'] if c['state'] != 'have']
        if not todo:
            print(f'{key}: nothing to do, files untouched', flush=True)
            continue
        scache = cache / key
        scache.mkdir(exist_ok=True)

        def clip_pcm(c) -> np.ndarray:
            h = hashlib.sha1(f"{c['voice']}|{c['lang']}|{c['speed']}|{c['text']}".encode()).hexdigest()[:16]
            f = scache / f'{h}.f32'
            if f.exists():
                return np.frombuffer(f.read_bytes(), dtype=np.float32).copy()
            samples, _ = kokoro.create(c['text'], voice=c['voice'], speed=c['speed'], lang=c['lang'])
            pcm = process(samples)
            f.write_bytes(pcm.astype(np.float32).tobytes())
            return pcm

        for c in todo:
            clip_pcm(c)
            synth_count += 1
        if todo:
            print(f'{key}: synthesized/reused {len(todo)} clips ({synth_count} total, {time.time()-t0:.0f}s)', flush=True)

        # assemble: existing segments in manifest order (rebakes swapped), orphans kept, new appended
        sprite_clips = {c['key']: c for c in sprite['clips']}
        ordered: list[tuple[str, np.ndarray]] = []
        if old_clips:
            master = decode_pcm(src / f'{key}.m4a')
            last_end = max(s + d for s, d in old_clips.values())
            expect = (last_end + 250) * SR // 1000
            if abs(len(master) - expect) > SR // 10:
                print(f'{key}: DECODE LENGTH MISMATCH got {len(master)} expect ~{expect}', file=sys.stderr)
                return 1
            for k, (s, d) in old_clips.items():
                c = sprite_clips.get(k)
                if c and c['state'] == 'rebake':
                    ordered.append((k, clip_pcm(c)))
                else:
                    ordered.append((k, master[s * SR // 1000:(s + d) * SR // 1000]))
        for c in sprite['clips']:
            if c['state'] == 'new':
                ordered.append((c['key'], clip_pcm(c)))

        parts: list[np.ndarray] = [np.zeros(GAP, dtype=np.float32)]
        new_clips: dict[str, list[int]] = {}
        cursor = GAP
        for k, pcm in ordered:
            dur_ms = int(round(len(pcm) * 1000 / SR))
            new_clips[k] = [int(round(cursor * 1000 / SR)), dur_ms]
            parts.append(pcm)
            parts.append(np.zeros(GAP, dtype=np.float32))
            cursor += len(pcm) + GAP
        full = np.concatenate(parts)
        wb, mb = encode(full, out / key)
        manifest['clips'] = new_clips
        (out / f'{key}.json').write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + '\n')
        index['sprites'][key] = {**index['sprites'][key], 'count': len(new_clips),
                                 'durationSec': round(len(full) / SR, 1), 'bytes': {'webm': wb, 'm4a': mb}}
        print(f'{key}: assembled {len(new_clips)} clips, {len(full)/SR:.1f}s', flush=True)

    (out / 'index.json').write_text(json.dumps(index, indent=1) + '\n')
    print(f'done in {time.time()-t0:.0f}s')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
