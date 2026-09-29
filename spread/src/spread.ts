// SPREAD — aktif sequence'taki her klibi kendi track'ine dağıtır. HİÇBİR klibin zamanı değişmez; yalnız track'i değişir.
//
// Akış (her transaction'dan sonra sequence baştan okunur ve DOĞRULANIR; tutmazsa DUR, kendi başına düzeltme yok):
//   0) plan + onay penceresi
//   1) yedek: sequence.createCloneAction → yeni sequence görünmezse Spread BAŞLAMAZ; yedek aktif olursa asıla dönülür
//   2) TX-A "track hazırlığı" (yalnız yeni track gerekiyorsa): kanıtlı yöntem = clone ofseti (hedef = mevcut track sayısı).
//      Her yeni track için bir geçici yardımcı kopya, sequence SONUNUN ÖTESİNE park edilir → hiçbir asılla zamanda çakışmaz.
//      Neden ayrı transaction: overwrite'ın olmayan track'i açtığı ve tek transaction'da ardışık track açma KANITLANMADI;
//      bu belirsiz adım asıllara dokunulmadan ÖNCE ölçülür (başarısızsa yalnız yardımcılar eklenmiş olur, tek Ctrl+Z).
//   3) TX-B "dağıt" (tek transaction): clone (ses / sadece-video birimleri) → remove (taşınan asıllar + yardımcılar, tek seçim,
//      ripple=false)
//   4) v1.2.1 "ilk overwrite (ölçüm)": İLK kamera TEK BAŞINA kendi transaction'ında proje öğesinden overwrite edilir (BAĞLI doğar);
//      video ve ses(ler)inin start/end/in/out'u aslıyla tick düzeyinde karşılaştırılır (trimstate.ts → overwriteFit):
//        birebir → devam;
//        YALNIZ kuyrukta ve < 1 kare fark (ör. overwrite kuyruğu medya sonuna uzattı) → AYRI transaction'da klip başına TEK
//        SetOutPoint (kanıtlı kural: SetOutPoint yalnız kuyruğu değiştirir, Δend = Δout); End ile Out ASLA aynı transaction'da
//        değil. Bağlı sesin videonun SetOutPoint'ini izleyip izlemediği bilinmiyor → önce yalnız video, ses okunur; izlemediyse
//        ses ayrı transaction'da. Sonra yeniden doğrulanır;
//        başka her fark (baş, start kayması, ≥ 1 kare) → DUR, kalan kameralara dokunulmaz (ölçülen fark + Ctrl+Z sayısı + yedek adı).
//   5) "overwrite": kalan kameralar (tek transaction), aynı ölçüm ve aynı kural
//   6) tüm klipleri programla seç + Synchronize talimatı
// Kameraların proje öğeleri her overwrite'tan HEMEN önce YEDEK sequence'tan taze okunur (asılları TX-B'de silindi; hiçbir referans
// bir transaction'ı aşamaz).
// v0.3.4: eski TX-C "kırpma eşitlemesi" (overwrite'ın tam boy yerleştirdiği kırpılmış kameralara set In/Out/Start/End, tek
// transaction'da) KALDIRILDI: gerçek Premiere'de set action'lar klibin ilk hâlinden fark olarak uygulanıp aynı kenarda birikiyor
// (Out + End → kuyruk iki kez kırpılır; kanıt: trimcal.ts). Kırpılmış kamera varsa SPREAD BAŞLAMAZ. v1.2.1: "kırpılmış" = in ≠ 0 ya
// da medya − out 0 ile 1 kare arasında değil (trimstate.ts; tam kare sayılı out ile milisaniye hizalı medya süresi arasındaki
// < 1 karelik fark kırpma DEĞİLDİR).

import { ppro } from "./ppro";
import { selectAll, selectExactly } from "./edit";
import {
  askUser,
  confirmNotStopped,
  expectState,
  forgetStopped,
  frameTicks,
  makeBackup,
  multisetEqual,
  prepareTracks,
  rememberStopped,
  reportStop,
  runTx,
  SpreadStop,
} from "./guard";
import { errText, fmtClip, relocate, secOf, settle, snapshot, ticks, trackLabel, type ClipInfo, type Snapshot } from "./model";
import { where } from "./classify";
import { makePlan, type Placement, type Plan, type Unit } from "./plan";
import { Trail } from "./prints";
import { confirmRedo, reconcileAndLog } from "./records";
import { setStepMids } from "./steps";
import { requireActive, sequenceGuid, sequenceName, type SeqContext } from "./session";
import { edgeDelta, fmtDelta, fmtDiff, frameOf, frameText, overwriteFit, type Frame, type OverwriteFit } from "./trimstate";
import { done, log, progress } from "./ui";
import { diffTimes, verifySpread } from "./verify";

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
    const trim = u.kind === "camera" && u.trimmed ? " [kırpılmış]" : u.kind === "camera" && u.trimmed === null ? " [kırpma bilinmiyor]" : "";
    log(`  ${u.kind.padEnd(6)} "${u.label}" ${secOf(u.start)}s  ${from} → ${tgt}  (${how})${trim}`, "dim");
  }
  for (const w of plan.warnings) log(`uyarı: ${w}`, "warn");
  for (const e of plan.errors) log(`HATA: ${e}`, "err");
}

// ------------------------------------------------------------------ v1.2.1 kamera overwrite + ölçüm

type Item = { u: Unit; p: Placement; now: ClipInfo; fit: OverwriteFit };

const sameEdges = (a: ClipInfo, b: ClipInfo) => {
  const d = edgeDelta(a, b);
  return !!d && d.start === 0n && d.end === 0n && d.inPt === 0n && d.outPt === 0n;
};

/** Kameraları proje öğesinden overwrite eder, her yerleşeni aslıyla ölçer, yalnız-kuyruk < 1 kare farkı SetOutPoint'le düzeltir. */
class Overwriter {
  prev!: Snapshot;
  beforeLast: Snapshot | null = null;
  /** bağlı ses, videonun SetOutPoint'ini izliyor mu — ilk gerektiğinde ÖLÇÜLÜR (null = bilinmiyor) */
  follow: boolean | null = null;

  constructor(
    private ctx: SeqContext,
    private plan: Plan,
    private backupGuid: string,
    private seqFrame: bigint | null,
    private executed: string[],
    private pending: Set<Unit>,
    private trail: Trail
  ) {}

  frame(u: Unit): Frame {
    return u.trim?.frame ?? frameOf(u.video!.frameTicks, this.seqFrame);
  }

  placementsOf(u: Unit): Placement[] {
    return this.plan.placements.filter((p) => p.unit === u);
  }

  /** Proje öğeleri: asıllar TX-B'de silindi → yedek sequence'tan (aslıyla birebir; makeBackup doğruladı) HEMEN şimdi taze okunur. */
  async sources(list: Unit[]): Promise<{ u: Unit; src: ClipInfo }[]> {
    const all = await this.ctx.project.getSequences(); // d.ts:L2520 Project.getSequences
    const seq = all.find((x) => sequenceGuid(x) === this.backupGuid);
    if (!seq) throw new SpreadStop("Yedek sequence bulunamadı (kameraların proje öğeleri ondan okunur). Durduruldu; kalan kameralara dokunulmadı.");
    const bs = await snapshot({ ...this.ctx, sequence: seq, guid: this.backupGuid, name: sequenceName(seq) });
    return list.map((u) => {
      const src = relocate(bs, u.video!);
      if (!src) throw new SpreadStop(`"${u.label}" yedek sequence'ta bulunamadı (yedek değiştirilmiş?). Durduruldu; kalan kameralara dokunulmadı.`);
      return { u, src };
    });
  }

  async step(list: Unit[], label: string, isMeasure: boolean, prev: Snapshot, beforeLast: Snapshot | null): Promise<void> {
    const { ctx, plan, executed, pending } = this;
    if (isMeasure) progress(0.6, `İlk kamera yerleştiriliyor (ölçüm)…`);
    await expectState(ctx, prev, beforeLast, executed);
    const src = await this.sources(list);
    log(`${label}: ${list.length} kamera proje öğesinden overwrite ediliyor${isMeasure ? ` ("${list[0].label}" tek başına; video ve ses aslıyla tick düzeyinde karşılaştırılacak)` : ""}.`);
    await runTx(ctx, executed, label, `Spread: ${label}`, (ops) => {
      for (const { u, src: c } of src) ops.overwrite(c, ticks(u.video!.start), u.vTarget!, u.aTarget!);
    });
    await settle();
    const s = await snapshot(ctx);
    this.trail.note(s, executed.length);
    for (const u of list) pending.delete(u);
    const v = verifySpread(plan, s, { pending, loose: new Set(list) });
    if (v.problems.length)
      throw new SpreadStop(
        isMeasure
          ? `İlk overwrite (ölçüm, "${list[0].label}") doğrulaması tutmadı. Durduruldu; kalan kameralara dokunulmadı.`
          : `Taşıma doğrulaması tutmadı ("${label}"). Durduruldu.`,
        v.problems
      );
    const items: Item[] = list.flatMap((u) =>
      this.placementsOf(u).map((p) => {
        const now = v.found.get(p)!;
        return { u, p, now, fit: overwriteFit(p.clip, now, this.frame(u)) };
      })
    );
    for (const u of list) {
      const its = items.filter((i) => i.u === u);
      log(
        `   ölçüm "${u.label}": ${its
          .map((i) => `${trackLabel(i.p.clip.kind, i.p.target)} ${i.fit === "exact" ? "birebir" : i.fit === "tail" ? `yalnız kuyruk ${fmtDiff(edgeDelta(i.p.clip, i.now)!.end, this.frame(u))}` : `FARK: ${fmtDelta(edgeDelta(i.p.clip, i.now), this.frame(u))}`}`)
          .join("; ")}`,
        its.every((i) => i.fit === "exact") ? "dim" : "warn"
      );
    }
    const bad = items.filter((i) => i.fit === "other");
    if (bad.length)
      throw new SpreadStop(
        `${isMeasure ? `İLK OVERWRITE TUTMADI (ölçüm, "${list[0].label}")` : "OVERWRITE TUTMADI"}: proje öğesinden yerleşen klip aslıyla aynı değil ve fark yalnız kuyrukta < 1 kare değil. Durduruldu; ${isMeasure ? "kalan kameralara" : "başka hiçbir şeye"} dokunulmadı.`,
        [
          ...bad.map(
            (i) =>
              `${trackLabel(i.p.clip.kind, i.p.target)} "${i.p.clip.name}": ölçülen fark ${fmtDelta(edgeDelta(i.p.clip, i.now), this.frame(i.u))} ` +
              `(${diffTimes(i.p.clip, i.now).join("; ")}); ${frameText(this.frame(i.u))}`
          ),
          "Kural: yalnız kuyrukta ve 1 kareden küçük fark SetOutPoint'le düzeltilir; baş / start kayması / ≥ 1 kare fark düzeltilmez.",
        ]
      );
    this.beforeLast = prev;
    this.prev = s;
    const tails = items.filter((i) => i.fit === "tail");
    if (tails.length) await this.fixTails(tails, isMeasure);
    else if (isMeasure) log(`✓ İlk overwrite (ölçüm) birebir: "${list[0].label}" aslıyla tick düzeyinde aynı; kalanlar aynı yolla.`, "ok");
  }

  /** SetOutPoint (klip başına tek action; End YOK) — ayrı transaction. Referanslar hemen öncesinde taze okunur. */
  private async setOuts(list: Item[], label: string): Promise<Snapshot> {
    const { ctx, executed } = this;
    await expectState(ctx, this.prev, this.beforeLast, executed);
    const s = await snapshot(ctx);
    const refs = list.map((i) => {
      const c = relocate(s, i.now);
      if (!c) throw new SpreadStop(`kuyruk düzeltme öncesi klip yeniden bulunamadı: ${fmtClip(i.now)}`);
      return { i, c };
    });
    log(`${label}: ${refs.length} klibe SetOutPoint (kuyruk, aslının out'una; klip başına tek action, End yok).`);
    await runTx(ctx, executed, label, `Spread: ${label}`, (ops) => {
      for (const { i, c } of refs) ops.setOut(c, ticks(i.p.clip.outPt));
    });
    await settle();
    const after = await snapshot(ctx);
    this.trail.note(after, executed.length);
    this.beforeLast = this.prev;
    this.prev = after;
    return after;
  }

  private async fixTails(tails: Item[], isMeasure: boolean): Promise<void> {
    const { plan, pending } = this;
    const pre = isMeasure ? "ilk " : "";
    const vidUnits = new Set(tails.filter((i) => i.p.clip.kind === "V").map((i) => i.u));
    // HER ZAMAN önce yalnız videolar (videosu düzeltilmeyen kameraların sesleri doğrudan); videosu düzeltilen kameraların sesleri
    // okunur: izlediyse action yok, izlemediyse AYRI transaction'da (video + ses SetOutPoint'i aynı transaction'da hiç ölçülmedi)
    const deferred = tails.filter((i) => i.p.clip.kind === "A" && vidUnits.has(i.u));
    const now1 = tails.filter((i) => !deferred.includes(i));
    progress(0.85, "Kuyruk farkı düzeltiliyor (SetOutPoint)…");
    const s1 = await this.setOuts(now1, `${pre}kuyruk düzeltme`);
    const touched = new Set(tails.map((i) => i.u));
    const deferredUnits = new Set(deferred.map((i) => i.u));
    const v1 = verifySpread(plan, s1, { pending, loose: deferredUnits });
    const probs = [...v1.problems];
    // ertelenen seslerin videosu artık birebir olmalı
    for (const u of deferredUnits)
      for (const p of this.placementsOf(u).filter((x) => x.clip.kind === "V")) {
        const n = v1.found.get(p);
        if (n && overwriteFit(p.clip, n, this.frame(u)) !== "exact") probs.push(`"${p.clip.name}" (${trackLabel("V", p.target)}) SetOutPoint sonrası aslıyla aynı değil: ${fmtDelta(edgeDelta(p.clip, n), this.frame(u))}`);
      }
    if (probs.length) throw new SpreadStop(`Kuyruk düzeltme (SetOutPoint) doğrulaması tutmadı. Durduruldu.`, probs);
    if (deferred.length) {
      const st = deferred.map((i) => {
        const n = v1.found.get(i.p)!;
        return overwriteFit(i.p.clip, n, this.frame(i.u)) === "exact" ? "followed" : sameEdges(i.now, n) ? "unchanged" : "other";
      });
      const known = this.follow;
      const all = (x: string) => st.every((y) => y === x);
      if (all("followed") && known !== false) this.follow = true;
      else if (all("unchanged") && known !== true) this.follow = false;
      else
        throw new SpreadStop(
          known !== null && (all("followed") || all("unchanged"))
            ? `Kuyruk düzeltme: ilk ölçümde bağlı ses videonun SetOutPoint'ini ${known ? "izlemişti, bu kez izlemedi" : "izlememişti, bu kez izledi"}. Durduruldu.`
            : "Kuyruk düzeltme: bağlı seslerin bir kısmı videonun SetOutPoint'ini izledi, bir kısmı izlemedi ya da başka türlü değişti. Durduruldu.",
          [
          ...deferred.map((i, k) => `${trackLabel("A", i.p.target)} "${i.p.clip.name}": ${st[k] === "followed" ? "izledi (aslıyla aynı)" : st[k] === "unchanged" ? "değişmedi" : `başka fark: ${fmtDelta(edgeDelta(i.p.clip, v1.found.get(i.p)!), this.frame(i.u))}`}`),
        ]);
      log(`   ölçüm: bağlı ses videonun SetOutPoint'ini ${this.follow ? "İZLİYOR (sese ayrıca action yok)" : "izlemiyor → sese ayrı transaction'da SetOutPoint"}.`, "dim");
      if (!this.follow) await this.setOuts(deferred, `${pre}kuyruk düzeltme (ses)`);
    }
    const vEnd = verifySpread(plan, this.prev, { pending });
    if (vEnd.problems.length) throw new SpreadStop(`Kuyruk düzeltme (SetOutPoint) doğrulaması tutmadı. Durduruldu.`, vEnd.problems);
    log(`✓ ${isMeasure ? "İlk overwrite (ölçüm): kuyruk" : "Kuyruk"} farkı SetOutPoint'le düzeltildi ve doğrulandı (${touched.size} kamera, aslıyla tick düzeyinde aynı).`, "ok");
  }
}

// ------------------------------------------------------------------ ana akış
export async function runSpread(): Promise<void> {
  const executed: string[] = [];
  let backupName: string | null = null;
  let ctx: SeqContext | null = null;
  const trail = new Trail(); // v1.2.1: ara hâller (kısmi Ctrl+Z tanınsın)
  log("▶ SPREAD", "head");
  try {
    ctx = await requireActive();
    log(`sequence: "${ctx.name}"`, "dim");
    const s0 = await snapshot(ctx, { media: true });
    // v1.2.1: kayıt ipucudur, kilit değil — tutmayan kayıt silinir; tutan kayıtta yalnız soru
    await reconcileAndLog(ctx.guid, s0);
    if (!(await confirmNotStopped(ctx, s0, "SPREAD"))) return log("İptal edildi — hiçbir şey değişmedi.", "warn");
    if (!(await confirmRedo(ctx.guid, s0, "spread"))) return;
    const tc: unknown = ppro.ProjectItem.TYPE_CLIP; // d.ts:L2788 ProjectItemStatic.TYPE_CLIP (Probe'da sınanmadı → yoksa kontrol atlanır)
    const seqFrame = await frameTicks(ctx);
    const plan = makePlan(s0, typeof tc === "number" ? tc : null, seqFrame);
    const opt = s0.clips.filter((c) => c.optErrors.length);
    if (opt.length) log(`not: ${opt.length} klipte isteğe bağlı bilgi okunamadı (ör. medya süresi) — engel değil. İlki: ${opt[0].optErrors[0]}`, "dim");
    printPlan(plan, s0);
    if (plan.errors.length) throw new SpreadStop(`Plan kurulamadı (${plan.errors.length} hata). Spread BAŞLAMADI, hiçbir şey değişmedi.`);
    if (!s0.clips.length) throw new SpreadStop("Sequence'ta klip yok.");
    const cut = plan.overwrite.filter((u) => u.trimmed === true);
    if (cut.length)
      throw new SpreadStop(`${cut.length} kamera klibi kırpılmış (in ≠ 0 ya da medya − out 0 ile 1 kare arasında değil). Spread BAŞLAMADI, hiçbir şey değişmedi.`, [
        ...cut.map(
          (u) =>
            `${where(u.video!)} in=${u.video!.inPt} out=${u.video!.outPt} medya=${u.video!.mediaDur ?? "?"}: ${u.trim!.why}` +
            `${u.trim!.diff !== null && !/medya − out/.test(u.trim!.why) ? ` (medya − out = ${fmtDiff(u.trim!.diff, u.trim!.frame)})` : ""}; ${frameText(u.trim!.frame)}`
        ),
        "Neden: kamera proje öğesinden overwrite ile TAM BOY yerleşir; eski 'kırpma eşitlemesi' adımı (set In/Out/Start/End tek " +
          "transaction'da) gerçek Premiere'de aynı kenarı İKİ KEZ kırpıyor (kanıtlandı) — v0.3.4'te bu adım kaldırıldı.",
        "Yapılacak: bu kameraların kırpmasını kaldır (klibi tam boy yap) ya da onları SPREAD'den ayrı tut.",
      ]);
    const moving = plan.overwrite.length + plan.clone.length;
    if (!moving) {
      log("✓ Zaten dağıtılmış: her klip kendi hedef track'inde. Yapılacak bir şey yok.", "ok");
      forgetStopped(ctx.guid);
      done("spread", "ok", "Zaten dağıtılmış; yapılacak bir şey yok.", "Sonra: Premiere'de Clip › Synchronize, ardından Topla.", true);
      return;
    }
    const newV = Math.max(0, plan.neededV - s0.vCount);
    const newA = Math.max(0, plan.neededA - s0.aCount);
    const unknown = plan.overwrite.filter((u) => u.trimmed === null).length;

    const ans = await askUser(
      `${plan.counts.camera} kamera${plan.counts.videoOnly ? ` + ${plan.counts.videoOnly} sadece-video` : ""}, ${plan.counts.audio} ses bulundu, ` +
        `${newV + newA} track açılacak (V ${newV}, A ${newA}). Önce yedek sequence oluşturulacak. ` +
        `Taşınacak: ${plan.overwrite.length} kamera (proje öğesinden yeniden, bağlı — kamera klibindeki efektler, ses kazancı/keyframe'ler ve klip adı taşınmaz), ` +
        `${plan.clone.length} ses/video (birebir kopya); ` +
        `yerinde kalan: ${plan.stay.length}.` +
        `${unknown ? ` ${unknown} kamerada medya süresi okunamadı → kırpılmışsa overwrite ölçümü DURDURUR (Ctrl+Z ile geri alınır).` : ""}` +
        `${plan.warnings.length ? ` ${plan.warnings.length} uyarı (günlükte).` : ""} Devam?`,
      [
        `${plan.counts.camera} kamera${plan.counts.videoOnly ? ` + ${plan.counts.videoOnly} sadece-video` : ""} ve ${plan.counts.audio} ses kendi track'ine dağıtılacak.`,
        `${newV + newA} yeni track açılacak (V ${newV}, A ${newA}); klip zamanları değişmez.`,
        ...(unknown ? [`DİKKAT: ${unknown} kamerada medya süresi okunamadı — kırpılmışsa işlem taşımadan sonra durur.`] : []),
        ...(plan.warnings.length ? [`${plan.warnings.length} uyarı (Sorun bildir raporunda).`] : []),
        `Önce yedek sequence alınır ("${ctx.name}" kopyası). Devam?`,
      ],
      { title: `${plan.placements.length} klip dağıtılsın mı?` }
    );
    if (ans !== "Evet") {
      log("İptal edildi — hiçbir şey değişmedi.", "warn");
      return;
    }

    // 1) yedek
    progress(0.1, "Yedek sequence alınıyor…");
    const backup = await makeBackup(ctx, "Spread");
    backupName = backup.name;
    const s1 = await snapshot(ctx);
    if (!multisetEqual(s0, s1)) throw new SpreadStop("Yedek alınırken asıl sequence'ın klipleri değişti. Durduruldu.");

    // 2) TX-A: track hazırlığı (kanıtlı yöntem: clone ofseti, hedef = mevcut track sayısı, sırayla)
    let helpers: ClipInfo[] = [];
    let expected: Snapshot = s1; // bir sonraki adımdan önce timeline'ın bu hâlde olması beklenir
    let beforeLast: Snapshot | null = null;
    if (newV || newA) {
      progress(0.3, `${newV + newA} track açılıyor…`);
      const r = await prepareTracks(ctx, s1, plan.neededV, plan.neededA, executed, "Spread: track hazırlığı");
      helpers = r.helpers;
      expected = r.after;
      beforeLast = s1;
      trail.note(r.after, executed.length);
    }

    // 3) TX-B "dağıt": clone + remove (tek transaction). Önce timeline beklenen hâlde mi; seçim + referanslar HEMEN öncesinde taze.
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
    const pending = new Set<Unit>(plan.overwrite);
    log(`TX-B: ${cloneSrc.length} clone → ${so.readCount} klip sil (ripple=false)${pending.size ? `; ardından ${pending.size} kamera overwrite (ilki tek başına, ölçüm)` : ""}.`);
    progress(0.5, `${plan.placements.length} klip kendi track'ine taşınıyor…`);
    await runTx(ctx, executed, "dağıt", "Spread: dağıt", (ops) => {
      for (const { p, src } of cloneSrc) {
        const off = p.target - src.track;
        ops.clone(src, ppro.TickTime.TIME_ZERO, src.kind === "V" ? off : 0, src.kind === "A" ? off : 0); // d.ts:L3929 TickTimeStatic.TIME_ZERO
      }
      ops.remove(so.sel);
    });
    await settle();
    let prev = await snapshot(ctx);
    trail.note(prev, executed.length);
    beforeLast = so.snap; // TX-B öncesi (seçim klipleri değiştirmez) — TX-B geri alınırsa sonraki adım bunu görür
    const vB = verifySpread(plan, prev, { pending });
    if (vB.problems.length) throw new SpreadStop("Taşıma doğrulaması tutmadı.", vB.problems);

    // 4) + 5) kameralar: ilki tek başına (ölçüm), sonra kalanlar; kuyrukta < 1 kare fark → ayrı transaction'da SetOutPoint
    if (plan.overwrite.length) {
      const first = plan.overwrite[0];
      const ow = new Overwriter(ctx, plan, backup.guid, seqFrame, executed, pending, trail);
      await ow.step([first], "ilk overwrite (ölçüm)", true, prev, beforeLast);
      if (plan.overwrite.length > 1) {
        progress(0.75, `${plan.overwrite.length - 1} kamera daha yerleştiriliyor…`);
        await ow.step(plan.overwrite.slice(1), "overwrite", false, ow.prev, ow.beforeLast);
      }
      prev = ow.prev;
    }
    const vF = verifySpread(plan, prev);
    if (vF.problems.length) throw new SpreadStop("Taşıma doğrulaması tutmadı.", vF.problems);

    log(
      `✓ SPREAD tamam: ${plan.placements.length} klip, ${plan.neededV} video + ${plan.neededA} ses track'ine dağıtıldı; ` +
        `her klibin start/end/in/out'u aslıyla tick düzeyinde aynı; her track'te 1 klip. (${executed.length} adım: ${executed.join(", ")})`,
      "ok"
    );

    // 4) seç + talimat
    try {
      const sel = await selectAll(ctx);
      log(`Tüm klipler programla seçildi (${sel.read}/${sel.requested}; timeline'da görünmeyebilir).`, "dim");
    } catch (e) {
      log(`Seçim yapılamadı: ${errText(e)} (önemli değil)`, "warn");
    }
    log("Şimdi Clip > Synchronize'ı dene. Menü gri ise timeline'a tıkla, Ctrl+A, sağ tık > Synchronize (Audio).", "head");
    done(
      "spread",
      "ok",
      `${plan.placements.length} klip kendi track'ine dağıtıldı.`,
      "Sonra: Premiere'de Clip › Synchronize (menü gri ise timeline'a tıkla, Ctrl+A), ardından Topla. " +
        `Beğenmezsen Ctrl+Z × ${executed.length} (hepsini birden) ya da yedek sequence "${backupName}".`
    );
    // kısmi Ctrl+Z (ör. 3 adımdan 1'i) tanınsın: ara hâller işarette (records.ts → reconcile)
    setStepMids(ctx.guid, "spread", trail.between(executed.length), backupName);
    log(`Beğenmezsen: timeline'a tıkla, Ctrl+Z'ye ${executed.length} kez bas — ya da yedek sequence "${backupName}"i kullan.`, "dim");
    forgetStopped(ctx.guid);
  } catch (e) {
    // v1.2.1: SPREAD de yarım iş kaydı bırakır (bir sonraki işlem bu hâli görürse SORAR; geri alınınca kayıt kendiliğinden silinir)
    if (executed.length && ctx) await rememberStopped(ctx, "SPREAD", { backup: backupName, mids: trail.mids });
    reportStop("SPREAD", e, executed, backupName);
  }
}
