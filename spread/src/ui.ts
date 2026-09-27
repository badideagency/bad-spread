// Panel arayüzü (Spread v1.1.0, sade): üstte "Spread ●" (yardımcı yalnız nokta; ayrıntı ipucunda) + sequence adı; üç adım (yalnız
// SIRADAKİ adımın düğmesi görünür; biten adımda ✓, adının üstüne tıklayınca "Yeniden çalıştır"); altta tek satır sonuç / ilerleme;
// onay: başlık + en çok 3 satır + [Vazgeç] [Devam]; günlük, Durum raporu, eşik, boşluk, kaynak eşleme "⚙ Ayarlar" görünümünde.
// YALNIZ görünüm: hiçbir karar burada verilmez. Ayrıntılı günlük (#log, Ayarlar'da) her zaman yazılır ve arka plan günlüğüne
// (journal.ts: bellek + dosya) düşer → "Sorun bildir" raporu. Ana ekranda teknik terim yok (tick, transaction, track index…).
// Tema: Spectrum UXP bileşenleri (sp-*) Premiere temasını kendileri izler; burada renk VERİLMEZ (tek istisna: hata satırı kırmızı,
// index.html). UXP'nin --uxp-host-* CSS değişkenleri Premiere'de desteklenmiyor (Adobe uxp-premiere-pro css-styling belgesi).
// DOM: yalnız getElementById / createElement / appendChild / textContent / className / style / set/removeAttribute (UXP'de hepsi var).

import { beginOp, currentOpLines, endOp, noteError, record } from "./journal";

type Tone = "info" | "ok" | "warn" | "err" | "head" | "dim";
export type StepId = "spread" | "topla" | "bagla";
export type ResultKind = "ok" | "warn" | "err" | "cancel" | "info";

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

function addLine(box: HTMLElement, text: string, tag = "div", cls = ""): void {
  const d = document.createElement(tag);
  d.textContent = text;
  if (cls) d.className = cls;
  box.appendChild(d);
}

// ------------------------------------------------------------------ ayrıntılı günlük (⚙ Ayarlar ▸ Günlük)

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
    // renk yok (tema); satırların kendi işaretleri var (✓ ✗ ⚠ ▶). Başlık kalın.
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

// ------------------------------------------------------------------ görünümler (ana / ⚙ Ayarlar)

export function showSettings(open: boolean): void {
  show("main", !open, "flex");
  show("settings", open, "flex");
}

// ------------------------------------------------------------------ onay: başlık + en çok 3 satır + [Vazgeç] [Devam]

export type Answer = "Evet" | "Hayır" | "Atla";

/** Onay penceresinin başlığı ve düğme adları (yalnız görünüm). Verilmezse "Onay" / "Devam" / "Vazgeç". */
export interface AskOptions {
  title?: string;
  yes?: string;
  no?: string;
}

let pendingResolve: ((a: Answer) => void) | null = null;

/** Dikkat gerektiren satırlar (onayda her zaman görünür, kalın). */
const ATTENTION = /VETO|SESSİZ KALACAK|ŞÜPHELİ|DİKKAT|ÇİFT KOPYA|AYRILAMAYAN|ÇELİŞKİLİ|BELİRLENEMEDİ|KAMERA SESİ KORUNACAK|BÖLÜNMÜŞ|PARK KAYDI|KARIŞIK KANAL|EKSİK/;

/** Özeti verilmemiş soru: başlık satırı + dikkat / madde satırları. */
function autoSummary(question: string): string[] {
  const ls = question.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  if (ls.length <= 3) return ls;
  return [ls[0], ...ls.slice(1).filter((l) => /^\s*•/.test(l) || ATTENTION.test(l))];
}

/**
 * Satırdan soru cümlelerini ve "Evet = … / Hayır = …" açıklamalarını atar (düğmeler zaten söylüyor): "…alınır. Devam?" → "…alınır."
 */
function dropQuestion(line: string): string {
  return line
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/\?$/.test(s) && !/^\(?(Evet|Hayır)\s*[=→]/.test(s) && !/^Evet = .*·/.test(s))
    .join(" ")
    .trim();
}

/** Dikkat satırının kısası (birleştirmek için): ilk ";", " (" ya da " — " öncesi. */
const shortAttn = (l: string): string => (l.split(/;|\s\(|\s—\s/)[0] ?? l).trim().replace(/\.$/, "");

/**
 * Onay gövdesi: en çok `max` satır (başlık ayrı).
 *  - Soru cümleleri ve "Evet = / Hayır =" açıklamaları atılır (düğmeler söylüyor).
 *  - Birden çok dikkat satırı TEK satırda birleşir: "DİKKAT — KAMERA SESİ KORUNACAK: 2 aralıkta · KARIŞIK KANAL: 2 grupta …".
 *  - Sıra: ilk olgu satırı → dikkat satırı → silinecekler / yedek satırı → diğerleri. Sığmayan satır SESSİZCE düşmez: son satıra
 *    "(+N satır Sorun bildir raporunda)" eklenir (tam metin günlükte). (inceleme #9, M3)
 */
function dialogBody(lines: string[], max = 3): string[] {
  const ls = lines.map(dropQuestion).filter(Boolean);
  const attn = ls.filter((l) => ATTENTION.test(l));
  const rest = ls.filter((l) => !ATTENTION.test(l));
  const attnLine = attn.length > 1 ? `DİKKAT — ${attn.map(shortAttn).join(" · ")}` : attn[0];
  const prio = (l: string) => (/silinecek|yedek/i.test(l) ? 0 : 1);
  const tail = rest.slice(1).sort((a, b) => prio(a) - prio(b));
  const order = [...(rest[0] !== undefined ? [rest[0]] : []), ...(attnLine !== undefined ? [attnLine] : []), ...tail];
  if (order.length <= max) return order;
  const out = order.slice(0, max);
  out[max - 1] += ` (+${order.length - max} satır Sorun bildir raporunda)`;
  return out;
}

/**
 * Panelde soru gösterir, kullanıcı Devam / Vazgeç'e basana kadar bekler.
 * @param question tam metin (gizli; günlüğe yazılır → Sorun bildir raporu)
 * @param summary özet satırları (dikkat satırları dahil); verilmezse sorudan çıkarılır. Gösterilen: en çok 3 satır.
 * @param opts başlık ve düğme adları (ör. ŞÜPHELİ ÜYE'de "Hayır" = oturumda kalsın, işlem sürer)
 */
export function ask(question: string, summary?: string[], opts: AskOptions = {}): Promise<Answer> {
  const box = el("ask");
  el("ask-text").textContent = question;
  setText("ask-title", opts.title ?? "Onay");
  setText("ask-yes", opts.yes ?? "Devam");
  setText("ask-no", opts.no ?? "Vazgeç");
  const sum = maybe("ask-summary");
  if (sum) {
    clear(sum);
    for (const l of dialogBody(summary && summary.length ? summary : autoSummary(question))) addLine(sum, l, "sp-body", ATTENTION.test(l) ? "attn" : "");
  }
  show("progress", false);
  show("result", false);
  showSettings(false); // onay ana görünümde; kullanıcı ⚙ Ayarlar'daysa oraya dön
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

// ------------------------------------------------------------------ üst: sequence adı + yardımcı noktası

export function setSequenceLine(text: string, ok: boolean): void {
  const s = maybe("status");
  if (!s) return;
  s.textContent = text;
  s.className = ok ? "seq ok" : "seq warn";
}

/** Yardımcı: üstte yalnız nokta (ayrıntı ipucunda); kapalıysa tek satır talimat; gerçek hata ⚙ Ayarlar'da (#helper). */
export function setHelperStatus(ok: boolean, detail: string): void {
  try {
    el("helper").textContent = ok ? detail.charAt(0).toLocaleUpperCase("tr") + detail.slice(1) : `Bağlı değil — ${detail}`;
  } catch {
    /* gösterge yoksa geç */
  }
  const dot = maybe("helper-dot");
  if (dot) {
    dot.className = ok ? "dot on" : "dot off";
    dot.setAttribute("title", ok ? `Spread Helper hazır (${detail})` : `Spread Helper kapalı — ${detail}`);
  }
  setText("helper-short", "Spread Helper paneli kapalı: Window › Extensions (Legacy) › Spread Helper");
  show("helperline", !ok);
}

// ------------------------------------------------------------------ adımlar: ① Dağıt ✓ / ② Topla [Topla] / ③ Bağla

export interface StepView {
  state: "todo" | "done" | "warn";
  text: string;
}

const STEPS: StepId[] = ["spread", "topla", "bagla"];
const STEP_BTN: Record<StepId, string> = { spread: "btn-spread", topla: "btn-collect", bagla: "btn-bind" };
const rerunOpen = new Set<StepId>();
let lastSteps: { steps: Record<StepId, StepView>; next: StepId | null } | null = null;

/**
 * Yalnız sıradaki adımın düğmesi görünür (vurgulu). Biten adımda ✓ (uyarılıysa !); adının üstüne tıklayınca "Yeniden çalıştır".
 * Gelecektekiler soluk ve tıklanamaz. İşlemler kendi denetimlerini yine yapar (bu yalnız gösterge).
 */
export function renderSteps(steps: Record<StepId, StepView>, next: StepId | null): void {
  lastSteps = { steps, next };
  const order = next ? STEPS.indexOf(next) : STEPS.length;
  STEPS.forEach((id, i) => {
    const v = steps[id];
    const future = i > order || (next === null && v.state === "todo");
    const card = maybe(`step-${id}`);
    if (card) card.className = `step ${v.state}${next === id ? " next" : ""}${future ? " future" : ""}`;
    setText(`res-${id}`, v.state === "done" ? "✓" : v.state === "warn" ? "!" : "");
    const name = maybe(`name-${id}`);
    if (name) name.setAttribute("title", v.text || "");
    const b = maybe(STEP_BTN[id]);
    if (b) b.style.display = next === id ? "" : "none";
    const canRerun = v.state !== "todo" && next !== id;
    if (!canRerun) rerunOpen.delete(id);
    show(`rerun-${id}`, canRerun && rerunOpen.has(id));
  });
  show("sync-hint", steps.spread.state === "done" && steps.topla.state === "todo");
}

/** Biten bir adımın adına tıklanınca "Yeniden çalıştır" düğmesini aç / kapat. */
export function toggleRerun(id: StepId): void {
  if (!lastSteps) return;
  const v = lastSteps.steps[id];
  if (v.state === "todo" || lastSteps.next === id) return;
  if (rerunOpen.has(id)) rerunOpen.delete(id);
  else rerunOpen.add(id);
  renderSteps(lastSteps.steps, lastSteps.next);
}

// ------------------------------------------------------------------ işlem: ilerleme + tek satır sonuç

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
    rerunOpen.clear();
  } catch {
    /* gösterge yoksa geç */
  }
  progress(0.02, "Sequence okunuyor…");
}

/** İlerleme çubuğu + tek satır ne yapıldığı. frac: 0…1. */
export function progress(frac: number, text: string): void {
  if (!opActive) return;
  try {
    show("progress", !isAsking());
    const bar = maybe("progress-bar");
    if (bar) bar.setAttribute("value", String(Math.round(Math.max(0.02, Math.min(1, frac)) * 100)));
    setText("progress-text", text);
  } catch {
    /* gösterge yoksa geç */
  }
}

const CLASS: Record<ResultKind, string> = { ok: "ok", warn: "warn", err: "err", cancel: "dim", info: "dim" };
const ICON: Record<ResultKind, string> = { ok: "✓", warn: "⚠", err: "✗", cancel: "–", info: "•" };

/** İşlemin sonucu: tek satır + (varsa) "Ne yapmalıyım?" bağlantısının arkasında ne yapılacağı. Ayrıntı günlükte / Sorun bildir'de. */
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
  show("result-hint", false);
  show("result-help", !!hint);
  show("result", true);
  if (kind === "err") {
    try {
      noteError(opLabel, headline, [hint, ...details, ...currentOpLines()].filter(Boolean));
    } catch {
      /* yoksa geç */
    }
  }
}

/** "Ne yapmalıyım?" → ne yapılacağını göster / gizle. */
export function toggleHint(): void {
  const h = maybe("result-hint");
  if (h) h.style.display = h.style.display === "block" ? "none" : "block";
}

/** Başarılı / uyarılı bitiş — adımın ✓'ü (sequence başına hatırlanır) + tek satır sonuç. */
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
      if (/İptal edildi/.test(last)) opEnd("cancel", "Vazgeçildi; hiçbir şey değişmedi.");
      else opEnd("info", "Bitti.", "", []);
    }
    show("progress", false);
    endOp();
  } catch {
    /* yoksa geç */
  }
  opActive = false;
}

// ------------------------------------------------------------------ insan dilinde tek cümle, teknik terim yok

/**
 * Durdurma mesajının ana ekrana düşmemesi gereken terimleri (tick, transaction, action, TX, API adları, "A3" / "V1" track adları).
 * Tırnak içi metin (sequence / klip adları: "Kurgu v2", "Action Cam") ÖNCE atılır; track adı yalnız BÜYÜK harfle (inceleme #9, M4).
 * Sonuçlar, ipuçları ve ilerleme metinleri bizim yazdığımız sade cümleler → süzülmez (Ctrl+Z sayısı, yedek adı hep görünür).
 */
const TECH = /tick|transaction|\baction|\bTX-?\d|\bguid\b|ExtendScript|linkSelection|getLinkedItems|\bAPI\b|createCloneAction|executeTransaction|ClipProjectItem/i;
const TRACK = /\b[AV]\d+\b/;
const technical = (s: string): boolean => {
  const bare = s.replace(/"[^"]*"/g, "");
  return TECH.test(bare) || TRACK.test(bare);
};

const HUMAN: [RegExp, string][] = [
  [/^Önce TOPLA'ya bas: bu sequence için TOPLA kaydı yok/, "Önce Topla'ya bas: bu sequence henüz toplanmadı."],
  [/^Ayar TOPLA'dan sonra değişti/, "Ayarlar Topla'dan sonra değişti; önce Topla'ya tekrar bas."],
  [/YARIM hâlde/, "Önceki işlem yarım kaldı; önce geri al (Ctrl+Z) ya da yedek sequence'ı aç."],
  [/^KAMERA klibinin çift kopyası var/, "Bir kamera klibi aynı yerde iki kez var; fazlasını elle sil."],
  [/^İLK TAŞIMA TUTMADI/, "İlk taşıma beklendiği gibi olmadı; işlem durdu."],
  [/^İLK PARÇA TUTMADI/, "İlk ses kesimi beklendiği gibi olmadı; işlem durdu."],
  [/^KALİBRASYON TUTARLI BİR KURAL VERMEDİ/, "Kırpma komutları ölçülemedi; hiçbir şey kesilmedi."],
  [/^Kalibrasyonda .* beklenmeyen bir değişiklik/, "Kırpma ölçümü sırasında beklenmeyen bir değişiklik oldu; işlem durdu."],
  [/kamera klibi kırpılmış/, "Kırpılmış kamera klibi var; Dağıt başlamadı."],
  [/^Yeni düzende \d+ çakışma var/, "Yeni düzende klipler üst üste binerdi; Topla başlamadı."],
  [/^Plan kurulamadı/, "Plan kurulamadı; hiçbir şey değişmedi."],
  [/grup bağlanamadı/, "Bazı gruplar bağlanamadı; kesim yerinde, Bağla'ya tekrar bas."],
  [/bağlama isteği başarısız/, "Spread Helper'a ulaşılamadı; kesim yerinde, Bağla'ya tekrar bas."],
  [/^Bu sequence BAĞLA'dan geçti/, "Bu sequence zaten bağlandı; yeniden toplamak için Bağla öncesi yedeği aç."],
  [/^BAĞLA'dan sonra düzen değişmiş/, "Bağla'dan sonra düzen değişmiş; yedek sequence'la çalış."],
  [/^Kesimden sonra \d+ öğe yok ve kalanlar/, "Kesimden sonra silinen klipler grupları değiştirmiş; hiçbir şey yapılmadı."],
  [/^Düzen, kayıttaki KES planıyla uyuşmuyor/, "Kesimden sonra düzen değişmiş; hiçbir şey yapılmadı."],
  [/^Adımlar arasında timeline değişti/, "İşlem sürerken timeline değişti; güvenlik için durdu."],
  [/^Onay beklerken timeline değişti/, "Onay beklerken timeline değişti; hiçbir şey yapılmadı."],
  [/^Yedek sequence oluşmadı/, "Yedek sequence oluşturulamadı; hiçbir şey değişmedi."],
  [/doğrulaması tutmadı/, "Bir adımın sonucu beklendiği gibi değildi; işlem durdu."],
  [/Senkron sonucunda tutarsızlık/, "Senkron sonucunda tutarsızlık var; Topla başlamadı."],
  [/sequence yok|proje yok/i, "Aktif sequence yok; timeline'a bir kez tıkla."],
];

/** Durdurma mesajından tek cümle (bilinen durumlar elle; kalanı ilk cümle — teknik terim içeriyorsa sade bir cümle). */
export function humanize(message: string): string {
  for (const [re, h] of HUMAN) if (re.test(message)) return h;
  let s = message.split(/(?<=[.!?])\s|\s—\s/)[0] ?? message;
  const m = /^([A-ZÇĞİÖŞÜ ]{6,}):\s/.exec(s);
  if (m) s = m[1];
  if (/^[A-ZÇĞİÖŞÜ\s]+$/.test(s)) s = s.charAt(0) + s.slice(1).toLocaleLowerCase("tr");
  s = s.charAt(0).toLocaleUpperCase("tr") + s.slice(1);
  if (technical(s)) return "Beklenmeyen bir durum; işlem durdu.";
  if (s.length > 120) s = s.slice(0, 117) + "…";
  return /[.!?…]$/.test(s) ? s : s + ".";
}
