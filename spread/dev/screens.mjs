// Ekran görüntüleri (v1.0.0) — mock ortamında: smoke.cjs "screens" senaryosu (jsdom + gerçek panel HTML'i + mock Premiere + gerçek
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
const SP = `
  body { font-family: "Segoe UI", "Adobe Clean", "DejaVu Sans", sans-serif; }
  sp-button { display: inline-block; box-sizing: border-box; padding: 5px 14px; border-radius: 16px; border: 2px solid #6e6e6e;
    color: #e3e3e3; font-weight: bold; font-size: 12px; text-align: center; background: transparent; }
  sp-button[size="l"] { padding: 8px 18px; border-radius: 20px; font-size: 14px; }
  sp-button[variant="cta"] { background: #378ef0; border-color: #378ef0; color: #fff; }
  sp-button[quiet] { border-color: transparent; color: #b0b0b0; }
  sp-button[disabled] { opacity: .45; }
  input { background: #1d1d1d; color: #ddd; border: 1px solid #555; }
  select { background: #1d1d1d; color: #ddd; border: 1px solid #555; }
  textarea { background: #1d1d1d; color: #bbb; border: 1px solid #444; }`;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ deviceScaleFactor: 2 });
const WIDE = new Set(["01-hazir", "02-topla-onay", "04-topla-tamam", "05-bagla-onay", "07-bagla-tamam", "08-hata"]);
const made = [];
for (const f of readdirSync(html).filter((x) => x.endsWith(".html")).sort()) {
  const name = f.replace(/\.html$/, "");
  const content = readFileSync(join(html, f), "utf8");
  for (const w of WIDE.has(name) ? [300, 560] : [300]) {
    await page.setViewportSize({ width: w, height: 120 });
    await page.setContent(content, { waitUntil: "load" });
    await page.addStyleTag({ content: SP });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    const file = join(out, `${name}-${w}.png`);
    await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 1500) } });
    made.push(file);
  }
}

// Spread Helper paneli: gerçek index.html + panel.js, sahte durum (sunucu / plan)
const helperUrl = pathToFileURL(join(root, "cep-helper", "index.html")).href;
const helperStates = {
  "20-yardimci-calisiyor": { listening: true, waiting: false },
  "21-yardimci-bagla-bekliyor": { listening: true, waiting: true },
  "22-yardimci-hata": { listening: false, error: "localhost:47731 kullanımda (EADDRINUSE) — başka bir Premiere / yardımcı açık mı?" },
};
for (const [name, st] of Object.entries(helperStates)) {
  const ctx = await browser.newContext({ viewport: { width: 300, height: 140 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((s) => {
    const state = {
      version: "1.0.0",
      listening: s.listening,
      error: s.error || null,
      port: 47731,
      addresses: ["127.0.0.1", "::1"],
      v6: "dinliyor",
      premiere: "26.5.1",
      node: "v22.22.0",
      core: "1.0.0",
      infoFile: "C:\\Users\\kullanici\\AppData\\Roaming\\BadIdeaAgency\\SpreadHelper\\helper.json",
      requests: 12,
      lastRequest: { at: "2026-09-26T10:21:04Z", method: "POST", url: "/ping", status: 200, ms: 3 },
    };
    window.SpreadHelperApp = {
      lines: ["10:20:58 Spread Helper 1.0.0 açıldı"],
      helper: {
        state: () => state,
        subscribe: () => {},
        planStatus: () => ({ exists: true, waiting: s.waiting, linked: false, sequence: "Ana Kurgu", groups: 11, createdAt: "2026-09-26T10:20:00Z" }),
        readPlan: () => ({ sequence: "Ana Kurgu", groups: new Array(11), createdAt: "2026-09-26T10:20:00Z", from: "link-plan.json" }),
        bindFromPlan: () => Promise.resolve({ ok: true, summary: "✓ 11 grup bağlandı ve doğrulandı", rows: [], ignored: [], lines: [] }),
      },
    };
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
