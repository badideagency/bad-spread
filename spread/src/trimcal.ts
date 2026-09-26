// KIRPMA KALİBRASYONU — SAF (Premiere çağrısı yok). v0.3.4.
//
// KANITLANMIŞ (gerçek Premiere, v0.3.3 BAĞLA raporu, ilk parça A038C001 kılavuz sesi, 1552.80 sn → baştaki 2.32 sn):
//   End → Start → In → Out TEK transaction'da (addAction 4/4) → okunan out = −393257410560000 tick (−1548.16 s), beklenen
//   589317120000 (2.32 s). −1548.16 = 1552.80 + 2 × (2.32 − 1552.80): createSetEndAction ile createSetOutPointAction AYNI kenarı
//   (kuyruk) değiştiriyor ve tek transaction'da her biri klibin İLK hâlinden hesaplanan FARK olarak uygulanıyor → fark iki kez.
//   (Probe T8 bunu görmedi: değerleri eşitti, fark 0.)
//
// Bu yüzden BAĞLA set action'ların anlamını TAHMİN ETMEZ, ÖLÇER: park alanındaki geçici kopyalar üzerinde her action'ı AYRI
// transaction'da, TEK BAŞINA dener ve (start, end, in, out) üzerindeki etkisini okur. Etki = hedef alanın farkı başına her alanın
// farkı: tam −1, 0 ya da +1 olmalı (değilse — ör. kareye yuvarlama — tutarlı kural yok).
// Kural: kuyruk için TEK action (Out ya da End; etkisi tam (0, 1, 0, 1) olan), baş için TEK action (In ya da Start; etkisi tam
// (1, 0, 1, 0)); ikisi de yoksa baş için In+Start (etkilerinin toplamı (1, 0, 1, 0) ise — kullanıcının izin verdiği tek birleşim).
// Aynı klibin aynı kenarına ASLA iki "aynı etkili" action üretilmez; farkı 0 olan kenara action üretilmez. Bir klibin iki kenarı tek
// transaction'da değişiyorsa sonuç "her action'ın farkı ilk hâlden, etkiler toplanır" varsayımıyla ÖNCEDEN hesaplanır ve hedefle
// birebir aynı değilse transaction kurulmaz.

import { secOf } from "./core";

export type SetAct = "out" | "end" | "in" | "start";
export const SET_ACTS: SetAct[] = ["out", "end", "in", "start"];

/** Kırpmada değişen dört alan (tick). */
export interface Edges {
  start: bigint;
  end: bigint;
  inPt: bigint;
  outPt: bigint;
}

/** Bir action'ın birim etkisi: hedef alanın farkı d iken (start, end, in, out) farkı = d × vec. */
export type Vec = [number, number, number, number];

export const FIELD: Record<SetAct, keyof Edges> = { out: "outPt", end: "end", in: "inPt", start: "start" };
export const ACT_NAME: Record<SetAct, string> = { out: "SetOutPoint", end: "SetEnd", in: "SetInPoint", start: "SetStart" };
const ORDER: (keyof Edges)[] = ["start", "end", "inPt", "outPt"];
const TAIL: Vec = [0, 1, 0, 1];
const HEAD: Vec = [1, 0, 1, 0];

export interface TrimRule {
  tail: SetAct;
  head: SetAct[];
}

/** Kalibrasyonun ölçtüğü etkiler + seçilen kural (sequence başına saklanır). */
export interface TrimCal {
  v: 1;
  guid: string;
  /** Premiere sürümü (uxp host.version); değişirse yeniden ölçülür */
  host: string;
  at: string;
  /** deneme farkı (tick) */
  delta: string;
  vec: Record<SetAct, Vec>;
  rule: TrimRule;
}

const sameVec = (a: Vec, b: Vec) => a.every((x, i) => x === b[i]);
const addVec = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];

/**
 * Tek action'ın ölçülen etkisi. d = hedef alanın istenen farkı (≠ 0). Her alanın farkı d'nin tam −1 / 0 / +1 katı değilse null.
 */
export function measureVec(before: Edges, after: Edges, d: bigint): Vec | null {
  if (d === 0n) return null;
  const out: number[] = [];
  for (const f of ORDER) {
    const x = after[f] - before[f];
    if (x === 0n) out.push(0);
    else if (x === d) out.push(1);
    else if (x === -d) out.push(-1);
    else return null;
  }
  return out as Vec;
}

export const fmtVec = (v: Vec | null): string => (v ? `(Δstart, Δend, Δin, Δout) = (${v.map((x) => (x > 0 ? `+${x}` : String(x))).join(", ")}) × fark` : "tam kat DEĞİL");

/** Ölçülen etkilerden kural; yoksa null + neden. */
export function chooseRule(vec: Partial<Record<SetAct, Vec | null>>): { rule: TrimRule | null; why: string[] } {
  const why: string[] = [];
  const has = (a: SetAct) => vec[a] ?? null;
  let tail: SetAct | null = null;
  for (const a of ["out", "end"] as SetAct[]) if (!tail && has(a) && sameVec(has(a)!, TAIL)) tail = a;
  if (!tail) why.push(`kuyruk: ne SetOutPoint ne SetEnd tek başına kuyruğu kırpıyor (beklenen etki (0, +1, 0, +1); Out ${fmtVec(has("out"))}, End ${fmtVec(has("end"))})`);
  let head: SetAct[] | null = null;
  for (const cand of [["in"], ["start"], ["in", "start"]] as SetAct[][]) {
    if (head) break;
    const vs = cand.map(has);
    if (vs.some((v) => !v)) continue;
    const sum = (vs as Vec[]).reduce(addVec, [0, 0, 0, 0] as Vec);
    if (sameVec(sum, HEAD)) head = cand;
  }
  if (!head) why.push(`baş: ne SetInPoint ne SetStart ne In+Start başı kırpıyor (beklenen etki (+1, 0, +1, 0); In ${fmtVec(has("in"))}, Start ${fmtVec(has("start"))})`);
  return { rule: tail && head ? { tail, head } : null, why };
}

export const fmtRule = (r: TrimRule): string => `kuyruk = ${ACT_NAME[r.tail]}, baş = ${r.head.map((a) => ACT_NAME[a]).join(" + ")}`;

export interface TrimStep {
  act: SetAct;
  value: bigint;
}

/**
 * Bir klibin f0 → target kırpması için action'lar ve "her action'ın farkı ilk hâlden, etkiler toplanır" varsayımıyla ÖNCEDEN
 * hesaplanan sonuç. problem ≠ null → bu klip bu kuralla kırpılamaz (transaction kurulmaz).
 */
export function planTrim(f0: Edges, target: Edges, rule: TrimRule, vec: Record<SetAct, Vec>): { steps: TrimStep[]; result: Edges; problem: string | null } {
  const h = target.start - f0.start;
  const t = target.end - f0.end;
  const steps: TrimStep[] = [];
  if (target.inPt - f0.inPt !== h) return { steps, result: f0, problem: `baş farkı start'ta ${h}, in'de ${target.inPt - f0.inPt} tick (eşit olmalı)` };
  if (target.outPt - f0.outPt !== t) return { steps, result: f0, problem: `kuyruk farkı end'de ${t}, out'ta ${target.outPt - f0.outPt} tick (eşit olmalı)` };
  if (h !== 0n) for (const a of rule.head) steps.push({ act: a, value: target[FIELD[a]] });
  if (t !== 0n) steps.push({ act: rule.tail, value: target[FIELD[rule.tail]] });
  const r: Edges = { ...f0 };
  for (const s of steps) {
    const d = s.value - f0[FIELD[s.act]]; // fark İLK hâlden
    ORDER.forEach((f, i) => (r[f] += BigInt(vec[s.act][i]) * d));
  }
  const bad = ORDER.filter((f) => r[f] !== target[f]);
  return {
    steps,
    result: r,
    problem: bad.length ? `toplam etki hedefi vermiyor: ${bad.map((f) => `${f} ${r[f]} ≠ ${target[f]}`).join(", ")}` : null,
  };
}

/** Denemede hedef alan içeri doğru değişir: kuyruk (out/end) −δ, baş (in/start) +δ. */
export const inward = (a: SetAct): bigint => (a === "out" || a === "end" ? -1n : 1n);

/** Deneme farkı: kopyanın ¼'ünü ve 1 sn'yi aşmaz; bilerek kare sınırına DÜŞMEZ (gerçek parçalar kare arasında kesilebilir). */
export function calDelta(len: bigint, tps: bigint): bigint | null {
  const base = len / 4n < tps ? len / 4n : tps;
  const d = base - 12345n;
  return d > 0n ? d : null;
}

/** Günlük / handoff satırı. */
export function describeCal(c: TrimCal): string[] {
  return [
    ...SET_ACTS.map((a) => `${ACT_NAME[a]} tek başına (${FIELD[a]} ${inward(a) < 0n ? "−" : "+"}${secOf(BigInt(c.delta))} sn): ${fmtVec(c.vec[a])}`),
    `seçilen kural: ${fmtRule(c.rule)}`,
  ];
}
