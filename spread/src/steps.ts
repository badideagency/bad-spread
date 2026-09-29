// Adım göstergesi (v1.0.0) — YALNIZ görünüm: hangi adım tamam (✓ + kısa sonuç), sıradaki hangisi (vurgulu). Hiçbir işlemi
// engellemez ya da başlatmaz. Kaynaklar: bu panelin sequence başına hatırladığı son sonuçlar (localStorage) + TOPLA / BAĞLA kaydı.
// Her saniye timeline okunmaz (Premiere'i yorar). v1.2.1: her işaret, işlemin SONUNDAKİ timeline parmak izini taşır (fp: tam,
// tp: yalnız kaynak + track); panel açılınca, sequence değişince, timeline'ın şekli değişince (track / klip sayıları) ve her işlemden
// önce canlı timeline'la karşılaştırılır — tutmayan işaret silinir (records.ts → reconcile). KAYIT İPUCUDUR, KİLİT DEĞİLDİR.

import { readPanelLinkResult } from "./linker";
import type { Mid } from "./prints";
import { loadRecord } from "./settings";
import type { StepId, StepView } from "./ui";

const KEY = "spread.steps.v1";

/**
 * fp / tp: işlemin sonundaki timeline parmak izi (records.ts; v1.2.0 ve öncesinin kayıtlarında yok); mid: işlemin ARA hâlleri (kısmi
 * Ctrl+Z tanınsın, prints.ts); backup: işlemin aldığı yedek sequence
 */
export type StepMark = { kind: "ok" | "warn"; text: string; at: string; fp?: string; tp?: string; mid?: Mid[]; backup?: string | null };
type Saved = Partial<Record<StepId, StepMark>>;
export type StepMarks = Saved;

function all(): Record<string, Saved> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const j: unknown = raw ? JSON.parse(raw) : {};
    return j && typeof j === "object" ? (j as Record<string, Saved>) : {};
  } catch {
    return {};
  }
}

/**
 * Başarılı / uyarılı bitişi hatırla; önceki adım yeniden yapılınca sonrakilerin ✓'ü silinir.
 * @param noop işlem hiçbir şeyi değiştirmedi ("zaten dağıtılmış / toplanmış"): zamanı eski kalır ("" = en eski), sonrakiler silinmez
 */
export function rememberStep(guid: string | null, step: StepId, kind: "ok" | "warn", text: string, noop = false): void {
  if (!guid) return;
  try {
    const a = all();
    const s: Saved = { ...(a[guid] ?? {}) };
    // no-op: işaretin parmak izi / ara hâlleri / yedeği korunur (timeline değişmedi; kısmi Ctrl+Z hâlâ tanınsın)
    s[step] = { ...(noop ? s[step] : undefined), kind, text, at: noop ? (s[step]?.at ?? "") : new Date().toISOString() };
    if (noop) {
      /* düzen değişmedi → sonraki adımların ✓'ü geçerli kalır */
    } else if (step === "spread") {
      delete s.topla;
      delete s.bagla;
    } else if (step === "topla") delete s.bagla;
    a[guid] = s;
    window.localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* hatırlanamazsa yalnız bu oturumda görünmez */
  }
}

function saveAll(a: Record<string, Saved>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* hatırlanamazsa yalnız bu oturumda görünmez */
  }
}

/** v1.2.1: bu sequence'ın adım işaretleri (salt okuma). */
export function stepMarks(guid: string): Saved {
  return { ...(all()[guid] ?? {}) };
}

/** v1.2.1: işlemin sonundaki timeline parmak izini işarete yazar (işaret yoksa bir şey yapmaz). */
export function setStepPrint(guid: string, step: StepId, fp: string, tp: string): void {
  const a = all();
  const m = a[guid]?.[step];
  if (!m) return;
  a[guid] = { ...a[guid], [step]: { ...m, fp, tp } };
  saveAll(a);
}

/** v1.2.1: bu sequence'ın işaretlerini verilenlerle değiştirir (records.ts: Ctrl+Y ile geri dönülünce geri yükleme). */
export function setStepMarks(guid: string, marks: Saved): void {
  const a = all();
  a[guid] = { ...marks };
  saveAll(a);
}

/** v1.2.1: işlemin ara hâllerini ve yedeğini işarete yazar (işaret yoksa bir şey yapmaz). */
export function setStepMids(guid: string, step: StepId, mid: Mid[], backup: string | null): void {
  const a = all();
  const m = a[guid]?.[step];
  if (!m) return;
  a[guid] = { ...a[guid], [step]: { ...m, mid, backup } };
  saveAll(a);
}

/** v1.2.1: verilen adımların işaretlerini siler (yalnız bu sequence). ids yoksa bu sequence'ın bütün işaretleri. */
export function forgetSteps(guid: string, ids?: StepId[]): void {
  const a = all();
  if (!(guid in a)) return;
  if (!ids) delete a[guid];
  else {
    const s: Saved = { ...a[guid] };
    for (const id of ids) delete s[id];
    a[guid] = s;
  }
  saveAll(a);
}

export function stepViews(guid: string | null): { steps: Record<StepId, StepView>; next: StepId | null } {
  const s: Saved = guid ? (all()[guid] ?? {}) : {};
  const rec0 = guid ? loadRecord(guid) : null;
  // kayıt, bu panelde SONRADAN yapılan bir SPREAD'den eskiyse yok sayılır (yeniden SPREAD → TOPLA / BAĞLA ✓'ü dönmesin)
  const rec = rec0 && (!s.spread || rec0.at >= s.spread.at) ? rec0 : null;
  const v = (id: StepId, fallback: StepView | null): StepView => {
    const x = s[id];
    if (x) return { state: x.kind === "ok" ? "done" : "warn", text: x.text };
    return fallback ?? { state: "todo", text: "" };
  };
  const topla = v("topla", rec ? { state: "done", text: `toplandı (${rec.at.slice(0, 10)})` } : null);
  const bind = rec?.bind && (!s.topla || rec.bind.at >= s.topla.at) ? rec.bind : null;
  let bagla = v("bagla", bind ? (bind.stage === "linked" ? { state: "done", text: "bağlandı" } : { state: "warn", text: "kesildi; bağlanmayı bekliyor" }) : null);
  // kesim bu panelde yapıldı, bağlama Spread Helper panelinde yapıldıysa (sonuç dosyası bu planın) → ✓
  if (bagla.state === "warn" && bind && bind.stage === "cut") {
    const pr = readPanelLinkResult();
    if (pr && pr.ok && pr.planCreatedAt === bind.at) bagla = { state: "done", text: "Spread Helper panelinde bağlandı." };
  }
  const spread = v("spread", topla.state !== "todo" ? { state: "done", text: "" } : null);
  // v1.1.0: bağlama bitmiş ama notlu (ör. bazı sesler bağ dışında, bağ okunarak doğrulanamadı) → "!" kalır ama sıradaki adım yok
  const baglaFinished = bagla.state === "done" || (bagla.state === "warn" && bind?.stage === "linked");
  const next: StepId | null = baglaFinished ? null : topla.state === "done" ? "bagla" : spread.state === "done" ? "topla" : "spread";
  return { steps: { spread, topla, bagla }, next };
}
