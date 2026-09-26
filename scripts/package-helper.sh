#!/usr/bin/env bash
# Spread Helper (GÖRÜNÜR CEP paneli) paketleme — v0.3.2.
#   release/spread-helper-klasor.zip : ANA YOL — İMZASIZ eklenti klasörü + KUR.cmd + PlayerDebugMode .reg + CEP günlüğü .reg + BENIOKU
#   release/spread-helper.zxp        : YALNIZ zaman damgalı (TSA) imza alınabilirse. Adobe imzalama teknik notu: "the package must be
#                                      signed with a valid certificate and time-stamped" → zaman damgasız ZXP ÜRETİLMEZ.
#
# Neden klasör imzasız: gerçek Windows / Premiere 26.5.1'de v0.3.0'ın (zaman damgasız, kendinden imzalı) yardımcısı yüklenmedi. İmza
# DOĞRULANAMAYAN bir eklenti PlayerDebugMode=1 iken de reddedilebiliyor (üçüncü taraf rapor: AE 26.3, "Signature verification failed");
# imzasız eklenti + PlayerDebugMode=1 ise Adobe'nin belgelediği geliştirici yolu (CEP 12 Cookbook, "Debugging Unsigned Extensions").
#
# İmzalama (isteğe bağlı): ZXPSIGNCMD=/yol/ZXPSignCmd.exe (Linux'ta Wine). Sertifika .signing/ altında (git'e GİRMEZ).
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="cep-helper"
BUNDLE="com.badideagency.spread.helper"
OUT_ZXP="$PWD/release/spread-helper.zxp"
OUT_ZIP="$PWD/release/spread-helper-klasor.zip"
SIGN_DIR="$PWD/.signing"
ZXPSIGNCMD="${ZXPSIGNCMD:-}"
WINE="${WINE:-/usr/lib/wine/wine64}"
TSA="${TSA:-http://timestamp.digicert.com}"

node scripts/check-jsx.mjs
node scripts/check-core.mjs

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$BUNDLE"
cp -R "$SRC/CSXS" "$SRC/index.html" "$SRC/js" "$SRC/jsx" "$SRC/.debug" "$STAGE/$BUNDLE/"
for f in CSXS/manifest.xml .debug index.html js/spread-core.js js/helper.js js/panel.js jsx/host.jsx; do
  [ -f "$STAGE/$BUNDLE/$f" ] || { echo "HATA: pakette $f yok"; exit 1; }
done
find "$STAGE" -type d -exec chmod 755 {} +
find "$STAGE" -type f -exec chmod 644 {} +
find "$STAGE" -exec touch -h -t 202601010000 {} +

mkdir -p release
rm -f "$OUT_ZIP"
# ANA YOL: imzasız klasör kiti
KIT="$STAGE/kit"
mkdir -p "$KIT"
cp -R "$STAGE/$BUNDLE" "$KIT/"
cp scripts/helper-kit/KUR.cmd scripts/helper-kit/PlayerDebugMode_CSXS12.reg scripts/helper-kit/CEP_GUNLUK_AC.reg scripts/helper-kit/BENIOKU.txt "$KIT/"
find "$KIT" -type d -exec chmod 755 {} +
find "$KIT" -type f -exec chmod 644 {} +
find "$KIT" -exec touch -h -t 202601010000 {} +
( cd "$KIT" && find . -mindepth 1 | sed 's|^\./||' | LC_ALL=C sort | zip -X -q "$OUT_ZIP" -@ )
if unzip -l "$OUT_ZIP" | grep -q "META-INF"; then echo "HATA: klasör kitinde imza (META-INF) var — imzasız olmalı"; exit 1; fi
echo "✓ $OUT_ZIP ($(stat -c %s "$OUT_ZIP") bayt, imzasız klasör + KUR.cmd + .reg)"

# İSTEĞE BAĞLI: zaman damgalı ZXP
if [ -z "$ZXPSIGNCMD" ] || [ ! -f "$ZXPSIGNCMD" ]; then
  rm -f "$OUT_ZXP"
  echo "not: ZXPSIGNCMD verilmedi → .zxp üretilmedi (klasör kiti ana yol)."
  exit 0
fi
run_sign() {
  if [[ "$ZXPSIGNCMD" == *.exe ]]; then WINEDEBUG=-all WINEPREFIX="${WINEPREFIX:-$SIGN_DIR/wineprefix}" "$WINE" "$ZXPSIGNCMD" "$@"; else "$ZXPSIGNCMD" "$@"; fi
}
mkdir -p "$SIGN_DIR"
if [ ! -f "$SIGN_DIR/spread-helper.p12" ]; then
  PASS="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
  echo "$PASS" > "$SIGN_DIR/password.txt"
  chmod 600 "$SIGN_DIR/password.txt"
  ( cd "$SIGN_DIR" && run_sign -selfSignedCert TR Istanbul "Bad Idea Agency" "Spread Helper" "$PASS" spread-helper.p12 -validityDays 3650 )
fi
PASS="$(cat "$SIGN_DIR/password.txt")"
cp "$SIGN_DIR/spread-helper.p12" "$STAGE/cert.p12"
(
  cd "$STAGE"
  if ! run_sign -sign "$BUNDLE" out.zxp cert.p12 "$PASS" -tsa "$TSA" >sign.log 2>&1; then
    echo "not: zaman damgası sunucusuna ($TSA) ulaşılamadı → .zxp ÜRETİLMEDİ (zaman damgasız imza ZXP Installer'da reddedilebilir)."
    sed 's/^/   /' sign.log | tail -5
    rm -f out.zxp
    exit 0
  fi
  run_sign -verify out.zxp -certInfo -skipOnlineRevocationChecks | tee verify.log
  grep -qi "signature verified successfully" verify.log || { echo "HATA: imza doğrulanamadı"; exit 1; }
  unzip -p out.zxp META-INF/signatures.xml | grep -qi "timestamp" || { echo "HATA: imzada zaman damgası yok"; exit 1; }
)
if [ -f "$STAGE/out.zxp" ]; then
  cp "$STAGE/out.zxp" "$OUT_ZXP"
  echo "✓ $OUT_ZXP (zaman damgalı imza)"
else
  rm -f "$OUT_ZXP"
fi
