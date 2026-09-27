#!/usr/bin/env bash
# Yeniden başlatıcı sınaması (v1.2.0) — Wine'da, gerçek Premiere OLMADAN, sahte bir süreçle.
#
# Sahte Premiere = Windows Node 17.7.1 (CEP 12'nin kendi Node sürümü), "C:\Program Files\Adobe\Sahte (Kurgu) & ş\Adobe Premiere Pro.exe"
# adıyla. Yardımcının (cep-helper/js/updater.js) KENDİ kodunu çalıştırır: restart-spread.cmd'yi yazar ve updater.restarterSpawnArgs
# ile AYNI biçimde başlatır (cmd /c start "" /b cmd /c call …, değerler ortam değişkeniyle), sonra kapanır. Yeniden açılan "Premiere"
# (aynı exe) proje yolunu argüman olarak alır; proje dosyası küçük bir JS'tir ve argümanları bir dosyaya yazar → doğru projeyle mi
# açıldı, görülür. Yollar boşluk, parantez, "&" ve Türkçe harf içerir.
#
# Senaryolar:
#   1) normal: başlatıcı, üst süreç (sahte Premiere) kapandıktan SONRA da yaşar; kapanmayı bekler, aynı exe'yi aynı projeyle açar
#   2) süreç listesi okunamıyor (Wine'ın find'ı /I'yı reddeder → errorlevel 2): HİÇBİR ŞEY açılmaz (ikinci Premiere yok)
#   3) Premiere süre dolana kadar kapanmıyor: HİÇBİR ŞEY açılmaz
# Wine farkı: Wine'ın find'ı /I bayrağını tanımaz (errorlevel 2) → 1 ve 3'te betikten " /I" atılır (gerçek Windows'ta /I var).
# Sınanamayan (gerçek Windows + Premiere gerekir): CEP motorunun dış bir iş nesnesinde (job) olup olmadığı — handoff.md.
# Kullanım: bash scripts/test-restarter-wine.sh   (Node 17.7.1 win-x64 ~/.cache/spread-test'e bir kez indirilir, sha256 doğrulanır)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
W=${WINE:-/usr/lib/wine/wine64}
[ -x "$W" ] || { echo "Wine yok ($W) — atlandı"; exit 0; }
export LANG=C.UTF-8
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/spread-test"
NODEV=v17.7.1
NODEZIP="$CACHE/node-$NODEV-win-x64.zip"
mkdir -p "$CACHE"
if [ ! -f "$NODEZIP" ]; then
  curl -fsSL -o "$NODEZIP.part" "https://nodejs.org/dist/$NODEV/node-$NODEV-win-x64.zip"
  mv "$NODEZIP.part" "$NODEZIP"
fi
want=$(curl -fsSL "https://nodejs.org/dist/$NODEV/SHASUMS256.txt" | awk -v f="node-$NODEV-win-x64.zip" '$2==f{print $1}')
got=$(sha256sum "$NODEZIP" | cut -d' ' -f1)
[ -n "$want" ] && [ "$want" = "$got" ] || { echo "HATA: Node zip'inin sha256'sı tutmuyor ($got ≠ $want)"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export WINEPREFIX="$TMP/wp" WINEDEBUG=-all WINEDLLOVERRIDES="mscoree,mshtml="
timeout 300 "$W" wineboot -i >/dev/null 2>&1
C="$WINEPREFIX/drive_c"
FAKEDIR="$C/Program Files/Adobe/Sahte (Kurgu) & ş"
mkdir -p "$FAKEDIR" "$C/rt"
unzip -q -j "$NODEZIP" "node-$NODEV-win-x64/node.exe" -d "$TMP"
cp "$TMP/node.exe" "$FAKEDIR/Adobe Premiere Pro.exe"
EXE='C:\Program Files\Adobe\Sahte (Kurgu) & ş\Adobe Premiere Pro.exe'
PRJDIR="$C/Projeler/Çekim 12 Eylül (A&B)"
mkdir -p "$PRJDIR"
PRJ='C:\Projeler\Çekim 12 Eylül (A&B)\Kurgu ş.prproj'
# "proje": yeniden açılan sahte Premiere bunu çalıştırır → argümanlarını yazar
printf '%s\n' "require('fs').writeFileSync('C:\\\\rt\\\\acildi.json', JSON.stringify(process.argv.slice(1)));" > "$PRJDIR/Kurgu ş.prproj"
DATA="$C/Kullanıcı Ali (Kurgu) & ş"
mkdir -p "$DATA"
UPD=$(echo "Z:$ROOT/cep-helper/js/updater.js" | sed 's|/|\\|g')

# sahte Premiere: yardımcının kodu (updater.js) + kapanış
cat > "$C/rt/sahte-premiere.js" <<'EOF'
const cp = require("child_process"), fs = require("fs"), path = require("path");
const U = require(process.env.T_UPDATER);
const dataDir = process.env.T_DATA;
const cmd = path.join(dataDir, "restart-spread.cmd");
let text = U.RESTART_CMD;
if (process.env.T_WINE_FIND === "1") text = text.split(" | find /I ").join(" | find ");
fs.writeFileSync(cmd, text);
const log = path.join(dataDir, "update.log");
const sp = U.restarterSpawnArgs(process.env.ComSpec, cmd, { SPREAD_IMG: path.win32.basename(process.execPath), SPREAD_EXE: process.execPath, SPREAD_PRJ: process.env.T_PRJ, SPREAD_LOG: log, SPREAD_MAX: process.env.T_MAX }, process.env);
const c = cp.spawn(sp.cmd, sp.args, sp.opts);
c.on("error", (e) => fs.appendFileSync(log, "spawn hatası " + e.message + "\n"));
c.unref();
fs.appendFileSync(log, "sahte premiere: başlatıcı başlatıldı, " + process.env.T_LIVE + " ms sonra kapanıyor\n");
setTimeout(() => process.exit(0), Number(process.env.T_LIVE));
EOF

fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1: $2"; else echo "  ✗ $1: $2 (beklenen $3)"; fail=1; fi; }
running() { "$W" cmd /c tasklist 2>/dev/null | tr -d '\r' | grep -c "Adobe Premiere Pro.exe" || true; }
scenario() { # $1 ad, $2 T_WINE_FIND, $3 T_MAX, $4 T_LIVE (ms), $5 bekleme (sn)
  rm -f "$C/rt/acildi.json" "$DATA/update.log"
  echo "== $1"
  T_UPDATER="$UPD" T_DATA='C:\Kullanıcı Ali (Kurgu) & ş' T_PRJ="$PRJ" T_WINE_FIND="$2" T_MAX="$3" T_LIVE="$4" \
    WINEDEBUG=-all timeout 60 "$W" "$EXE" 'C:\rt\sahte-premiere.js' >/dev/null 2>&1 || true
  for _ in $(seq 1 "$5"); do [ -f "$C/rt/acildi.json" ] && break; sleep 1; done
  sleep 2
  echo "   günlük: $(tr -d '\r' < "$DATA/update.log" 2>/dev/null | paste -sd'|' | sed 's/^[^|]*: //')"
}

scenario "1) normal: Premiere kapanınca aynı projeyle yeniden açılır" 1 60 3000 40
check "yeniden açıldı" "$([ -f "$C/rt/acildi.json" ] && echo evet || echo hayır)" evet
check "aynı proje (argüman)" "$(tr -d '\r' < "$C/rt/acildi.json" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s)[0])}catch{console.log("?")}})')" "$PRJ"
check "günlükte 'yeniden acildi'" "$(grep -c 'Premiere yeniden acildi' "$DATA/update.log" 2>/dev/null || true)" 1
"$W" cmd /c taskkill /F /IM "Adobe Premiere Pro.exe" >/dev/null 2>&1 || true
sleep 1

scenario "2) süreç listesi okunamıyor (find hatası) → hiçbir şey açılmaz" 0 60 3000 15
check "açılmadı" "$([ -f "$C/rt/acildi.json" ] && echo açıldı || echo açılmadı)" açılmadı
check "günlükte 'surec listesi okunamadi'" "$(grep -c 'surec listesi okunamadi' "$DATA/update.log" 2>/dev/null || true)" 1

scenario "3) Premiere süre dolana kadar kapanmıyor → hiçbir şey açılmaz" 1 3 30000 12
check "açılmadı" "$([ -f "$C/rt/acildi.json" ] && echo açıldı || echo açılmadı)" açılmadı
check "günlükte 'kapanmadi'" "$(grep -c 'kapanmadi - hicbir sey acilmadi' "$DATA/update.log" 2>/dev/null || true)" 1
"$W" cmd /c taskkill /F /IM "Adobe Premiere Pro.exe" >/dev/null 2>&1 || true
wineserver -k 2>/dev/null || true

[ $fail = 0 ] && echo "YENİDEN BAŞLATICI SINAMASI OK" || { echo "YENİDEN BAŞLATICI SINAMASI BAŞARISIZ"; exit 1; }
