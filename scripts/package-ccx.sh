#!/usr/bin/env bash
# Kullanım: scripts/package-ccx.sh [probe|spread]   (varsayılan: probe)
#   probe : dist/        → release/spread-probe.ccx
#   spread: spread/dist/ → release/spread.ccx
#  - manifest.json ZIP'in KÖKÜNDE (alt klasör yok)
#  - dosyalar 644, klasörler 755 (000 izin / kökte manifest yok → kurulumda "UPI status -160")
#  - sabit zaman damgası + sıralı dosya listesi (tekrar üretilebilir paket)
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-probe}"
case "$TARGET" in
  probe)  BUILD="npm run build";        DIST="dist";        OUT="$PWD/release/spread-probe.ccx" ;;
  spread) BUILD="npm run build:spread"; DIST="spread/dist"; OUT="$PWD/release/spread.ccx" ;;
  *) echo "bilinmeyen hedef: $TARGET (probe|spread)"; exit 2 ;;
esac

$BUILD

mkdir -p release
rm -f "$OUT"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$DIST"/. "$STAGE/"
[ -f "$STAGE/manifest.json" ] || { echo "HATA: $DIST/manifest.json yok"; exit 1; }

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
