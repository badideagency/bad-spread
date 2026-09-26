// TOPLA — senkrondan SONRA: oturumları (sessions.ts) bulur, kronolojik sırayla sequence başından dizer (YATAY: blok başına tek
// ofset, blok içi tick-exact) ve klipleri cihaz / kaynak track'lerine koyar (DİKEY). Sahipsizler park track'lerine (zaman aynı).
// Güvenlik: guard.ts (onay → yedek → her transaction sonrası tick düzeyinde doğrulama → tutmazsa DUR + Ctrl+Z + yedek adı).
//
// Transaction'lar: [yedek] → [TX-0 çift kopyaları sil] → [TX-A track hazırlığı] → TX-1 ilk oturum park (ÖLÇÜM) → TX-2 kalan park →
// TX-3 ilk oturum yerleştir (ÖLÇÜM) → TX-4 kalan yerleştir.
// v0.3.4 — ÇİFT KOPYA (aynı kaynak + aynı start/end/in/out; aynı kaynağın farklı konumdaki kopyası çift DEĞİL) TOPLA'yı durdurmaz: en
// küçük numaralı track'teki kalır, ötekiler ilk adımda (TX-0, ripple=false) silinir; bütün plan çiftsiz düzen üzerinden kurulur. Sıfırdan farklı timeOffset'li clone gerçek Premiere'de tick düzeyinde ölçülmedi → ilk oturum
// tek başına taşınır; tutmazsa "İLK TAŞIMA TUTMADI".

import { selectExactly } from "./edit";
import { classify, sourcesOf, where } from "./classify";
import {
  bindState,
  clipKey,
  describeFrame,
  expectCollect,
  frameToRecord,
  layoutOf,
  layoutState,
  makeCollectPlan,
  makeFrame,
  parkedExp,
  parkedFromRecord,
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
import { compareLayout, expOf, findExp, snapshotOverlaps } from "./layout";
import { fmtClip, relocate, secOf, settle, snapshot, ticks, trackLabel, TICKS_PER_SECOND, type ClipInfo, type Snapshot } from "./model";
import { analyze, describeLinks, duplicateSets, partlyParked, suspiciousMembers, type Analysis, type DuplicateSet, type Recording } from "./sessions";
import { requireActive, type SeqContext } from "./session";
import { getGapSec, getThreshold, loadRecord, mappingFor, saveMapping, saveRecord, type CollectRecord } from "./settings";
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

function confirmText(plan: CollectPlan, a: Analysis, newV: number, newA: number, extra: string[]): string {
  const L: string[] = [];
  L.push(`TOPLA — ${plan.layouts.length} oturum, sırayla sequence başından (aralarında ${secOf(BigInt(Math.round(getGapSec() * 1000)) * (TICKS_PER_SECOND / 1000n))} sn):`);
  for (const l of plan.layouts)
    L.push(`  ${l.session.id}  ${l.session.label}  → ${secOf(l.newStart)} s'den başlar (kayma ${l.delta >= 0n ? "+" : ""}${secOf(l.delta)} sn)`);
  if (plan.parkedRecs.length) L.push(`Park track'lerine (zamanı değişmeden, silinmez): ${recList(plan.parkedRecs)}`);
  for (const v of a.vetoDecisions) L.push(v);
  L.push(...extra);
  L.push(`Track'ler: ${describeFrame(plan.frame)}.`);
  L.push(
    `${plan.moves.length} klip taşınacak (yatay ${plan.horizontalMoves}, dikey ${plan.verticalMoves}); oturum içi konumlar tick düzeyinde korunur. ` +
      `İlk oturum önce TEK BAŞINA taşınıp ölçülür.${newV + newA ? ` ${newV + newA} track açılacak (V ${newV}, A ${newA}).` : ""}`
  );
  L.push("Taşınan kamera videoları kılavuz seslerinden ayrı düşer (BAĞLA yeniden bağlar). Önce yedek sequence oluşturulacak. Devam?");
  return L.join("\n");
}

/** Onay penceresindeki çift kopya satırı. */
function dupText(dups: DuplicateSet[]): string {
  return (
    `ÇİFT KOPYA — ilk adımda silinecek (ripple=false; aynı kaynak + aynı start/end/in/out, en küçük numaralı track'teki kalır): ` +
    dups.map((d) => `${d.drop.map((c) => trackLabel(c.kind, c.track)).join("+")} "${d.keep.name}" (${trackLabel(d.keep.kind, d.keep.track)} kalır)`).join("; ")
  );
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
    const sAll = await snapshot(ctx);
    assertNotStopped(ctx, sAll, "TOPLA");
    for (const w of sAll.warnings) throw new SpreadStop(`Okuma sorunu: ${w}. TOPLA BAŞLAMADI.`);
    // çift kopyalar: fazlalar ilk adımda silinecek → bütün analiz ve plan çiftsiz düzen (s0) üzerinden
    const dups = duplicateSets(classify(sAll));
    const drop = dups.flatMap((d) => d.drop);
    const dropSet = new Set(drop);
    const s0: Snapshot = drop.length ? { ...sAll, clips: sAll.clips.filter((c) => !dropSet.has(c)) } : sAll;
    for (const d of dups)
      log(`ÇİFT KOPYA: ${d.line} → ${d.drop.map((c) => trackLabel(c.kind, c.track)).join(", ")} silinecek (ilk adım), ${trackLabel(d.keep.kind, d.keep.track)} kalır`, "warn");
    const items = classify(s0);
    const mapping = mappingFor(sourcesOf(items));
    const frame = makeFrame(items, mapping);
    // önceki TOPLA'nın park ettikleri (kayıttan; track sırasından tahmin YOK) → analize girmez, yerinde kalır
    const rec = loadRecord(ctx.guid);
    // BAĞLA kesimi yapılmışsa harici sesler çapalara bölünmüştür → senkron kanıtı (tam kayıtlar) yok, oturumlar güvenle yeniden
    // bulunamaz → TAHMİN YOK, başlamaz. Kesimsiz BAĞLA (yalnız silme/bağlama) sonrası TOPLA çalışır ama taşınanların bağı çözülür.
    const bs = bindState(rec, s0);
    if (bs === "partial" || (bs === "applied" && rec!.bind!.created.length))
      throw new SpreadStop(
        bs === "partial"
          ? "BAĞLA'dan sonra düzen değişmiş (kesilen parçaların bir kısmı yerinde, bir kısmı değil). TOPLA BAŞLAMADI, hiçbir şey değişmedi. " +
              "BAĞLA öncesi yedek sequence'la çalış ya da BAĞLA'yı Ctrl+Z ile tamamen geri al."
          : "Bu sequence BAĞLA'dan geçti: sesler kesildi (harici sesler çapalara, kamera sesleri harici sessiz aralıklara), oturumları bulduran tam kayıtlar artık yok → oturumlar güvenle " +
              "yeniden bulunamaz (tahmin edilmez). TOPLA BAŞLAMADI, hiçbir şey değişmedi. Yeniden toplamak için BAĞLA öncesi yedek sequence'ı kullan " +
              "(ya da BAĞLA'yı Ctrl+Z ile tamamen geri al)."
      );
    // park kaydı YALNIZ TOPLA'nın bıraktığı düzen duruyorsa geçerli: TOPLA tamamen geri alınmışsa bırakılır (her şey senkron
    // sonucundan yeniden), düzen el ile değişmişse sorulur
    const keep = parkedFromRecord(items, rec);
    if (keep.size) {
      const ls = layoutState(rec!, s0);
      if (ls === "undone") {
        log(`   son TOPLA geri alınmış (timeline TOPLA öncesi hâlinde) → park kaydı (${keep.size} klip) kullanılmıyor; her şey senkron sonucundan`, "warn");
        keep.clear();
      } else if (ls === "changed") {
        const list = [...keep].slice(0, 8).map((c) => `  • ${where(c)} [${secOf(c.start)}s–${secOf(c.end)}s]`);
        const ans = await askUser(
          `PARK KAYDI — düzen son TOPLA'dan sonra değişmiş (TOPLA'nın bıraktığı yerlerin bir kısmı yok). Son TOPLA şu ${keep.size} klibi park etmişti:\n` +
            `${list.join("\n")}${keep.size > 8 ? `\n  … ${keep.size - 8} klip daha` : ""}\n` +
            "Park'ta kalsınlar mı (oturumlara karışmaz, analiz edilmez; zamanları değişmez)?\n" +
            "(Evet = kalsın. Hayır = hiçbir şey değişmez. Park kaydını bırakıp her şeyi senkron sonucundan yeniden bulmak için son TOPLA'yı " +
            "Ctrl+Z ile tamamen geri al — panel bunu tanır.)"
        );
        if (ans !== "Evet") {
          log("İptal edildi — hiçbir şey değişmedi.", "warn");
          return;
        }
      }
    }
    const exclude = new Set(keep);
    let a = analyze(s0, items, { threshold: getThreshold(), exclude });
    log(`Okundu: V ${s0.vCount}, A ${s0.aCount}, ${s0.clips.length} klip; ${a.recordings.length} kayıt, ${a.links.length} güçlü bağ (eşik %${Math.round(getThreshold() * 100)}).`, "dim");
    if (keep.size) log(`   önceki TOPLA'dan park'ta ${keep.size} klip (kayıttan) — analize girmez, zamanı değişmez`, "dim");
    for (const l of describeLinks(a, 60)) log(`   bağ: ${l}`, "dim");
    printAnalysis(a);
    if (a.errors.length) throw new SpreadStop("Senkron sonucunda tutarsızlık var — TOPLA BAŞLAMADI, hiçbir şey değişmedi.", a.errors);
    const readErr = s0.clips.flatMap((c) => c.readErrors.map((e) => `${where(c)} — ${e}`));
    if (readErr.length) throw new SpreadStop("Bazı klipler okunamadı. TOPLA BAŞLAMADI.", readErr);

    // bölünmüş kayıt: park kaydındaki bir klibin kaydı (aynı cihaz + kayıt) bir oturumda → parçalar birbirinden kayardı → sor
    const split = partlyParked(a, items, exclude);
    if (split.length) {
      const ans = await askUser(
        "AYNI KAYIT BÖLÜNMÜŞ — bir kaydın bir kısmı park'ta (önceki TOPLA), bir kısmı bir oturumda:\n" +
          `${split.map((x) => `  • ${x.rec.label}: park'ta ${x.parked.map(where).join(", ")} ↔ ${x.session.id} oturumunda`).join("\n")}\n` +
          "Oturum taşınırken park'taki parça yerinde kalırsa aynı kaydın parçaları birbirinden kayar. Park'taki parçalar kaydıyla birlikte " +
          "oturuma alınsın mı? (Evet = park kaydından çıkar, oturumla aynı ofsetle taşınır; senkron tutarlılığı yine denetlenir. Hayır = hiçbir şey değişmez.)"
      );
      if (ans !== "Evet") {
        log("İptal edildi — hiçbir şey değişmedi.", "warn");
        return;
      }
      for (const x of split)
        for (const c of x.parked) {
          exclude.delete(c);
          keep.delete(c);
        }
      a = analyze(s0, items, { threshold: getThreshold(), exclude });
      printAnalysis(a);
      if (a.errors.length) throw new SpreadStop("Senkron sonucunda tutarsızlık var — TOPLA BAŞLAMADI, hiçbir şey değişmedi.", a.errors);
    }

    // şüpheli üyeler (yalnız çok uzun bir kaydın içine düşmüş kısa klipler) → kullanıcı karar verir
    const kept = new Set<Recording["id"]>();
    for (let round = 0; round < 5; round++) {
      const sus = suspiciousMembers(a).filter((x) => !kept.has(x.rec.id));
      if (!sus.length) break;
      const ans = await askUser(
        `ŞÜPHELİ ÜYE — güçlü bağın tek kanıtı, kısa bir klibin çok uzun bir kaydın içine düşmesi (oran kısa olana göre ölçüldüğü için %100):\n` +
          `${sus.map((x) => "  • " + x.line).join("\n")}\n` +
          "Senkron bu klibi eşleyemeyip rastgele bırakmış olabilir. Bunları oturumlarından çıkarıp park track'lerine (ZAMANI DEĞİŞMEDEN) koyayım mı?\n" +
          "(Evet = park'a; Hayır = oturumda kalsın, BAĞLA onlara da ses keser)"
      );
      if (ans === "Evet") {
        for (const x of sus) for (const c of x.rec.clips) exclude.add(c);
        a = analyze(s0, items, { threshold: getThreshold(), exclude });
        printAnalysis(a);
      } else for (const x of sus) kept.add(x.rec.id);
    }
    const userParked = [...exclude].filter((c) => !keep.has(c));

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
          `Onaylarsan KULLANILACAK sıra${a.orderIssue.kind === "ambiguous" ? " (bilinen bütün kısıtlara uyar; belirsiz yerde senkronun bıraktığı sıra)" : " (senkronun bıraktığı, timeline'daki sıra)"}:\n` +
          `${a.sessions.map((x) => `  ${x.id}  ${x.label}`).join("\n")}\nBu sırayla dizilsin mi? (Hayır → hiçbir şey değişmez)`
      );
      if (ans !== "Evet") {
        log("İptal edildi — hiçbir şey değişmedi.", "warn");
        return;
      }
    }

    const fr = await frameTicks(ctx);
    const gap = ceilTo(BigInt(Math.round(getGapSec() * 1000)) * (TICKS_PER_SECOND / 1000n), fr);
    // kullanıcının park'a gönderdiği şüpheli üyeler analizden çıkarıldı → kaydı olmayan klip olarak plan onları park track'lerine koyar
    const plan = makeCollectPlan(s0, items, a, frame, { gap, frameTicks: fr, parkedRecs, keepInPlace: keep });
    const record = (bind: CollectRecord["bind"]): CollectRecord => ({
      v: 1,
      guid: ctx!.guid,
      frame: frameToRecord(frame),
      mapping: [...mapping],
      thresholdPct: Math.round(getThreshold() * 100),
      // park'takiler: önceki kayıttakiler + bu TOPLA'da oturumsuz kalan (bilinmeyen olmayan) her klip — zamanları değişmez
      parked: [...new Set(plan.placements.filter((p) => p.session === null && p.x.role !== "unknown").map((p) => clipKey(p.x.clip)))],
      bind,
      layout: layoutOf(plan),
      at: new Date().toISOString(),
    });
    if (!fr) log("not: sequence kare süresi okunamadı → ofsetler kareye hizalanmadı.", "warn");
    for (const e of plan.errors) log(`HATA: ${e}`, "err");
    for (const c of plan.conflicts) log(`ÇAKIŞMA: ${c}`, "err");
    if (plan.errors.length) throw new SpreadStop(`Plan kurulamadı (${plan.errors.length} hata). TOPLA BAŞLAMADI, hiçbir şey değişmedi.`);
    if (plan.conflicts.length)
      throw new SpreadStop(`Yeni düzende ${plan.conflicts.length} çakışma var — TOPLA BAŞLAMADI, hiçbir şey değişmedi.`, plan.conflicts);
    if (!plan.moves.length && !drop.length) {
      // hiçbir şey taşınmadı → kayıt bugünkü ayarla yenilenir (kesimsiz BAĞLA'nın kaydı durur)
      saveRecord(record(bs === "applied" ? rec!.bind : null));
      saveMapping(mapping);
      log("✓ Zaten toplanmış: oturumlar sırayla, klipler cihaz / kaynak track'lerinde. Yapılacak bir şey yok.", "ok");
      log(CHECK_MSG, "head");
      return;
    }
    const newV = Math.max(0, plan.neededV - s0.vCount);
    const newA = Math.max(0, plan.neededA - s0.aCount);
    const extra: string[] = dups.length ? [dupText(dups)] : [];
    const unknown = items.filter((x) => x.role === "unknown");
    if (unknown.length) extra.push(`Dokunulmayan öğeler (yerinde kalır): ${unknown.map((x) => where(x.clip)).join(", ")}`);
    if (keep.size) extra.push(`Önceki TOPLA'dan park'ta: ${keep.size} klip (oturumlara karışmaz; zamanı değişmez, çerçeve büyüdüyse park track'i değişir).`);
    if (userParked.length) extra.push(`Senin kararınla park'a: ${userParked.length} klip (şüpheli üye).`);
    if (bs === "applied") extra.push("DİKKAT: bu sequence BAĞLA'dan geçti (kesimsiz) — taşınan kliplerin bağları çözülür (clone); TOPLA'dan sonra BAĞLA'ya tekrar bas.");
    const ans = await askUser(
      plan.moves.length
        ? confirmText(plan, a, newV, newA, extra)
        : `TOPLA — düzen zaten toplanmış (oturumlar sırayla, klipler cihaz / kaynak track'lerinde); yalnız çift kopyalar silinecek.\n${dupText(dups)}\n` +
            "Önce yedek sequence oluşturulacak. Devam?"
    );
    if (ans !== "Evet") {
      log("İptal edildi — hiçbir şey değişmedi.", "warn");
      return;
    }

    const backup = await makeBackup(ctx, "TOPLA");
    backupName = backup.name;
    const s1 = await snapshot(ctx);
    if (!multisetEqual(sAll, s1)) throw new SpreadStop("Yedek alınırken asıl sequence'ın klipleri değişti. Durduruldu.");

    let helpers: ClipInfo[] = [];
    let prev: Snapshot = s1;
    let beforeLast: Snapshot | null = null;
    // TX-0: çift kopyaların fazlaları (ripple=false) — kalan her şey tick düzeyinde yerinde olmalı
    if (drop.length) {
      const so = await select(ctx, drop, "Çift kopyalar");
      log(`TX-0 (çift kopyaları sil): ${so.readCount} klip siliniyor (ripple=false) — her çiftin en küçük numaralı track'teki kopyası kalır.`);
      await runTx(ctx, executed, "çift kopyaları sil", "TOPLA: çift kopyaları sil", (ops) => {
        ops.remove(so.sel);
      });
      await settle();
      const s = await snapshot(ctx);
      const probs = compareLayout(s0.clips.map((c) => expOf(c)), s);
      if (probs.length) throw new SpreadStop("Çift kopya silme doğrulaması tutmadı (yalnız fazla kopyalar silinmeliydi).", probs);
      log(`✓ TX-0 doğrulandı: ${drop.length} fazla kopya silindi, kalan ${s.clips.length} klip tick düzeyinde yerinde.`, "ok");
      beforeLast = prev;
      prev = s;
    }
    if (!plan.moves.length) {
      forgetStopped();
      saveRecord(record(bs === "applied" ? rec!.bind : null));
      saveMapping(mapping);
      log(`✓ TOPLA tamam: ${drop.length} çift kopya silindi; düzen zaten toplanmıştı. (${executed.length} adım: ${executed.join(", ")})`, "ok");
      log(CHECK_MSG, "head");
      log(`Beğenmezsen: timeline'a tıkla, Ctrl+Z'ye ${executed.length} kez bas — ya da yedek sequence "${backupName}"i kullan.`, "dim");
      return;
    }
    if (newV || newA) {
      if (drop.length) await expectState(ctx, prev, beforeLast, executed);
      const r = await prepareTracks(ctx, prev, plan.neededV, plan.neededA, executed, "TOPLA: track hazırlığı");
      helpers = r.helpers;
      beforeLast = prev;
      prev = r.after;
    }
    // park yeri: hem bugünkü düzenin hem YENİ düzenin sonunun ötesi (yerleştirme park kopyalarına değmesin), kare hizalı
    const pb = await parkBase(ctx, prev);
    const P = pb > ceilTo(plan.layoutEnd + PARK_GAP, fr) ? pb : ceilTo(plan.layoutEnd + PARK_GAP, fr);
    // ölçüm: ilk oturumun taşınanları; ilk oturum hiç taşınmıyorsa ilk taşınanın bütün kaydı (kamera videosu + kılavuzları birlikte;
    // analize girmeyen park'takilerde aynı kamera klibinin videosu + kılavuzları = aynı kaynak + aynı start/end)
    const m0 = plan.moves[0].x.clip;
    const rec0 = a.recordingOf.get(m0);
    const measure = plan.firstMoves.length
      ? plan.firstMoves
      : rec0
        ? plan.moves.filter((p) => a.recordingOf.get(p.x.clip) === rec0)
        : plan.moves.filter((p) => p.x.clip.projId === m0.projId && p.x.clip.start === m0.start && p.x.clip.end === m0.end);
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
    saveRecord(record(null));
    saveMapping(mapping);
    log(CHECK_MSG, "head");
    log(`Beğenmezsen: timeline'a tıkla, Ctrl+Z'ye ${executed.length} kez bas — ya da yedek sequence "${backupName}"i kullan.`, "dim");
  } catch (e) {
    if (executed.length && ctx) await rememberStopped(ctx, "TOPLA");
    reportStop("TOPLA", e, executed, backupName);
  }
}
