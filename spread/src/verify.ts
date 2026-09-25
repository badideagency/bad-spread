// Doğrulama — SAF fonksiyonlar (Premiere çağrısı yok). Her transaction'dan sonra çağrılır; bir şey tutmazsa Spread DURUR.
// Kontroller (TX-B/TX-C sonrası):
//   1) klip sayısı aslıyla aynı
//   2) her klibin start/end/in/out (+speed) aslıyla tick düzeyinde aynı
//   3) her track'te ≤ 1 klip
//   4) kamera birimlerinde video ve ses(ler) aynı start/end'de
//   5) her klip planladığı track'te ve doğru kaynaktan
// Tek istisna — "kırpma eşitlemesi" adayı (TX-C): kırpılmış bir kamera aslı, overwrite ile BEKLENEN biçimde kırpılmamış
// yerleşmişse: doğru track + doğru kaynak + start AYNI + in=0 + out=medya süresi (biliniyorsa) + hız aynı.
// Başka her fark (ör. kaymış start, yanlış uzunluk) → DUR (kendi başına düzeltme yok).

import { keyFull, secOf, trackLabel, type ClipInfo, type Kind, type Snapshot } from "./model";
import type { Plan } from "./plan";

export interface TrimFix {
  orig: ClipInfo;
  now: ClipInfo;
}

export interface VerifyResult {
  ok: boolean;
  problems: string[];
  trimFix: TrimFix[];
}

const TIME_FIELDS: (keyof ClipInfo)[] = ["start", "end", "inPt", "outPt", "speed"];

function diffTimes(a: ClipInfo, b: ClipInfo): string[] {
  const out: string[] = [];
  for (const f of TIME_FIELDS) {
    if (a[f] !== b[f]) {
      const extra = f === "speed" ? "" : ` (fark ${(() => {
        try {
          return (BigInt(String(b[f])) - BigInt(String(a[f]))).toString();
        } catch {
          return "?";
        }
      })()} tick)`;
      out.push(`${f}: asıl=${String(a[f])} şimdi=${String(b[f])}${extra}`);
    }
  }
  return out;
}

const trackKey = (k: Kind, t: number) => `${k}|${t}`;

/**
 * @param allowTrimFix true → yalnız kamera kırpma farklarını trimFix listesine koy (TX-B sonrası); false → her fark sorun (TX-C sonrası)
 */
export function verifySpread(plan: Plan, fin: Snapshot, allowTrimFix: boolean): VerifyResult {
  const problems: string[] = [];
  const trimFix: TrimFix[] = [];

  // 3) her track'te ≤ 1 klip
  const byTrack = new Map<string, ClipInfo[]>();
  for (const c of fin.clips) {
    const k = trackKey(c.kind, c.track);
    byTrack.set(k, [...(byTrack.get(k) ?? []), c]);
  }
  for (const [k, list] of byTrack)
    if (list.length > 1) {
      const [kind, t] = k.split("|");
      problems.push(`${trackLabel(kind as Kind, Number(t))} track'inde ${list.length} klip var (en fazla 1 olmalı): ${list.map((c) => `"${c.name}"`).join(", ")}`);
    }

  // 1) klip sayısı
  if (fin.clips.length !== plan.placements.length)
    problems.push(`klip sayısı değişti: önce ${plan.placements.length}, şimdi ${fin.clips.length}`);

  // 5) + 2) her asıl, hedef track'inde ve zamanları aynı
  const matched = new Set<ClipInfo>();
  for (const p of plan.placements) {
    const here = byTrack.get(trackKey(p.clip.kind, p.target)) ?? [];
    const now = here.find((c) => c.projId === p.clip.projId) ?? null;
    if (!now) {
      problems.push(`${trackLabel(p.clip.kind, p.target)} hedefinde "${p.clip.name}" yok${here.length ? ` (orada: ${here.map((c) => `"${c.name}"`).join(", ")})` : ""}`);
      continue;
    }
    matched.add(now);
    const d = diffTimes(p.clip, now);
    if (!d.length) continue;
    const fullPlacement =
      now.start === p.clip.start && now.inPt === "0" && (p.clip.mediaDur === null || now.outPt === p.clip.mediaDur) && p.clip.speed === now.speed;
    const origTrimmed = p.clip.inPt !== now.inPt || p.clip.outPt !== now.outPt;
    if (allowTrimFix && p.unit.kind === "camera" && !p.unit.stays && fullPlacement && origTrimmed) trimFix.push({ orig: p.clip, now });
    else problems.push(`"${p.clip.name}" (${trackLabel(p.clip.kind, p.target)}) zamanı aslıyla aynı değil: ${d.join("; ")}`);
  }
  for (const c of fin.clips)
    if (!matched.has(c)) problems.push(`planda olmayan klip: ${trackLabel(c.kind, c.track)} "${c.name}" [${secOf(c.start)}s–${secOf(c.end)}s]`);

  // 4) kamera: video ve ses(ler) aynı start/end
  if (!allowTrimFix || trimFix.length === 0) {
    for (const u of plan.units) {
      if (u.kind !== "camera") continue;
      const v = (byTrack.get(trackKey("V", u.vTarget!)) ?? []).find((c) => c.projId === u.video!.projId);
      if (!v) continue; // yukarıda raporlandı
      u.audio.forEach((_, k) => {
        const a = (byTrack.get(trackKey("A", u.aTarget! + k)) ?? []).find((c) => c.projId === u.video!.projId);
        if (a && (a.start !== v.start || a.end !== v.end))
          problems.push(`kamera "${u.label}": video [${v.start}–${v.end}] ile ses ${trackLabel("A", a.track)} [${a.start}–${a.end}] aynı start/end'de değil`);
      });
    }
  }

  return { ok: problems.length === 0 && trimFix.length === 0, problems, trimFix };
}

/**
 * TX-A (track hazırlığı) sonrası: eski klipler birebir duruyor mu, gereken track'ler açıldı mı, fazladan yalnız yardımcılar mı var.
 */
export function verifyTracks(
  before: Snapshot,
  after: Snapshot,
  neededV: number,
  neededA: number,
  helperCount: { V: number; A: number }
): string[] {
  const problems: string[] = [];
  if (after.vCount < neededV) problems.push(`video track sayısı ${after.vCount}, gereken ${neededV}`);
  if (after.aCount < neededA) problems.push(`ses track sayısı ${after.aCount}, gereken ${neededA}`);
  const pool = new Map<string, number>();
  for (const c of after.clips) pool.set(keyFull(c), (pool.get(keyFull(c)) ?? 0) + 1);
  let intact = 0;
  for (const c of before.clips) {
    const k = keyFull(c);
    const n = pool.get(k) ?? 0;
    if (n > 0) {
      pool.set(k, n - 1);
      intact++;
    } else problems.push(`asıl klip değişti/kayboldu: ${trackLabel(c.kind, c.track)} "${c.name}"`);
  }
  const extra = after.clips.length - intact;
  const wantExtra = helperCount.V + helperCount.A;
  if (extra !== wantExtra) problems.push(`beklenen ${wantExtra} geçici yardımcı klip, bulunan fazladan klip ${extra}`);
  for (let t = before.vCount; t < neededV; t++)
    if (after.clips.filter((c) => c.kind === "V" && c.track === t).length !== 1) problems.push(`yeni ${trackLabel("V", t)} track'inde tam 1 yardımcı yok`);
  for (let t = before.aCount; t < neededA; t++)
    if (after.clips.filter((c) => c.kind === "A" && c.track === t).length !== 1) problems.push(`yeni ${trackLabel("A", t)} track'inde tam 1 yardımcı yok`);
  return problems;
}
