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
import { selectAll, selectExactly, transact } from "./edit";
import {
  big,
  errText,
  fmtClip,
  invalidateRefs,
  keyFull,
  relocate,
  secOf,
  settle,
  sleep,
  snapshot,
  ticks,
  trackLabel,
  tt,
  TICKS_PER_SECOND,
  type ClipInfo,
  type Snapshot,
} from "./model";
import { makePlan, type Plan } from "./plan";
import { getActive, requireActive, sequenceGuid, sequenceName, SessionError, type SeqContext } from "./session";
import { ask, log, type Answer } from "./ui";
import { verifySpread, verifyTracks } from "./verify";
import type { Sequence } from "./ppro";

export class SpreadStop extends Error {
  constructor(message: string, public details: string[] = []) {
    super(message);
    this.name = "SpreadStop";
  }
}

async function askUser(q: string): Promise<Answer> {
  const a = await ask(q);
  invalidateRefs(); // kullanıcı timeline'da bir şey yapmış olabilir
  return a;
}

const PARK_GAP = 10n * TICKS_PER_SECOND; // yardımcılar sequence sonundan 10 sn sonra

function multisetEqual(a: Snapshot, b: Snapshot): boolean {
  const ka = a.clips.map(keyFull).sort();
  const kb = b.clips.map(keyFull).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/**
 * Transaction'ı çalıştırır ve "yapılan adımlar"a yazar. Hata verirse: önce/sonra karşılaştırıp Premiere'in kısmen uygulayıp
 * uygulamadığını ÖLÇER (Ctrl+Z sayısı doğru söylensin), sonra DURUR.
 */
async function runTx(
  ctx: SeqContext,
  executed: string[],
  label: string,
  undoName: string,
  build: Parameters<typeof transact>[2]
): Promise<Awaited<ReturnType<typeof transact>>> {
  const pre = await snapshot(ctx); // yalnız karşılaştırma için değerler (kuşak değişmez)
  try {
    const r = await transact(ctx, undoName, build);
    executed.push(label);
    return r;
  } catch (e) {
    await settle();
    const now = await snapshot(ctx);
    const changed = !multisetEqual(pre, now) || now.vCount !== pre.vCount || now.aCount !== pre.aCount;
    if (changed) executed.push(`${label} (hata verdi, kısmen uygulanmış)`);
    throw new SpreadStop(`"${label}" adımı hata verdi: ${errText(e)}${changed ? "" : " (timeline değişmedi)"}`);
  }
}

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

// ------------------------------------------------------------------ yedek
async function makeBackup(ctx: SeqContext): Promise<{ name: string; guid: string }> {
  const before = await ctx.project.getSequences(); // d.ts:L2520 Project.getSequences
  const ids = new Set(before.map(sequenceGuid));
  const tx = await transact(ctx, "Spread: yedek sequence", (ops) => {
    ops.cloneSequence();
  });
  let fresh: Sequence[] = [];
  for (let i = 0; i < 10 && fresh.length === 0; i++) {
    await sleep(300);
    const after = await ctx.project.getSequences(); // d.ts:L2520 Project.getSequences
    fresh = after.filter((s) => !ids.has(sequenceGuid(s)));
  }
  if (fresh.length !== 1)
    throw new SpreadStop(`Yedek sequence oluşmadı (executeTransaction → ${tx.ok}, yeni sequence: ${fresh.length}). Spread BAŞLAMADI, timeline'a dokunulmadı.`);
  const backup = { name: sequenceName(fresh[0]), guid: sequenceGuid(fresh[0]) };
  log(`✓ Yedek oluştu: "${backup.name}"`, "ok");

  const { sequence: active } = await getActive();
  const activeGuid = active ? sequenceGuid(active) : null;
  if (activeGuid !== ctx.guid) {
    if (activeGuid !== backup.guid)
      throw new SpreadStop("Yedek alınırken aktif sequence değişti (yedek değil, başka bir sequence). Spread BAŞLAMADI.");
    log("Yedek aktif oldu → asıl sequence'a dönülüyor…", "warn");
    const back = await ctx.project.setActiveSequence(ctx.sequence); // d.ts:L2590 Project.setActiveSequence
    const { sequence: now } = await getActive();
    if (!back || !now || sequenceGuid(now) !== ctx.guid)
      throw new SpreadStop(`Yedek aktif oldu ve asıl sequence'a dönülemedi (setActiveSequence → ${String(back)}). Spread BAŞLAMADI.`);
    log(`✓ Asıl sequence "${ctx.name}" tekrar aktif.`, "ok");
  }
  return backup;
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
    const plan = makePlan(s0, ppro.ProjectItem.TYPE_CLIP); // d.ts:L2788 ProjectItemStatic.TYPE_CLIP
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
        `Taşınacak: ${plan.overwrite.length} kamera (proje öğesinden, bağlı; klip efektleri taşınmaz), ${plan.clone.length} ses/video (kopya); ` +
        `yerinde kalan: ${plan.stay.length}.${trimmed ? ` ${trimmed} kamera kırpılmış/bilinmiyor → gerekirse kırpma eşitlemesi adımı.` : ""}` +
        `${plan.warnings.length ? ` ${plan.warnings.length} uyarı (günlükte).` : ""} Devam?`
    );
    if (ans !== "Evet") {
      log("İptal edildi — hiçbir şey değişmedi.", "warn");
      return;
    }

    // 1) yedek
    const backup = await makeBackup(ctx);
    backupName = backup.name;
    const s1 = await snapshot(ctx);
    if (!multisetEqual(s0, s1)) throw new SpreadStop("Yedek alınırken asıl sequence'ın klipleri değişti. Durduruldu.");

    // 2) TX-A: track hazırlığı (kanıtlı yöntem: clone ofseti, hedef = mevcut track sayısı, sırayla)
    let helpers: ClipInfo[] = [];
    if (newV || newA) {
      const hv = s1.clips.find((c) => c.kind === "V") ?? null;
      const ha = s1.clips.find((c) => c.kind === "A") ?? null;
      if ((newV && !hv) || (newA && !ha)) throw new SpreadStop("Track açmak için kopyalanacak klip yok.");
      const seqEnd = big(tt(await ctx.sequence.getEndTime()).ticks); // d.ts:L3181 Sequence.getEndTime
      const park = seqEnd + PARK_GAP;
      log(`TX-A: ${newV} video + ${newA} ses track'i clone ofsetiyle açılıyor (yardımcılar ${secOf(park)}s'ye park edilir).`);
      const tx = await runTx(ctx, executed, "track hazırlığı", "Spread: track hazırlığı", (ops) => {
        for (let t = s1.vCount; t < plan.neededV; t++) ops.clone(hv!, ticks(park - big(hv!.start)), t - hv!.track, 0);
        for (let t = s1.aCount; t < plan.neededA; t++) ops.clone(ha!, ticks(park - big(ha!.start)), 0, t - ha!.track);
      });
      log(`   executeTransaction → ${tx.ok}; addAction ${tx.addResults.filter(Boolean).length}/${tx.addResults.length}`, "dim");
      await settle();
      const s2 = await snapshot(ctx);
      const probs = verifyTracks(s1, s2, plan.neededV, plan.neededA, { V: newV, A: newA });
      const extra = s2.clips.filter((c) => !s1.clips.some((o) => keyFull(o) === keyFull(c)));
      for (const c of extra) if (big(c.start) < park) probs.push(`yardımcı park yerinde değil: ${fmtClip(c)}`);
      if (probs.length) throw new SpreadStop("Track hazırlığı beklendiği gibi olmadı.", probs);
      helpers = extra;
      log(`✓ TX-A doğrulandı: V ${s1.vCount}→${s2.vCount}, A ${s1.aCount}→${s2.aCount}; asıllar birebir duruyor.`, "ok");
    }

    // 3) TX-B: taşı (tek transaction). Seçim + referanslar HEMEN öncesinde taze.
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
    const txB = await runTx(ctx, executed, "dağıt", "Spread: dağıt", (ops) => {
      for (const { p, src } of cloneSrc) {
        const off = p.target - src.track;
        ops.clone(src, ppro.TickTime.TIME_ZERO, src.kind === "V" ? off : 0, src.kind === "A" ? off : 0); // d.ts:L3929 TickTimeStatic.TIME_ZERO
      }
      ops.remove(so.sel);
      for (const { u, src } of owSrc) ops.overwrite(src, ticks(u.video!.start), u.vTarget!, u.aTarget!);
    });
    log(`   executeTransaction → ${txB.ok}; addAction ${txB.addResults.filter(Boolean).length}/${txB.addResults.length}`, "dim");
    await settle();
    const sB = await snapshot(ctx);
    const vB = verifySpread(plan, sB, true);
    if (vB.problems.length) throw new SpreadStop("Taşıma doğrulaması tutmadı.", vB.problems);

    // 4) TX-C: kırpma eşitlemesi (yalnız farklı yerleşen kamera klipleri)
    if (vB.trimFix.length) {
      log(`TX-C: ${vB.trimFix.length} kamera klibi aslına eşitlenecek (set In → Out → Start → End).`);
      for (const t of vB.trimFix) log(`   ${fmtClip(t.now)} → asıl in=${t.orig.inPt} out=${t.orig.outPt} start=${t.orig.start} end=${t.orig.end}`, "dim");
      const sC0 = await snapshot(ctx);
      const fixes = vB.trimFix.map((t) => {
        const now = relocate(sC0, t.now);
        if (!now) throw new SpreadStop(`eşitleme öncesi klip yeniden bulunamadı: ${fmtClip(t.now)}`);
        return { orig: t.orig, now };
      });
      const txC = await runTx(ctx, executed, "kırpma eşitlemesi", "Spread: kırpma eşitlemesi", (ops) => {
        for (const { orig, now } of fixes) {
          ops.setIn(now, ticks(orig.inPt));
          ops.setOut(now, ticks(orig.outPt));
          ops.setStart(now, ticks(orig.start));
          ops.setEnd(now, ticks(orig.end));
        }
      });
      log(`   executeTransaction → ${txC.ok}; addAction ${txC.addResults.filter(Boolean).length}/${txC.addResults.length}`, "dim");
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
    const stop = e instanceof SpreadStop ? e : null;
    const msg = stop ? stop.message : e instanceof SessionError ? e.message : `Beklenmeyen hata: ${errText(e)}`;
    log(`✗ SPREAD DURDU: ${msg}`, "err");
    for (const d of stop?.details ?? []) log(`   • ${d}`, "err");
    if (executed.length) {
      log(`Yapılan adımlar (${executed.length}): ${executed.join(", ")}.`, "warn");
      log(
        `Geri almak için: timeline'a tıkla ve Ctrl+Z'ye ${executed.length} kez bas — ya da yedek sequence "${backupName ?? "?"}"i kullan. ` +
          "Panel kendi başına düzeltme yapmaz.",
        "warn"
      );
    } else if (backupName) {
      log(`Timeline'da değişiklik yapılmadı. (Yedek "${backupName}" oluştu; silebilirsin.)`, "warn");
    } else {
      log("Timeline'da değişiklik yapılmadı.", "warn");
    }
  }
}
