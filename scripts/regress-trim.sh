#!/usr/bin/env bash
# v0.3.4 REGRESYON (BAĞLA kırpması): gerçek Premiere'de set action'lar tek transaction'da klibin ilk hâlinden fark olarak uygulanıp
# aynı kenarda birikiyor. Mock bu anlamı uygular (spread/dev/smoke.cjs, M.setSem "real"). Bu betik:
#   1) v0.3.3'ü (varsayılan 6aa05c8) geçici bir klasöre derler ve AYNI mock'la çalıştırır → ilk parça −1548.16 s ile DÜŞMELİ
#      (out okunan −393257410560000, fark −393846727680000 — gerçek raporla birebir)
#   2) güncel derlemeyi aynı senaryoyla çalıştırır → GEÇMELİ
# Kullanım: bash scripts/regress-trim.sh [eski-commit]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
REV=${1:-6aa05c8}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git -C "$ROOT" cat-file -e "$REV^{commit}" 2>/dev/null || { echo "✗ $REV commit'i yok (sığ klon?) — git fetch --unshallow"; exit 1; }
git -C "$ROOT" archive "$REV" spread | tar -x -C "$TMP"
ln -s "$ROOT/node_modules" "$TMP/node_modules"
(cd "$TMP" && "$ROOT/node_modules/.bin/vite" build --config spread/vite.config.mjs --logLevel error)
echo "── ESKİ kod ($REV) — düşmeli"
SPREAD_DIST="$TMP/spread/dist" SPREAD_REGRESS=old node "$ROOT/spread/dev/smoke.cjs" regress_trim
echo "── YENİ kod — geçmeli"
node "$ROOT/spread/dev/smoke.cjs" regress_trim,trimcal_rules
