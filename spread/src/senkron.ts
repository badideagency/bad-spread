// SENKRON (v1.4.0) — SAF ses eşleştirme motoru (Premiere API'si YOK, Node API'si YOK). Yardımcı panel (cep-helper/js/senkron.js)
// dosyaları ffmpeg ile mono 8 kHz'e çözer ve buraya verir; sonuç yalnız veri (hangi dosya nerede, ne kadar emin). UXP (Spread)
// sonucu okur, raporlar ("Dene") ya da — Ayarlar'daki deneysel anahtar açıksa — timeline'a uygular ("Uygula").
//
// 1) ZARF (kaba arama için, 100 Hz): sinyalin ortalaması (DC kayması) çıkarılır; 10 ms'lik blokların enerjisi → log (kazanç farkı toplamsal sabite döner) → ±0.5 sn hareketli
//    ortalaması çıkarılır (hece ritmi kalır, mikrofonun rengi / gürültü tabanı gider). Sessiz ya da ayırt edici sesi olmayan dosya
//    ("sessiz") eşleşmeye girmez → "emin değil".
// 2) KABA: iki zarfın bütün kaydırmalarda NORMALİZE çapraz korelasyonu (FFT + önek toplamlarıyla yerel normalizasyon; yalnız en az
//    `minOverlap` üst üste binen kaydırmalar). Güven = en yüksek tepe (NCC) VE birinci / ikinci tepe oranı (ikinci tepe: birinciden
//    ≥ 1 sn uzakta). Eşik altı → eşleşme YOK (tahmin yok).
// 3) İNCE: kaba sonucun ±1 sn'sinde, 8 kHz sinyalde, en yüksek enerjili ≤ 8 sn'lik ortak bölümde GCC-PHAT (farklı mikrofonların
//    renk farkını düzler, tepe keskin) + parabolik alt-örnek ara değerleme → ≪ 1 ms. İnce tepe kabaya ≤ 50 ms uzak ve keskin olmalı.
// 4) ÇÖZÜM: en çok desteklenen dosyadan başlayarak BÜYÜYEN yerleşim. Yerleşmemiş her dosya için yerleşmiş komşularının verdiği
//    konum tahminleri ±2 ms içinde kümelenir; en ağır küme açıkça önde (ikinci küme < yarısı) VE kısıtlar tutuyorsa yerleşir:
//    kimliği kesin cihazın (kamera, Zoom) iki kaydı ≥ 1 kare üst üste olamaz; sayacı güvenli cihazda dosya sırası = zaman sırası.
//    Kısıtı bozan eşleşme düşer, çiftin bir sonraki (yine güvenli) tepesi denenir. Hiçbir yolla yerleşemeyen → "emin değil".
//    Birbirine hiç bağlanmayan kümeler AYRI GRUP (ayrı oturum); gruplar arası mesafe saat ipucundan, yoksa bilinmez (boşluk).
//    TEKRARLAYAN İÇERİK (müzik döngüsü, aynı jingle) yanlış yerleşimin ana kaynağıdır (inceleme #15). Bu yüzden:
//      - bir dosya TEK bir eşleşmeyle ancak o eşleşme GENİŞ bir aralıkta arandıysa (≥ wideSec: rakip tekrarlar oran sınamasına
//        girebilsin) yerleşir; dar aralıklı eşleşmelerde (iki kısa klip) en az İKİ bağımsız eşleşme gerekir;
//      - bir grupta eşleşmesi olup orada yerleşemeyen (çelişen / kısıtı bozan) dosya başka grup kuramaz, başka gruba giremez;
//      - kimliği kesin cihazın (kamera, Zoom) ≥ 3 saatli dosyası aynı saat kaymasında tutarlıysa (sapma ≤ 2 sn), saatine
//        > clockTolSec uyuşmayan dosyası "emin değil" (saat ipucuyla çelişiyor) ve çözüm onsuz yeniden kurulur.
// 5) SAAT İPUÇLARI (dosya adı tarih_saat, ffprobe creation_time / timecode) YALNIZ aramayı daraltır ve raporlanır: cihaz başına saat
//    kayması, o cihazın güvenle yerleşmiş dosyalarının (konum − saat) medyanı. İpucuyla daraltılmış ikinci turda da eşikler aynı.
// Bütün konumlar saniye (Number); tick'e çeviri UXP'de (1 sn = 254016000000 tick; 1 ms ≪ 1 kare). Rapordaki konumlar DOSYA BAŞINA
// göre (Premiere klibi dosyanın zaman sıfırına koyar): PCM'in ilk örneği dosya başından `lead` sn sonraysa (ses akışı geç başlıyor;
// yardımcı ffprobe'dan bulur) konum = PCM başı − lead.

export const SR = 8000;
export const ENV_RATE = 100;
const HOP = SR / ENV_RATE;

export interface SenkronOpts {
  /** kaba aday eşiği (zarf NCC; yalnız aday seçer, güven değil) */
  minNcc: number;
  /** güven: ince GCC-PHAT tepe yüksekliği, keskinlik (tepe / ±5 ms dışı en büyük) ve birinci / ikinci aday oranı */
  minPeak: number;
  minSharp: number;
  minRatio: number;
  /** kaba aşamadan ince aşamaya giden en çok aday */
  candidates: number;
  /** kaba aramada en az ortak süre (sn); kısa dosyada dosyanın kendisi */
  minOverlapSec: number;
  /** kimliği kesin cihazda "üst üste" sayılan en küçük çakışma (sn) = 1 kare */
  frameSec: number;
  /** döngü / küme tutarlılığı (sn) */
  tolSec: number;
  /** ince arama penceresi (±sn) ve bölüm uzunluğu (sn) */
  fineHalfSec: number;
  fineWinSec: number;
  /** saat ipucuyla daraltılmış aramanın yarı genişliği (sn) */
  hintHalfSec: number;
  /** tek eşleşmeyle yerleşme için en dar arama aralığı (sn) */
  wideSec: number;
  /** tutarlı cihaz saatine göre izin verilen en büyük fark (sn) */
  clockTolSec: number;
}

export const DEFAULT_OPTS: SenkronOpts = {
  minNcc: 0.15,
  minPeak: 0.06,
  minSharp: 2,
  minRatio: 3,
  candidates: 4,
  minOverlapSec: 15,
  frameSec: 1001 / 24000,
  tolSec: 0.002,
  fineHalfSec: 1,
  fineWinSec: 8,
  hintHalfSec: 10,
  wideSec: 60,
  clockTolSec: 30,
};

export interface SenkronInput {
  id: string;
  name: string;
  kind: "camera" | "audio";
  /** identity.ts cihazı ("A", "Sony", "DJI", "Zoom" …) ve kaydı (Zoom'da kanallar aynı kayıt: aynı anda başlar) */
  device: string;
  recording: string;
  /** cihaz kimliği kesin mi (health.ts certainDevice): kesinse kendi kayıtları üst üste olamaz */
  certain: boolean;
  /** güvenli sayaç (health.ts counterUsable → identity order) ya da null */
  order: number[] | null;
  /** mono 8 kHz örnekler */
  pcm: Int16Array | Float32Array;
  /** saat ipucu: kaydın başlangıcı, saniye (aynı cihazın dosyaları arasında karşılaştırılabilir) ya da null */
  clock: number | null;
  clockSrc?: string;
  /** PCM'in ilk örneğinin dosyanın zaman sıfırına göre yeri (sn; ses akışı videodan sonra başlıyorsa +) — rapor konumları dosya başına göre */
  lead?: number;
}

export interface Peak {
  /** b'nin a'ya göre başlangıcı (sn): pos(b) − pos(a) */
  s: number;
  ncc: number;
}

export interface Edge {
  a: number;
  b: number;
  /** güvenli tepeler (en iyisi başta); ince ayarlı. ncc: zarf NCC, peak: GCC-PHAT tepe yüksekliği, ratio: sonraki adaya oranı */
  peaks: { s: number; ncc: number; peak: number; ratio: number; sharp: number }[];
  /** en iyi adayın PHAT tepesi ve oranı (rapor; güvenli olmasa da) */
  best: number;
  bestRatio: number;
  why: string | null;
  /** aranan kaydırma aralığının genişliği (sn) — dar aralıkta rakip tekrarlar hiç sınanmamış olabilir */
  span: number;
  /** saat ipucuyla daraltılmış ikinci turdan */
  hinted: boolean;
}

export interface Placed {
  id: string;
  name: string;
  status: "ok" | "emin değil";
  /** grup numarası (1…), yerleşemeyende 0 */
  group: number;
  /** grubun başlangıcına göre konum (sn) */
  pos: number | null;
  /** 0…1 (yerleştiren kümenin ağırlığı, en güçlü tek eşleşmenin NCC'si ile sınırlı) */
  confidence: number;
  /** yerleştiren en güçlü eşleşmenin karşı dosyası */
  via: string | null;
  /** yerleştiren en güçlü eşleşmenin GCC-PHAT tepesi ve oranı */
  viaPeak: number;
  viaRatio: number;
  /** kaç eşleşme bu konumu doğruladı (±tolSec) */
  support: number;
  /** saat ipucunun beklediği konum (grup koordinatında) ve fark (sn) */
  hintPos: number | null;
  hintDiff: number | null;
  why: string;
}

export interface Group {
  n: number;
  ids: string[];
  /** grubun kapsadığı aralık (grup koordinatı) */
  start: number;
  end: number;
  /** saat ipucundan 1. gruba göre başlangıç farkı (sn) ya da null */
  clockFrom1: number | null;
}

export interface SenkronResult {
  placed: Placed[];
  groups: Group[];
  edges: { a: string; b: string; s: number | null; peak: number; ratio: number; used: boolean; residualMs: number | null; why: string | null }[];
  deviceClock: { device: string; offset: number; n: number; spread: number }[];
  notes: string[];
}

export interface Hooks {
  progress?: (text: string, frac: number) => void;
  cancelled?: () => boolean;
  yieldNow?: () => Promise<void>;
}

export class Cancelled extends Error {
  constructor() {
    super("iptal edildi");
  }
}

// ------------------------------------------------------------------ FFT (yinelemeli radix-2, karmaşık)

interface FftPlan {
  n: number;
  rev: Uint32Array;
  cos: Float64Array;
  sin: Float64Array;
}
const plans = new Map<number, FftPlan>();

function planOf(n: number): FftPlan {
  let p = plans.get(n);
  if (p) return p;
  const bits = Math.round(Math.log2(n));
  if (1 << bits !== n) throw new Error("FFT boyu 2'nin kuvveti olmalı: " + n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i;
    let r = 0;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = r >>> 0;
  }
  const cos = new Float64Array(n >> 1);
  const sin = new Float64Array(n >> 1);
  for (let k = 0; k < n >> 1; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sin[k] = Math.sin((2 * Math.PI * k) / n);
  }
  p = { n, rev, cos, sin };
  if (plans.size > 8) plans.clear();
  plans.set(n, p);
  return p;
}

export function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  const p = planOf(n);
  for (let i = 0; i < n; i++) {
    const j = p.rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = p.cos[k];
        const wi = inverse ? p.sin[k] : -p.sin[k];
        const a = i + j;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}

const pow2 = (x: number) => 1 << Math.ceil(Math.log2(Math.max(2, x)));

/**
 * Çapraz korelasyon C[k] = Σ_m a[m]·b[m − k], k ∈ [−(Lb−1), La−1] → dizi indeksi k + (Lb − 1).
 * k > 0: b, a'dan k örnek SONRA başlar (pos(b) − pos(a) = k / hız). phat: GCC-PHAT ağırlığı.
 */
export function xcorr(a: ArrayLike<number>, b: ArrayLike<number>, phat = false): Float64Array {
  const La = a.length;
  const Lb = b.length;
  const n = pow2(La + Lb);
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  for (let i = 0; i < La; i++) ar[i] = a[i];
  for (let i = 0; i < Lb; i++) br[i] = b[i];
  fft(ar, ai, false);
  fft(br, bi, false);
  // A · conj(B)
  let mag = 0;
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] + ai[i] * bi[i];
    const im = ai[i] * br[i] - ar[i] * bi[i];
    ar[i] = r;
    ai[i] = im;
    if (phat) mag += Math.hypot(r, im);
  }
  if (phat) {
    const eps = (mag / n) * 1e-3 + 1e-20;
    for (let i = 0; i < n; i++) {
      const m = Math.hypot(ar[i], ai[i]) + eps;
      ar[i] /= m;
      ai[i] /= m;
    }
  }
  fft(ar, ai, true);
  const out = new Float64Array(La + Lb - 1);
  for (let k = -(Lb - 1); k <= La - 1; k++) out[k + Lb - 1] = ar[(k + n) % n];
  return out;
}

// ------------------------------------------------------------------ zarf

export interface Env {
  env: Float32Array;
  /** ayırt edici ses var mı */
  usable: boolean;
  why: string;
  rms: number;
}

const toFloat = (x: Int16Array | Float32Array): Float32Array => {
  if (x instanceof Float32Array) return x;
  const f = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) f[i] = x[i] / 32768;
  return f;
};

function percentile(v: Float64Array, p: number): number {
  if (!v.length) return 0;
  const s = Float64Array.from(v).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

export function envelope(pcm: Int16Array | Float32Array): Env {
  const x = toFloat(pcm);
  const nb = Math.floor(x.length / HOP);
  const e = new Float64Array(nb);
  let tot = 0;
  for (let b = 0; b < nb; b++) {
    let s = 0;
    for (let i = b * HOP; i < (b + 1) * HOP; i++) s += x[i] * x[i];
    e[b] = s / HOP;
    tot += s;
  }
  const rms = Math.sqrt(tot / Math.max(1, nb * HOP));
  const env = new Float32Array(nb);
  if (nb < ENV_RATE * 2) return { env, usable: false, why: "çok kısa (< 2 sn)", rms };
  if (rms < 1e-4) return { env, usable: false, why: `sessiz (RMS ${(20 * Math.log10(rms + 1e-12)).toFixed(0)} dBFS)`, rms };
  const floor = Math.max(percentile(e, 0.2), 1e-10);
  const p90 = percentile(e, 0.9);
  if (p90 < floor * 1.6) return { env, usable: false, why: "ayırt edici ses yok (düz gürültü / ton)", rms };
  const L = new Float64Array(nb);
  for (let b = 0; b < nb; b++) L[b] = Math.log(e[b] + floor);
  // ±0.5 sn hareketli ortalama çıkar
  const W = ENV_RATE >> 1;
  const pre = new Float64Array(nb + 1);
  for (let b = 0; b < nb; b++) pre[b + 1] = pre[b] + L[b];
  for (let b = 0; b < nb; b++) {
    const lo = Math.max(0, b - W);
    const hi = Math.min(nb, b + W + 1);
    env[b] = L[b] - (pre[hi] - pre[lo]) / (hi - lo);
  }
  return { env, usable: true, why: "", rms };
}

// ------------------------------------------------------------------ kaba arama (normalize çapraz korelasyon)

/**
 * Bütün kaydırmalarda NCC. Yalnız ortak kısmı ≥ minN örnek olan ve [kMin, kMax] içindeki kaydırmalar. Tepeler: en iyi + birbirinden
 * ≥ sep uzak sonrakiler (en çok 4).
 */
export function nccPeaks(a: Float32Array, b: Float32Array, minN: number, kMin: number, kMax: number, sep: number): { k: number; ncc: number }[] {
  const La = a.length;
  const Lb = b.length;
  if (!La || !Lb) return [];
  const C = xcorr(a, b);
  const pa = new Float64Array(La + 1);
  const pa2 = new Float64Array(La + 1);
  for (let i = 0; i < La; i++) {
    pa[i + 1] = pa[i] + a[i];
    pa2[i + 1] = pa2[i] + a[i] * a[i];
  }
  const pb = new Float64Array(Lb + 1);
  const pb2 = new Float64Array(Lb + 1);
  for (let i = 0; i < Lb; i++) {
    pb[i + 1] = pb[i] + b[i];
    pb2[i + 1] = pb2[i] + b[i] * b[i];
  }
  const lo = Math.max(-(Lb - 1), kMin);
  const hi = Math.min(La - 1, kMax);
  const vals: { k: number; ncc: number }[] = [];
  const ncc = new Float64Array(Math.max(0, hi - lo + 1)).fill(-2);
  for (let k = lo; k <= hi; k++) {
    const m0 = Math.max(0, k);
    const m1 = Math.min(La, Lb + k);
    const n = m1 - m0;
    if (n < minN) continue;
    const sa = pa[m1] - pa[m0];
    const sa2 = pa2[m1] - pa2[m0];
    const sb = pb[m1 - k] - pb[m0 - k];
    const sb2 = pb2[m1 - k] - pb2[m0 - k];
    const va = sa2 - (sa * sa) / n;
    const vb = sb2 - (sb * sb) / n;
    if (va <= 1e-9 * n || vb <= 1e-9 * n) continue;
    ncc[k - lo] = (C[k + Lb - 1] - (sa * sb) / n) / Math.sqrt(va * vb);
  }
  // tepeler: yerel en büyükler, büyükten küçüğe, birbirinden ≥ sep uzak
  for (let i = 0; i < ncc.length; i++) {
    const v = ncc[i];
    if (v <= -2) continue;
    if ((i > 0 && ncc[i - 1] > v) || (i + 1 < ncc.length && ncc[i + 1] >= v)) continue;
    vals.push({ k: i + lo, ncc: v });
  }
  vals.sort((x, y) => y.ncc - x.ncc);
  const out: { k: number; ncc: number }[] = [];
  for (const v of vals) {
    if (out.some((o) => Math.abs(o.k - v.k) < sep)) continue;
    out.push(v);
    if (out.length >= 4) break;
  }
  return out;
}

// ------------------------------------------------------------------ ince ayar (8 kHz, GCC-PHAT)

/**
 * @param K0 kaba kaydırma (örnek, 8 kHz): pos(b) − pos(a)
 * @returns ince kaydırma (örnek, kesirli) ve keskinlik (tepe / ±5 ms dışındaki en büyük) ya da null (ortak bölüm yok)
 */
export function fineShift(a: Float32Array, b: Float32Array, K0: number, halfSec: number, winSec: number): { K: number; sharp: number; peak: number } | null {
  const La = a.length;
  const Lb = b.length;
  const M = Math.round(halfSec * SR);
  const m0 = Math.max(0, K0);
  const m1 = Math.min(La, Lb + K0);
  if (m1 - m0 < SR) return null; // < 1 sn ortak
  const W = Math.min(m1 - m0, Math.round(winSec * SR));
  // a'nın ortak kısmında en yüksek enerjili W'lik pencere (80 örneklik bloklarla)
  let best = m0;
  if (m1 - m0 > W) {
    const nb = Math.floor((m1 - m0) / HOP);
    const be = new Float64Array(nb + 1);
    for (let i = 0; i < nb; i++) {
      let s = 0;
      for (let j = m0 + i * HOP; j < m0 + (i + 1) * HOP; j++) s += a[j] * a[j];
      be[i + 1] = be[i] + s;
    }
    const wb = Math.floor(W / HOP);
    let bestE = -1;
    for (let i = 0; i + wb <= nb; i++) {
      const s = be[i + wb] - be[i];
      if (s > bestE) {
        bestE = s;
        best = m0 + i * HOP;
      }
    }
  }
  const A = a.subarray(best, best + W);
  const j0 = Math.max(0, best - K0 - M);
  const j1 = Math.min(Lb, best - K0 + W + M);
  if (j1 - j0 < SR) return null;
  const B = b.subarray(j0, j1);
  const r = xcorr(A, B, true);
  // A[t] ↔ B[t − k'] → K = best − j0 + k'. İzinli K: [K0 − M, K0 + M]
  const off = B.length - 1;
  const kLo = Math.max(-(B.length - 1), K0 - M - best + j0);
  const kHi = Math.min(A.length - 1, K0 + M - best + j0);
  if (kHi < kLo) return null;
  let kb = kLo;
  for (let k = kLo; k <= kHi; k++) if (r[k + off] > r[kb + off]) kb = k;
  const excl = Math.round(0.005 * SR);
  let second = 1e-12;
  for (let k = kLo; k <= kHi; k++) if (Math.abs(k - kb) > excl && r[k + off] > second) second = r[k + off];
  // parabolik ara değerleme
  let frac = 0;
  if (kb > kLo && kb < kHi) {
    const y0 = r[kb - 1 + off];
    const y1 = r[kb + off];
    const y2 = r[kb + 1 + off];
    const den = y0 - 2 * y1 + y2;
    if (den < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den));
  }
  return { K: best - j0 + kb + frac, sharp: r[kb + off] / second, peak: r[kb + off] };
}

// ------------------------------------------------------------------ saat ipucu (dosya adından)

/** Dosya adındaki tarih_saat → saniye (yerel saat, yalnız aynı cihazın dosyaları arasında karşılaştırılır) ya da null. */
export function clockFromName(name: string): number | null {
  const b = name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  let m = /(?:^|_)(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_|$)/.exec(b);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
  m = /^(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_|$)/.exec(b);
  if (m) return Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
  return null;
}

// ------------------------------------------------------------------ ana akış

const median = (v: number[]) => {
  const s = v.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const cmpOrder = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};

interface Node {
  f: SenkronInput;
  x: Float32Array;
  env: Env;
  dur: number;
}

export async function solve(files: SenkronInput[], opts0: Partial<SenkronOpts> = {}, hooks: Hooks = {}): Promise<SenkronResult> {
  const o: SenkronOpts = { ...DEFAULT_OPTS, ...opts0 };
  const yieldNow = hooks.yieldNow ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const step = async (text: string, frac: number) => {
    if (hooks.cancelled?.()) throw new Cancelled();
    hooks.progress?.(text, frac);
    await yieldNow();
  };
  const notes: string[] = [];
  const nodes: Node[] = [];
  for (let i = 0; i < files.length; i++) {
    await step(`zarf ${i + 1}/${files.length}`, 0.05 * (i / Math.max(1, files.length)));
    const x0 = toFloat(files[i].pcm);
    // DC kayması zarfı düzleştirmesin (inceleme #15): ortalama çıkarılır (kopya; çağıranın dizisine dokunulmaz)
    let mean = 0;
    for (let k = 0; k < x0.length; k++) mean += x0[k];
    mean /= Math.max(1, x0.length);
    const x = x0 === files[i].pcm || Math.abs(mean) > 1e-6 ? Float32Array.from(x0, (v) => v - mean) : x0;
    nodes.push({ f: files[i], x, env: envelope(x), dur: x.length / SR });
  }
  const n = nodes.length;
  // eşleştirilecek çiftler: aynı KESİN cihazın kayıtları aynı anda olamaz → atlanır
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const A = nodes[i];
      const B = nodes[j];
      if (!A.env.usable || !B.env.usable) continue;
      // aynı KESİN cihazın FARKLI kayıtları aynı anda olamaz → eşleştirilmez (aynı kaydın kanalları eşleşir: Zoom Tr1 ↔ Tr2)
      if (A.f.device === B.f.device && A.f.certain && B.f.certain && A.f.recording !== B.f.recording) continue;
      pairs.push([i, j]);
    }
  const edges: Edge[] = [];
  const match = async (i: number, j: number, win: [number, number] | null): Promise<Edge> => {
    const A = nodes[i];
    const B = nodes[j];
    const shorter = Math.min(A.env.env.length, B.env.env.length);
    const minN = Math.min(shorter, Math.round(o.minOverlapSec * ENV_RATE));
    const kMin = win ? Math.floor(win[0] * ENV_RATE) : -Infinity;
    const kMax = win ? Math.ceil(win[1] * ENV_RATE) : Infinity;
    const pk = nccPeaks(A.env.env, B.env.env, minN, kMin, kMax, ENV_RATE).filter((p) => p.ncc >= o.minNcc);
    // aranan aralık: ortak kısmı ≥ minN olan kaydırmalar (∩ pencere)
    const lo = Math.max(minN - B.env.env.length, kMin);
    const hi = Math.min(A.env.env.length - minN, kMax);
    const e: Edge = { a: i, b: j, peaks: [], best: 0, bestRatio: 0, why: null, span: Math.max(0, hi - lo) / ENV_RATE, hinted: !!win };
    if (!pk.length) {
      e.why = "ortak bölüm / benzerlik yok";
      return e;
    }
    // ince aşama her aday için (8 kHz, GCC-PHAT): güven dalga biçimi uyumundan
    const cand: { s: number; ncc: number; peak: number; sharp: number }[] = [];
    for (const p of pk.slice(0, o.candidates)) {
      await yieldNow();
      const f = fineShift(A.x, B.x, Math.round((p.k / ENV_RATE) * SR), o.fineHalfSec, o.fineWinSec);
      if (!f) continue;
      const s = f.K / SR;
      // ince tepe kaba adaydan uzaksa aday tutarsız → tepesi sayılmaz
      cand.push({ s, ncc: p.ncc, peak: Math.abs(s - p.k / ENV_RATE) <= 0.05 ? f.peak : 0, sharp: f.sharp });
    }
    cand.sort((x, y) => y.peak - x.peak);
    if (!cand.length || cand[0].peak <= 0) {
      e.why = "ince ayar tutarsız (ortak bölüm yok ya da tepe kabadan uzak)";
      return e;
    }
    e.best = cand[0].peak;
    e.bestRatio = cand[0].peak / Math.max(cand[1]?.peak ?? 0, 0.02);
    for (let q = 0; q < cand.length; q++) {
      const c = cand[q];
      const ratio = c.peak / Math.max(cand[q + 1]?.peak ?? 0, 0.02);
      if (c.peak < o.minPeak || c.sharp < o.minSharp || ratio < o.minRatio) {
        if (q === 0)
          e.why =
            c.peak < o.minPeak
              ? `dalga biçimi uyumu düşük (tepe ${c.peak.toFixed(3)} < ${o.minPeak})`
              : c.sharp < o.minSharp
                ? `tepe keskin değil (${c.sharp.toFixed(1)} < ${o.minSharp})`
                : `iki aday yakın (oran ${ratio.toFixed(1)} < ${o.minRatio})`;
        break;
      }
      e.peaks.push({ s: c.s, ncc: c.ncc, peak: c.peak, ratio, sharp: c.sharp });
    }
    return e;
  };
  for (let q = 0; q < pairs.length; q++) {
    await step(`eşleştiriliyor ${q + 1}/${pairs.length}`, 0.1 + 0.75 * (q / Math.max(1, pairs.length)));
    edges.push(await match(pairs[q][0], pairs[q][1], null));
  }
  await step("çözülüyor", 0.87);
  const banned = new Map<number, string>();
  const settle = () => {
    let P = place(nodes, edges, o, banned);
    for (let round = 0; round < 6; round++) {
      const more = clockConflicts(nodes, P, o).filter(([i]) => !banned.has(i));
      if (!more.length) break;
      for (const [i, why] of more) banned.set(i, why);
      P = place(nodes, edges, o, banned);
    }
    return P;
  };
  let placement = settle();
  // saat ipucu ikinci tur: yerleşemeyenler için, cihaz saat kayması biliniyorsa dar pencerede (±hintHalfSec; eşikler aynı)
  const offs = deviceOffsets(nodes, placement);
  const retry = nodes
    .map((_, i) => i)
    .filter((i) => placement.group[i] === 0 && !banned.has(i) && !placement.blocked[i] && nodes[i].env.usable && nodes[i].f.clock !== null && offs.has(nodes[i].f.device));
  if (retry.length) {
    let changed = false;
    for (let r = 0; r < retry.length; r++) {
      const i = retry[r];
      const gi = offs.get(nodes[i].f.device)!;
      const expect = nodes[i].f.clock! + gi.offset + lead(nodes[i]); // i'nin PCM başının beklenen yeri (grup gi.group koordinatı)
      for (let j = 0; j < n; j++) {
        if (placement.group[j] !== gi.group || !nodes[j].env.usable) continue;
        if (nodes[i].f.device === nodes[j].f.device && nodes[i].f.certain && nodes[j].f.certain && nodes[i].f.recording !== nodes[j].f.recording) continue;
        await step(`saat ipucuyla yeniden aranıyor ${r + 1}/${retry.length}`, 0.88 + 0.08 * (r / retry.length));
        // d = beklenen pos(i) − pos(j). Kenar s = pos(b) − pos(a) saklar → i = a ise s = −d, i = b ise s = d (inceleme #15 B1)
        const d = expect - placement.pos[j];
        const [a, b] = i < j ? [i, j] : [j, i];
        const c = i === a ? -d : d;
        const e = await match(a, b, [c - o.hintHalfSec, c + o.hintHalfSec]);
        if (!e.peaks.length) continue;
        const k = edges.findIndex((x) => x.a === a && x.b === b);
        if (k >= 0 && !edges[k].peaks.length) {
          edges[k] = e;
          changed = true;
        } else if (k < 0) {
          edges.push(e);
          changed = true;
        }
      }
    }
    if (changed) {
      placement = settle();
      notes.push(`saat ipucuyla dar pencerede (±${o.hintHalfSec} sn) yeniden arandı: ${retry.length} dosya`);
    }
  }
  if (banned.size) notes.push(`${banned.size} dosya saat ipucuyla çeliştiği için yerleştirilmedi`);
  await step("rapor", 0.97);
  return report(nodes, edges, placement, o, notes);
}

interface Placement {
  group: number[];
  pos: number[];
  weight: number[];
  via: number[];
  viaPeak: { ncc: number; ratio: number }[];
  support: number[];
  why: string[];
  /** kullanılan tepe (kenar indeksi → tepe indeksi) */
  used: Map<number, number>;
  /** bir grupta eşleşmesi olup orada yerleşemedi → başka grup kuramaz / giremez */
  blocked: boolean[];
}

/** PCM başının dosyanın zaman sıfırına göre yeri (sn). */
const lead = (x: Node) => (typeof x.f.lead === "number" && Number.isFinite(x.f.lead) ? x.f.lead : 0);

/** Konum tahmini: yerleşmiş j'den i'ye kenar e'nin q. tepesi → pos(i). */
function estimate(e: Edge, q: number, i: number, posJ: number): number {
  const s = e.peaks[q].s; // pos(b) − pos(a)
  return e.a === i ? posJ - s : posJ + s;
}

/** @param banned yerleştirilmeyecek dosyalar (ör. saat ipucuyla çelişen) → gerekçeleriyle "emin değil" */
function place(nodes: Node[], edges: Edge[], o: SenkronOpts, banned: Map<number, string> = new Map()): Placement {
  const n = nodes.length;
  const P: Placement = {
    group: new Array(n).fill(0),
    pos: new Array(n).fill(0),
    weight: new Array(n).fill(0),
    via: new Array(n).fill(-1),
    viaPeak: new Array(n).fill(null).map(() => ({ ncc: 0, ratio: 0 })),
    support: new Array(n).fill(0),
    why: new Array(n).fill(""),
    used: new Map(),
    blocked: new Array(n).fill(false),
  };
  for (const [i, w] of banned) P.why[i] = w;
  const inc: number[][] = nodes.map(() => []);
  edges.forEach((e, k) => {
    if (!e.peaks.length || banned.has(e.a) || banned.has(e.b)) return;
    inc[e.a].push(k);
    inc[e.b].push(k);
  });
  // tek eşleşmeyle yerleşme yalnız geniş aralıkta aranmış (rakip tekrarlar sınanmış) ya da saatle daraltılmış kenarla
  const wide = (k: number) => edges[k].hinted || edges[k].span >= o.wideSec;
  const strength = (i: number) => inc[i].reduce((s, k) => s + edges[k].peaks[0].peak, 0);
  // kısıt: i'yi p'ye koymak aynı gruptaki yerleşmişlerle çelişiyor mu
  const violates = (i: number, p: number, g: number): string | null => {
    const fi = nodes[i].f;
    if (!fi.certain) return null;
    for (let j = 0; j < n; j++) {
      if (j === i || P.group[j] !== g) continue;
      const fj = nodes[j].f;
      if (fj.device !== fi.device || !fj.certain) continue;
      if (fj.recording === fi.recording) {
        // aynı kaydın kanalları aynı anda başlar
        if (Math.abs(p - P.pos[j]) > o.tolSec) return `aynı kaydın kanalı ${fj.name} ile başlangıç farklı (${((p - P.pos[j]) * 1000).toFixed(1)} ms)`;
        continue;
      }
      const ov = Math.min(p + nodes[i].dur, P.pos[j] + nodes[j].dur) - Math.max(p, P.pos[j]);
      if (ov >= o.frameSec) return `aynı cihazın ${fj.name} kaydıyla üst üste (${ov.toFixed(3)} sn)`;
      if (fi.order && fj.order) {
        const c = cmpOrder(fi.order, fj.order);
        if ((c < 0 && p > P.pos[j]) || (c > 0 && p < P.pos[j])) return `dosya sırası ${fj.name} ile ters`;
      }
    }
    return null;
  };
  let g = 0;
  for (;;) {
    // yeni grubun kökü: en güçlü bağlı, yerleşmemiş dosya
    let root = -1;
    for (let i = 0; i < n; i++) if (P.group[i] === 0 && !P.blocked[i] && inc[i].length && (root < 0 || strength(i) > strength(root))) root = i;
    if (root < 0) break;
    g++;
    P.group[root] = g;
    P.pos[root] = 0;
    P.weight[root] = strength(root);
    P.why[root] = "grubun dayanağı (en çok eşleşen dosya)";
    for (;;) {
      let bestI = -1;
      let bestPos = 0;
      let bestW = 0;
      let bestVia = -1;
      let bestPk = { ncc: 0, ratio: 0 };
      let bestSup = 0;
      let bestUsed: [number, number][] = [];
      const why = new Map<number, string>();
      for (let i = 0; i < n; i++) {
        if (P.group[i] !== 0 || P.blocked[i] || banned.has(i)) continue;
        // tahminler: yerleşmiş komşulardan, bütün güvenli tepeler
        const est: { p: number; w: number; k: number; q: number }[] = [];
        for (const k of inc[i]) {
          const e = edges[k];
          const j = e.a === i ? e.b : e.a;
          if (P.group[j] !== g) continue;
          e.peaks.forEach((pk, q) => est.push({ p: estimate(e, q, i, P.pos[j]), w: pk.peak * (q === 0 ? 1 : 0.999), k, q }));
        }
        if (!est.length) continue;
        // ±tol kümeleri (açgözlü: ağırlığa göre)
        est.sort((x, y) => y.w - x.w);
        const clusters: { p: number; w: number; m: typeof est }[] = [];
        for (const x of est) {
          const c = clusters.find((cl) => Math.abs(cl.p - x.p) <= o.tolSec);
          if (c) {
            c.m.push(x);
            c.w += x.w;
          } else clusters.push({ p: x.p, w: x.w, m: [x] });
        }
        // aynı kenarın iki tepesi aynı kümeyi iki kez saymasın
        for (const c of clusters) {
          const seen = new Set<number>();
          c.m = c.m.filter((x) => (seen.has(x.k) ? false : (seen.add(x.k), true)));
          c.w = c.m.reduce((s, x) => s + x.w, 0);
          // konum: kümedeki tahminlerin ağırlıklı ortalaması
          c.p = c.m.reduce((s, x) => s + x.p * x.w, 0) / c.w;
        }
        clusters.sort((x, y) => y.w - x.w);
        // en ağır, kısıtı bozmayan küme; kısıtı bozmayan başka bir küme onun yarısından ağırsa → çelişkili (tahmin yok)
        let chosen: (typeof clusters)[number] | null = null;
        let reason = "";
        const okc = clusters.filter((c) => {
          const v = violates(i, c.p, g);
          if (v && !reason) reason = `eşleşme kısıtı bozuyor: ${v}`;
          return !v;
        });
        if (okc.length && !(okc.length > 1 && okc[1].w >= 0.5 * okc[0].w)) chosen = okc[0];
        else if (okc.length) reason = "çelişen eşleşmeler (iki konum da güçlü)";
        // kanıt: en az bir GENİŞ aralıklı eşleşme ya da iki bağımsız eşleşme (tekrarlayan içerik — inceleme #15 B2)
        if (chosen && !chosen.m.some((x) => wide(x.k)) && chosen.m.length < 2) {
          reason = "tek ve dar aralıklı eşleşme (kısa klipler; tekrarlayan içerik olabilir) — ikinci bağımsız eşleşme yok";
          chosen = null;
        }
        if (!chosen) {
          why.set(i, reason || "uygun konum yok");
          continue;
        }
        if (chosen.w > bestW) {
          bestI = i;
          bestPos = chosen.p;
          bestW = chosen.w;
          const top = chosen.m[0];
          const e = edges[top.k];
          bestVia = e.a === i ? e.b : e.a;
          bestPk = { ncc: e.peaks[top.q].peak, ratio: e.peaks[top.q].ratio };
          bestSup = chosen.m.length;
          bestUsed = chosen.m.map((x) => [x.k, x.q]);
        }
      }
      if (bestI < 0) {
        for (const [i, w] of why) if (P.group[i] === 0 && !P.why[i]) P.why[i] = w;
        // bu grupla güvenli eşleşmesi olup yerleşemeyenler başka grup kuramaz / başka gruba giremez (inceleme #15 B3)
        for (let i = 0; i < n; i++)
          if (P.group[i] === 0 && !P.blocked[i] && inc[i].some((k) => P.group[edges[k].a === i ? edges[k].b : edges[k].a] === g)) {
            P.blocked[i] = true;
            if (!P.why[i]) P.why[i] = "grubun dosyalarıyla eşleşmesi var ama tutarlı bir konum yok";
          }
        break;
      }
      P.group[bestI] = g;
      P.pos[bestI] = bestPos;
      P.weight[bestI] = bestW;
      P.via[bestI] = bestVia;
      P.viaPeak[bestI] = bestPk;
      P.support[bestI] = bestSup;
      P.why[bestI] = "";
      for (const [k, q] of bestUsed) P.used.set(k, q);
    }
  }
  // grubu kökü sıfır olmayacak biçimde kaydır: en erken başlayan 0
  for (let gg = 1; gg <= g; gg++) {
    let min = Infinity;
    for (let i = 0; i < n; i++) if (P.group[i] === gg) min = Math.min(min, P.pos[i]);
    for (let i = 0; i < n; i++) if (P.group[i] === gg) P.pos[i] -= min;
  }
  // tek başına kalan kökler (hiç komşusu yerleşmemiş grup) → grup değil
  for (let gg = 1; gg <= g; gg++) {
    const mem = nodes.map((_, i) => i).filter((i) => P.group[i] === gg);
    if (mem.length === 1) {
      const i = mem[0];
      P.group[i] = 0;
      // kökün kendi gerekçesi yok; komşularının (engellenen / yetersiz kanıt) gerekçesi varsa o
      const nb = inc[i].map((k) => (edges[k].a === i ? edges[k].b : edges[k].a)).find((j) => P.why[j] && !/dayanağı/.test(P.why[j]));
      P.why[i] = nb !== undefined ? `eşleştiği "${nodes[nb].f.name}" yerleşemedi (${P.why[nb]})` : "hiçbir eşleşmesi yerleşemedi";
    }
  }
  return P;
}

/** Dosya başının (zaman sıfırı) grup koordinatındaki yeri. */
const mpos = (nodes: Node[], P: Placement, i: number) => P.pos[i] - lead(nodes[i]);

function deviceOffsets(nodes: Node[], P: Placement): Map<string, { offset: number; group: number; n: number; spread: number }> {
  const by = new Map<string, { g: number; v: number }[]>();
  nodes.forEach((x, i) => {
    if (P.group[i] === 0 || x.f.clock === null) return;
    by.set(x.f.device, [...(by.get(x.f.device) ?? []), { g: P.group[i], v: mpos(nodes, P, i) - x.f.clock }]);
  });
  const out = new Map<string, { offset: number; group: number; n: number; spread: number }>();
  for (const [d, list] of by) {
    // en kalabalık gruptaki tahminler (gruplar arası konum ortak değil)
    const cnt = new Map<number, number>();
    for (const x of list) cnt.set(x.g, (cnt.get(x.g) ?? 0) + 1);
    const g = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const v = list.filter((x) => x.g === g).map((x) => x.v);
    const m = median(v);
    out.set(d, { offset: m, group: g, n: v.length, spread: median(v.map((x) => Math.abs(x - m))) });
  }
  return out;
}

/**
 * Saat ipucuyla çelişen yerleşimler (inceleme #15 B4): kimliği KESİN cihazın (tek saat) aynı gruptaki ≥ 3 saatli dosyası aynı kaymada
 * tutarlıysa (medyan mutlak sapma ≤ 2 sn), saatine > clockTolSec uymayan dosya — aynı içerik başka zamanda da çalmış olabilir.
 */
function clockConflicts(nodes: Node[], P: Placement, o: SenkronOpts): [number, string][] {
  const out: [number, string][] = [];
  const by = new Map<string, number[]>();
  nodes.forEach((x, i) => {
    if (P.group[i] === 0 || x.f.clock === null || !x.f.certain) return;
    const k = `${P.group[i]}\u0000${x.f.device}`;
    by.set(k, [...(by.get(k) ?? []), i]);
  });
  for (const list of by.values()) {
    if (list.length < 3) continue;
    const v = list.map((i) => mpos(nodes, P, i) - nodes[i].f.clock!);
    const m = median(v);
    if (median(v.map((x) => Math.abs(x - m))) > 2) continue;
    list.forEach((i, k) => {
      if (Math.abs(v[k] - m) > o.clockTolSec)
        out.push([i, `saat ipucuyla ${(v[k] - m).toFixed(1)} sn çelişiyor (aynı cihazın ${list.length - 1} dosyası saatine uyuyor; aynı ses başka zamanda da çalmış olabilir)`]);
    });
  }
  return out;
}

function report(nodes: Node[], edges: Edge[], P: Placement, o: SenkronOpts, notes: string[]): SenkronResult {
  const G = Math.max(0, ...P.group);
  // raporlanan konum: dosya başı (zaman sıfırı; ses akışının başlangıç kayması düşülmüş), grubun en erken dosya başı 0
  const shift = new Map<number, number>();
  for (let g = 1; g <= G; g++) {
    let m = Infinity;
    nodes.forEach((_, i) => P.group[i] === g && (m = Math.min(m, mpos(nodes, P, i))));
    if (m !== Infinity) shift.set(g, m);
  }
  const rpos = (i: number) => mpos(nodes, P, i) - (shift.get(P.group[i]) ?? 0);
  const offs = deviceOffsets(nodes, P);
  const groups: Group[] = [];
  for (let g = 1; g <= G; g++) {
    const mem = nodes.map((_, i) => i).filter((i) => P.group[i] === g);
    if (!mem.length) continue;
    groups.push({
      n: groups.length + 1,
      ids: mem.map((i) => nodes[i].f.id),
      start: Math.min(...mem.map((i) => rpos(i))),
      end: Math.max(...mem.map((i) => rpos(i) + nodes[i].dur)),
      clockFrom1: null,
    });
  }
  // grup numaralarını yeniden sırala (boş grup atlandıysa)
  const renum = new Map<number, number>();
  {
    let k = 0;
    for (let g = 1; g <= G; g++) if (nodes.some((_, i) => P.group[i] === g)) renum.set(g, ++k);
  }
  // gruplar arası saat: aynı cihazın iki grupta saatli dosyası varsa, gruplar arası fark = (saat − konum) farkı
  if (groups.length > 1) {
    const anchor = new Map<number, Map<string, number>>(); // grup → cihaz → (saat − konum) medyanı
    for (let g = 1; g <= G; g++) {
      const m = new Map<string, number[]>();
      nodes.forEach((x, i) => {
        if (P.group[i] === g && x.f.clock !== null) m.set(x.f.device, [...(m.get(x.f.device) ?? []), x.f.clock - rpos(i)]);
      });
      const mm = new Map<string, number>();
      for (const [d, v] of m) mm.set(d, median(v));
      anchor.set(renum.get(g) ?? 0, mm);
    }
    const a1 = anchor.get(1)!;
    for (const gr of groups) {
      if (gr.n === 1) {
        gr.clockFrom1 = 0;
        continue;
      }
      const ag = anchor.get(gr.n)!;
      const diffs: number[] = [];
      for (const [d, v] of ag) if (a1.has(d)) diffs.push(v - a1.get(d)!);
      gr.clockFrom1 = diffs.length ? median(diffs) : null;
    }
  }
  const placed: Placed[] = nodes.map((x, i) => {
    const g = P.group[i];
    const off = offs.get(x.f.device);
    const hintPos = g && off && off.group === g && x.f.clock !== null ? x.f.clock + off.offset - (shift.get(g) ?? 0) : null;
    return {
      id: x.f.id,
      name: x.f.name,
      status: g ? "ok" : "emin değil",
      group: g ? renum.get(g) ?? 0 : 0,
      pos: g ? rpos(i) : null,
      confidence: g ? Math.min(1, P.weight[i]) : 0,
      via: P.via[i] >= 0 ? nodes[P.via[i]].f.name : null,
      viaPeak: P.viaPeak[i].ncc,
      viaRatio: P.viaPeak[i].ratio,
      support: P.support[i],
      hintPos,
      hintDiff: hintPos !== null && g ? rpos(i) - hintPos : null,
      why: g ? P.why[i] : !x.env.usable ? x.env.why : P.why[i] || bestWhy(i, edges) || "eşleşme yok",
    };
  });
  const outEdges = edges.map((e, k) => {
    const q = P.used.get(k);
    const s = e.peaks.length ? e.peaks[q ?? 0].s : null;
    let residualMs: number | null = null;
    if (s !== null && P.group[e.a] && P.group[e.a] === P.group[e.b]) residualMs = (P.pos[e.b] - P.pos[e.a] - s) * 1000;
    return { a: nodes[e.a].f.name, b: nodes[e.b].f.name, s, peak: e.best, ratio: e.bestRatio, used: q !== undefined, residualMs, why: e.why };
  });
  const bad = outEdges.filter((e, k) => e.residualMs !== null && Math.abs(e.residualMs) > o.tolSec * 1000 && edges[k].peaks.length > 0);
  if (bad.length) notes.push(`${bad.length} güvenli eşleşme sonuçla ±${(o.tolSec * 1000).toFixed(0)} ms'den fazla ayrışıyor (kullanılmadı; rapor listesinde)`);
  return {
    placed,
    groups,
    edges: outEdges,
    deviceClock: [...offs.entries()].map(([device, v]) => ({ device, offset: v.offset, n: v.n, spread: v.spread })),
    notes,
  };
}

function bestWhy(i: number, edges: Edge[]): string {
  const mine = edges.filter((e) => e.a === i || e.b === i);
  if (!mine.length) return "eşleştirilecek dosya yok (aynı cihaz / sessiz)";
  const top = mine.slice().sort((x, y) => y.best - x.best)[0];
  return `güvenli eşleşme yok (en iyi aday: tepe ${top.best.toFixed(3)}, oran ${top.bestRatio.toFixed(1)}${top.why ? " — " + top.why : ""})`;
}
