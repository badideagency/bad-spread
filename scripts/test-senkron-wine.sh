#!/usr/bin/env bash
# SENKRON uçtan uca sınaması — Wine'da GERÇEK sabit ffmpeg derlemesi (gyan.dev 7.1.1 essentials):
#   yardımcı modülü (cep-helper/js/senkron.js) zip'i SABİT adresten indirir (FFMPEG_ZIP verilirse o dosya "elle konan zip" olarak
#   kullanılır — yine sha256 denetlenir), sha256'yı doğrular, ffmpeg.exe / ffprobe.exe'yi çıkarır; ikinci açılışta kurulu ikilileri
#   sha256 ile doğrular; ffmpeg.exe'nin kendisiyle üretilen MP4 (H.264 + AAC) / MOV (PCM) ve 48 kHz stereo WAV'ları çözer; motor
#   bilinen ofsetleri ≤ 1 ms bulmalı. Sınanamayan: gerçek Windows'ta CEP'in Node'u (spawn aynı API), gerçek kamera dosyaları.
# Kullanım: bash scripts/test-senkron-wine.sh   (ağ yoksa: FFMPEG_ZIP=/yol/ffmpeg-7.1.1-essentials_build.zip)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
W=${WINE:-/usr/lib/wine/wine64}
[ -x "$W" ] || { echo "Wine yok ($W) — atlandı"; exit 0; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export WINE="$W" WINEPREFIX="$TMP/wp" WINEDEBUG=-all WINEDLLOVERRIDES="mscoree,mshtml="
timeout 300 "$W" wineboot -i >/dev/null 2>&1 || true
timeout 900 node "$ROOT/spread/dev/senkron-wine.cjs" "$TMP/work"
