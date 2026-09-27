// Ekran görüntüleri (v1.2.0) — mock ortamında: smoke.cjs "screens" senaryosu (jsdom + gerçek panel HTML'i + mock Premiere + gerçek
// yardımcı sunucusu) belirli anlarda panelin HTML'ini yazar; burada Chromium (playwright-core) o HTML'leri dar (300 px) ve geniş
// (560 px) panel olarak PNG'ye çevirir. Spread Helper paneli için cep-helper/index.html, sahte bir durumla (SpreadHelperApp) açılır.
// v1.2.0: panelin kendi CSS'i her şeyi çizer (Spectrum bileşeni yok) → taklit yok. Tek fark yazı tipi: Premiere'de UXP'nin
// varsayılanı (Premiere'in arayüz yazı tipi), burada Open Sans (Segoe UI'a en yakın açık yazı tipi; yalnız ekran görüntüsü için,
// ~/.cache/spread-test'e indirilir, pakete girmez). Premiere'in UXP'si CSS geçişlerini çizmez; görüntüler durağan olduğundan fark yok.
// Kullanım: npm run build:spread && node spread/dev/screens.mjs [çıktı klasörü=docs/ekran]
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const out = resolve(process.argv[2] ?? join(root, "docs", "ekran"));
const html = mkdtempSync(join(tmpdir(), "spread-screens-"));
mkdirSync(out, { recursive: true });

execFileSync(process.execPath, [join(here, "smoke.cjs"), "screens"], { stdio: "inherit", env: { ...process.env, SPREAD_SCREENS: html } });

const EXE = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
// Open Sans (OFL, google/fonts) — Premiere'in arayüz yazı tipine / Segoe UI'a yakın; yoksa indirilir
const FONT = join(homedir(), ".cache", "spread-test", "opensans-OpenSans");
if (!existsSync(FONT)) {
  mkdirSync(dirname(FONT), { recursive: true });
  execFileSync("curl", ["-fsSL", "-o", FONT, "https://raw.githubusercontent.com/google/fonts/main/ofl/opensans/OpenSans%5Bwdth,wght%5D.ttf"]);
}
const FONT_CSS = `@font-face { font-family: "Premiere UI"; src: url("${pathToFileURL(FONT).href}"); font-weight: 300 800; }
  html, body { font-family: "Premiere UI", sans-serif; }`;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ deviceScaleFactor: 2 });
const WIDE = new Set(["01-baslangic", "02-dagitildi", "05-toplandi", "06-bagla-onay", "08-bitti", "09-hata", "14-guncelleme-seridi", "15-guncelleme-onay"]);
const made = [];
for (const f of readdirSync(html).filter((x) => x.endsWith(".html")).sort()) {
  const name = f.replace(/\.html$/, "");
  const content = readFileSync(join(html, f), "utf8");
  for (const w of WIDE.has(name) ? [300, 560] : [300]) {
    await page.setViewportSize({ width: w, height: 120 });
    await page.setContent(content, { waitUntil: "load" });
    await page.addStyleTag({ content: FONT_CSS });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    const file = join(out, `${name}-${w}.png`);
    await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 1500) } });
    made.push(file);
  }
}

// Spread Helper paneli: gerçek index.html + panel.js, sahte durum (sunucu / plan) ve sahte CEP teması (getHostEnvironment)
const helperUrl = pathToFileURL(join(root, "cep-helper", "index.html")).href;
const helperStates = {
  "20-yardimci-calisiyor": { listening: true, waiting: false, h: 30 },
  "21-yardimci-bagla-bekliyor": { listening: true, waiting: true, h: 30 },
  "22-yardimci-hata": { listening: false, error: "localhost:47731 kullanımda (EADDRINUSE)", h: 30 },
  "23-yardimci-ayrinti": { listening: true, waiting: false, h: 330, more: true },
};
for (const [name, st] of Object.entries(helperStates)) {
  const ctx = await browser.newContext({ viewport: { width: 300, height: st.h }, deviceScaleFactor: 2 });
  await ctx.addInitScript((s) => {
    const state = {
      version: "1.2.0",
      listening: s.listening,
      error: s.error || null,
      port: 47731,
      addresses: ["127.0.0.1", "::1"],
      v6: "dinliyor",
      premiere: "26.5.1",
      node: "v22.22.0",
      core: "1.1.0",
      persistent: true,
      infoFile: "C:\\Users\\kullanici\\AppData\\Roaming\\BadIdeaAgency\\SpreadHelper\\helper.json",
      requests: 12,
      lastRequest: { at: "2026-09-26T10:21:04Z", method: "POST", url: "/ping", status: 200, ms: 3 },
    };
    // CEP'in tema bilgisi (CSInterface.getHostEnvironment'ın alt çağrısı) — gerçekte Premiere verir. helper.js __adobe_cep__ görünce
    // kendi sunucusunu kurmaya çalışır (burada Node yok) → sahte durum nesnesi salt okunur tutulur (helper.js'in ataması yok sayılır).
    window.__adobe_cep__ = { addEventListener: () => {} };
    const stub = {
      lines: ["10:20:58 Spread Helper 1.2.0 açıldı", "10:20:58 dinliyor 127.0.0.1:47731", "10:20:59 arka sekmede kalıcılık (setExtensionPersistent): istendi"],
      helper: {
        state: () => state,
        subscribe: () => {},
        planStatus: () => ({ exists: true, waiting: s.waiting, linked: false, sequence: "Ana Kurgu", groups: 11, createdAt: "2026-09-26T10:20:00Z" }),
        readPlan: () => ({ sequence: "Ana Kurgu", groups: new Array(11), createdAt: "2026-09-26T10:20:00Z", from: "link-plan.json" }),
        bindFromPlan: () => Promise.resolve({ ok: true, summary: "✓ 11 grup bağlandı ve doğrulandı", rows: [], ignored: [], lines: [], notes: [] }),
      },
    };
    Object.defineProperty(window, "SpreadHelperApp", { get: () => stub, set: () => {}, configurable: false });
  }, st);
  const p = await ctx.newPage();
  await p.goto(helperUrl);
  await p.addStyleTag({ content: FONT_CSS });
  if (st.more) await p.click("#srv");
  const file = join(out, `${name}-300.png`);
  await p.screenshot({ path: file, fullPage: true });
  made.push(file);
  await ctx.close();
}
await browser.close();
rmSync(html, { recursive: true, force: true });
console.log(`✓ ${made.length} ekran görüntüsü → ${out}`);
