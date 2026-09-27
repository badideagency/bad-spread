// Spread v1.1.0 — giriş noktası (yalnız arayüz bağlantıları). Üstte "Spread ●" + sequence adı; üç adım (① Dağıt → Clip › Synchronize →
// ② Topla → ③ Bağla; yalnız sıradakinin düğmesi, biten adımın adına tıklayınca "Yeniden çalıştır"); altta tek satır sonuç / ilerleme
// + "Ne yapmalıyım?"; "⚙ Ayarlar" görünümünde kaynak eşleme, eşik, boşluk, yardımcı ayrıntısı, Durum raporu ve günlük; "Sorun bildir".
// İşlemlerin mantığı src/ altındaki modüllerde.

import { getActive, requireActive, sequenceGuid, sequenceName } from "./src/session";
import { runSpread } from "./src/spread";
import { runCollect } from "./src/topla";
import { runBind } from "./src/bagla";
import { buildStatusReport } from "./src/status";
import { buildIssueReport, saveIssueReport } from "./src/report";
import { classify, sourcesOf } from "./src/classify";
import { getLinker } from "./src/linker";
import { bindSettingInputs, renderMapping } from "./src/settings";
import { errText, snapshot } from "./src/model";
import { rememberStep, stepViews } from "./src/steps";
import { SPREAD_VERSION } from "./src/version";
import {
  answer,
  byId,
  clearLog,
  isAsking,
  log,
  opEnd,
  opFinish,
  opStart,
  renderSteps,
  setDoneHandler,
  setHelperStatus,
  setReportText,
  setSequenceLine,
  showSettings,
  toggleHint,
  toggleRerun,
  type StepId,
} from "./src/ui";

let busy = false;
const ACTIONS = ["btn-spread", "btn-collect", "btn-bind", "btn-status", "btn-channels", "rerun-spread", "rerun-topla", "rerun-bagla"];
let lastSeqGuid: string | null = null; // kaynak eşlemesi en son bu sequence için tarandı
let activeGuid: string | null = null; // adım göstergesi (şu an aktif sequence; yoksa null)
let opGuid: string | null = null; // işlemin başladığı sequence (adım sonucu ona yazılır)

function setDisabled(id: string, disabled: boolean): void {
  try {
    const b = byId(id);
    if (disabled) b.setAttribute("disabled", "true");
    else b.removeAttribute("disabled");
  } catch {
    /* yoksa geç */
  }
}

function paintSteps(): void {
  try {
    const v = stepViews(activeGuid);
    renderSteps(v.steps, activeGuid ? v.next : null);
  } catch {
    /* gösterge yoksa geç */
  }
}

async function refresh(): Promise<void> {
  let ok = false;
  try {
    const { project, sequence } = await getActive();
    if (!project) setSequenceLine("Açık proje yok.", false);
    else if (!sequence) setSequenceLine("Aktif sequence yok — timeline'a bir kez tıkla.", false);
    else {
      setSequenceLine(sequenceName(sequence), true);
      ok = true;
      const g = sequenceGuid(sequence);
      activeGuid = g;
      if (g !== lastSeqGuid && !busy) {
        lastSeqGuid = g;
        void scanChannels(false);
      }
    }
    if (!ok) activeGuid = null;
  } catch (e) {
    setSequenceLine(`Durum okunamadı: ${errText(e)}`, false);
  }
  for (const id of ACTIONS) setDisabled(id, busy || !ok);
  paintSteps();
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
  try {
    await refresh();
    opGuid = activeGuid;
    opStart(label);
    await fn();
  } catch (e) {
    log(`Beklenmeyen hata: ${errText(e)}`, "err");
    opEnd("err", `${label}: beklenmeyen hata.`, "Sorun bildir'e bas ve raporu gönder.", [errText(e)]);
  } finally {
    busy = false; // önce kilit (gösterge hata verse de panel kilitli kalmasın)
    opFinish();
    await refresh();
  }
}

/** Panoya kopyalar (UXP panosu; Premiere API değil). @returns hangi yolla kopyalandı ya da null */
async function copyText(text: string): Promise<{ ok: boolean; how: string }> {
  // Tip: @adobe/cc-ext-uxp-types Clipboard (setContent / writeText).
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
      return { ok: true, how: name };
    } catch (e) {
      errs.push(`${name}: ${errText(e)}`);
    }
  }
  return { ok: false, how: errs.join(" | ") || "clipboard API yok" };
}

async function copyReport(): Promise<void> {
  const text = (byId("report") as HTMLTextAreaElement).value;
  if (!text) {
    log("Önce 'Durum raporu'na bas.", "warn");
    return;
  }
  const r = await copyText(text);
  if (r.ok) log(`✓ Rapor panoya kopyalandı (${r.how}, ${text.length} karakter).`, "ok");
  else log(`✗ Panoya kopyalanamadı (${r.how}). Rapor kutusuna tıkla, Ctrl+A / Ctrl+C.`, "err");
}

/**
 * "Sorun bildir": tek metin paketi → panoya + masaüstüne. Hep basılabilir; işlem sürerken (ör. onay beklerken) de çalışır, o zaman
 * sequence okunmaz. Rapor, Durum raporu kutusunu (KES planı olabilir) EZMEZ; kopyalanamazsa kendi kutusunda görünür.
 */
let reporting = false;
async function reportIssue(): Promise<void> {
  if (reporting) return;
  reporting = true;
  const note = (t: string) => {
    try {
      const n = byId("issue-note");
      n.textContent = t;
      n.style.display = "block";
    } catch {
      /* yoksa geç */
    }
  };
  note("Rapor hazırlanıyor…");
  const reading = !busy;
  if (reading) busy = true;
  try {
    const text = await buildIssueReport(reading);
    const saved = await saveIssueReport(text);
    const copied = await copyText(text);
    try {
      const box = byId("issue-text") as HTMLTextAreaElement;
      box.value = text;
      box.style.display = copied.ok ? "none" : "block";
    } catch {
      /* yoksa geç */
    }
    log(`Sorun raporu: ${text.split("\n").length} satır; ${saved.ok ? `kaydedildi: ${saved.path}` : `kaydedilemedi (${saved.detail})`}; ${copied.ok ? "panoya kopyalandı" : `panoya kopyalanamadı (${copied.how})`}.`, "head");
    note(
      saved.ok || copied.ok
        ? `✓ Rapor hazır${copied.ok ? ", panoya kopyalandı" : ""}${saved.ok ? ` ve kaydedildi: ${saved.path}` : ""}. Bana gönder (yapıştır ya da dosyayı ekle).`
        : "✗ Rapor kopyalanamadı ve kaydedilemedi — aşağıdaki kutuya tıkla, Ctrl+A / Ctrl+C."
    );
  } catch (e) {
    note(`✗ Rapor hazırlanamadı: ${errText(e)}`);
  } finally {
    if (reading) busy = false;
    reporting = false;
  }
}

function on(id: string, fn: () => void): void {
  try {
    byId(id).addEventListener("click", fn);
  } catch (e) {
    log(`Buton bağlanamadı #${id}: ${errText(e)}`, "err");
  }
}

function init(): void {
  try {
    byId("ver").textContent = SPREAD_VERSION;
  } catch {
    /* başlık yoksa geç */
  }
  setDoneHandler((step, kind, text, noop) => {
    rememberStep(opGuid, step, kind, text, noop);
    paintSteps();
  });
  const actions: Record<StepId, () => void> = {
    spread: () => void exclusive("SPREAD", runSpread),
    topla: () =>
      void exclusive("TOPLA", async () => {
        await runCollect();
        await scanChannels(false);
      }),
    bagla: () => void exclusive("BAĞLA", runBind),
  };
  on("btn-spread", actions.spread);
  on("btn-collect", actions.topla);
  on("btn-bind", actions.bagla);
  // biten adımın adı → "Yeniden çalıştır" (yalnız görünüm; işlem aynı düğmeyle aynı)
  for (const id of ["spread", "topla", "bagla"] as StepId[]) {
    on(`name-${id}`, () => toggleRerun(id));
    on(`rerun-${id}`, actions[id]);
  }
  on("btn-settings", () => showSettings(true));
  on("btn-back", () => showSettings(false));
  try {
    byId("result-help").addEventListener("click", (e: Event) => {
      e.preventDefault?.();
      toggleHint();
    });
  } catch {
    /* yoksa geç */
  }
  on("btn-channels", () => void exclusive("Kanallar", () => scanChannels(true)));
  on("btn-helper", () => void checkHelper(true));
  on("btn-status", () =>
    void exclusive("Durum raporu", async () => {
      log("▶ Durum raporu", "head");
      const text = await buildStatusReport();
      setReportText(text);
      log(`✓ Durum raporu hazır (${text.split("\n").length} satır). 'Raporu kopyala' ile al.`, "ok");
      opEnd("info", "Durum raporu hazır (⚙ Ayarlar ▸ Durum raporu).");
    })
  );
  on("btn-issue", () => void reportIssue());
  on("ask-yes", () => answer("Evet"));
  on("ask-no", () => answer("Hayır"));
  on("btn-copy", () => void copyReport());
  on("btn-clear", () => {
    if (!isAsking()) clearLog();
  });
  bindSettingInputs();
  log(`Spread ${SPREAD_VERSION} hazır. Sıra: Dağıt (SPREAD) → Clip > Synchronize → Topla (TOPLA) → kontrol → Bağla (BAĞLA). Her işlem önce onay ister ve yedek sequence alır.`, "head");
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
