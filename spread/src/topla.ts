// TOPLA — senkrondan SONRA: klipleri cihaz / kanal track'lerine DİKEY taşır. Hiçbir klibin start/end/in/out'u değişmez.
// Plan: collect.ts (saf). Güvenlik: guard.ts (Spread'le aynı: onay → yedek → her transaction sonrası tick düzeyinde doğrulama →
// tutmazsa DUR + Ctrl+Z sayısı + yedeğin adı; kendi başına düzeltme yok).
//
// Transaction'lar: [yedek] → [TX-A track hazırlığı, yalnız gerekirse] → TX-1 park → TX-2 yerleştir.

import { selectExactly } from "./edit";
import { expectAfterPark, expectFinal, makeCollectPlan, parkedOf, type CollectPlan } from "./collect";
import { fileName, roleLabel } from "./classify";
import { askUser, expectState, makeBackup, multisetEqual, parkBase, prepareTracks, reportStop, runTx, SpreadStop } from "./guard";
import { compareLayout, findExp, snapshotOverlaps } from "./layout";
import { fmtClip, relocate, secOf, settle, snapshot, ticks, trackLabel, type ClipInfo, type Snapshot } from "./model";
import { requireActive } from "./session";
import { isKept } from "./settings";
import { log } from "./ui";

export const CHECK_MSG = "Kontrol et, sonra BAĞLA'ya bas.";

function printCollectPlan(plan: CollectPlan, s: Snapshot): void {
  log(`Okundu: V track ${s.vCount}, A track ${s.aCount}, ${s.clips.length} klip.`, "dim");
  for (const d of plan.devices)
    log(`  cihaz ${d.key.padEnd(4)} ${d.clips.length} klip, toplam ${secOf(d.total)} sn (ör. "${d.sample}") → ${trackLabel("V", d.vTrack)}` +
      (d.guideCh ? `; kılavuz ses → ${Array.from({ length: d.guideCh }, (_, k) => trackLabel("A", d.guideBase + k)).join("+")}` : ""), "dim");
  for (const c of plan.channels)
    log(`  kanal ${c.key.padEnd(6)} ${c.count} klip → ${trackLabel("A", c.aTrack)}${c.kept ? "" : " (ayarda KAPALI: BAĞLA silecek)"}`, "dim");
  for (const m of plan.moves)
    log(`    ${roleLabel(m.x).padEnd(18)} ${trackLabel(m.x.clip.kind, m.x.clip.track)} → ${trackLabel(m.x.clip.kind, m.target)}  "${m.x.clip.name}" ${secOf(m.x.clip.start)}s`, "dim");
  for (const w of plan.warnings) log(`uyarı: ${w}`, "warn");
  for (const e of plan.errors) log(`HATA: ${e}`, "err");
  for (const c of plan.conflicts) log(`ÇAKIŞMA: ${c}`, "err");
}

export async function runCollect(): Promise<void> {
  const executed: string[] = [];
  let backupName: string | null = null;
  log("▶ TOPLA", "head");
  try {
    const ctx = await requireActive();
    log(`sequence: "${ctx.name}"`, "dim");
    const s0 = await snapshot(ctx);
    const plan = makeCollectPlan(s0, isKept);
    printCollectPlan(plan, s0);
    if (plan.errors.length) throw new SpreadStop(`Plan kurulamadı (${plan.errors.length} hata). TOPLA BAŞLAMADI, hiçbir şey değişmedi.`);
    if (plan.conflicts.length)
      throw new SpreadStop(
        `Hedef track'lerde ${plan.conflicts.length} zaman çakışması var — TOPLA BAŞLAMADI, hiçbir şey değişmedi. ` +
          "Klipler sessizce başka track'e konmaz: senkronu / bu klipleri kontrol et.",
        plan.conflicts
      );
    if (!plan.moves.length) {
      log("✓ Zaten toplanmış: her klip cihaz / kanal track'inde. Yapılacak bir şey yok.", "ok");
      log(CHECK_MSG, "head");
      return;
    }
    const newV = Math.max(0, plan.neededV - s0.vCount);
    const newA = Math.max(0, plan.neededA - s0.aCount);
    const devTxt = plan.devices.map((d) => `${d.key} ${d.clips.length} klip → ${trackLabel("V", d.vTrack)}`).join(", ");
    const chTxt = plan.channels.map((c) => `${c.key} → ${trackLabel("A", c.aTrack)}${c.kept ? "" : " (kapalı)"}`).join(", ");
    const guideTxt = plan.guideCount
      ? `kamera kılavuz sesleri → ${trackLabel("A", plan.channels.length)}–${trackLabel("A", plan.neededA - 1)} (kontrol için; BAĞLA silecek)`
      : "kılavuz ses yok";
    const ans = await askUser(
      `TOPLA: ${plan.devices.length} cihaz (${devTxt}); ${plan.channels.length} harici kanal (${chTxt}); ${guideTxt}. ` +
        `${plan.moves.length} klip yalnız DİKEY taşınacak (zamanlar değişmez; taşınan kamera videoları kılavuz seslerinden ayrı düşer, BAĞLA yeniden bağlar)` +
        `${plan.unknown.length ? `; ${plan.unknown.length} sınıflanamayan öğeye dokunulmayacak` : ""}` +
        `${newV + newA ? `; ${newV + newA} track açılacak (V ${newV}, A ${newA})` : ""}. Önce yedek sequence oluşturulacak. Devam?`
    );
    if (ans !== "Evet") {
      log("İptal edildi — hiçbir şey değişmedi.", "warn");
      return;
    }

    const backup = await makeBackup(ctx, "TOPLA");
    backupName = backup.name;
    const s1 = await snapshot(ctx);
    if (!multisetEqual(s0, s1)) throw new SpreadStop("Yedek alınırken asıl sequence'ın klipleri değişti. Durduruldu.");

    let helpers: ClipInfo[] = [];
    let expected: Snapshot = s1;
    let beforeLast: Snapshot | null = null;
    if (newV || newA) {
      const r = await prepareTracks(ctx, s1, plan.neededV, plan.neededA, executed, "TOPLA: track hazırlığı");
      helpers = r.helpers;
      expected = r.after;
      beforeLast = s1;
    }

    // TX-1 park: taşınacaklar aynı track'te +P; asıllar (+ yardımcılar) silinir
    await expectState(ctx, expected, beforeLast, executed);
    const so = await selectExactly(ctx, [...plan.moves.map((m) => m.x.clip), ...helpers]);
    for (const n of so.notes) log(`   ${n}`, "dim");
    if (!so.exact) throw new SpreadStop("Taşınacak asıllar birebir seçilemedi — güvenlik için taşıma yapılmadı.");
    const P = await parkBase(ctx, so.snap);
    const src1 = plan.moves.map((m) => {
      const f = relocate(so.snap, m.x.clip);
      if (!f) throw new SpreadStop(`park öncesi klip yeniden bulunamadı: ${fmtClip(m.x.clip)}`);
      return f;
    });
    log(`TX-1 (park): ${src1.length} klip aynı track'te ${secOf(P)} sn ileri kopyalanıyor → ${so.readCount} klip siliniyor (ripple=false).`);
    await runTx(ctx, executed, "park", "TOPLA: park", (ops) => {
      for (const c of src1) ops.clone(c, ticks(P), 0, 0);
      ops.remove(so.sel);
    });
    await settle();
    const sP = await snapshot(ctx);
    const pProbs = compareLayout(expectAfterPark(s0, plan, P), sP);
    if (pProbs.length) throw new SpreadStop("Park doğrulaması tutmadı.", pProbs);
    log(`✓ TX-1 doğrulandı: ${src1.length} klip park yerinde, diğer ${s0.clips.length - src1.length} klip birebir.`, "ok");

    // TX-2 yerleştir: park kopyaları −P zaman + dikey ofsetle hedefe; park kopyaları silinir
    await expectState(ctx, sP, null, executed);
    const taken = new Set<ClipInfo>();
    const parked = plan.moves.map((m) => {
      const c = findExp(sP, parkedOf(m.x.clip, P), taken);
      if (!c) throw new SpreadStop(`park kopyası bulunamadı: ${fmtClip(m.x.clip)}`);
      taken.add(c);
      return { m, c };
    });
    const so2 = await selectExactly(ctx, parked.map((p) => p.c));
    for (const n of so2.notes) log(`   ${n}`, "dim");
    if (!so2.exact) throw new SpreadStop("Park kopyaları birebir seçilemedi — güvenlik için yerleştirme yapılmadı.");
    const src2 = parked.map((p) => {
      const f = relocate(so2.snap, p.c);
      if (!f) throw new SpreadStop(`yerleştirme öncesi park kopyası yeniden bulunamadı: ${fmtClip(p.c)}`);
      return { m: p.m, c: f };
    });
    log(`TX-2 (yerleştir): ${src2.length} park kopyası hedef track'lerine (−${secOf(P)} sn) → park kopyaları siliniyor.`);
    await runTx(ctx, executed, "yerleştir", "TOPLA: yerleştir", (ops) => {
      for (const { m, c } of src2) {
        const off = m.target - c.track;
        ops.clone(c, ticks(-P), c.kind === "V" ? off : 0, c.kind === "A" ? off : 0);
      }
      ops.remove(so2.sel);
    });
    await settle();
    const sF = await snapshot(ctx);
    const fProbs = [...compareLayout(expectFinal(s0, plan), sF), ...snapshotOverlaps(sF)];
    if (fProbs.length) throw new SpreadStop("TOPLA doğrulaması tutmadı.", fProbs);

    log(
      `✓ TOPLA tamam: ${plan.moves.length} klip cihaz / kanal track'lerine dikey taşındı; her klibin start/end/in/out'u aslıyla tick düzeyinde aynı; ` +
        `hiçbir track'te çakışma yok. (${executed.length} adım: ${executed.join(", ")})`,
      "ok"
    );
    for (const u of plan.unknown) log(`   dokunulmadı: ${trackLabel(u.clip.kind, u.clip.track)} "${fileName(u.clip)}" (${u.why})`, "dim");
    log(CHECK_MSG, "head");
    log(`Beğenmezsen: timeline'a tıkla, Ctrl+Z'ye ${executed.length} kez bas — ya da yedek sequence "${backupName}"i kullan.`, "dim");
  } catch (e) {
    reportStop("TOPLA", e, executed, backupName);
  }
}
