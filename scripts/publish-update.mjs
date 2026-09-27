// Spread güncelleme yayını (v1.2.0): npm run publish-update
//
//  1. Kurulum paketini üretir (scripts/package-kurulum.sh → release/Spread_Kurulum_v<sürüm>.zip; Spread ve yardımcı AYNI sürüm).
//  2. sha256'sını hesaplar.
//  3. Güncelleme deposunu (HERKESE AÇIK, yalnız zip + latest.json + README) geçici bir klasöre klonlar, zip'i
//     releases/Spread_Kurulum_v<sürüm>.zip olarak koyar, latest.json'u yazar, commit + push.
//
// Kurallar:
//  - Kaynak kod ASLA gitmez: depoda yalnız README.md, latest.json, releases/Spread_Kurulum_v*.zip olabilir; başka bir yol görülürse
//    push YAPILMAZ.
//  - Yayımlanmış bir zip'in üstüne yazılmaz (aynı sürüm ikinci kez yayımlanamaz; yeni sürüm numarası ver).
//  - Yeni sürüm latest.json'daki sürümden BÜYÜK olmalı.
//  - Notlar scripts/update-notes.json'dan: { "<sürüm>": ["1–3 Türkçe madde"] }. latest.json, yardımcının kullandığı AYNI doğrulayıcıdan
//    geçer (cep-helper/js/updater.js validateLatest).
//
// Seçenekler: --no-build (release/'deki zip'i kullan) · --dry-run (push yok; ne yapılacağını yazar) · --remote <git adresi>
// (sınama için; varsayılan https://github.com/badideagency/bad-spread-updates.git) · --date YYYY-MM-DD
// Push izni yoksa git'in hatasıyla DURUR ve ne yapılacağını yazar.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL("..", import.meta.url)); // Windows / boşluklu / Türkçe yollarda da doğru
const U = require(join(ROOT, "cep-helper/js/updater.js"));

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(name);
const REMOTE = opt("--remote") ?? `https://github.com/${U.UPDATE_REPO}.git`;
const DRY = has("--dry-run");

function die(msg) {
  console.error(`HATA: ${msg}`);
  process.exit(1);
}
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const manifest = JSON.parse(readFileSync(join(ROOT, "spread/public/manifest.json"), "utf8"));
const VER = manifest.version;
const MIN_PPRO = manifest.host?.minVersion;
const notesAll = JSON.parse(readFileSync(join(ROOT, "scripts/update-notes.json"), "utf8"));
const notes = notesAll[VER];
if (!notes) die(`scripts/update-notes.json'da ${VER} için not yok (1–3 Türkçe madde)`);

if (!has("--no-build")) execFileSync("bash", [join(ROOT, "scripts/package-kurulum.sh")], { cwd: ROOT, stdio: "inherit" });
const ZIP = join(ROOT, `release/Spread_Kurulum_v${VER}.zip`);
if (!existsSync(ZIP)) die(`${ZIP} yok`);
const zipBuf = readFileSync(ZIP);
const sha256 = createHash("sha256").update(zipBuf).digest("hex");

// paket, yardımcının kuracağı paketle aynı denetimden geçmeli (zip okunur, gerekli dosyalar, sürümler)
const kit = U.checkKit(U.readZip(require("node:zlib"), zipBuf), VER);
U.checkCcx(require("node:zlib"), kit["spread.ccx"], VER);

const rel = `releases/Spread_Kurulum_v${VER}.zip`;
const latest = U.validateLatest({
  version: VER,
  date: opt("--date") ?? new Date().toISOString().slice(0, 10),
  notes,
  zip_url: `${U.ZIP_PREFIX}main/${rel}`,
  sha256,
  min_premiere: MIN_PPRO,
});

const work = mkdtempSync(join(tmpdir(), "spread-updates-"));
try {
  try {
    git(tmpdir(), "clone", "--depth", "1", REMOTE, work);
  } catch (e) {
    die(
      `güncelleme deposu klonlanamadı (${REMOTE}):\n${String(e.stderr || e.message).trim()}\n` +
        `Yapılacak: GitHub'da herkese açık "${U.UPDATE_REPO}" deposunu oluştur (README'li, main dalı) ve bu makinede ona push iznin olsun.`
    );
  }
  // boş depo (hiç commit yok) → main dalı burada açılır; yayın adresi hep main
  try {
    git(work, "rev-parse", "HEAD");
  } catch {
    git(work, "checkout", "-q", "-b", "main");
  }
  const prevFile = join(work, "latest.json");
  if (existsSync(prevFile)) {
    const prev = JSON.parse(readFileSync(prevFile, "utf8"));
    if (U.cmpVersion(VER, prev.version) <= 0) die(`yayındaki sürüm ${prev.version}; yeni sürüm (${VER}) ondan büyük olmalı`);
  }
  const dest = join(work, rel);
  if (existsSync(dest)) die(`${rel} zaten yayımlanmış — üstüne yazılmaz; sürüm numarasını artır`);
  mkdirSync(join(work, "releases"), { recursive: true });
  copyFileSync(ZIP, dest);
  writeFileSync(prevFile, JSON.stringify(latest, null, 2) + "\n");
  writeFileSync(
    join(work, "README.md"),
    [
      "# Spread — güncellemeler",
      "",
      "Bu depo yalnız **Spread** (Premiere Pro paneli) ve **Spread Helper** kurulum paketlerini ve `latest.json`'u barındırır; kaynak kod",
      "burada değildir. Panel açılışta ve 6 saatte bir `latest.json`'u okur; kullanıcı onaylarsa Spread Helper paketi indirir, sha256'yı",
      "doğrular ve kurar.",
      "",
      `Son sürüm: **${VER}** (${latest.date}) — \`${rel}\``,
      "",
      "Elle kurulum: zip'i indir → çıkart → `KUR.cmd`.",
      "",
    ].join("\n")
  );
  git(work, "add", "-A");
  const staged = git(work, "ls-files").split("\n").filter(Boolean);
  const allowed = (p) => p === "README.md" || p === "latest.json" || /^releases\/Spread_Kurulum_v\d+\.\d+\.\d+\.zip$/.test(p);
  const bad = staged.filter((p) => !allowed(p));
  if (bad.length) die(`güncelleme deposunda izin verilmeyen dosya(lar) var — push YAPILMADI:\n  ${bad.join("\n  ")}`);
  console.log(`latest.json:\n${JSON.stringify(latest, null, 2)}`);
  console.log(`depodaki dosyalar: ${staged.join(", ")}`);
  if (DRY) {
    console.log("--dry-run: commit / push yok");
  } else {
    git(work, "-c", "user.name=Spread yayın", "-c", "user.email=noreply@badideagency", "commit", "-q", "-m", `Spread ${VER}`);
    try {
      git(work, "push", "origin", "HEAD:main");
    } catch (e) {
      die(
        `push reddedildi (${REMOTE}):\n${String(e.stderr || e.message).trim()}\n` +
          `Yapılacak: bu makinedeki GitHub hesabına "${U.UPDATE_REPO}" deposunda yazma izni ver (ya da depoyu oluştur), sonra tekrar çalıştır.`
      );
    }
    console.log(`✓ yayımlandı: Spread ${VER} → ${U.LATEST_URL}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
