// TOPLA — senkrondan SONRA: oturumları (sessions.ts) bulur, kronolojik sırayla sequence başından dizer (YATAY: blok başına tek
// ofset, blok içi tick-exact) ve klipleri cihaz / kaynak track'lerine koyar (DİKEY). Sahipsizler park track'lerine (zaman aynı).
// Güvenlik: guard.ts (onay → yedek → her transaction sonrası tick düzeyinde doğrulama → tutmazsa DUR + Ctrl+Z + yedek adı).
//
// Transaction'lar: [yedek] → [TX-A track hazırlığı] → TX-1 ilk oturum park (ÖLÇÜM) → TX-2 kalan park → TX-3 ilk oturum yerleştir
// (ÖLÇÜM) → TX-4 kalan yerleştir. Sıfırdan farklı timeOffset'li clone gerçek Premiere'de tick düzeyinde ölçülmedi → ilk oturum
// tek başına taşınır; tutmazsa "İLK TAŞIMA TUTMADI".

import { selectExactly } from "./edit";
import { classify, sourcesOf, where } from "./classify";
import {
  collectedShape,
  describeFrame,
  expectCollect,
  makeCollectPlan,
  makeFrame,
  parkedExp,
  verifyRelative,
  type CollectPlan,
  type Placement,
} from "./collect";
import {
  askUser,
  assertNotStopped,
  ceilTo,
  expectState,
  forgetStopped,
  frameTicks,
  makeBackup,
  multisetEqual,
  parkBase,
  PARK_GAP,
  prepareTracks,
  rememberStopped,
  reportStop,
  runTx,
  SpreadStop,
} from "./guard";
import { compareLayout, findExp, snapshotOverlaps } from "./layout";
import { fmtClip, relocate, secOf, settle, snapshot, ticks, trackLabel, TICKS_PER_SECOND, type ClipInfo, type Snapshot } from "./model";
import { analyze, describeLinks, type Analysis, type Recording } from "./sessions";
import { requireActive, type SeqContext } from "./session";
import { getGapSec, getThreshold, mappingFor } from "./settings";
import { log } from "./ui";

export const CHECK_MSG = "Kontrol et, sonra BAĞLA'ya bas.";

export function printAnalysis(a: Analysis): void {
  for (const d of a.duplicates) log(`ÇİFT KOPYA: ${d}`, "err");
  for (const s of a.sessions) log(`  ${s.id} [${secOf(s.start)}s–${secOf(s.end)}s] ${s.label}`, "dim");
  for (const o of a.orphans) log(`  sahipsiz: ${o.label} [${secOf(o.start)}s–${secOf(o.end)}s] (güçlü bağı yok)`, "dim");
  for (const v of a.vetoDecisions) log(`  ${v}`, "warn");
  for (const u of a.unresolved) for (const l of u.lines) log(`  AYRILAMADI: ${l}`, "err");
  if (a.orderIssue) for (const l of a.orderIssue.lines) log(`  SIRA: ${l}`, "err");
  for (const w of a.warnings) log(`uyarı: ${w}`, "warn");
}

function recList(rs: Recording[]): string {
  return rs.map((r) => `${r.label} [${secOf(r.start)}s–${secOf(r.end)}s]`).join(", ");
}

function confirmText(plan: CollectPlan, a: Analysis, newV: number, newA: number): string {
  const L: string[] = [];
  L.push(`TOPLA — ${plan.layouts.length} oturum, sırayla sequence başından (aralarında ${secOf(BigInt(Math.round(getGapSec() * 1000)) * (TICKS_PER_SECOND / 1000n))} sn):`);
  for (const l of plan.layouts)
    L.push(`  ${l.session.id}  ${l.session.label}  → ${secOf(l.newStart)} s'den başlar (kayma ${l.delta >= 0n ? "+" : ""}${secOf(l.delta)} sn)`);
  if (plan.parkedRecs.length) L.push(`Park track'lerine (zamanı değişmeden, silinmez): ${recList(plan.parkedRecs)}`);
  for (const v of a.vetoDecisions) L.push(v);
  L.push(`Track'ler: ${describeFrame(plan.frame)}.`);
  L.push(
    `${plan.moves.length} klip taşınacak (yatay ${plan.horizontalMoves}, dikey ${plan.verticalMoves}); oturum içi konumlar tick düzeyinde korunur. ` +
      `İlk oturum önce TEK BAŞINA taşınıp ölçülür.${newV + newA ? ` ${newV + newA} track açılacak (V ${newV}, A ${newA}).` : ""}`
  );
  L.push("Taşınan kamera videoları kılavuz seslerinden ayrı düşer (BAĞLA yeniden bağlar). Önce yedek sequence oluşturulacak. Devam?");
  return L.join("\n");
}

async function select(ctx: SeqContext, clips: ClipInfo[], what: string) {
  const so = await selectExactly(ctx, clips);
  for (const n of so.notes) log(`   ${n}`, "dim");
  if (!so.exact) throw new SpreadStop(`${what} birebir seçilemedi — güvenlik için taşıma yapılmadı.`);
  return so;
}

export async function runCollect(): Promise<void> {
  const executed: string[] = [];
  let backupName: string | null = null;
  let ctx: SeqContext | null = null;
  log("▶ TOPLA", "head");
  try {
    ctx = await requireActive();
    log(`sequence: "${ctx.name}"`, "dim");
    const s0 = await snapshot(ctx);
    assertNotStopped(ctx, s0, "TOPLA");
    for (const w of s0.warnings) throw new SpreadStop(`Okuma sorunu: ${w}. TOPLA BAŞLAMADI.`);
    const items = classify(s0);
    const frame = makeFrame(items, mappingFor(sourcesOf(items)));
    const shape = collectedShape(frame, items);
    const keep = shape.shaped ? shape.parked : new Set<ClipInfo>();
    const a = analyze(s0, items, { threshold: getThreshold(), exclude: keep });
    log(`Okundu: V ${s0.vCount}, A ${s0.aCount}, ${s0.clips.length} klip; ${a.recordings.length} kayıt, ${a.links.length} güçlü bağ (eşik %${Math.round(getThreshold() * 100)}).`, "dim");
    for (const l of describeLinks(a, 60)) log(`   bağ: ${l}`, "dim");
    printAnalysis(a);
    if (a.duplicates.length)
      throw new SpreadStop(`ÇİFT KOPYA var (aynı kaynak + aynı start/end/in/out) — TOPLA BAŞLAMADI, hiçbir şeye dokunulmadı. Fazla kopyaları sil, sonra tekrar bas.`, a.duplicates);
    const readErr = s0.clips.flatMap((c) => c.readErrors.map((e) => `${where(c)} — ${e}`));
    if (readErr.length) throw new SpreadStop("Bazı klipler okunamadı. TOPLA BAŞLAMADI.", readErr);

    const parkedRecs: Recording[] = [...a.orphans];
    for (const u of a.unresolved) {
      const ans = await askUser(
        `AYRILAMAYAN OTURUM — tek anlamlı çözüm yok, TAHMİN EDİLMEDİ:\n${u.lines.map((l) => "  • " + l).join("\n")}\n` +
          `Bu ${u.recordings.length} kayıt (${recList(u.recordings)}) park track'lerine ZAMANI DEĞİŞMEDEN konup diğer oturumlarla devam edilsin mi?\n` +
          "(Hayır → hiçbir şey değişmez. Premiere'de bu grupları ayrı ayrı senkronlamak da bir çözüm.)"
      );
      if (ans !== "Evet") {
        log("İptal edildi — hiçbir şey değişmedi.", "warn");
        return;
      }
      parkedRecs.push(...u.recordings);
    }
    if (a.orderIssue && a.sessions.length > 1) {
      const ans = await askUser(
        `OTURUM SIRASI cihaz sayaçlarından / kayıt saatlerinden ${a.orderIssue.kind === "conflict" ? "ÇELİŞKİLİ" : "BELİRLENEMEDİ"}:\n` +
          `${a.orderIssue.lines.map((l) => "  • " + l).join("\n")}\n` +
          "Oturumlar senkronun bıraktığı sırayla (timeline'daki başlangıçlarına göre) dizilsin mi? (Hayır → hiçbir şey değişmez)"
      );
      if (ans !== "Evet") {
        log("İptal edildi — hiçbir şey değişmedi.", "warn");
        return;
      }
    }

    const fr = await frameTicks(ctx);
    const gap = ceilTo(BigInt(Math.round(getGapSec() * 1000)) * (TICKS_PER_SECOND / 1000n), fr);
    const plan = makeCollectPlan(s0, items, a, frame, { gap, frameTicks: fr, parkedRecs, keepInPlace: keep });
    if (!fr) log("not: sequence kare süresi okunamadı → ofsetler kareye hizalanmadı.", "warn");
    for (const e of plan.errors) log(`HATA: ${e}`, "err");
    for (const c of plan.conflicts) log(`ÇAKIŞMA: ${c}`, "err");
    if (plan.errors.length) throw new SpreadStop(`Plan kurulamadı (${plan.errors.length} hata). TOPLA BAŞLAMADI, hiçbir şey değişmedi.`);
    if (plan.conflicts.length)
      throw new SpreadStop(`Yeni düzende ${plan.conflicts.length} çakışma var — TOPLA BAŞLAMADI, hiçbir şey değişmedi.`, plan.conflicts);
    if (!plan.moves.length) {
      log("✓ Zaten toplanmış: oturumlar sırayla, klipler cihaz / kaynak track'lerinde. Yapılacak bir şey yok.", "ok");
      log(CHECK_MSG, "head");
      return;
    }
    const newV = Math.max(0, plan.neededV - s0.vCount);
    const newA = Math.max(0, plan.neededA - s0.aCount);
    const ans = await askUser(confirmText(plan, a, newV, newA));
    if (ans !== "Evet") {
      log("İptal edildi — hiçbir şey değişmedi.", "warn");
      return;
    }

    const backup = await makeBackup(ctx, "TOPLA");
    backupName = backup.name;
    const s1 = await snapshot(ctx);
    if (!multisetEqual(s0, s1)) throw new SpreadStop("Yedek alınırken asıl sequence'ın klipleri değişti. Durduruldu.");

    let helpers: ClipInfo[] = [];
    let prev: Snapshot = s1;
    let beforeLast: Snapshot | null = null;
    if (newV || newA) {
      const r = await prepareTracks(ctx, s1, plan.neededV, plan.neededA, executed, "TOPLA: track hazırlığı");
      helpers = r.helpers;
      beforeLast = s1;
      prev = r.after;
    }
    // park yeri: hem bugünkü düzenin hem YENİ düzenin sonunun ötesi (yerleştirme park kopyalarına değmesin), kare hizalı
    const pb = await parkBase(ctx, prev);
    const P = pb > ceilTo(plan.layoutEnd + PARK_GAP, fr) ? pb : ceilTo(plan.layoutEnd + PARK_GAP, fr);
    const measure = plan.firstMoves.length ? plan.firstMoves : plan.moves.slice(0, 1);
    const rest = plan.moves.filter((p) => !measure.includes(p));
    const parked = new Set<Placement>();
    const placed = new Set<Placement>();
    const first = plan.firstSession ? `${plan.firstSession.id} (${plan.firstSession.label})` : "ilk klip";

    const parkStep = async (list: Placement[], label: string, extra: ClipInfo[], isMeasure: boolean) => {
      await expectState(ctx!, prev, beforeLast, executed);
      const so = await select(ctx!, [...list.map((p) => p.x.clip), ...extra], "Taşınacak asıllar");
      const src = list.map((p) => {
        const f = relocate(so.snap, p.x.clip);
        if (!f) throw new SpreadStop(`park öncesi klip yeniden bulunamadı: ${fmtClip(p.x.clip)}`);
        return f;
      });
      log(`${label}: ${src.length} klip aynı track'te ${secOf(P)} sn ileri kopyalanıyor → ${so.readCount} klip siliniyor (ripple=false).`);
      await runTx(ctx!, executed, label, `TOPLA: ${label}`, (ops) => {
        for (const c of src) ops.clone(c, ticks(P), 0, 0);
        ops.remove(so.sel);
      });
      await settle();
      const s = await snapshot(ctx!);
      for (const p of list) parked.add(p);
      const probs = compareLayout(expectCollect(s0, plan, P, parked, placed), s);
      if (probs.length)
        throw new SpreadStop(isMeasure ? `İLK TAŞIMA TUTMADI (park, ${first}): sıfırdan farklı zaman ofsetli clone beklenen yere gitmedi.` : `"${label}" doğrulaması tutmadı.`, probs);
      log(`✓ ${label} doğrulandı (${list.length} klip, tick düzeyinde).`, "ok");
      beforeLast = prev;
      prev = s;
    };

    const placeStep = async (list: Placement[], label: string, isMeasure: boolean) => {
      await expectState(ctx!, prev, beforeLast, executed);
      const taken = new Set<ClipInfo>();
      const copies = list.map((p) => {
        const c = findExp(prev, parkedExp(p, P), taken);
        if (!c) throw new SpreadStop(`park kopyası bulunamadı: ${fmtClip(p.x.clip)}`);
        taken.add(c);
        return { p, c };
      });
      const so = await select(ctx!, copies.map((x) => x.c), "Park kopyaları");
      const src = copies.map(({ p, c }) => {
        const f = relocate(so.snap, c);
        if (!f) throw new SpreadStop(`yerleştirme öncesi park kopyası yeniden bulunamadı: ${fmtClip(c)}`);
        return { p, c: f };
      });
      log(`${label}: ${src.length} park kopyası yeni yerine (zaman ofseti Δ − ${secOf(P)} sn, dikey) → park kopyaları siliniyor.`);
      await runTx(ctx!, executed, label, `TOPLA: ${label}`, (ops) => {
        for (const { p, c } of src) {
          const off = p.track - c.track;
          ops.clone(c, ticks(p.delta - P), c.kind === "V" ? off : 0, c.kind === "A" ? off : 0);
        }
        ops.remove(so.sel);
      });
      await settle();
      const s = await snapshot(ctx!);
      for (const p of list) placed.add(p);
      const probs = compareLayout(expectCollect(s0, plan, P, parked, placed), s);
      if (probs.length)
        throw new SpreadStop(
          isMeasure ? `İLK TAŞIMA TUTMADI (yerleştirme, ${first}): negatif zaman ofsetli / dikey clone beklenen yere gitmedi.` : `"${label}" doğrulaması tutmadı.`,
          probs
        );
      log(`✓ ${label} doğrulandı (${list.length} klip, tick düzeyinde).`, "ok");
      beforeLast = prev;
      prev = s;
    };

    await parkStep(measure, "ilk park (ölçüm)", helpers, true);
    if (rest.length) await parkStep(rest, "park", [], false);
    await placeStep(measure, "ilk yerleştirme (ölçüm)", true);
    if (rest.length) await placeStep(rest, "yerleştir", false);

    const fProbs = [...compareLayout(expectCollect(s0, plan, P, parked, placed), prev), ...verifyRelative(plan, prev), ...snapshotOverlaps(prev)];
    if (fProbs.length) throw new SpreadStop("TOPLA doğrulaması tutmadı.", fProbs);

    log(
      `✓ TOPLA tamam: ${plan.layouts.length} oturum sırayla dizildi (bloklar çakışmıyor, oturum içi göreli konumlar tick düzeyinde aynı); ` +
        `${plan.moves.length} klip taşındı; ${plan.parkedRecs.length} kayıt park track'inde. (${executed.length} adım: ${executed.join(", ")})`,
      "ok"
    );
    for (const l of plan.layouts) log(`   ${l.session.id}: ${secOf(l.newStart)}s–${secOf(l.newEnd)}s  ${l.session.label}`, "dim");
    for (const r of plan.parkedRecs) log(`   park: ${r.label} (${trackLabel(r.clips[0].kind, plan.placements.find((p) => p.x.clip === r.clips[0])!.track)}, zamanı aynı)`, "dim");
    forgetStopped();
    log(CHECK_MSG, "head");
    log(`Beğenmezsen: timeline'a tıkla, Ctrl+Z'ye ${executed.length} kez bas — ya da yedek sequence "${backupName}"i kullan.`, "dim");
  } catch (e) {
    if (executed.length && ctx) await rememberStopped(ctx, "TOPLA");
    reportStop("TOPLA", e, executed, backupName);
  }
}
