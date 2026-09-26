#!/usr/bin/env bash
# KUR.cmd / KALDIR.cmd sınaması — Wine'da (gerçek Windows yerine; cmd.exe, reg.exe, xcopy aynı betikle çalışır).
# Sınanan: ilk kurulum (önceki PlayerDebugMode saklanır: CSXS.11 = "0", CSXS.12 yok), ikinci kurulum (saklanan değer bozulmaz),
# kaldırma (CSXS.11 yeniden "0", CSXS.12 değeri yok, yardımcı ve veri klasörleri silinir), zip açılmadan çalıştırma, yönetici reddi,
# boşluk + parantez içeren kurulum klasörü, ")" içeren %APPDATA%, Adobe kurucusu (UPIA) yolu: sahte UnifiedPluginInstallerAgent.exe
# (Wine'ın whoami.exe'si → çıkış 0 = "kurdu", hostname.exe → çıkış 1 = "kurulamadı"), UPIA yokken "bulunamadı".
# Sınanamayan: gerçek Adobe kurucusu (Wine'da yok) — gerçek Windows'ta ilk kurulumda görülecek.
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
UPIA="$WINEPREFIX/drive_c/Program Files/Common Files/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent"
fake_upia() { rm -rf "$UPIA"; [ "$1" = yok ] && return 0; mkdir -p "$UPIA"; cp "$WINEPREFIX/drive_c/windows/system32/$1.exe" "$UPIA/UnifiedPluginInstallerAgent.exe"; }
winpath() { echo "Z:$(echo "$1" | sed 's|/|\\|g')"; }
q() { "$W" reg query "HKCU\\Software\\Adobe\\CSXS.$1" /v PlayerDebugMode 2>&1 | tr -d '\r' | awk '/PlayerDebugMode/{print $3; f=1} END{if(!f) print "YOK"}'; }
# "cmd /c call" — Wine'ın cmd /c'si parantezli yolu tırnakla bile açamıyor (Windows'ta çift tıklama "cmd /c ""yol" "" ile açar, sorun yok)
run() { printf '\r\n\r\n' | timeout 120 "$W" cmd /c call "$(winpath "$1")\\$2" 2>&1 | tr -d '\r'; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1: $2"; else echo "  ✗ $1: $2 (beklenen $3)"; fail=1; fi; }
unpack() { rm -rf "$1"; mkdir -p "$1"; (cd "$1" && unzip -q "$ZIP" && sed -i "s/^net session >nul 2>&1\r\$/cmd \/c exit $2\r/" KUR.cmd KALDIR.cmd); }

"$W" reg add 'HKCU\Software\Adobe\CSXS.11' /v PlayerDebugMode /t REG_SZ /d 0 /f >/dev/null 2>&1
KIT="$TMP/Spread Kurulum (1)"
unpack "$KIT" 1
echo "== KUR (ilk; klasör adında boşluk + parantez; Adobe kurucusu yok)"
fake_upia yok
o=$(run "$KIT" KUR.cmd); echo "$o" | { grep '\[' || true; } | sed 's/^/   /'
check "UPIA yok → çift tıkla" "$(echo "$o" | grep -c 'kurucusu bulunamadi')" 1
check "CSXS.11" "$(q 11)" 1; check "CSXS.12" "$(q 12)" 1
check "yardımcı" "$([ -f "$D/Adobe/CEP/extensions/com.badideagency.spread.helper/CSXS/manifest.xml" ] && echo var)" var
check "önceki değerler" "$(tr -d '\r' < "$D/BadIdeaAgency/SpreadKurulum/onceki.txt" | paste -sd' ')" "CSXS.11=REG_SZ;0 CSXS.12=YOK"
echo "== KUR (ikinci; Adobe kurucusu 0 döndürür)"
fake_upia whoami
o=$(run "$KIT" KUR.cmd); echo "$o" | { grep '\[' || true; } | sed 's/^/   /'
check "UPIA 0 → kurdu" "$(echo "$o" | grep -c 'kurdugunu bildirdi')" 1
check "önceki değerler korunur" "$(tr -d '\r' < "$D/BadIdeaAgency/SpreadKurulum/onceki.txt" | paste -sd' ')" "CSXS.11=REG_SZ;0 CSXS.12=YOK"
echo "== KUR (üçüncü; Adobe kurucusu 1 döndürür)"
fake_upia hostname
o=$(run "$KIT" KUR.cmd); echo "$o" | { grep '\[' || true; } | sed 's/^/   /'
check "UPIA 1 → kurulamadı" "$(echo "$o" | grep -c 'paneli kurulamadi')" 1
check "yardımcı yine kuruldu" "$(echo "$o" | grep -c 'Spread Helper kopyalandi')" 1
echo "== KALDIR (Adobe kurucusu 0 döndürür)"
fake_upia whoami
o=$(run "$KIT" KALDIR.cmd); echo "$o" | { grep '\[' || true; } | sed 's/^/   /'
check "UPIA /remove" "$(echo "$o" | grep -c 'kaldirdigini bildirdi')" 1
check "CSXS.11 geri" "$(q 11)" 0; check "CSXS.12 geri" "$(q 12)" YOK
check "yardımcı silindi" "$([ -e "$D/Adobe/CEP/extensions/com.badideagency.spread.helper" ] && echo var || echo yok)" yok
check "veriler silindi" "$([ -e "$D/BadIdeaAgency" ] && echo var || echo yok)" yok
echo "== %APPDATA% içinde \")\" (kullanıcı adı \"Ali (Kurgu)\" gibi)"
fake_upia yok
PA='C:\users\'"$(whoami)"'\AppData\Roaming\Ali (Kurgu)'
PD="$D/Ali (Kurgu)"
printf '@echo off\r\nset "APPDATA=%s"\r\ncall "%%~dp0%%1"\r\n' "$PA" > "$KIT/paren.cmd"
runp() { printf '\r\n\r\n' | timeout 120 "$W" cmd /c call "$(winpath "$KIT")\\paren.cmd" "$1" 2>&1 | tr -d '\r'; }
o=$(runp KUR.cmd); echo "$o" | { grep '\[' || true; } | sed 's/^/   /'
check "yardımcı (parantezli APPDATA)" "$([ -f "$PD/Adobe/CEP/extensions/com.badideagency.spread.helper/CSXS/manifest.xml" ] && echo var)" var
check "önceki değerler (parantezli APPDATA)" "$(tr -d '\r' < "$PD/BadIdeaAgency/SpreadKurulum/onceki.txt" | paste -sd' ')" "CSXS.11=REG_SZ;0 CSXS.12=YOK"
o=$(runp KALDIR.cmd); echo "$o" | { grep '\[' || true; } | sed 's/^/   /'
check "CSXS.11 geri (parantezli)" "$(q 11)" 0; check "CSXS.12 geri (parantezli)" "$(q 12)" YOK
check "yardımcı silindi (parantezli)" "$([ -e "$PD/Adobe/CEP/extensions/com.badideagency.spread.helper" ] && echo var || echo yok)" yok
check "veriler silindi (parantezli)" "$([ -e "$PD/BadIdeaAgency" ] && echo var || echo yok)" yok
echo "== zip açılmadan"
mkdir -p "$TMP/tek" && (cd "$TMP/tek" && unzip -q "$ZIP" KUR.cmd && sed -i "s/^net session >nul 2>&1\r\$/cmd \/c exit 1\r/" KUR.cmd)
check "uyarı" "$(run "$TMP/tek" KUR.cmd | grep -c 'CIKART')" 1
echo "== yönetici olarak"
unpack "$TMP/adm" 0
check "KUR reddeder" "$(run "$TMP/adm" KUR.cmd | grep -c 'YONETICI OLARAK')" 1
check "KALDIR reddeder" "$(run "$TMP/adm" KALDIR.cmd | grep -c 'YONETICI OLARAK')" 1
check "reddedince yazmadı" "$(q 12)" YOK
[ $fail = 0 ] && echo "KURULUM SINAMASI OK" || { echo "KURULUM SINAMASI FAIL"; exit 1; }
