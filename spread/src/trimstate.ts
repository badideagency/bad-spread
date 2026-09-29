// KAMERA KLİBİ KIRPMA DURUMU — SAF (Premiere çağrısı yok). v1.2.1. SPREAD'in reddi, plan günlüğündeki [kırpılmış] etiketi, Durum
// raporu ve SPREAD'in "ilk overwrite (ölçüm)" adımı YALNIZ bu modülü kullanır (tek kural).
//
// Kanıt (gerçek rapor, Spread 1.2.0, Premiere 26.5.1, 29.97 fps tek kamera, 12 dokunulmamış klip): timeline'daki out TAM KARE sayısı
// (ör. 98877133555200 = 11666 × 8475667200), medya süresi milisaniye hizalı (98883348480000); medya − out hep 0 ile 1 kare arasında
// (0.026–0.940 kare). v1.2.0'ın "out ≠ medya sonu → kırpılmış" kuralı bu 12 klibin hepsini yanlışlıkla kırpılmış saydı.
//
// Kural: kırpılmamış ⇔ in = 0 (tick tam) VE 0 ≤ medya − out < 1 kare.
//   Kare = klibin video kare süresi: proje öğesinin (footage) kare hızı okunabiliyorsa o; yoksa sequence'ın timebase'i; o da yoksa
//   1/23.976 sn. Negatif fark (out medya sonunu aşıyor) ya da ≥ 1 kare → gerçekten kırpılmış (SPREAD başlamaz).

import { TICKS_PER_SECOND } from "./core";

/** 23.976 fps'in kare süresi (tick): 254016000000 × 1001 / 24000 = 10594584000 (tam). */
export const DEFAULT_FRAME = (TICKS_PER_SECOND * 1001n) / 24000n;

export type FrameSource = "footage" | "sequence" | "varsayılan";

export interface Frame {
  ticks: bigint;
  src: FrameSource;
}

/**
 * Kare hızı (fps, ör. 29.97002997 ya da 25) → kare süresi (tick). NTSC hızları (n × 1000/1001) tam değerine oturtulur
 * (29.97 → 8475667200); anlamsız değer → null.
 */
export function fpsToFrameTicks(fps: unknown): bigint | null {
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps < 1 || fps > 1000) return null;
  for (const n of [24, 30, 48, 60, 120, 240]) {
    const ntsc = (n * 1000) / 1001;
    if (Math.abs(fps - ntsc) < 0.005) return (TICKS_PER_SECOND * 1001n) / BigInt(n * 1000);
  }
  const t = BigInt(Math.round(Number(TICKS_PER_SECOND) / fps));
  return t > 0n ? t : null;
}

/** Klibin kare süresi: footage → sequence timebase → 23.976. */
export function frameOf(footageFrame: string | null, seqFrame: bigint | null): Frame {
  if (footageFrame && /^\d+$/.test(footageFrame) && BigInt(footageFrame) > 0n) return { ticks: BigInt(footageFrame), src: "footage" };
  if (seqFrame && seqFrame > 0n) return { ticks: seqFrame, src: "sequence" };
  return { ticks: DEFAULT_FRAME, src: "varsayılan" };
}

export function fpsText(f: Frame): string {
  return (Number(TICKS_PER_SECOND) / Number(f.ticks)).toFixed(3).replace(/\.?0+$/, "");
}

/** Bir tick farkını üç birimde yazar: "6214924800 tick = 24.466 ms = 0.733 kare". */
export function fmtDiff(d: bigint, f: Frame): string {
  const ms = (Number(d) / Number(TICKS_PER_SECOND)) * 1000;
  const fr = Number(d) / Number(f.ticks);
  const sign = d > 0n ? "+" : "";
  return `${sign}${d} tick = ${sign}${ms.toFixed(3)} ms = ${sign}${fr.toFixed(3)} kare`;
}

export function frameText(f: Frame): string {
  return `1 kare = ${f.ticks} tick (${fpsText(f)} fps, ${f.src === "footage" ? "proje öğesinin kare hızı" : f.src === "sequence" ? "sequence timebase" : "varsayılan 23.976"})`;
}

export interface TrimInput {
  inPt: string;
  outPt: string;
  mediaDur: string | null;
  /** proje öğesinin (footage) kare süresi, tick — okunamazsa null */
  frameTicks: string | null;
}

export interface TrimState {
  /** "full" = kırpılmamış, "trimmed" = gerçekten kırpılmış, "unknown" = medya süresi okunamadı (in = 0) */
  state: "full" | "trimmed" | "unknown";
  /** medya − out (tick); medya süresi okunamazsa null */
  diff: bigint | null;
  frame: Frame;
  /** kısa açıklama (günlük / rapor) */
  why: string;
}

const isTicks = (x: string | null): x is string => !!x && /^-?\d+$/.test(x);

/** TEK kural. @param seqFrame sequence timebase'inin kare süresi (tick) — okunamazsa null */
export function trimState(c: TrimInput, seqFrame: bigint | null): TrimState {
  const frame = frameOf(c.frameTicks, seqFrame);
  const diff = isTicks(c.mediaDur) && isTicks(c.outPt) ? BigInt(c.mediaDur) - BigInt(c.outPt) : null;
  if (c.inPt !== "0") return { state: "trimmed", diff, frame, why: `başı kırpılmış (in = ${c.inPt} tick ≠ 0)` };
  if (diff === null) return { state: "unknown", diff, frame, why: "medya süresi okunamadı" };
  if (diff < 0n) return { state: "trimmed", diff, frame, why: `out medya sonunu aşıyor (medya − out = ${fmtDiff(diff, frame)})` };
  if (diff >= frame.ticks) return { state: "trimmed", diff, frame, why: `kuyruğu kırpılmış (medya − out = ${fmtDiff(diff, frame)} ≥ 1 kare)` };
  return {
    state: "full",
    diff,
    frame,
    why: diff === 0n ? "tam boy (out = medya sonu)" : `tam boy (medya − out = ${fmtDiff(diff, frame)} < 1 kare: kare yuvarlaması)`,
  };
}

// ------------------------------------------------------------------ ilk overwrite (ölçüm): yerleşen klip aslıyla aynı mı

export interface EdgeDelta {
  start: bigint;
  end: bigint;
  inPt: bigint;
  outPt: bigint;
}

export type OverwriteFit = "exact" | "tail" | "other";

export interface Timed {
  start: string;
  end: string;
  inPt: string;
  outPt: string;
}

const b = (x: string) => (isTicks(x) ? BigInt(x) : null);

export function edgeDelta(orig: Timed, now: Timed): EdgeDelta | null {
  const v = [b(now.start), b(orig.start), b(now.end), b(orig.end), b(now.inPt), b(orig.inPt), b(now.outPt), b(orig.outPt)];
  if (v.some((x) => x === null)) return null;
  const [ns, os, ne, oe, ni, oi, no, oo] = v as bigint[];
  return { start: ns - os, end: ne - oe, inPt: ni - oi, outPt: no - oo };
}

/**
 * Proje öğesinden overwrite ile yerleşen klip, aslına göre:
 *   exact = start/end/in/out tick düzeyinde aynı;
 *   tail  = YALNIZ kuyruk farklı (start ve in aynı, Δend = Δout ≠ 0) ve |Δ| < 1 kare → ayrı transaction'da tek SetOutPoint düzeltir
 *           (kanıtlı kural: SetOutPoint yalnız kuyruğu değiştirir, Δend = Δout — trimcal.ts);
 *   other = başka her fark (baş, start kayması, ≥ 1 kare, okunamayan değer) → DUR.
 */
export function overwriteFit(orig: Timed, now: Timed, frame: Frame): OverwriteFit {
  const d = edgeDelta(orig, now);
  if (!d) return "other";
  if (d.start === 0n && d.end === 0n && d.inPt === 0n && d.outPt === 0n) return "exact";
  const abs = d.end < 0n ? -d.end : d.end;
  if (d.start === 0n && d.inPt === 0n && d.end === d.outPt && abs < frame.ticks) return "tail";
  return "other";
}

export function fmtDelta(d: EdgeDelta | null, f: Frame): string {
  if (!d) return "değerler okunamadı";
  const parts = (["start", "end", "inPt", "outPt"] as const).filter((k) => d[k] !== 0n).map((k) => `${k} ${fmtDiff(d[k], f)}`);
  return parts.length ? parts.join("; ") : "fark yok";
}
