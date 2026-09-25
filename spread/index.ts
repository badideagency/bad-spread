// Spread — giriş noktası. SPREAD ve DURUM RAPORU butonları, aktif sequence göstergesi, meşgul kilidi, rapor kopyalama.

import { getActive, sequenceName } from "./src/session";
import { runSpread } from "./src/spread";
import { buildStatusReport } from "./src/status";
import { errText } from "./src/model";
import { answer, byId, clearLog, isAsking, log, setReportText } from "./src/ui";

let busy = false;
const ACTIONS = ["btn-spread", "btn-status"];

function setDisabled(id: string, disabled: boolean): void {
  try {
    const b = byId(id);
    if (disabled) b.setAttribute("disabled", "true");
    else b.removeAttribute("disabled");
  } catch {
    /* yoksa geç */
  }
}

async function refresh(): Promise<void> {
  let ok = false;
  try {
    const { project, sequence } = await getActive();
    const s = byId("status");
    if (!project) s.textContent = "Açık proje yok.";
    else if (!sequence) s.textContent = "Aktif sequence yok — timeline'a bir kez tıkla.";
    else {
      s.textContent = `Aktif sequence: "${sequenceName(sequence)}"`;
      ok = true;
    }
    s.style.color = ok ? "#4cc27a" : "#e8b04a";
  } catch (e) {
    try {
      byId("status").textContent = `Durum okunamadı: ${errText(e)}`;
    } catch {
      /* yoksa geç */
    }
  }
  for (const id of ACTIONS) setDisabled(id, busy || !ok);
}

async function exclusive(label: string, fn: () => Promise<void>): Promise<void> {
  if (busy) {
    log(`"${label}" için bekle: başka bir işlem sürüyor.`, "warn");
    return;
  }
  busy = true;
  await refresh();
  try {
    await fn();
  } catch (e) {
    log(`Beklenmeyen hata: ${errText(e)}`, "err");
  } finally {
    busy = false;
    await refresh();
  }
}

async function copyReport(): Promise<void> {
  const text = (byId("report") as HTMLTextAreaElement).value;
  if (!text) {
    log("Önce 'Durum raporu'na bas.", "warn");
    return;
  }
  // UXP panosu (Premiere API değil). Tip: @adobe/cc-ext-uxp-types Clipboard (setContent / writeText).
  const cb = (navigator as unknown as {
    clipboard?: { setContent?: (d: Record<string, string>) => Promise<unknown>; writeText?: (t: unknown) => Promise<unknown> };
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
      log(`✓ Rapor panoya kopyalandı (${name}, ${text.length} karakter).`, "ok");
      return;
    } catch (e) {
      errs.push(`${name}: ${errText(e)}`);
    }
  }
  log(`✗ Panoya kopyalanamadı (${errs.join(" | ") || "clipboard API yok"}). Rapor kutusuna tıkla, Ctrl+A / Ctrl+C.`, "err");
}

function on(id: string, fn: () => void): void {
  try {
    byId(id).addEventListener("click", fn);
  } catch (e) {
    log(`Buton bağlanamadı #${id}: ${errText(e)}`, "err");
  }
}

function init(): void {
  on("btn-spread", () => void exclusive("SPREAD", runSpread));
  on("btn-status", () =>
    void exclusive("Durum raporu", async () => {
      log("▶ Durum raporu", "head");
      const text = await buildStatusReport();
      setReportText(text);
      log(`✓ Durum raporu hazır (${text.split("\n").length} satır). 'Raporu kopyala' ile al.`, "ok");
    })
  );
  on("ask-yes", () => answer("Evet"));
  on("ask-no", () => answer("Hayır"));
  on("btn-copy", () => void copyReport());
  on("btn-clear", () => {
    if (!isAsking()) clearLog();
  });
  log("Spread hazır. SPREAD: klipleri kendi track'lerine dağıtır (zamanlar değişmez). Önce onay ister ve yedek sequence alır.", "head");
  void refresh();
  setInterval(() => {
    if (!busy) void refresh();
  }, 1500);
}

try {
  init();
} catch (e) {
  const box = document.getElementById("log");
  if (box) box.textContent = `Panel başlatılamadı: ${errText(e)}`;
}
