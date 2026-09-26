// Spread — giriş noktası. SPREAD / TOPLA / BAĞLA / DURUM RAPORU butonları, aktif sequence göstergesi, yardımcı göstergesi,
// "tutulacak harici kanallar" ayarı, meşgul kilidi, rapor kopyalama.

import { getActive, requireActive, sequenceGuid, sequenceName } from "./src/session";
import { runSpread } from "./src/spread";
import { runCollect } from "./src/topla";
import { runBind } from "./src/bagla";
import { buildStatusReport } from "./src/status";
import { classify, sourcesOf } from "./src/classify";
import { getLinker } from "./src/linker";
import { bindSettingInputs, renderMapping } from "./src/settings";
import { errText, snapshot } from "./src/model";
import { answer, byId, clearLog, isAsking, log, setHelperStatus, setReportText } from "./src/ui";

let busy = false;
const ACTIONS = ["btn-spread", "btn-collect", "btn-bind", "btn-status", "btn-channels"];
let lastSeqGuid: string | null = null;

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
      const g = sequenceGuid(sequence);
      if (g !== lastSeqGuid && !busy) {
        lastSeqGuid = g;
        void scanChannels(false);
      }
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

/** Aktif sequence'taki harici kaynakları bulur ve kaynak eşleme panelini çizer (salt okuma). */
async function scanChannels(verbose: boolean): Promise<void> {
  try {
    const ctx = await requireActive();
    const items = classify(await snapshot(ctx));
    const srcs = sourcesOf(items).map((key) => ({ key, count: items.filter((x) => x.role === "external" && x.source === key).length }));
    renderMapping(srcs);
    if (verbose) log(`Harici kaynaklar: ${srcs.map((c) => `${c.key} (${c.count})`).join(", ") || "yok"}`, "dim");
  } catch (e) {
    if (verbose) log(`Kaynaklar okunamadı: ${errText(e)}`, "warn");
  }
}

let pinging = false;
async function checkHelper(verbose: boolean): Promise<void> {
  if (pinging) return;
  pinging = true;
  try {
    const r = await getLinker().ping();
    setHelperStatus(r.ok, r.detail);
    if (verbose) {
      log(r.ok ? `✓ Yardımcı ${r.detail}` : `✗ Yardımcı bağlı değil: ${r.detail}`, r.ok ? "ok" : "warn");
      if (!r.ok) for (const h of getLinker().installHint()) log(`   ${h}`, "warn");
    }
  } catch (e) {
    setHelperStatus(false, errText(e));
  } finally {
    pinging = false;
  }
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
  on("btn-collect", () =>
    void exclusive("TOPLA", async () => {
      await runCollect();
      await scanChannels(false);
    })
  );
  on("btn-bind", () => void exclusive("BAĞLA", runBind));
  on("btn-channels", () => void exclusive("Kanallar", () => scanChannels(true)));
  on("btn-helper", () => void checkHelper(true));
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
  bindSettingInputs();
  log("Spread hazır. Sıra: SPREAD → Clip > Synchronize → TOPLA → kontrol → BAĞLA. Her işlem önce onay ister ve yedek sequence alır.", "head");
  void refresh();
  void checkHelper(false);
  setInterval(() => {
    if (!busy) void refresh();
  }, 1500);
  setInterval(() => {
    if (!busy) void checkHelper(false);
  }, 15000);
}

try {
  init();
} catch (e) {
  const box = document.getElementById("log");
  if (box) box.textContent = `Panel başlatılamadı: ${errText(e)}`;
}
