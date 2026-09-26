// Panel arayüzü (Spread v1.0.0): üst durum satırı, numaralı üç adım, ilerleme çubuğu, tek cümlelik sonuç + "Ayrıntı ▸", özetli onay
// penceresi, "Gelişmiş ▸" altında ayrıntılı günlük. YALNIZ görünüm: hiçbir karar burada verilmez.
// Ayrıntılı günlük (#log) her zaman yazılır (Gelişmiş altında gizli) ve arka plan günlüğüne (journal.ts: bellek + dosya) düşer.
// DOM: yalnız getElementById / createElement / appendChild / textContent / className / style / set/removeAttribute (UXP'de hepsi var).

import { beginOp, currentOpLines, endOp, noteError, record } from "./journal";

type Tone = "info" | "ok" | "warn" | "err" | "head" | "dim";
export type StepId = "spread" | "topla" | "bagla";
export type ResultKind = "ok" | "warn" | "err" | "cancel" | "info";

const COLORS: Record<Tone, string> = {
  info: "",
  ok: "#4cc27a",
  warn: "#e8b04a",
  err: "#ff6b6b",
  head: "#8fb8ff",
  dim: "#9a9a9a",
};

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Panel öğesi bulunamadı: #${id}`);
  return e;
}

function maybe(id: string): HTMLElement | null {
  try {
    return document.getElementById(id);
  } catch {
    return null;
  }
}

function show(id: string, on: boolean, display = "block"): void {
  const e = maybe(id);
  if (e) e.style.display = on ? display : "none";
}

function setText(id: string, text: string): void {
  const e = maybe(id);
  if (e) e.textContent = text;
}

function clear(e: HTMLElement): void {
  e.innerHTML = "";
}

function addLine(box: HTMLElement, text: string, cls = ""): void {
  const d = document.createElement("div");
  d.textContent = text;
  if (cls) d.className = cls;
  box.appendChild(d);
}

// ------------------------------------------------------------------ ayrıntılı günlük (Gelişmiş ▸ Günlük)

export function log(msg: string, tone: Tone = "info"): void {
  try {
    record(msg);
  } catch {
    /* arka plan günlüğü yoksa geç */
  }
  try {
    const box = el("log");
    const line = document.createElement("div");
    line.textContent = msg;
    if (COLORS[tone]) line.style.color = COLORS[tone];
    if (tone === "head") line.style.fontWeight = "bold";
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  } catch {
    // log alanı yoksa yapacak bir şey yok
  }
}

export function clearLog(): void {
  el("log").innerHTML = "";
}

export function setReportText(text: string): void {
  const ta = el("report") as HTMLTextAreaElement;
  ta.value = text;
}

export function byId(id: string): HTMLElement {
  return el(id);
}

// ------------------------------------------------------------------ katlı bölümler ("Ayrıntı ▸", "Gelişmiş ▸")

const toggles = new Map<string, { body: string; label: string }>();

function paintToggle(toggleId: string, open: boolean): void {
  const t = toggles.get(toggleId);
  if (t) setText(toggleId, `${t.label} ${open ? "▾" : "▸"}`);
}

/** Tıklayınca gövdeyi açıp kapatan başlık. Varsayılan KAPALI. */
export function bindToggle(toggleId: string, bodyId: string, label: string): void {
  toggles.set(toggleId, { body: bodyId, label });
  const t = maybe(toggleId);
  if (!t) return;
  paintToggle(toggleId, false);
  show(bodyId, false);
  t.addEventListener("click", () => {
    const b = maybe(bodyId);
    const open = !!b && b.style.display === "none";
    show(bodyId, open);
    paintToggle(toggleId, open);
  });
}

function collapse(toggleId: string): void {
  const t = toggles.get(toggleId);
  if (!t) return;
  show(t.body, false);
  paintToggle(toggleId, false);
}

// ------------------------------------------------------------------ onay penceresi (özet + Ayrıntı)

export type Answer = "Evet" | "Hayır" | "Atla";

let pendingResolve: ((a: Answer) => void) | null = null;

/** Dikkat gerektiren satırlar (özette her zaman görünür). */
const ATTENTION = /VETO|SESSİZ KALACAK|ŞÜPHELİ|DİKKAT|ÇİFT KOPYA|AYRILAMAYAN|ÇELİŞKİLİ|BELİRLENEMEDİ|KAMERA SESİ KORUNACAK|BÖLÜNMÜŞ|PARK KAYDI/;

/** Özeti verilmemiş soru: başlık satırı + dikkat / madde satırları (en çok 3) + soru cümlesi. */
function autoSummary(question: string): string[] {
  const ls = question.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  if (ls.length <= 5) return ls;
  const out = [ls[0]];
  const bullets = ls.slice(1).filter((l) => /^\s*•/.test(l) || ATTENTION.test(l));
  out.push(...bullets.slice(0, 3));
  if (bullets.length > 3) out.push(`  … ${bullets.length - 3} satır daha (Ayrıntı)`);
  const q = [...ls].reverse().find((l) => /\?/.test(l));
  if (q && !out.includes(q)) out.push(q);
  return out;
}

/**
 * Özet en çok 5 satır: ilk satır ve son satır (soru) kalır; aradakilerden önce dikkat satırları, sonra diğerleri (sıra korunur).
 * Sığmayanlar "Ayrıntı ▸"daki tam metinde; son tutulan satıra kaç satırın orada kaldığı eklenir.
 */
function capSummary(ls: string[], max = 5): string[] {
  if (ls.length <= max) return ls;
  const mid = ls.slice(1, -1).map((l, i) => ({ l, i }));
  const keep = new Set([...mid.filter((x) => ATTENTION.test(x.l)), ...mid.filter((x) => !ATTENTION.test(x.l))].slice(0, max - 2).map((x) => x.i));
  const kept = mid.filter((x) => keep.has(x.i)).map((x) => x.l);
  kept[kept.length - 1] += ` (+${mid.length - kept.length} satır Ayrıntı'da)`;
  return [ls[0], ...kept, ls[ls.length - 1]];
}

/**
 * Panelde soru gösterir, kullanıcı Evet/Hayır'a basana kadar bekler.
 * @param question tam metin ("Ayrıntı ▸" altında; günlüğe de yazılır)
 * @param summary 3–5 satırlık özet (dikkat satırları dahil); verilmezse sorudan çıkarılır
 */
export function ask(question: string, summary?: string[]): Promise<Answer> {
  const box = el("ask");
  el("ask-text").textContent = question;
  const sum = maybe("ask-summary");
  if (sum) {
    clear(sum);
    for (const l of capSummary(summary && summary.length ? summary : autoSummary(question))) addLine(sum, l, ATTENTION.test(l) ? "attn" : "");
  }
  collapse("ask-more-toggle");
  show("progress", false);
  box.style.display = "block";
  log(`❓ SORU: ${question}`, "warn");
  try {
    box.scrollIntoView();
  } catch {
    /* UXP'de yoksa sorun değil */
  }
  return new Promise<Answer>((resolve) => {
    pendingResolve = (a: Answer) => {
      box.style.display = "none";
      pendingResolve = null;
      log(`   → Cevap: ${a}`, "warn");
      if (opActive && a === "Evet") show("progress", true);
      resolve(a);
    };
  });
}

export function answer(a: Answer): void {
  if (pendingResolve) pendingResolve(a);
}

export function isAsking(): boolean {
  return pendingResolve !== null;
}

// ------------------------------------------------------------------ üst satır: sequence + yardımcı

export function setSequenceLine(text: string, ok: boolean): void {
  const s = maybe("status");
  if (!s) return;
  s.textContent = text;
  s.className = ok ? "seq ok" : "seq warn";
}

/** Yardımcı göstergesi: üstte ● + kısa metin; ayrıntı (gerçek hata) Gelişmiş'te #helper'da. */
export function setHelperStatus(ok: boolean, detail: string): void {
  try {
    const e = el("helper");
    e.textContent = ok ? `Yardımcı: bağlı — ${detail}` : `Yardımcı: bağlı değil — ${detail}`;
    e.style.color = ok ? COLORS.ok : COLORS.warn;
  } catch {
    /* gösterge yoksa geç */
  }
  const dot = maybe("helper-dot");
  if (dot) dot.className = ok ? "dot on" : "dot off";
  setText("helper-short", ok ? "yardımcı hazır" : "yardımcı kapalı: Window → Extensions (Legacy) → Spread Helper'ı aç");
  const line = maybe("helperline");
  if (line) line.setAttribute("title", detail);
}

// ------------------------------------------------------------------ adımlar (1 SPREAD → Synchronize → 2 TOPLA → 3 BAĞLA)

export interface StepView {
  state: "todo" | "done" | "warn";
  text: string;
}

const STEP_NUM: Record<StepId, string> = { spread: "1", topla: "2", bagla: "3" };
const STEP_BTN: Record<StepId, string> = { spread: "btn-spread", topla: "btn-collect", bagla: "btn-bind" };

export function renderSteps(steps: Record<StepId, StepView>, next: StepId | null): void {
  for (const id of ["spread", "topla", "bagla"] as StepId[]) {
    const v = steps[id];
    const card = maybe(`step-${id}`);
    if (card) card.className = `step ${v.state}${next === id ? " next" : ""}`;
    setText(`num-${id}`, v.state === "done" ? "✓" : v.state === "warn" ? "!" : STEP_NUM[id]);
    setText(`res-${id}`, v.text);
    const b = maybe(STEP_BTN[id]);
    if (b) b.setAttribute("variant", next === id ? "cta" : "secondary");
  }
  const sync = maybe("sync-hint");
  if (sync) sync.className = next === "topla" && steps.spread.state === "done" ? "between next" : "between";
}

// ------------------------------------------------------------------ işlem: ilerleme + sonuç

let opActive = false;
let opEnded = false;
let opLabel = "";
let doneHandler: ((step: StepId, kind: "ok" | "warn", text: string, noop: boolean) => void) | null = null;

export function setDoneHandler(fn: (step: StepId, kind: "ok" | "warn", text: string, noop: boolean) => void): void {
  doneHandler = fn;
}

// Buradaki işlem göstergesi fonksiyonları ASLA fırlatmaz (runner'ların mantığına hata taşımasın).
export function opStart(label: string): void {
  opActive = true;
  opEnded = false;
  opLabel = label;
  try {
    beginOp(label);
    show("result", false);
  } catch {
    /* gösterge yoksa geç */
  }
  progress(0.02, `${label}: sequence okunuyor…`);
}

/** İlerleme çubuğu + tek satır ne yapıldığı. frac: 0…1. */
export function progress(frac: number, text: string): void {
  if (!opActive) return;
  try {
    show("progress", !isAsking());
    const f = maybe("progress-fill");
    if (f) f.style.width = `${Math.round(Math.max(0.02, Math.min(1, frac)) * 100)}%`;
    setText("progress-text", text);
  } catch {
    /* gösterge yoksa geç */
  }
}

const CLASS: Record<ResultKind, string> = { ok: "result ok", warn: "result warn", err: "result err", cancel: "result dim", info: "result dim" };
const ICON: Record<ResultKind, string> = { ok: "✓", warn: "⚠", err: "✗", cancel: "–", info: "•" };

/** İşlemin sonucu: tek cümle + ne yapılacağı + "Ayrıntı ▸" (bu işlemin günlüğü). */
export function opEnd(kind: ResultKind, headline: string, hint = "", details: string[] = []): void {
  if (!opActive || opEnded) return;
  opEnded = true;
  try {
    paintResult(kind, headline, hint, details);
  } catch {
    /* gösterge yoksa geç */
  }
}

function paintResult(kind: ResultKind, headline: string, hint: string, details: string[]): void {
  show("progress", false);
  const r = maybe("result");
  if (r) r.className = CLASS[kind];
  setText("result-head", `${ICON[kind]} ${headline}`);
  setText("result-hint", hint);
  show("result-hint", !!hint);
  const more = maybe("result-more");
  if (more) {
    clear(more);
    for (const l of [...details, ...(details.length ? [""] : []), ...currentOpLines()]) addLine(more, l);
  }
  collapse("result-more-toggle");
  show("result", true);
  if (kind === "err") {
    try {
      noteError(opLabel, headline, [hint, ...details, ...currentOpLines()].filter(Boolean));
    } catch {
      /* yoksa geç */
    }
  }
}

/** Başarılı / uyarılı bitiş — adımın ✓'ü ve kısa sonucu (sequence başına hatırlanır). */
/** @param noop true → işlem hiçbir şeyi değiştirmedi ("zaten …"): sonraki adımların ✓'ü silinmez */
export function done(step: StepId, kind: "ok" | "warn", text: string, hint = "", noop = false): void {
  opEnd(kind, text, hint);
  try {
    if (doneHandler) doneHandler(step, kind, text, noop);
  } catch {
    /* kayıt yoksa geç */
  }
}

/** İşlem wrapper'ı bitirir: sonuç yazılmadıysa son satırdan (iptal / bilgi). */
export function opFinish(): void {
  try {
    if (opActive && !opEnded) {
      const last = [...currentOpLines()].reverse().find((l) => l.trim()) ?? "";
      if (/İptal edildi/.test(last)) opEnd("cancel", "İptal edildi; hiçbir şey değişmedi.");
      else opEnd("info", "Bitti.", "", []);
    }
    show("progress", false);
    endOp();
  } catch {
    /* yoksa geç */
  }
  opActive = false;
}

// ------------------------------------------------------------------ insan dilinde tek cümle

const HUMAN: [RegExp, string][] = [
  [/^Önce TOPLA'ya bas: bu sequence için TOPLA kaydı yok/, "Önce TOPLA'ya bas: bu sequence henüz toplanmadı."],
  [/^Ayar TOPLA'dan sonra değişti/, "Ayarlar TOPLA'dan sonra değişti; önce TOPLA'ya tekrar bas."],
  [/YARIM hâlde/, "Önceki işlem yarım kaldı; önce geri al (Ctrl+Z) ya da yedek sequence'ı kullan."],
  [/^KAMERA klibinin çift kopyası var/, "Bir kamera klibi aynı yerde iki kez var; fazlasını elle sil."],
  [/^İLK TAŞIMA TUTMADI/, "İlk taşıma beklendiği gibi olmadı; işlem durdu."],
  [/^İLK PARÇA TUTMADI/, "İlk ses kesimi beklendiği gibi olmadı; işlem durdu."],
  [/^KALİBRASYON TUTARLI BİR KURAL VERMEDİ/, "Kırpma komutları ölçülemedi; hiçbir şey kesilmedi."],
  [/^Kalibrasyonda .* beklenmeyen bir değişiklik/, "Kırpma ölçümü sırasında beklenmeyen bir değişiklik oldu; işlem durdu."],
  [/kamera klibi kırpılmış/, "Kırpılmış kamera klibi var; SPREAD başlamadı."],
  [/^Yeni düzende \d+ çakışma var/, "Yeni düzende klipler üst üste binerdi; TOPLA başlamadı."],
  [/^Plan kurulamadı/, "Plan kurulamadı; nedeni Ayrıntı'da."],
  [/grup bağlanamadı/, "Bazı gruplar bağlanamadı; kesim yerinde, BAĞLA'ya tekrar bas."],
  [/^Bu sequence BAĞLA'dan geçti/, "Bu sequence zaten bağlandı; yeniden toplamak için BAĞLA öncesi yedeği kullan."],
  [/^BAĞLA'dan sonra düzen değişmiş/, "BAĞLA'dan sonra düzen değişmiş; yedek sequence'la çalış."],
  [/^Adımlar arasında timeline değişti/, "İşlem sürerken timeline değişti; güvenlik için durdu."],
  [/^Yedek sequence oluşmadı/, "Yedek sequence oluşturulamadı; hiçbir şey değişmedi."],
  [/doğrulaması tutmadı/, "Bir adımın sonucu beklendiği gibi değildi; işlem durdu."],
  [/Senkron sonucunda tutarsızlık/, "Senkron sonucunda tutarsızlık var; TOPLA başlamadı."],
  [/sequence yok|proje yok/i, "Aktif sequence yok; timeline'a bir kez tıkla."],
];

/** Durdurma mesajından tek cümle (bilinen durumlar elle; kalanı ilk cümle, BÜYÜK HARF başlık küçültülür). */
export function humanize(message: string): string {
  for (const [re, h] of HUMAN) if (re.test(message)) return h;
  let s = message.split(/(?<=[.!?])\s|\s—\s/)[0] ?? message;
  const m = /^([A-ZÇĞİÖŞÜ ]{6,}):\s/.exec(s);
  if (m) s = m[1];
  if (/^[A-ZÇĞİÖŞÜ\s]+$/.test(s)) s = s.charAt(0) + s.slice(1).toLocaleLowerCase("tr");
  s = s.charAt(0).toLocaleUpperCase("tr") + s.slice(1);
  if (s.length > 160) s = s.slice(0, 157) + "…";
  return /[.!?…]$/.test(s) ? s : s + ".";
}
