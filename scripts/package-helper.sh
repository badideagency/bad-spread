#!/usr/bin/env bash
# Spread Helper (görünmez CEP yardımcısı) paketleme.
#   release/spread-helper.zxp        : Adobe ZXPSignCmd ile KENDİNDEN İMZALI (self-signed) ZXP
#   release/spread-helper-klasor.zip : yedek yol — aynı imzalı içeriğin açılmış klasörü + KUR.cmd + PlayerDebugMode .reg
#
# İmzalama: Adobe'nin ZXPSignCmd'si (github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD, 4.1.3 x64) Linux'ta Wine ile
# çalıştırılır (Linux sürümü yok). ZXPSIGNCMD=/yol/ZXPSignCmd.exe ve (Linux'ta) wine64 gerekir; yoksa paket İMZASIZ üretilmez,
# betik hata verir.
# Sertifika: ilk çalıştırmada .signing/ altında self-signed .p12 + rastgele parola üretilir (git'e GİRMEZ, .gitignore).
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="cep-helper"
BUNDLE="com.badideagency.spread.helper"
OUT_ZXP="$PWD/release/spread-helper.zxp"
OUT_ZIP="$PWD/release/spread-helper-klasor.zip"
SIGN_DIR="$PWD/.signing"
ZXPSIGNCMD="${ZXPSIGNCMD:-}"
WINE="${WINE:-/usr/lib/wine/wine64}"

[ -n "$ZXPSIGNCMD" ] && [ -f "$ZXPSIGNCMD" ] || { echo "HATA: ZXPSIGNCMD=<ZXPSignCmd.exe yolu> verilmedi"; exit 2; }
run_sign() {
  if [[ "$ZXPSIGNCMD" == *.exe ]]; then WINEDEBUG=-all WINEPREFIX="${WINEPREFIX:-$SIGN_DIR/wineprefix}" "$WINE" "$ZXPSIGNCMD" "$@"; else "$ZXPSIGNCMD" "$@"; fi
}

node scripts/check-jsx.mjs

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$BUNDLE"
cp -R "$SRC/CSXS" "$SRC/index.html" "$SRC/js" "$SRC/jsx" "$STAGE/$BUNDLE/"
find "$STAGE" -type d -exec chmod 755 {} +
find "$STAGE" -type f -exec chmod 644 {} +
find "$STAGE" -exec touch -h -t 202601010000 {} +

# sertifika (yalnız yoksa)
mkdir -p "$SIGN_DIR"
if [ ! -f "$SIGN_DIR/spread-helper.p12" ]; then
  PASS="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
  echo "$PASS" > "$SIGN_DIR/password.txt"
  chmod 600 "$SIGN_DIR/password.txt"
  ( cd "$SIGN_DIR" && run_sign -selfSignedCert TR Istanbul "Bad Idea Agency" "Spread Helper" "$PASS" spread-helper.p12 -validityDays 3650 )
fi
PASS="$(cat "$SIGN_DIR/password.txt")"

mkdir -p release
rm -f "$OUT_ZXP" "$OUT_ZIP"
# ZXPSignCmd göreli yollarla çalıştırılır (Wine yol çevirisi)
cp "$SIGN_DIR/spread-helper.p12" "$STAGE/cert.p12"
(
  cd "$STAGE"
  if ! run_sign -sign "$BUNDLE" out.zxp cert.p12 "$PASS" -tsa http://timestamp.digicert.com >sign.log 2>&1; then
    echo "not: zaman damgası sunucusuna ulaşılamadı — zaman damgasız imzalanıyor (sertifika 10 yıl geçerli)"
    rm -f out.zxp
    run_sign -sign "$BUNDLE" out.zxp cert.p12 "$PASS"
  fi
  run_sign -verify out.zxp -certInfo -skipOnlineRevocationChecks | tee verify.log
  grep -qi "signature verified successfully" verify.log || { echo "HATA: imza doğrulanamadı"; exit 1; }
)
cp "$STAGE/out.zxp" "$OUT_ZXP"

# yedek klasör paketi: imzalı ZXP'nin açılmış hâli (META-INF imzası dahil) + kurulum betikleri
KIT="$STAGE/kit"
mkdir -p "$KIT/$BUNDLE"
( cd "$KIT/$BUNDLE" && unzip -q "$OUT_ZXP" )
cp scripts/helper-kit/KUR.cmd scripts/helper-kit/PlayerDebugMode_CSXS12.reg scripts/helper-kit/BENIOKU.txt "$KIT/"
find "$KIT" -type d -exec chmod 755 {} +
find "$KIT" -type f -exec chmod 644 {} +
find "$KIT" -exec touch -h -t 202601010000 {} +
( cd "$KIT" && find . -mindepth 1 | sed 's|^\./||' | LC_ALL=C sort | zip -X -q "$OUT_ZIP" -@ )

echo "✓ $OUT_ZXP ($(stat -c %s "$OUT_ZXP") bayt, sha256 $(sha256sum "$OUT_ZXP" | cut -c1-16)…)"
echo "✓ $OUT_ZIP ($(stat -c %s "$OUT_ZIP") bayt)"
