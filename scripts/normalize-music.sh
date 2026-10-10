#!/usr/bin/env bash
# Two-pass ffmpeg loudnorm to -16 LUFS / -1.5 dBTP, encoded like the existing tracks (MP3 128 kbps, 44.1 kHz stereo).
# Usage: scripts/normalize-music.sh <in.mp3> <out.mp3>
set -euo pipefail
in="$1"; out="$2"
j=$(ffmpeg -hide_banner -nostats -i "$in" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
g() { python3 -c "import json,sys; print(json.loads(sys.stdin.read())['$1'])" <<<"$j"; }
ffmpeg -hide_banner -nostats -loglevel error -y -i "$in" -map 0:a:0 -map_metadata -1 \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true" \
  -ar 44100 -ac 2 -c:a libmp3lame -b:a 128k "$out"
