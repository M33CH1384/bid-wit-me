"""Voice Phase 3 bake: voice/bake-plan.json -> apps/web/public/voices/ai/<id>.mp3 with Kokoro-82M (kokoro-onnx, CPU).

Same voices, speeds and loudness as the canned clips (/workspace/bwm-voices): trim, -16 LUFS, -1 dBFS limit, 10 ms
fades, mono MP3. espeak-ng is the phonemizer on the runner only; nothing from it ships.

  python bake.py --models DIR [--dry-run]
--dry-run (or missing models/packages) synthesizes nothing and exits 0 after listing the plan.
"""
import argparse, json, os, subprocess, sys, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PLAN = os.path.join(ROOT, "voice", "bake-plan.json")
OUT = os.path.join(ROOT, "apps", "web", "public", "voices", "ai")
SR = 24000
TARGET_LUFS = -16.0
PEAK = 10 ** (-1.0 / 20)


def process(x):
    import numpy as np, pyloudnorm as pyln
    x = np.asarray(x, dtype=np.float64)
    win = int(SR * 0.01); n = len(x) // win
    if n:
        rms = np.sqrt(np.mean(x[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
        db = 20 * np.log10(rms / (np.max(np.abs(x)) + 1e-9))
        on = np.where(db > -45.0)[0]
        if len(on):
            pad = int(SR * 0.025)
            x = x[max(0, on[0] * win - pad): min(len(x), (on[-1] + 1) * win + pad)]
    lu = pyln.Meter(SR, block_size=min(0.4, len(x) / SR * 0.99)).integrated_loudness(x)
    x = x * 10 ** ((TARGET_LUFS - lu) / 20)
    x = np.clip(x, -PEAK, PEAK)
    f = min(int(SR * 0.01), len(x) // 2); r = np.linspace(0, 1, f)
    x[:f] *= r; x[-f:] *= r[::-1]
    return x.astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=os.path.join(ROOT, ".voice-models"))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    lines = json.load(open(PLAN))["lines"]
    print(f"bake: {len(lines)} line(s) planned")
    for l in lines:
        print(f"  {l['id']}  {l['persona']}-{l['g']} {l['voice']}@{l['speed']}  [{l['bucket']}]  {l['text']}")
    if a.dry_run or not lines:
        print("bake: dry run, nothing synthesized" if a.dry_run else "bake: nothing to do")
        return 0
    onnx, vbin = os.path.join(a.models, "kokoro-v1.0.onnx"), os.path.join(a.models, "voices-v1.0.bin")
    try:
        import soundfile as sf
        from kokoro_onnx import Kokoro
    except ImportError as e:
        print(f"bake: skipped, missing package ({e})"); return 0
    if not (os.path.exists(onnx) and os.path.exists(vbin)):
        print(f"bake: skipped, models not in {a.models}"); return 0
    k = Kokoro(onnx, vbin)
    os.makedirs(OUT, exist_ok=True)
    made = 0
    for l in lines:
        dst = os.path.join(OUT, f"{l['id']}.mp3")
        if os.path.exists(dst) and os.path.getsize(dst) > 1000:
            continue
        try:
            audio, sr = k.create(l["text"], voice=l["voice"], speed=float(l["speed"]), lang=l["lang"])
            assert sr == SR, sr
            with tempfile.TemporaryDirectory() as td:
                wav = os.path.join(td, "x.wav")
                sf.write(wav, process(audio), SR)
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-ar", "24000", "-map_metadata", "-1",
                                "-c:a", "libmp3lame", "-b:a", "48k", dst], check=True)
            made += 1
        except Exception as e:  # one bad line must not sink the batch; apply() leaves it queued
            print(f"  FAILED {l['id']}: {e}", file=sys.stderr)
    print(f"bake: {made} clip(s) written to {os.path.relpath(OUT, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
