#!/usr/bin/env bash
# publish-update sınaması (v1.2.0) — GitHub'a hiç çıkmadan, geçici yerel "bare" depolarla (güncelleme deposunun yerine).
# Sınanan: README'li depoya yayın (yalnız README.md + latest.json + releases/…zip; latest.json'daki sha256 = zip'in sha256'sı),
# aynı sürümün ikinci kez yayımlanması → RED, boş depoya yayın (main dalı açılır), depoda izin verilmeyen bir dosya (ör. kaynak kod)
# varsa → push YOK ve depo değişmez.
# Kullanım: bash scripts/package-kurulum.sh && bash scripts/test-publish-update.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VER=$(node -p 'require("'"$ROOT"'/spread/public/manifest.json").version')
ZIP="$ROOT/release/Spread_Kurulum_v$VER.zip"
[ -f "$ZIP" ] || { echo "HATA: $ZIP yok — önce scripts/package-kurulum.sh"; exit 1; }
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
g() { git -c user.name=sınama -c user.email=sinama@example.invalid "$@"; }
pub() { node "$ROOT/scripts/publish-update.mjs" --no-build --remote "$1" 2>&1 || true; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1: $2 (beklenen $3)"; fail=1; fi; }
seed() { # $1 bare repo; $2.. "yol=içerik"
  local bare=$1; shift
  git init -q --bare -b main "$bare"
  local w="$T/w-$(basename "$bare")"
  git clone -q "$bare" "$w" 2>/dev/null
  (cd "$w" && git checkout -q -b main 2>/dev/null || true
    for kv in "$@"; do mkdir -p "$(dirname "${kv%%=*}")"; printf '%s\n' "${kv#*=}" > "${kv%%=*}"; done
    g add -A && g commit -qm seed && git push -q origin HEAD:main 2>/dev/null)
}

echo "== README'li depo"
seed "$T/a.git" "README.md=# güncellemeler"
o=$(pub "$T/a.git"); echo "$o" | tail -1 | sed 's/^/   /'
check "yayımlandı" "$(echo "$o" | grep -c '✓ yayımlandı')" 1
check "depoda yalnız 3 yol" "$(git -C "$T/a.git" ls-tree -r --name-only main | paste -sd' ')" "README.md latest.json releases/Spread_Kurulum_v$VER.zip"
check "latest.json sha256 = zip" "$(git -C "$T/a.git" show main:latest.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).sha256))')" "$(sha256sum "$ZIP" | cut -c1-64)"
check "depodaki zip = release zip'i" "$(git -C "$T/a.git" show "main:releases/Spread_Kurulum_v$VER.zip" | sha256sum | cut -c1-64)" "$(sha256sum "$ZIP" | cut -c1-64)"
echo "== aynı sürüm ikinci kez"
check "reddedildi" "$(pub "$T/a.git" | grep -c 'ondan büyük olmalı')" 1
check "commit eklenmedi" "$(git -C "$T/a.git" rev-list --count main)" 2
echo "== boş depo"
git init -q --bare -b main "$T/b.git"
check "yayımlandı (main açıldı)" "$(pub "$T/b.git" | grep -c '✓ yayımlandı')" 1
echo "== depoda kaynak kod (izinsiz dosya)"
seed "$T/c.git" 'latest.json={"version":"0.0.1"}' "src/kaynak.ts=export const x = 1;"
before=$(git -C "$T/c.git" rev-parse main)
o=$(pub "$T/c.git")
check "push YAPILMADI" "$(echo "$o" | grep -c 'push YAPILMADI')" 1
check "depo değişmedi" "$(git -C "$T/c.git" rev-parse main)" "$before"

[ $fail = 0 ] && echo "YAYIN SINAMASI OK" || { echo "YAYIN SINAMASI BAŞARISIZ"; exit 1; }
