#!/usr/bin/env bash
# KUR.cmd / KALDIR.cmd sınaması — Wine'da (gerçek Windows yerine; cmd.exe, reg.exe, xcopy aynı betikle çalışır).
# Sınanan: ilk kurulum (önceki PlayerDebugMode saklanır: CSXS.11 = "0", CSXS.12 yok), ikinci kurulum (saklanan değer bozulmaz),
# kaldırma (CSXS.11 yeniden "0", CSXS.12 değeri yok, yardımcı ve veri klasörleri silinir), zip açılmadan çalıştırma, yönetici reddi.
# Sınanamayan: Adobe UnifiedPluginInstallerAgent (Wine'da yok) — sahte bir .exe ile yalnız "kurulamadı" yolu görülür.
# Not: Wine'ın `net session`'ı 0 döndürür (yönetici sanılır) → sınamada o satır "cmd /c exit 1" (yönetici değil) ile değiştirilir.
# Kullanım: bash scripts/package-kurulum.sh && bash scripts/test-kurulum-wine.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
W=${WINE:-/usr/lib/wine/wine64}
[ -x "$W" ] || { echo "Wine yok ($W) — atlandı"; exit 0; }
ZIP=$(ls "$ROOT"/release/Spread_Kurulum_v*.zip | head -1)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export WINEPREFIX="$TMP/wp" WINEDEBUG=-all WINEDLLOVERRIDES="mscoree,mshtml="
timeout 300 "$W" wineboot -i >/dev/null 2>&1
D="$WINEPREFIX/drive_c/users/$(whoami)/AppData/Roaming"
winpath() { echo "Z:$(echo "$1" | sed 's|/|\\|g')"; }
q() { "$W" reg query "HKCU\\Software\\Adobe\\CSXS.$1" /v PlayerDebugMode 2>&1 | tr -d '\r' | awk '/PlayerDebugMode/{print $3; f=1} END{if(!f) print "YOK"}'; }
run() { printf '\r\n\r\n' | timeout 120 "$W" cmd /c "$(winpath "$1")\\$2" 2>&1 | tr -d '\r'; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1: $2"; else echo "  ✗ $1: $2 (beklenen $3)"; fail=1; fi; }
unpack() { rm -rf "$1"; mkdir -p "$1"; (cd "$1" && unzip -q "$ZIP" && sed -i "s/^net session >nul 2>&1\r\$/cmd \/c exit $2\r/" KUR.cmd KALDIR.cmd); }

"$W" reg add 'HKCU\Software\Adobe\CSXS.11' /v PlayerDebugMode /t REG_SZ /d 0 /f >/dev/null 2>&1
unpack "$TMP/kit" 1
echo "== KUR (ilk)"
o=$(run "$TMP/kit" KUR.cmd); echo "$o" | grep '\[' | sed 's/^/   /'
check "CSXS.11" "$(q 11)" 1; check "CSXS.12" "$(q 12)" 1
check "yardımcı" "$([ -f "$D/Adobe/CEP/extensions/com.badideagency.spread.helper/CSXS/manifest.xml" ] && echo var)" var
check "önceki değerler" "$(tr -d '\r' < "$D/BadIdeaAgency/SpreadKurulum/onceki.txt" | paste -sd' ')" "CSXS.11=REG_SZ;0 CSXS.12=YOK"
echo "== KUR (ikinci)"
run "$TMP/kit" KUR.cmd >/dev/null
check "önceki değerler korunur" "$(tr -d '\r' < "$D/BadIdeaAgency/SpreadKurulum/onceki.txt" | paste -sd' ')" "CSXS.11=REG_SZ;0 CSXS.12=YOK"
echo "== KALDIR"
o=$(run "$TMP/kit" KALDIR.cmd); echo "$o" | grep '\[' | sed 's/^/   /'
check "CSXS.11 geri" "$(q 11)" 0; check "CSXS.12 geri" "$(q 12)" YOK
check "yardımcı silindi" "$([ -e "$D/Adobe/CEP/extensions/com.badideagency.spread.helper" ] && echo var || echo yok)" yok
check "veriler silindi" "$([ -e "$D/BadIdeaAgency" ] && echo var || echo yok)" yok
echo "== zip açılmadan"
mkdir -p "$TMP/tek" && (cd "$TMP/tek" && unzip -q "$ZIP" KUR.cmd && sed -i "s/^net session >nul 2>&1\r\$/cmd \/c exit 1\r/" KUR.cmd)
check "uyarı" "$(run "$TMP/tek" KUR.cmd | grep -c 'CIKART')" 1
echo "== yönetici olarak"
unpack "$TMP/adm" 0
check "KUR reddeder" "$(run "$TMP/adm" KUR.cmd | grep -c 'YONETICI OLARAK')" 1
check "KALDIR reddeder" "$(run "$TMP/adm" KALDIR.cmd | grep -c 'YONETICI OLARAK')" 1
check "reddedince yazmadı" "$(q 12)" YOK
[ $fail = 0 ] && echo "KURULUM SINAMASI OK" || { echo "KURULUM SINAMASI FAIL"; exit 1; }
