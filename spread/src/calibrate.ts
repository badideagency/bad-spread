// KIRPMA KALİBRASYONU — çalıştırıcı (v0.3.4). Saf kısım ve kanıtlanmış bulgu: trimcal.ts.
// BAĞLA'nın bir sequence'taki ilk kesiminden ÖNCE (yedekten sonra, TX-1'den önce) bir kez; sonuç sequence başına saklanır (settings.ts).
//   C-1 "kalibrasyon kopyaları": kesilecek ilk sesin 4 tam boy kopyası, aynı track'te, sequence sonunun ötesindeki park alanına
//       (clone + zaman ofseti — TOPLA / BAĞLA'da kanıtlı yöntem); her kopyanın iki yanında ≥ ses boyu boşluk
//   C-2…C-5: her kopyada TEK action, AYRI transaction: SetOutPoint, SetEnd, SetInPoint, SetStart — hedef alan δ kadar içeri
//       (δ < 1 sn, kare sınırına düşmez). Her birinden sonra: yalnız o kopya değişmiş mi, (start, end, in, out) etkisi ne
//   C-6 "kalibrasyon kopyalarını sil": kopyalar silinir (ripple=false) → düzen kalibrasyon öncesiyle BİREBİR aynı mı
// Beklenmeyen bir şey olursa (kopya kayboldu, başka klip değişti) DUR — kendi başına düzeltme yok, Ctrl+Z sayısı söylenir.

import { selectExactly } from "./edit";
import { ceilTo, expectState, frameTicks, multisetEqual, parkBase, runTx, SpreadStop } from "./guard";
import { compareLayout, expKey, expOf, findExp, type Exp } from "./layout";
import { big, fmtClip, relocate, secOf, settle, snapshot, ticks, trackLabel, TICKS_PER_SECOND, type ClipInfo, type Snapshot } from "./model";
import type { SeqContext } from "./session";
import { ACT_NAME, calDelta, chooseRule, FIELD, fmtVec, inward, measureVec, SET_ACTS, type Edges, type SetAct, type TrimCal, type Vec } from "./trimcal";
import type { TxOps } from "./edit";
import { log } from "./ui";

export const edgesOf = (c: ClipInfo): Edges => ({ start: big(c.start), end: big(c.end), inPt: big(c.inPt), outPt: big(c.outPt) });

/** Premiere sürümü (kalibrasyon kaydının anahtarı); okunamazsa "?". */
export function hostVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const uxp = require("uxp") as { host?: { version?: unknown } };
    const v = uxp.host?.version; // uxp.d.ts:L9558 Host.version
    return v === undefined || v === null ? "?" : String(v);
  } catch {
    return "?";
  }
}

/** Tek set action'ı TxOps'a çevirir. */
export function applySet(ops: TxOps, c: ClipInfo, a: SetAct, value: bigint): void {
  const t = ticks(value);
  if (a === "out") ops.setOut(c, t);
  else if (a === "end") ops.setEnd(c, t);
  else if (a === "in") ops.setIn(c, t);
  else ops.setStart(c, t);
}

export interface CalOutcome {
  /** tutarlı kural bulunduysa kaydedilecek kalibrasyon; bulunmadıysa null */
  cal: TrimCal | null;
  vec: Partial<Record<SetAct, Vec | null>>;
  /** ölçüm satırları (günlük / rapor) */
  lines: string[];
  /** kural yoksa nedenleri */
  why: string[];
  /** kalibrasyondan sonra okunan düzen (öncekiyle birebir aynı) */
  after: Snapshot;
}

/**
 * @param s1 kalibrasyon öncesi düzen (yeni okunmuş; referansları taze)
 * @param src kopyalanacak klip (kesilecek ilk ses) — s1'de yeniden bulunur
 */
export async function calibrateTrim(ctx: SeqContext, executed: string[], s1: Snapshot, src0: ClipInfo, guid: string, host: string): Promise<CalOutcome> {
  const src = relocate(s1, src0);
  if (!src) throw new SpreadStop(`kalibrasyon için kopyalanacak ses bulunamadı: ${fmtClip(src0)}`);
  const L = big(src.end) - big(src.start);
  const d = calDelta(L, TICKS_PER_SECOND);
  if (d === null) throw new SpreadStop(`kalibrasyon için ses çok kısa (${secOf(L)} sn): ${fmtClip(src)}`);
  const P = await parkBase(ctx, s1);
  const frame = await frameTicks(ctx);
  const qs: bigint[] = [];
  let cursor = P;
  for (let k = 0; k < SET_ACTS.length; k++) {
    const q = ceilTo(cursor + L, frame);
    qs.push(q);
    cursor = q + 2n * L + TICKS_PER_SECOND;
  }
  const copyExp = (k: number): Exp => expOf(src, { start: qs[k], end: qs[k] + L });
  log(
    `KALİBRASYON (bu sequence'ta ilk kez): set action'ların etkisi ölçülecek — ${trackLabel("A", src.track)} "${src.name}" ` +
      `${SET_ACTS.length} kopya (${secOf(P)} sn sonrası park alanı), her action AYRI transaction'da tek başına, δ = ${secOf(d)} sn.`,
    "head"
  );

  // C-1 kopyalar
  await runTx(ctx, executed, "kalibrasyon kopyaları", "BAĞLA: kalibrasyon kopyaları", (ops) => {
    for (const q of qs) ops.clone(src, ticks(q - big(src.start)), 0, 0);
  });
  await settle();
  let s = await snapshot(ctx);
  const baseExp = s1.clips.map((c) => expOf(c));
  const p1 = compareLayout([...baseExp, ...qs.map((_, k) => copyExp(k))], s);
  if (p1.length) throw new SpreadStop("Kalibrasyon kopyaları beklendiği gibi oluşmadı.", p1);

  // C-2…C-5 her action tek başına, ayrı transaction
  const vec: Partial<Record<SetAct, Vec | null>> = {};
  const lines: string[] = [];
  const now: Exp[] = qs.map((_, k) => copyExp(k)); // kopyaların güncel beklenen hâli
  let prev = s1;
  for (let k = 0; k < SET_ACTS.length; k++) {
    const a = SET_ACTS[k];
    await expectState(ctx, s, prev, executed);
    const c = findExp(s, now[k]);
    if (!c) throw new SpreadStop(`kalibrasyon kopyası bulunamadı (${ACT_NAME[a]} öncesi): ${trackLabel("A", src.track)} "${src.name}" ${secOf(qs[k])} sn`);
    const f0 = edgesOf(c);
    const dd = inward(a) * d;
    const value = f0[FIELD[a]] + dd;
    prev = s;
    await runTx(ctx, executed, `kalibrasyon ${ACT_NAME[a]}`, `BAĞLA: kalibrasyon ${ACT_NAME[a]}`, (ops) => applySet(ops, c, a, value));
    await settle();
    s = await snapshot(ctx);
    // yalnız bu kopya değişmiş olmalı: öteki her klip birebir yerinde, bu kopyanın yerinde TEK yeni klip (aynı kaynak, aynı track)
    const others = [...baseExp, ...now.filter((_, j) => j !== k)];
    const rest = s.clips.slice();
    const missing: string[] = [];
    for (const e of others) {
      const i = rest.findIndex((x) => expKey(expOf(x)) === expKey(e));
      if (i < 0) missing.push(`${trackLabel(e.kind, e.track)} "${e.label}" [${secOf(e.start)}s–${secOf(e.end)}s]`);
      else rest.splice(i, 1);
    }
    const changed = rest.filter((x) => x.kind === src.kind && x.projId === src.projId && x.track === src.track);
    if (missing.length || rest.length !== 1 || changed.length !== 1 || s.vCount !== s1.vCount || s.aCount !== s1.aCount)
      throw new SpreadStop(`Kalibrasyonda ${ACT_NAME[a]} beklenmeyen bir değişiklik yaptı (yalnız kendi kopyası değişmeliydi).`, [
        ...missing.map((m) => `yerinde değil: ${m}`),
        ...rest.map((x) => `değişen / yeni klip: ${fmtClip(x)}`),
      ]);
    const f1 = edgesOf(changed[0]);
    const v = measureVec(f0, f1, dd);
    vec[a] = v;
    now[k] = expOf(changed[0]);
    const diff = (["start", "end", "inPt", "outPt"] as const).map((f) => `${f} ${f1[f] - f0[f] >= 0n ? "+" : ""}${f1[f] - f0[f]}`).join(", ");
    lines.push(`${ACT_NAME[a]} tek başına (${FIELD[a]} ${dd >= 0n ? "+" : ""}${dd} tick): okunan fark ${diff} → ${fmtVec(v)}`);
    log(`   ${lines[lines.length - 1]}`, "dim");
  }

  // C-6 kopyaları sil
  await expectState(ctx, s, prev, executed);
  const copies = now.map((e) => findExp(s, e));
  if (copies.some((c) => !c)) throw new SpreadStop("kalibrasyon kopyaları silinmeden önce yeniden bulunamadı.");
  const so = await selectExactly(ctx, copies as ClipInfo[]);
  for (const n of so.notes) log(`   ${n}`, "dim");
  if (!so.exact) throw new SpreadStop("Kalibrasyon kopyaları birebir seçilemedi — güvenlik için silinmedi.");
  await runTx(ctx, executed, "kalibrasyon kopyalarını sil", "BAĞLA: kalibrasyon kopyalarını sil", (ops) => {
    ops.remove(so.sel);
  });
  await settle();
  const after = await snapshot(ctx);
  if (!multisetEqual(s1, after) || after.vCount !== s1.vCount || after.aCount !== s1.aCount)
    throw new SpreadStop("Kalibrasyon kopyaları silindikten sonra düzen kalibrasyon öncesiyle aynı değil.", compareLayout(baseExp, after));
  log(`✓ Kalibrasyon kopyaları silindi; düzen kalibrasyon öncesiyle birebir aynı (${SET_ACTS.length + 2} adım geri alma geçmişinde).`, "ok");

  const { rule, why } = chooseRule(vec);
  const cal: TrimCal | null = rule
    ? { v: 1, guid, host, at: new Date().toISOString(), delta: String(d), vec: vec as Record<SetAct, Vec>, rule }
    : null;
  return { cal, vec, lines, why, after };
}
