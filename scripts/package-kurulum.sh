#!/usr/bin/env bash
# Spread 1.0.0 — tek tık kurulum paketi: release/Spread_Kurulum_v<sürüm>.zip
#   spread.ccx     Spread paneli (UXP) — KUR.cmd Adobe UnifiedPluginInstallerAgent'la kurar (bulamazsa: çift tıkla)
#   SpreadHelper/  Spread Helper (CEP, İMZASIZ klasör) — KUR.cmd %APPDATA%\Adobe\CEP\extensions altına kopyalar
#   KUR.cmd        yönetici izni istemez; yalnız HKCU (PlayerDebugMode) + %APPDATA% (önceki değerleri saklar)
#   KALDIR.cmd     KUR.cmd'nin yaptığı her şeyi geri alır (PlayerDebugMode kurulum öncesi hâline)
#   OKU_BENI.txt   bir sayfa, günlük kullanım
# Neden imzasız klasör (ZXP değil): ADIM 3.2 (handoff.md) — zaman damgasız imzalı ZXP gerçek Premiere'de yüklenmedi; imzasız klasör +
# PlayerDebugMode=1 Adobe'nin belgelediği geliştirici yolu (CEP 12 Cookbook, "Debugging Unsigned Extensions").
set -euo pipefail
cd "$(dirname "$0")/.."

VER="$(node -p 'require("./spread/public/manifest.json").version')"
HVER="$(grep -o 'var VERSION = "[^"]*"' cep-helper/js/helper.js | cut -d'"' -f2)"
[ "$VER" = "$HVER" ] || { echo "HATA: Spread $VER ≠ yardımcı $HVER — ikisi aynı sürümle yayımlanır"; exit 1; }
OUT="$PWD/release/Spread_Kurulum_v$VER.zip"

node scripts/check-jsx.mjs
node scripts/check-core.mjs
python3 scripts/check-xml.py
bash scripts/package-ccx.sh spread

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
KIT="$STAGE/kit"
mkdir -p "$KIT/SpreadHelper"
cp release/spread.ccx "$KIT/"
cp -R cep-helper/CSXS cep-helper/index.html cep-helper/js cep-helper/jsx cep-helper/.debug "$KIT/SpreadHelper/"
for f in CSXS/manifest.xml .debug index.html js/spread-core.js js/helper.js js/panel.js jsx/host.jsx; do
  [ -f "$KIT/SpreadHelper/$f" ] || { echo "HATA: pakette SpreadHelper/$f yok"; exit 1; }
done
python3 scripts/check-xml.py "$KIT/SpreadHelper" >/dev/null || { echo "HATA: paketteki XML geçersiz"; exit 1; }
# Windows dosyaları: CRLF; .cmd yalnız ASCII (cmd.exe kod sayfasından bağımsız); OKU_BENI.txt UTF-8 + BOM (Not Defteri)
for f in KUR.cmd KALDIR.cmd; do
  if LC_ALL=C grep -q '[^ -~[:space:]]' "scripts/kurulum/$f"; then echo "HATA: $f ASCII dışı karakter içeriyor"; exit 1; fi
  sed 's/\r$//; s/$/\r/' "scripts/kurulum/$f" > "$KIT/$f"
done
{ printf '\xEF\xBB\xBF'; sed 's/\r$//; s/$/\r/' scripts/kurulum/OKU_BENI.txt; } > "$KIT/OKU_BENI.txt"
grep -q "Spread $VER" "$KIT/KUR.cmd" || { echo "HATA: KUR.cmd sürümü $VER değil"; exit 1; }

find "$KIT" -type d -exec chmod 755 {} +
find "$KIT" -type f -exec chmod 644 {} +
find "$KIT" -exec touch -h -t 202601010000 {} +
mkdir -p release
rm -f "$OUT"
( cd "$KIT" && find . -mindepth 1 | sed 's|^\./||' | LC_ALL=C sort | zip -X -q "$OUT" -@ )
if unzip -l "$OUT" | grep -q "META-INF"; then echo "HATA: kitte imza (META-INF) var — imzasız olmalı"; exit 1; fi
for f in spread.ccx KUR.cmd KALDIR.cmd OKU_BENI.txt SpreadHelper/CSXS/manifest.xml; do
  unzip -l "$OUT" | grep -q " $f\$" || { echo "HATA: zip'te $f yok"; exit 1; }
done
echo "✓ $OUT ($(stat -c %s "$OUT") bayt): spread.ccx + SpreadHelper/ + KUR.cmd + KALDIR.cmd + OKU_BENI.txt"
