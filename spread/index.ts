// Spread v1.2.0 — giriş noktası (yalnız arayüz bağlantıları). Üstte "Spread" + sürüm + ↻ + yardımcı noktası, altında sequence adı;
// üç adım (1 Dağıt → Clip › Synchronize → 2 Topla → 3 Bağla; yalnız sıradakinin düğmesi, biten adımın adına tıklayınca "Yeniden
// çalıştır"); altta tek satır sonuç / ilerleme + "Ne yapmalıyım?"; "Ayarlar" görünümünde kaynak eşleme, eşik, boşluk, yardımcı
// ayrıntısı, Durum raporu ve günlük; "Sorun bildir". v1.2.0: güncelleme şeridi (latest.json, 6 saatte bir) ve ↻ Yenile.
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
import { CHECK_EVERY_MS, checkForUpdate, type Latest } from "./src/update";
import { askUser, stopMapHas } from "./src/guard";
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
  setUpdateStrip,
  progress,
  showSettings,
  toggleHint,
  toggleRerun,
  type StepId,
} from "./src/ui";

let busy = false;
const ACTIONS = ["btn-spread", "btn-collect", "btn-bind", "btn-status", "btn-channels", "rerun-spread", "rerun-topla", "rerun-bagla", "man-spread", "man-topla", "man-bagla"];
let latest: Latest | null = null; // v1.2.0: yayındaki daha yeni sürüm (yoksa null)
let helperReachable = false; // güncellemeyi yardımcı yapar: sürümü farklı olsa da ulaşılabiliyorsa yeter
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
    helperReachable = r.ok || r.helper !== undefined;
    paintUpdate();
    if (verbose) {
      log(r.ok ? `✓ Yardımcı ${r.detail}` : `✗ Yardımcı bağlı değil: ${r.detail}`, r.ok ? "ok" : "warn");
      if (!r.ok) for (const h of getLinker().installHint()) log(`   ${h}`, "warn");
    }
  } catch (e) {
    setHelperStatus(false, errText(e));
    helperReachable = false;
    paintUpdate();
  } finally {
    pinging = false;
  }
}

// ------------------------------------------------------------------ v1.2.0 güncelleme (denetim burada; kurulum Spread Helper'da)

const LAST_CHECK_KEY = "spread.updateCheck.v1";

function paintUpdate(): void {
  setUpdateStrip(latest ? { version: latest.version, helperOk: helperReachable } : null);
}

/**
 * latest.json'u okur (açılışta, 6 saatte bir ve ⚙ Ayarlar ▸ "Güncellemeleri denetle"). İnternet yoksa sessizce geçer (günlüğe soluk
 * bir satır); elle denetlemede sonuç Ayarlar'da tek satır.
 */
async function checkUpdates(manual = false): Promise<void> {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    /* hatırlanamazsa her açılışta denetler */
  }
  const r = await checkForUpdate();
  if (r.kind === "new") {
    latest = r.latest;
    log(`Yeni sürüm var: ${r.latest.version} (${r.latest.date}).`, "dim");
  } else {
    latest = null;
    if (r.kind === "premiere-old") log(`Yeni sürüm ${r.latest.version} Premiere ${r.latest.min_premiere} ya da yenisini istiyor (bu Premiere ${r.host}).`, "dim");
    else if (r.kind === "offline") log(`Güncelleme denetlenemedi (${r.detail}); sonra yeniden denenecek.`, "dim");
  }
  paintUpdate();
  if (manual) {
    const text =
      r.kind === "new"
        ? `Yeni sürüm ${r.latest.version} var: üstteki şeride bas.`
        : r.kind === "none"
          ? `Güncel (Spread ${SPREAD_VERSION}).`
          : r.kind === "premiere-old"
            ? `Yeni sürüm ${r.latest.version} Premiere ${r.latest.min_premiere} ya da yenisini istiyor.`
            : "Denetlenemedi (internet bağlantısı?).";
    try {
      byId("update-info").textContent = text;
    } catch {
      /* yoksa geç */
    }
    log(`Güncelleme denetimi: ${text}`, "dim");
  }
}

function updateDue(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0) >= CHECK_EVERY_MS;
  } catch {
    return true;
  }
}

/** Şeride tıklandı: notlar + [Şimdi değil] [Güncelle] → yardımcı kurar → [Sonra] [Yeniden başlat]. */
async function runUpdate(l: Latest): Promise<void> {
  const ans = await askUser(`Spread ${l.version} (${l.date}):\n${l.notes.map((n) => `• ${n}`).join("\n")}`, l.notes, {
    title: `Yeni sürüm ${l.version}`,
    yes: "Güncelle",
    no: "Şimdi değil",
  });
  if (ans !== "Evet") {
    log("İptal edildi — güncelleme sonraya kaldı.", "warn");
    opEnd("cancel", "Güncelleme sonraya kaldı.");
    return;
  }
  progress(0.1, "İndiriliyor ve doğrulanıyor…");
  let r;
  try {
    r = await getLinker().update(l.version);
  } catch (e) {
    log(`✗ GÜNCELLEME DURDU: ${errText(e)}`, "err");
    opEnd(
      "err",
      "Güncelleme yapılamadı; eski sürüm yerinde.",
      helperReachable
        ? "İnternet bağlantısını kontrol edip Güncelle'ye tekrar bas. Sürerse Sorun bildir'e bas."
        : "Window › Extensions (Legacy) › Spread Helper panelini aç, sonra Güncelle'ye tekrar bas.",
      [errText(e)]
    );
    return;
  }
  log(`✓ Güncelleme ${r.version} kuruldu: yardımcı yazıldı (yedek: ${r.backup}), panel ${r.panel === "installed" ? "Adobe kurucusuyla kuruldu" : `ELLE kurulacak (${r.why ?? "?"})`}.`, "ok");
  // kuruldu → şerit artık "Güncelle" demesin (yeni sürüm Premiere yeniden açılınca çalışır)
  latest = null;
  paintUpdate();
  progress(0.9, "Kuruldu.");
  const manual = r.panel === "manual";
  const ans2 = await askUser(
    `Güncelleme ${r.version} kuruldu. Projeyi kaydedip Premiere'i yeniden başlatayım mı?`,
    [
      manual ? "Spread paneli için açılan Creative Cloud penceresinde Install'a bas." : `Spread ve Spread Helper ${r.version} kuruldu.`,
      "Yeni sürüm Premiere yeniden açılınca çalışır.",
      "Önce açık projeler kaydedilir; kaydedilemezse Premiere kapatılmaz.",
    ],
    { title: "Premiere yeniden başlasın mı?", yes: "Yeniden başlat", no: "Sonra" }
  );
  if (ans2 !== "Evet") {
    log("Yeniden başlatma sonraya kaldı.", "dim");
    opEnd("ok", `${r.version} kuruldu; Premiere'i yeniden başlatınca açılır.`, manual ? "Önce Creative Cloud penceresinde Install'a bas." : "");
    return;
  }
  progress(0.95, "Projeler kaydediliyor…");
  try {
    const rr = await getLinker().restart();
    log(`✓ Projeler kaydedildi ve doğrulandı; Premiere kapanıyor, yeniden açılacak: ${rr.project || "(proje yok)"}`, "ok");
    opEnd("ok", "Premiere kapanıyor; birkaç saniye sonra aynı projeyle yeniden açılacak.");
  } catch (e) {
    log(`✗ YENİDEN BAŞLATMA DURDU: ${errText(e)}`, "err");
    opEnd("err", "Premiere kapatılmadı: proje kaydedilemedi.", "Projeyi Ctrl+S ile kaydet, sonra Premiere'i kendin kapatıp aç.", [errText(e)]);
  }
}

// ------------------------------------------------------------------ v1.2.0 ↻ Yenile

/**
 * Yardımcıya panelini yeniden yüklemesini söyler, sonra kendi panelini yeniden yükler (timeline açılışta baştan okunur). İşlem
 * sürerken olmaz; bu sequence'ta yarım kalmış bir işlem varsa önce uyarır.
 */
async function reloadPanels(): Promise<void> {
  if (busy) {
    log("↻ Yenile için bekle: bir işlem sürüyor.", "warn");
    return;
  }
  if (activeGuid && stopMapHas(activeGuid)) {
    busy = true;
    try {
      const ans = await askUser(
        "Bu sequence'ta yarım kalmış bir işlem var. Yenilemek onu düzeltmez; yarım kalan işlem yenilemeden sonra da yarım görünür.",
        ["Bu sequence'ta yarım kalmış bir işlem var.", "Yenilemek onu düzeltmez: önce Ctrl+Z ile geri al ya da yedek sequence'ı aç."],
        { title: "Yine de yenilensin mi?", yes: "Yenile", no: "Vazgeç" }
      );
      if (ans !== "Evet") return;
    } finally {
      busy = false;
    }
  }
  log("↻ Yenileniyor: Spread Helper ve Spread paneli yeniden yükleniyor…", "head");
  const h = await getLinker().reloadHelper();
  if (!h) log("Spread Helper'a ulaşılamadı; yalnız bu panel yenileniyor.", "dim");
  setTimeout(() => {
    // Adobe'nin Premiere örneği de paneli böyle yeniden yükler (AdobeDocs/uxp-premiere-pro-samples sample-panels/premiere-api/index.ts:373)
    window.location.reload();
  }, h ? 600 : 50);
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
    opEnd("err", `${({ SPREAD: "Dağıt", TOPLA: "Topla", BAĞLA: "Bağla", GÜNCELLE: "Güncelleme" } as Record<string, string>)[label] ?? label}: beklenmeyen hata.`, "Sorun bildir'e bas ve raporu gönder.", [errText(e)]);
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

/**
 * Tıklama + klavye (Enter / Boşluk). v1.2.0: düğmeler odaklanabilir <div> — "disabled" özniteliği tıklamayı kendiliğinden
 * engellemez, burada engellenir (yerli düğmedeki gibi).
 */
function on(id: string, fn: () => void): void {
  try {
    const e = byId(id);
    const off = () => typeof e.hasAttribute === "function" && e.hasAttribute("disabled");
    e.addEventListener("click", () => {
      if (!off()) fn();
    });
    e.addEventListener("keydown", (ev: Event) => {
      const k = (ev as KeyboardEvent).key;
      if ((k === "Enter" || k === " ") && !off()) {
        ev.preventDefault?.();
        fn();
      }
    });
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
    // ⚙ Ayarlar ▸ "Adımı elle çalıştır": adım işaretleri yanlışsa (ör. başka makine, silinmiş panel verisi) her adıma yol (inceleme #9, M5)
    on(`man-${id}`, () => {
      showSettings(false);
      actions[id]();
    });
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
  on("btn-reload", () => void reloadPanels());
  on("btn-check-update", () => void checkUpdates(true));
  on("update-strip", () => {
    if (!latest) return;
    if (!helperReachable) {
      void checkHelper(true);
      return;
    }
    const l = latest;
    void exclusive("GÜNCELLE", () => runUpdate(l));
  });
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
  // güncelleme: açılışta ve 6 saatte bir (yarım saatte bir bakılır; son denetim zamanı hatırlanır)
  void checkUpdates();
  setInterval(() => {
    if (!busy && updateDue()) void checkUpdates();
  }, 30 * 60 * 1000);
}

try {
  init();
} catch (e) {
  const box = document.getElementById("log");
  if (box) box.textContent = `Panel başlatılamadı: ${errText(e)}`;
}
