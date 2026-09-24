#!/usr/bin/env bash
# dist/ → release/spread-probe.ccx
#  - manifest.json ZIP'in KÖKÜNDE (alt klasör yok)
#  - dosyalar 644, klasörler 755 (000 izin / kökte manifest yok → kurulumda "UPI status -160")
#  - sabit zaman damgası + sıralı dosya listesi (tekrar üretilebilir paket)
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build

OUT="$PWD/release/spread-probe.ccx"
mkdir -p release
rm -f "$OUT"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R dist/. "$STAGE/"
[ -f "$STAGE/manifest.json" ] || { echo "HATA: dist/manifest.json yok"; exit 1; }

find "$STAGE" -type d -exec chmod 755 {} +
find "$STAGE" -type f -exec chmod 644 {} +
find "$STAGE" -exec touch -h -t 202601010000 {} +

(
  cd "$STAGE"
  # önce manifest.json, sonra geri kalan her şey (klasör girdileri dahil) sıralı
  { echo manifest.json; find . -mindepth 1 ! -name manifest.json | sed 's|^\./||' | LC_ALL=C sort; } \
    | zip -X -q "$OUT" -@
)

python3 scripts/verify-ccx.py "$OUT"
