// SPREAD — aktif sequence'taki her klibi kendi track'ine dağıtır. HİÇBİR klibin zamanı değişmez; yalnız track'i değişir.
//
// Akış (her transaction'dan sonra sequence baştan okunur ve DOĞRULANIR; tutmazsa DUR, kendi başına düzeltme yok):
//   0) plan + onay penceresi
//   1) yedek: sequence.createCloneAction → yeni sequence görünmezse Spread BAŞLAMAZ; yedek aktif olursa asıla dönülür
//   2) TX-A "track hazırlığı" (yalnız yeni track gerekiyorsa): kanıtlı yöntem = clone ofseti (hedef = mevcut track sayısı).
//      Her yeni track için bir geçici yardımcı kopya, sequence SONUNUN ÖTESİNE park edilir → hiçbir asılla zamanda çakışmaz.
//      Neden ayrı transaction: overwrite'ın olmayan track'i açtığı ve tek transaction'da ardışık track açma KANITLANMADI;
//      bu belirsiz adım asıllara dokunulmadan ÖNCE ölçülür (başarısızsa yalnız yardımcılar eklenmiş olur, tek Ctrl+Z).
//   3) TX-B "taşı" (tek transaction): clone (ses / sadece-video birimleri) → remove (taşınan asıllar + yardımcılar, tek seçim,
//      ripple=false) → overwrite (kamera birimleri proje öğesinden, BAĞLI doğar)
//   4) TX-C "kırpma eşitlemesi" (yalnız gerekirse): overwrite'ın aslından farklı yerleştirdiği kamera kliplerine
//      set In/Out/Start/End (kırpılmamış kliplere hiç dokunulmaz)
//   5) tüm klipleri programla seç + Synchronize talimatı

import { ppro } from "./ppro";
import { selectAll, selectExactly } from "./edit";
import { askUser, expectState, makeBackup, multisetEqual, prepareTracks, reportStop, runTx, SpreadStop } from "./guard";
import { errText, fmtClip, relocate, secOf, settle, snapshot, ticks, trackLabel, type ClipInfo, type Snapshot } from "./model";
import { makePlan, type Plan } from "./plan";
import { requireActive } from "./session";
import { log } from "./ui";
import { verifySpread } from "./verify";

export { SpreadStop };

function printPlan(plan: Plan, s: Snapshot): void {
  log(`Okundu: V track ${s.vCount}, A track ${s.aCount}, ${s.clips.length} klip.`, "dim");
  log(
    `Birimler: ${plan.counts.camera} kamera (${plan.counts.cameraChannels} ses kanalı), ${plan.counts.videoOnly} sadece-video, ${plan.counts.audio} ses.`
  );
  for (const u of plan.units.slice().sort((a, b) => (a.vTarget ?? 1e9) - (b.vTarget ?? 1e9) || (a.aTarget ?? 0) - (b.aTarget ?? 0))) {
    const tgt = [
      u.vTarget !== null ? trackLabel("V", u.vTarget) : null,
      u.audio.length ? u.audio.map((_, k) => trackLabel("A", u.aTarget! + k)).join("+") : null,
    ]
      .filter(Boolean)
      .join(" / ");
    const from = [u.video, ...u.audio]
      .filter((c): c is ClipInfo => !!c)
      .map((c) => trackLabel(c.kind, c.track))
      .join("+");
    const how = u.stays ? "yerinde kalır" : u.kind === "camera" ? "overwrite (bağlı)" : "clone";
    const trim = u.kind === "camera" && u.trimmed ? " [kırpılmış]" : "";
    log(`  ${u.kind.padEnd(6)} "${u.label}" ${secOf(u.start)}s  ${from} → ${tgt}  (${how})${trim}`, "dim");
  }
  for (const w of plan.warnings) log(`uyarı: ${w}`, "warn");
  for (const e of plan.errors) log(`HATA: ${e}`, "err");
}

// ------------------------------------------------------------------ ana akış
export async function runSpread(): Promise<void> {
  const executed: string[] = [];
  let backupName: string | null = null;
  log("▶ SPREAD", "head");
  try {
    const ctx = await requireActive();
    log(`sequence: "${ctx.name}"`, "dim");
    const s0 = await snapshot(ctx, { media: true });
    const tc: unknown = ppro.ProjectItem.TYPE_CLIP; // d.ts:L2788 ProjectItemStatic.TYPE_CLIP (Probe'da sınanmadı → yoksa kontrol atlanır)
    const plan = makePlan(s0, typeof tc === "number" ? tc : null);
    const opt = s0.clips.filter((c) => c.optErrors.length);
    if (opt.length) log(`not: ${opt.length} klipte isteğe bağlı bilgi okunamadı (ör. medya süresi) — engel değil. İlki: ${opt[0].optErrors[0]}`, "dim");
    printPlan(plan, s0);
    if (plan.errors.length) throw new SpreadStop(`Plan kurulamadı (${plan.errors.length} hata). Spread BAŞLAMADI, hiçbir şey değişmedi.`);
    if (!s0.clips.length) throw new SpreadStop("Sequence'ta klip yok.");
    const moving = plan.overwrite.length + plan.clone.length;
    if (!moving) {
      log("✓ Zaten dağıtılmış: her klip kendi hedef track'inde. Yapılacak bir şey yok.", "ok");
      return;
    }
    const newV = Math.max(0, plan.neededV - s0.vCount);
    const newA = Math.max(0, plan.neededA - s0.aCount);
    const trimmed = plan.overwrite.filter((u) => u.trimmed !== false).length;

    const ans = await askUser(
      `${plan.counts.camera} kamera${plan.counts.videoOnly ? ` + ${plan.counts.videoOnly} sadece-video` : ""}, ${plan.counts.audio} ses bulundu, ` +
        `${newV + newA} track açılacak (V ${newV}, A ${newA}). Önce yedek sequence oluşturulacak. ` +
        `Taşınacak: ${plan.overwrite.length} kamera (proje öğesinden yeniden, bağlı — kamera klibindeki efektler, ses kazancı/keyframe'ler ve klip adı taşınmaz), ` +
        `${plan.clone.length} ses/video (birebir kopya); ` +
        `yerinde kalan: ${plan.stay.length}.${trimmed ? ` ${trimmed} kamera kırpılmış/bilinmiyor → gerekirse kırpma eşitlemesi adımı.` : ""}` +
        `${plan.warnings.length ? ` ${plan.warnings.length} uyarı (günlükte).` : ""} Devam?`
    );
    if (ans !== "Evet") {
      log("İptal edildi — hiçbir şey değişmedi.", "warn");
      return;
    }

    // 1) yedek
    const backup = await makeBackup(ctx, "Spread");
    backupName = backup.name;
    const s1 = await snapshot(ctx);
    if (!multisetEqual(s0, s1)) throw new SpreadStop("Yedek alınırken asıl sequence'ın klipleri değişti. Durduruldu.");

    // 2) TX-A: track hazırlığı (kanıtlı yöntem: clone ofseti, hedef = mevcut track sayısı, sırayla)
    let helpers: ClipInfo[] = [];
    let expected: Snapshot = s1; // bir sonraki adımdan önce timeline'ın bu hâlde olması beklenir
    let beforeLast: Snapshot | null = null;
    if (newV || newA) {
      const r = await prepareTracks(ctx, s1, plan.neededV, plan.neededA, executed, "Spread: track hazırlığı");
      helpers = r.helpers;
      expected = r.after;
      beforeLast = s1;
    }

    // 3) TX-B: taşı (tek transaction). Önce timeline beklenen hâlde mi; seçim + referanslar HEMEN öncesinde taze.
    await expectState(ctx, expected, beforeLast, executed);
    const so = await selectExactly(ctx, [...plan.removeClips, ...helpers]);
    for (const n of so.notes) log(`   ${n}`, "dim");
    if (!so.exact) throw new SpreadStop("Silinecek asıllar birebir seçilemedi — güvenlik için taşıma yapılmadı.");
    const fresh = (c: ClipInfo) => {
      const f = relocate(so.snap, c);
      if (!f) throw new SpreadStop(`taşıma öncesi klip yeniden bulunamadı: ${fmtClip(c)}`);
      return f;
    };
    const cloneSrc = plan.clone.map((p) => ({ p, src: fresh(p.clip) }));
    const owSrc = plan.overwrite.map((u) => ({ u, src: fresh(u.video!) }));
    log(`TX-B: ${cloneSrc.length} clone → ${so.readCount} klip sil (ripple=false) → ${owSrc.length} kamera overwrite.`);
    await runTx(ctx, executed, "dağıt", "Spread: dağıt", (ops) => {
      for (const { p, src } of cloneSrc) {
        const off = p.target - src.track;
        ops.clone(src, ppro.TickTime.TIME_ZERO, src.kind === "V" ? off : 0, src.kind === "A" ? off : 0); // d.ts:L3929 TickTimeStatic.TIME_ZERO
      }
      ops.remove(so.sel);
      for (const { u, src } of owSrc) ops.overwrite(src, ticks(u.video!.start), u.vTarget!, u.aTarget!);
    });
    await settle();
    const sB = await snapshot(ctx);
    const vB = verifySpread(plan, sB, true);
    if (vB.problems.length) throw new SpreadStop("Taşıma doğrulaması tutmadı.", vB.problems);

    // 4) TX-C: kırpma eşitlemesi (yalnız farklı yerleşen kamera klipleri)
    if (vB.trimFix.length) {
      await expectState(ctx, sB, null, executed);
      log(`TX-C: ${vB.trimFix.length} kamera klibi aslına eşitlenecek (set In → Out → Start → End).`);
      for (const t of vB.trimFix) log(`   ${fmtClip(t.now)} → asıl in=${t.orig.inPt} out=${t.orig.outPt} start=${t.orig.start} end=${t.orig.end}`, "dim");
      const sC0 = await snapshot(ctx);
      const fixes = vB.trimFix.map((t) => {
        const now = relocate(sC0, t.now);
        if (!now) throw new SpreadStop(`eşitleme öncesi klip yeniden bulunamadı: ${fmtClip(t.now)}`);
        return { orig: t.orig, now };
      });
      await runTx(ctx, executed, "kırpma eşitlemesi", "Spread: kırpma eşitlemesi", (ops) => {
        for (const { orig, now } of fixes) {
          ops.setIn(now, ticks(orig.inPt));
          ops.setOut(now, ticks(orig.outPt));
          ops.setStart(now, ticks(orig.start));
          ops.setEnd(now, ticks(orig.end));
        }
      });
      await settle();
      const sC = await snapshot(ctx);
      const vC = verifySpread(plan, sC, false);
      if (!vC.ok) throw new SpreadStop("Kırpma eşitlemesi sonrası doğrulama tutmadı.", vC.problems);
    }

    log(
      `✓ SPREAD tamam: ${plan.placements.length} klip, ${plan.neededV} video + ${plan.neededA} ses track'ine dağıtıldı; ` +
        `her klibin start/end/in/out'u aslıyla tick düzeyinde aynı; her track'te 1 klip. (${executed.length} adım: ${executed.join(", ")})`,
      "ok"
    );

    // 5) seç + talimat
    try {
      const sel = await selectAll(ctx);
      log(`Tüm klipler programla seçildi (${sel.read}/${sel.requested}; timeline'da görünmeyebilir).`, "dim");
    } catch (e) {
      log(`Seçim yapılamadı: ${errText(e)} (önemli değil)`, "warn");
    }
    log("Şimdi Clip > Synchronize'ı dene. Menü gri ise timeline'a tıkla, Ctrl+A, sağ tık > Synchronize (Audio).", "head");
    log(`Beğenmezsen: timeline'a tıkla, Ctrl+Z'ye ${executed.length} kez bas — ya da yedek sequence "${backupName}"i kullan.`, "dim");
  } catch (e) {
    reportStop("SPREAD", e, executed, backupName);
  }
}
