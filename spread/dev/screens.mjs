// Ekran görüntüleri (v1.1.0) — mock ortamında: smoke.cjs "screens" senaryosu (jsdom + gerçek panel HTML'i + mock Premiere + gerçek
// yardımcı sunucusu) belirli anlarda panelin HTML'ini yazar; burada Chromium (playwright-core) o HTML'leri dar (300 px) ve geniş
// (560 px) panel olarak PNG'ye çevirir. Spread Helper paneli için cep-helper/index.html, sahte bir durumla (SpreadHelperApp) açılır.
// Not: Premiere'de düğmeler Spectrum (sp-button) çizer; burada benzer bir stille taklit edilir.
// Kullanım: npm run build:spread && node spread/dev/screens.mjs [çıktı klasörü=docs/ekran]
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
// Premiere'de Spectrum UXP bileşenleri (sp-*) temayı kendileri çizer; Chromium'da yok → burada Premiere'in KOYU temasına benzer bir
// taklit (yalnız ekran görüntüsü için; panelin kendi CSS'inde renk yok). Panel zemini = Premiere panel rengi.
const SP = `
  html, body { background: #232323; color: #d0d0d0; font-family: "Segoe UI", "Adobe Clean", "DejaVu Sans", sans-serif; font-size: 12px; }
  sp-heading { display: block; font-weight: bold; color: #e8e8e8; }
  sp-heading[size="XS"] { font-size: 15px; }
  sp-heading[size="XXS"] { font-size: 13px; margin-bottom: 4px; }
  sp-body { display: block; font-size: 13px; line-height: 18px; color: #d0d0d0; }
  sp-body[size="S"] { font-size: 12px; }
  sp-body.attn { font-weight: bold; }
  sp-detail { display: block; font-size: 11px; line-height: 15px; color: #9a9a9a; }
  sp-divider { display: block; height: 1px; background: #3e3e3e; }
  sp-link { display: inline-block; font-size: 12px; color: #6fa8ff; text-decoration: underline; cursor: pointer; }
  sp-button { display: inline-block; box-sizing: border-box; padding: 3px 12px; border-radius: 14px; border: 2px solid #6e6e6e;
    color: #e3e3e3; font-weight: bold; font-size: 12px; text-align: center; background: transparent; white-space: nowrap; }
  sp-button[variant="cta"] { background: #1473e6; border-color: #1473e6; color: #fff; }
  sp-button[disabled] { opacity: .45; }
  sp-action-button { display: inline-block; padding: 3px 6px; border-radius: 4px; color: #c8c8c8; font-size: 12px; white-space: nowrap; }
  sp-progressbar { display: block; height: 4px; border-radius: 2px; background: #4a4a4a; margin: 2px 0 4px; position: relative; overflow: hidden; }
  sp-progressbar::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: var(--pb, 2%); background: #378ef0; }
  input { background: #1d1d1d; color: #ddd; border: 1px solid #555; }
  select { background: #1d1d1d; color: #ddd; border: 1px solid #555; }
  textarea { background: #1d1d1d; color: #bbb; border: 1px solid #444; }`;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ deviceScaleFactor: 2 });
const WIDE = new Set(["01-baslangic", "02-dagitildi", "05-toplandi", "06-bagla-onay", "08-bitti", "09-hata"]);
const made = [];
for (const f of readdirSync(html).filter((x) => x.endsWith(".html")).sort()) {
  const name = f.replace(/\.html$/, "");
  const content = readFileSync(join(html, f), "utf8");
  for (const w of WIDE.has(name) ? [300, 560] : [300]) {
    await page.setViewportSize({ width: w, height: 120 });
    await page.setContent(content, { waitUntil: "load" });
    await page.addStyleTag({ content: SP });
    // ilerleme çubuğu: value özniteliği → genişlik (UXP'de bileşen kendisi çizer)
    await page.evaluate(() => {
      for (const b of document.querySelectorAll("sp-progressbar")) b.style.setProperty("--pb", `${Number(b.getAttribute("value") || 2)}%`);
    });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    const file = join(out, `${name}-${w}.png`);
    await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 1500) } });
    made.push(file);
  }
}

// Spread Helper paneli: gerçek index.html + panel.js, sahte durum (sunucu / plan) ve sahte CEP teması (getHostEnvironment)
const helperUrl = pathToFileURL(join(root, "cep-helper", "index.html")).href;
const DARK = { red: 35, green: 35, blue: 35 };
const LIGHT = { red: 214, green: 214, blue: 214 };
const helperStates = {
  "20-yardimci-calisiyor": { listening: true, waiting: false, bg: DARK, h: 26 },
  "21-yardimci-bagla-bekliyor": { listening: true, waiting: true, bg: DARK, h: 26 },
  "22-yardimci-hata": { listening: false, error: "localhost:47731 kullanımda (EADDRINUSE)", bg: DARK, h: 26 },
  "23-yardimci-acik-tema": { listening: true, waiting: false, bg: LIGHT, h: 26 },
};
for (const [name, st] of Object.entries(helperStates)) {
  const ctx = await browser.newContext({ viewport: { width: 300, height: st.h }, deviceScaleFactor: 2 });
  await ctx.addInitScript((s) => {
    const state = {
      version: "1.1.0",
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
    window.__adobe_cep__ = {
      getHostEnvironment: () => JSON.stringify({ appSkinInfo: { panelBackgroundColor: { color: { ...s.bg, alpha: 255 } }, baseFontFamily: "DejaVu Sans", baseFontSize: 11 } }),
      addEventListener: () => {},
    };
    const stub = {
      lines: ["10:20:58 Spread Helper 1.1.0 açıldı"],
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
  const file = join(out, `${name}-300.png`);
  await p.screenshot({ path: file, fullPage: true });
  made.push(file);
  await ctx.close();
}
await browser.close();
rmSync(html, { recursive: true, force: true });
console.log(`✓ ${made.length} ekran görüntüsü → ${out}`);
