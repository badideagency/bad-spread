// Spread Probe — giriş noktası. Butonları testlere bağlar, PROBE_ kilidini arayüze yansıtır.
// Asıl kilit src/guard.ts'de: her test requireProbe() ile başlar; buton kilidi yalnızca görseldir.

import { getActive, isProbeName, requireProbe, sequenceName } from "./src/guard";
import { buildReport, readEnv, type Env } from "./src/report";
import { resetRunState, RUN_ALL_ORDER, runOne, scanSetup, TESTS, type TestResult } from "./src/tests";
import { errText } from "./src/timeline";
import { answer, byId, clearLog, isAsking, log, setReportText } from "./src/ui";

const results = new Map<string, TestResult>();
let setupLines: string[] = [];
let env: Env | null = null;
let busy = false;
let locked = true;

const ACTION_IDS = ["btn-all", "btn-scan", ...TESTS.map((t) => `btn-${t.id.toLowerCase()}`)];

function setDisabled(id: string, disabled: boolean): void {
  try {
    const b = byId(id);
    if (disabled) b.setAttribute("disabled", "true");
    else b.removeAttribute("disabled");
  } catch {
    /* öğe yoksa geç */
  }
}

function refreshButtons(): void {
  for (const id of ACTION_IDS) setDisabled(id, busy || locked);
}

function setStatus(text: string, ok: boolean): void {
  try {
    const s = byId("status");
    s.textContent = text;
    s.style.color = ok ? "#4cc27a" : "#ff6b6b";
    s.style.borderColor = ok ? "#4cc27a" : "#ff6b6b";
  } catch {
    /* yoksa geç */
  }
}

async function pollGuard(): Promise<void> {
  try {
    const { project, sequence } = await getActive();
    if (!project) {
      locked = true;
      setStatus("⚠ Açık proje yok — butonlar kilitli.", false);
    } else if (!sequence) {
      locked = true;
      setStatus("⚠ Aktif sequence yok — PROBE_test'i timeline'da aç. Butonlar kilitli.", false);
    } else {
      const name = sequenceName(sequence);
      locked = !isProbeName(name);
      setStatus(
        locked
          ? `⚠ Aktif sequence "${name}" — adı PROBE_ ile başlamıyor. Butonlar KİLİTLİ.`
          : `✓ Aktif sequence "${name}" — testler açık.`,
        !locked
      );
    }
  } catch (e) {
    locked = true;
    setStatus(`⚠ Durum okunamadı: ${errText(e)} — butonlar kilitli.`, false);
  }
  refreshButtons();
}

function updateReport(): void {
  try {
    setReportText(buildReport(results, env, setupLines));
  } catch (e) {
    log(`Rapor oluşturulamadı: ${errText(e)}`, "err");
  }
}

async function exclusive(label: string, fn: () => Promise<void>): Promise<void> {
  if (busy) {
    log(`"${label}" için bekle: başka bir işlem sürüyor.`, "warn");
    return;
  }
  if (locked) {
    log(`"${label}" çalışmadı: aktif sequence PROBE_ değil (kilitli).`, "err");
    return;
  }
  busy = true;
  refreshButtons();
  try {
    if (!env) env = await readEnv();
    await fn();
  } catch (e) {
    log(`Beklenmeyen hata: ${errText(e)}`, "err");
  } finally {
    busy = false;
    await pollGuard();
    updateReport();
  }
}

async function runAll(): Promise<void> {
  log(`Hepsini çalıştır — sıra: ${RUN_ALL_ORDER.join(", ")} (silen testler sona)`, "head");
  results.clear(); // eski koşunun sonuçları bu raporu/kararı etkilemesin
  resetRunState();
  setupLines = [];
  let pin: string;
  try {
    pin = (await requireProbe()).guid; // bütün koşu bu sequence'a sabitlenir
  } catch (e) {
    log(`KİLİT: ${errText(e)}`, "err");
    return;
  }
  setupLines = await scanSetup();
  for (const id of RUN_ALL_ORDER) {
    const def = TESTS.find((t) => t.id === id);
    if (!def) continue;
    const r = await runOne(def, pin);
    results.set(id, r);
    updateReport();
    if (r.lockError) {
      log("PROBE_ kilidi devreye girdi — kalan testler durduruldu.", "err");
      break;
    }
  }
  log("Bitti. Aşağıdaki 'Raporu kopyala' ile raporu al.", "head");
}

async function copyReport(): Promise<void> {
  updateReport();
  const text = (byId("report") as HTMLTextAreaElement).value;
  // UXP panosu (Premiere API değil). Tip: @adobe/cc-ext-uxp-types Clipboard (setContent / writeText).
  const cb = (navigator as unknown as {
    clipboard?: {
      setContent?: (d: Record<string, string>) => Promise<unknown>;
      writeText?: (t: unknown) => Promise<unknown>;
    };
  }).clipboard;
  const tries: [string, () => Promise<unknown>][] = [];
  if (cb?.setContent) tries.push(["setContent", () => cb.setContent!({ "text/plain": text })]);
  if (cb?.writeText) {
    tries.push(["writeText(string)", () => cb.writeText!(text)]);
    tries.push(["writeText({text/plain})", () => cb.writeText!({ "text/plain": text })]);
  }
  const errs: string[] = [];
  for (const [name, fn] of tries) {
    try {
      await fn();
      log(`✓ Rapor panoya kopyalandı (${name}, ${text.length} karakter). Sohbete yapıştırabilirsin.`, "ok");
      return;
    } catch (e) {
      errs.push(`${name}: ${errText(e)}`);
    }
  }
  log(`✗ Panoya kopyalanamadı (${errs.join(" | ") || "clipboard API yok"}).`, "err");
  log("   Alttaki rapor kutusuna tıkla, Ctrl+A (Mac: Cmd+A) ile seç, Ctrl+C (Mac: Cmd+C) ile kopyala.", "warn");
}

function on(id: string, fn: () => void): void {
  try {
    byId(id).addEventListener("click", fn);
  } catch (e) {
    log(`Buton bağlanamadı #${id}: ${errText(e)}`, "err");
  }
}

function init(): void {
  on("btn-all", () => void exclusive("Hepsini çalıştır", runAll));
  on("btn-scan", () =>
    void exclusive("Tara", async () => {
      setupLines = await scanSetup();
    })
  );
  for (const t of TESTS) {
    on(`btn-${t.id.toLowerCase()}`, () =>
      void exclusive(t.id, async () => {
        results.set(t.id, await runOne(t));
      })
    );
  }
  on("ask-yes", () => answer("Evet"));
  on("ask-no", () => answer("Hayır"));
  on("ask-skip", () => answer("Atla"));
  on("btn-copy", () => void copyReport());
  on("btn-clear", () => {
    if (!isAsking()) clearLog();
  });

  log("Spread Probe hazır. Önce 'Tara' ile kurulumu kontrol et, sonra 'Hepsini çalıştır'.", "head");
  log("Güvenlik: yalnızca adı PROBE_ ile başlayan AKTİF sequence'ta çalışır. Diske/projeye kayıt yapmaz.", "dim");
  updateReport();
  void pollGuard();
  setInterval(() => {
    if (!busy) void pollGuard();
  }, 1500);
}

try {
  init();
} catch (e) {
  const box = document.getElementById("log");
  if (box) box.textContent = `Panel başlatılamadı: ${errText(e)}`;
}
