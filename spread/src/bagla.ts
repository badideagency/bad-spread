// BAĞLA — TOPLA + gözle kontrolden SONRA, OTURUM İÇİNDE: gruplar → çapalar → harici sesleri KENDİ oturumunun çapasına göre kes →
// kılavuz sesleri (grubunda harici ses varsa) ve "sil" kaynaklarını sil → her grubu yardımcı (CEP / ExtendScript linkSelection) ile bağla.
// Oturumlar TOPLA ile aynı modülden (sessions.ts); track çerçevesi, eşik, eşleme ve park listesi TOPLA KAYDINDAN (settings.ts) —
// track sırasından tahmin yok. Kayıt yoksa ya da eşleme/eşik TOPLA'dan sonra değiştiyse BAŞLAMAZ ("önce TOPLA").
// Kesme/silme doğrulanınca bağlama grupları kayda yazılır; yeniden basınca (ör. yardımcı düştüyse) YALNIZ bağlama yapılır — kesilmiş
// düzen yeniden analiz edilmez (harici sesler çapalara bölündüğü için senkron kanıtı artık yok).
// Plan: bind.ts (saf). Bağlama: linker.ts (TEK modül). Güvenlik: guard.ts (onay → yedek → her transaction sonrası tick düzeyinde
// doğrulama → tutmazsa DUR + Ctrl+Z sayısı + yedeğin adı; kendi başına düzeltme yok).
// Yarım iş bırakmamak için sıra: ÖNCE yardımcıya ping (yoksa HİÇBİR ŞEYE dokunmadan dur), sonra kesme ve silme, EN SON bağlama.
//
// Transaction'lar (yalnız gerekenler): [yedek] → TX-1 kesim hazırlığı (park kopyaları + silme) → TX-2 ilk parça (ÖLÇÜM) →
// TX-3 parçalar → TX-4 yerleştir → bağlama (yardımcı).

import { selectExactly } from "./edit";
import {
  expectBindFinal,
  expectParked,
  firstSlot,
  linkTargets,
  makeBindPlan,
  makeSlots,
  trimmedAtSlot,
  verifyBindContent,
  type BindPlan,
  type Slot,
} from "./bind";
import { classify, sourcesOf, where } from "./classify";
import {
  askUser,
  assertNotStopped,
  expectState,
  forgetStopped,
  frameTicks,
  makeBackup,
  multisetEqual,
  parkBase,
  rememberStopped,
  reportStop,
  runTx,
  SpreadStop,
} from "./guard";
import { bindState, frameFromRecord, itemKey, itemOf, layoutState, misplacedAgainst, parkedFromRecord } from "./collect";
import { analyze, partlyParked } from "./sessions";
import { compareLayout, expOf, findExp, snapshotOverlaps } from "./layout";
import { getLinker, type LinkGroupResult } from "./linker";
import { big, fmtClip, relocate, secOf, settle, sleep, snapshot, ticks, trackLabel, type ClipInfo, type Snapshot } from "./model";
import { assertSameSequence, requireActive, type SeqContext } from "./session";
import { getThreshold, loadRecord, mappingFor, recordDrift, saveBindRecord, type BindRecord, type CollectRecord, type LinkItemRec } from "./settings";
import { log, setHelperStatus } from "./ui";
import type { TxOps } from "./edit";

const LINK_UNDO_NOTE =
  "Not: bağlama adımı (yardımcı) Premiere'in geri alma geçmişine ayrıca kayıt ekleyebilir (ölçülmedi); en güvenli dönüş yedek sequence'tır.";

function printBindPlan(plan: BindPlan, s: Snapshot): void {
  log(`Okundu: V track ${s.vCount}, A track ${s.aCount}, ${s.clips.length} klip.`, "dim");
  for (const g of plan.groups) {
    const ps = plan.pieces.filter((p) => p.group === g);
    log(
      `  ${g.id}: ${g.cams.length} kamera [${secOf(g.start)}s–${secOf(g.end)}s], çapa ${trackLabel("V", g.anchor.track)} "${g.anchor.name}" ` +
        `[${secOf(g.anchor.start)}s–${secOf(g.anchor.end)}s] → ${ps.length} ses parçası`,
      "dim"
    );
    for (const p of ps)
      log(
        `     ${p.source.padEnd(10)} ${trackLabel("A", p.src.track)} "${p.src.name}" → [${secOf(p.start)}s–${secOf(p.end)}s] in=${secOf(p.inPt)}s` +
          (p.whole ? " (olduğu gibi kalır)" : " (kesilecek)"),
        "dim"
      );
  }
  for (const c of plan.deleteOutside) log(`  sil (hiçbir çapaya düşmüyor): ${where(c)}`, "dim");
  if (plan.deleteSil.length) log(`  sil (kaynak eşlemede "sil"): ${plan.deleteSil.map(where).join(", ")}`, "dim");
  for (const [g, gg] of plan.keptGuides) if (gg.length) log(`  ${g.id}: kamera sesi korunur (${gg.map(where).join(", ")})`, "dim");
  for (const x of plan.camless) log(`  ${x.id}: kamerasız oturum — sesleri olduğu gibi kalır`, "dim");
  if (plan.deleteGuides.length) log(`  sil: ${plan.deleteGuides.length} kamera kılavuz sesi`, "dim");
  for (const w of plan.warnings) log(`uyarı: ${w}`, "warn");
  for (const w of plan.silent) log(`SESSİZ KALACAK: ${w}`, "warn");
  for (const e of plan.errors) log(`HATA: ${e}`, "err");
}

function trim(ops: TxOps, c: ClipInfo, sl: Slot): void {
  const t = trimmedAtSlot(sl);
  // Sıra End → Start → In → Out (bkz. bind.ts): "kenar kırpma" ve "start taşır" anlamlarında aynı sonuç
  ops.setEnd(c, ticks(t.end));
  ops.setStart(c, ticks(t.start));
  ops.setIn(c, ticks(t.inPt));
  ops.setOut(c, ticks(t.outPt));
}

/** Park kopyasını (tam boy ya da kırpılmış) okunan düzende bulur. */
function parkedClip(snap: Snapshot, sl: Slot, trimmed: boolean, taken: Set<ClipInfo>): ClipInfo {
  const src = sl.piece.src;
  const e = trimmed ? expOf(src, trimmedAtSlot(sl)) : expOf(src, { start: sl.q, end: sl.q + (big(src.end) - big(src.start)) });
  const c = findExp(snap, e, taken);
  if (!c) throw new SpreadStop(`park kopyası bulunamadı: ${trackLabel("A", src.track)} "${src.name}" yuva ${secOf(sl.q)}s`);
  taken.add(c);
  return c;
}

async function trimTx(
  ctx: SeqContext,
  executed: string[],
  label: string,
  s0: Snapshot,
  plan: BindPlan,
  slots: Slot[],
  doneBefore: Set<Slot>,
  now: Slot[]
): Promise<Snapshot> {
  const sPre = await snapshot(ctx);
  const taken = new Set<ClipInfo>();
  const work = now.map((sl) => ({ sl, c: parkedClip(sPre, sl, false, taken) }));
  await runTx(ctx, executed, label, `BAĞLA: ${label}`, (ops) => {
    for (const { sl, c } of work) trim(ops, c, sl);
  });
  await settle();
  const s = await snapshot(ctx);
  const done = new Set([...doneBefore, ...now]);
  const probs = compareLayout(expectParked(s0, plan, slots, done), s);
  if (probs.length) {
    const first = label === "ilk parça";
    throw new SpreadStop(
      first
        ? "İLK PARÇA TUTMADI: set End/Start/In/Out Premiere'de beklenen kırpmayı yapmadı (UXP'de kırpma ilk kez ölçüldü). " +
            "Kalan parçalar kesilmedi. Yedek plan (CEP yardımcısında QE razor) handoff.md'de — bu raporu getir."
        : `"${label}" doğrulaması tutmadı.`,
      probs
    );
  }
  log(`✓ ${label}: ${now.length} parça tick düzeyinde doğru kırpıldı.`, "ok");
  return s;
}

/** Yardımcıya birkaç kez sor (ağır transaction'lardan hemen sonra ilk yanıt gecikebilir). */
async function pingRetry(tries: number): Promise<Awaited<ReturnType<ReturnType<typeof getLinker>["ping"]>>> {
  const linker = getLinker();
  let r = await linker.ping();
  for (let i = 1; i < tries && !r.ok; i++) {
    await sleep(1000);
    r = await linker.ping();
  }
  return r;
}

type LinkSpec = { id: string; label: string; items: LinkItemRec[] };

/**
 * Bağlama — en son; önce tekrar ping (ağır transaction'lardan sonra gecikebilir → birkaç deneme). Klip zamanları bağlamada değişmemeli.
 * @returns doğrulanamayan grupların satırları (boşsa hepsi getLinkedItems ile doğrulandı)
 */
async function linkGroups(ctx: SeqContext, groups: LinkSpec[], sF: Snapshot, edits: boolean): Promise<string[]> {
  const linker = getLinker();
  const ping2 = await pingRetry(3);
  setHelperStatus(ping2.ok, ping2.detail);
  const again = "Yardımcıyı düzelt ve BAĞLA'ya tekrar bas: kesilecek bir şey kalmadığı için yalnız bağlama yapılır.";
  if (!ping2.ok)
    throw new SpreadStop(
      `${edits ? "Kesme/silme BİTTİ ve doğrulandı ama y" : "Y"}ardımcı artık yanıt vermiyor (${ping2.detail}) — bağlama yapılmadı. ${again}`,
      linker.installHint()
    );
  await assertSameSequence(ctx);
  log(`Bağlama: ${groups.length} grup yardımcıya gönderiliyor (${linker.name}).`);
  let out: Awaited<ReturnType<typeof linker.link>>;
  try {
    out = await linker.link(ctx.name, groups.map((t) => ({ id: t.id, items: t.items })));
  } catch (e) {
    throw new SpreadStop(`${edits ? "Kesme/silme doğrulandı ve yerinde; " : ""}bağlama isteği başarısız: ${e instanceof Error ? e.message : String(e)}. ${again}`);
  }
  await settle();
  const sAfter = await snapshot(ctx);
  if (!multisetEqual(sF, sAfter)) throw new SpreadStop("Bağlama sırasında klipler değişti (beklenmiyordu).", compareLayout(sF.clips.map((c) => expOf(c)), sAfter));
  const byId = new Map<string, LinkGroupResult>(out.results.map((r) => [r.id, r]));
  const bad: string[] = [];
  const unverified: string[] = [];
  for (const t of groups) {
    const r = byId.get(t.id);
    if (!r) bad.push(`${t.label}: yardımcıdan sonuç gelmedi${out.detail ? ` (${out.detail})` : ""}`);
    else if (r.found !== r.total) bad.push(`${t.label}: ${r.total} öğeden ${r.found} bulundu (eksik: ${r.missing.join(", ")}) — bağlanmadı`);
    else if (!r.linked) bad.push(`${t.label}: linkSelection başarısız — ${r.detail}`);
    else if (r.verified === false) bad.push(`${t.label}: bağ doğrulanamadı — ${r.detail}`);
    else if (r.verified === null) unverified.push(`${t.label}: ${r.detail}`);
    else log(`   ✓ ${t.label}: bulundu ${r.found}/${r.total}, bağlandı, doğrulandı`, "dim");
  }
  if (bad.length) throw new SpreadStop(`${bad.length}/${groups.length} grup bağlanamadı${edits ? " (kesme/silme doğru ve yerinde)" : ""}. ${again}`, bad);
  return unverified;
}

function reportLinked(n: number, unverified: string[], executed: string[]): void {
  if (unverified.length) {
    // linkSelection "true" dedi ama bağ okunarak DOĞRULANAMADI → "tamam" denmez (uydurma yok)
    log(`⚠ BAĞLA bitti ama ${unverified.length}/${n} grubun bağı DOĞRULANAMADI (Premiere "bağlandı" dedi; okuyarak teyit edilemedi):`, "warn");
    for (const u of unverified) log(`   • ${u}`, "warn");
    log("Kontrol et: timeline'da bir kamera klibine tıkla — grubun kameraları ve ses parçaları birlikte seçilmeli (Linked Selection açık).", "head");
  } else
    log(
      `✓ BAĞLA tamam: ${n} grup bağlandı ve getLinkedItems ile doğrulandı; klip zamanları bağlamada değişmedi.` +
        `${executed.length ? ` (${executed.length} adım: ${executed.join(", ")})` : ""}`,
      "ok"
    );
}

/** Kesme/silme önceden yapılıp doğrulanmış (kayıtta) ve bütün öğeler yerinde → YALNIZ bağlama. Düzenleme yok, yedek yok. */
async function linkOnly(ctx: SeqContext, rec: CollectRecord, bind: BindRecord, s0: Snapshot): Promise<void> {
  const count = new Map<string, number>();
  for (const c of s0.clips) count.set(itemKey(itemOf(c)), (count.get(itemKey(itemOf(c))) ?? 0) + 1);
  const dup = bind.groups.flatMap((g) => g.items).filter((i) => (count.get(itemKey(i)) ?? 0) > 1);
  if (dup.length)
    throw new SpreadStop(
      "Bağlanacak öğelerden bazıları timeline'da birden çok kez var (aynı ad/track/start/end) — hangisinin bağlanacağı belli değil, BAĞLA BAŞLAMADI.",
      dup.map((i) => `${trackLabel(i.kind, i.track)} "${i.name}" [${secOf(i.start)}s–${secOf(i.end)}s]`)
    );
  log(`Kayıt: kesme/silme ${bind.at} tarihinde yapıldı ve doğrulandı; ${bind.groups.length} grubun bütün öğeleri yerinde.`, "dim");
  for (const g of bind.groups) log(`  ${g.label}`, "dim");
  const ans = await askUser(
    `BAĞLA: kesme/silme daha önce yapıldı ve doğrulandı (TOPLA kaydı ${rec.at}); ${bind.groups.length} grubun bütün öğeleri yerinde. ` +
      "Kesilmiş düzen yeniden analiz edilmez — kayıttaki gruplar kullanılır. Kesme/silme yok → yalnız bağlama (yedek alınmaz). Devam?"
  );
  if (ans !== "Evet") {
    log("İptal edildi — hiçbir şey değişmedi.", "warn");
    return;
  }
  const sF = await snapshot(ctx);
  if (!multisetEqual(s0, sF)) throw new SpreadStop("Onay beklerken timeline değişti. Güvenlik için durduruldu (hiçbir şey yapılmadı).");
  const unverified = await linkGroups(ctx, bind.groups, sF, false);
  saveBindRecord(ctx.guid, { ...bind, stage: "linked", at: new Date().toISOString() });
  forgetStopped();
  reportLinked(bind.groups.length, unverified, []);
}

export async function runBind(): Promise<void> {
  const executed: string[] = [];
  let backupName: string | null = null;
  let ctx: SeqContext | null = null;
  let cutsDone = false; // kesme/silme doğrulandıysa, bağlama hatasında tekrar basmak GÜVENLİ (yarım iş sayılmaz)
  const linker = getLinker();
  log("▶ BAĞLA", "head");
  try {
    // 0) önce yardımcı — yoksa HİÇBİR ŞEYE dokunmadan dur
    const ping = await linker.ping();
    setHelperStatus(ping.ok, ping.detail);
    if (!ping.ok) throw new SpreadStop(`Yardımcı bağlı değil (${ping.detail}). BAĞLA BAŞLAMADI, hiçbir şeye dokunulmadı.`, linker.installHint());
    log(`✓ Yardımcı ${ping.detail}`, "ok");

    ctx = await requireActive();
    log(`sequence: "${ctx.name}"`, "dim");
    const s0 = await snapshot(ctx);
    assertNotStopped(ctx, s0, "BAĞLA");
    for (const w of s0.warnings) throw new SpreadStop(`Okuma sorunu: ${w}. BAĞLA BAŞLAMADI.`);
    const readErr = s0.clips.flatMap((c) => c.readErrors.map((e) => `${where(c)} — ${e}`));
    if (readErr.length) throw new SpreadStop("Bazı klipler okunamadı. BAĞLA BAŞLAMADI.", readErr);

    // TOPLA kaydı: çerçeve, eşleme, eşik, park listesi (+ varsa BAĞLA aşaması) — tahmin yok
    const rec = loadRecord(ctx.guid);
    if (!rec)
      throw new SpreadStop(
        "Önce TOPLA'ya bas: bu sequence için TOPLA kaydı yok (TOPLA bu panelde bu sequence'ta tamamlanmadı ya da panel verisi silindi). BAĞLA BAŞLAMADI, hiçbir şey değişmedi."
      );
    const bs = bindState(rec, s0);
    if (bs === "partial")
      throw new SpreadStop(
        "BAĞLA'dan sonra düzen değişmiş: kesilen parçaların bir kısmı yerinde, bir kısmı değil. BAĞLA BAŞLAMADI, hiçbir şey değişmedi. " +
          "BAĞLA öncesi yedek sequence'la çalış ya da BAĞLA'yı Ctrl+Z ile tamamen geri al."
      );
    if (bs === "applied") return await linkOnly(ctx, rec, rec.bind!, s0);

    const items = classify(s0);
    const mapping = mappingFor(sourcesOf(items));
    const drift = recordDrift(rec, mapping, Math.round(getThreshold() * 100));
    if (drift.length)
      throw new SpreadStop("Ayar TOPLA'dan sonra değişti — TOPLA'ya tekrar bas (oturumlar ve track'ler yeni ayarla yeniden kurulur). BAĞLA BAŞLAMADI, hiçbir şey değişmedi.", drift);
    const frame = frameFromRecord(rec.frame);
    const parked = parkedFromRecord(items, rec);
    const a = analyze(s0, items, { threshold: rec.thresholdPct / 100, exclude: parked });
    const plan = makeBindPlan(a, mapping);
    // Ön koşullar (hepsi plan hatası → hiçbir şey değişmez):
    //  - TOPLA düzeni (dikey, KAYITLI çerçeveye göre): TOPLA taşıdığı kamera/kılavuz çiftlerini clone ile AYIRIR; kılavuzu hâlâ
    //    kamerasına bağlı bir düzende kılavuz silmek bağlı kamerayı da silebilir (kanıtlanmadı). Park'takiler analize girmez.
    //  - park dışındaki her kayıt bir oturumda (sahipsiz / ayrılamayan yok: TOPLA onları park'a koyardı → TOPLA'dan sonra değişmiş)
    //  - oturumlar zamanda ayrık (TOPLA'nın yatay dizimi), senkron tutarlı, çift kopya yok
    const pre: string[] = [];
    if (layoutState(rec, s0) === "undone")
      pre.push("son TOPLA geri alınmış (timeline TOPLA öncesi hâlinde; taşınmamış kameraların kılavuz sesi hâlâ bağlı olabilir) — önce TOPLA'ya bas");
    for (const x of partlyParked(a, items, parked))
      pre.push(`aynı kaydın bir kısmı park'ta, bir kısmı ${x.session.id} oturumunda (${x.rec.label}: ${x.parked.map(where).join(", ")}) — önce TOPLA'ya bas (sorar)`);
    const misplaced = misplacedAgainst(frame, items, parked);
    if (misplaced.length)
      pre.push(
        `düzen TOPLA düzeninde değil (${misplaced.length} klip TOPLA'nın cihaz/kaynak track'inde değil, ör. ${misplaced
          .slice(0, 3)
          .map((m) => where(m.clip))
          .join(", ")}) — önce TOPLA'ya bas`
      );
    for (const d of a.duplicates) pre.push(`çift kopya: ${d}`);
    for (const e of a.errors) pre.push(e);
    for (const o of a.orphans) pre.push(`oturumsuz kayıt park dışında: ${o.label} [${secOf(o.start)}s–${secOf(o.end)}s] — TOPLA'dan sonra değişmiş; önce TOPLA'ya bas`);
    for (const u of a.unresolved) pre.push(`ayrılamayan kayıtlar (önce TOPLA): ${u.lines[0]}`);
    for (let i = 0; i < a.sessions.length; i++)
      for (let j = i + 1; j < a.sessions.length; j++) {
        const x = a.sessions[i];
        const y = a.sessions[j];
        if (x.start < y.end && y.start < x.end) pre.push(`${x.id} ile ${y.id} zamanda çakışıyor — önce TOPLA'ya bas (oturumları sırayla dizer)`);
      }
    plan.errors.unshift(...pre);
    // son düzendeki harici klipler (park'takiler ve kamerasız oturumlarınkiler hariç — onlara dokunulmaz) + ait oldukları oturum
    // (oturumlar zamanda ayrık)
    const camless = new Set(plan.camless.map((x) => x.id));
    const extFinal = (snap: Snapshot) => {
      const cls = classify(snap);
      const pk = parkedFromRecord(cls, rec);
      return cls
        .filter((x) => x.role === "external" && !pk.has(x.clip))
        .map((x) => ({
          clip: x.clip,
          source: x.source!,
          sessionId: a.sessions.find((ss) => big(x.clip.start) >= ss.start && big(x.clip.end) <= ss.end)?.id ?? null,
        }))
        .filter((x) => !(x.sessionId && camless.has(x.sessionId)));
    };
    for (const x of a.sessions) log(`  ${x.id} [${secOf(x.start)}s–${secOf(x.end)}s] ${x.label}`, "dim");
    if (parked.size) log(`  park'ta ${parked.size} klip (TOPLA kaydından) — BAĞLA'ya girmez, dokunulmaz`, "dim");
    printBindPlan(plan, s0);
    if (plan.errors.length) throw new SpreadStop(`Plan kurulamadı (${plan.errors.length} hata). BAĞLA BAŞLAMADI, hiçbir şey değişmedi.`);
    const deletes = [...plan.deleteGuides, ...plan.deleteSil, ...plan.deleteOutside];
    const nPieces = plan.cuts.reduce((n, c) => n + c.pieces.length, 0);
    const edits = deletes.length + plan.cuts.length > 0;
    const targets = linkTargets(plan);
    const groups = targets.filter((t) => t.items.length >= 2);

    const ans = await askUser(
      `BAĞLA: ${plan.groups.length} grup (çapa = gruptaki en uzun kamera klibi). ` +
        `${plan.cuts.length} harici ses ${nPieces} parçaya kesilecek, ${plan.pieces.filter((p) => p.whole).length} ses olduğu gibi kalacak; ` +
        `silinecek: ${plan.deleteGuides.length} kılavuz ses, ${plan.deleteSil.length} "sil" kaynağı klibi, ${plan.deleteOutside.length} çapa dışı ses; ` +
        `${[...plan.keptGuides.values()].reduce((n, g) => n + g.length, 0)} kamera sesi (grubunda harici ses yok) korunacak. ` +
        (plan.camless.length ? `${plan.camless.length} kamerasız oturumun (${plan.camless.map((x) => x.id).join(", ")}) seslerine dokunulmayacak. ` : "") +
        `Kaynaklar: ${plan.keptSources.join(", ") || "yok"}. Kesim yalnız oturum içinde. Sonra ${groups.length} grup yardımcıyla bağlanacak. ` +
        `${plan.warnings.length ? `${plan.warnings.length} uyarı (günlükte). ` : ""}` +
        (plan.silent.length
          ? `\nSESSİZ KALACAK (kamera sesi silinecek, harici ses kapsamıyor):\n${plan.silent
              .slice(0, 8)
              .map((x) => "  • " + x)
              .join("\n")}${plan.silent.length > 8 ? `\n  … ${plan.silent.length - 8} tane daha (günlükte)` : ""}\n`
          : "") +
        `${edits ? "Önce yedek sequence oluşturulacak." : "Kesme/silme yok → yalnız bağlama (yedek alınmaz)."} Devam?`
    );
    if (ans !== "Evet") {
      log("İptal edildi — hiçbir şey değişmedi.", "warn");
      return;
    }

    let sF: Snapshot;
    if (edits) {
      const backup = await makeBackup(ctx, "BAĞLA");
      backupName = backup.name;
      const s1 = await snapshot(ctx);
      if (!multisetEqual(s0, s1)) throw new SpreadStop("Yedek alınırken asıl sequence'ın klipleri değişti. Durduruldu.");

      // TX-1 kesim hazırlığı: park kopyaları + silme (tek seçim)
      await expectState(ctx, s1, null, executed);
      const so = await selectExactly(ctx, [...deletes, ...plan.cuts.map((c) => c.src)]);
      for (const n of so.notes) log(`   ${n}`, "dim");
      if (!so.exact) throw new SpreadStop("Silinecek klipler birebir seçilemedi — güvenlik için kesme/silme yapılmadı.");
      const P = await parkBase(ctx, so.snap);
      const slots = makeSlots(plan, P, await frameTicks(ctx));
      const srcOf = new Map<ClipInfo, ClipInfo>();
      for (const cut of plan.cuts) {
        const f = relocate(so.snap, cut.src);
        if (!f) throw new SpreadStop(`kesim öncesi ses yeniden bulunamadı: ${fmtClip(cut.src)}`);
        srcOf.set(cut.src, f);
      }
      log(`TX-1 (kesim hazırlığı): ${slots.length} park kopyası (${secOf(P)} sn sonrası) → ${so.readCount} klip siliniyor (ripple=false).`);
      await runTx(ctx, executed, "kesim hazırlığı", "BAĞLA: kesim hazırlığı", (ops) => {
        for (const sl of slots) ops.clone(srcOf.get(sl.piece.src)!, ticks(sl.offset), 0, 0);
        ops.remove(so.sel);
      });
      await settle();
      let s = await snapshot(ctx);
      const p1 = compareLayout(expectParked(s0, plan, slots, new Set()), s);
      if (p1.length) {
        const lostCams = p1.some((x) => /beklenen klip yok: V/.test(x));
        throw new SpreadStop(
          "Kesim hazırlığı doğrulaması tutmadı." +
            (lostCams
              ? " Bir kamera klibi de silinmiş: kılavuz sesi hâlâ kamerasına BAĞLIYDI (TOPLA bu kamerayı taşımadıysa bağı çözülmemiştir) ve " +
                "silme bağlı partneri de sildi. Aşağıdaki sayıda Ctrl+Z ile geri al (ya da yedek sequence) ve bu raporu getir — UXP'de bağ " +
                "okunamıyor/çözülemiyor; yeniden TOPLA bu durumu düzeltmez."
              : ""),
          p1
        );
      }
      log(`✓ TX-1 doğrulandı: ${deletes.length + plan.cuts.length} klip silindi, ${slots.length} park kopyası yerinde.`, "ok");

      if (slots.length) {
        // TX-2 ilk parça (ölçüm) → TX-3 kalanlar → TX-4 yerleştir. Her adımdan önce: timeline beklenen hâlde mi (geri alınan adım düşülür)
        const first = firstSlot(slots)!;
        let prev = s1;
        await expectState(ctx, s, prev, executed);
        log(`TX-2 (ilk parça — ölçüm): "${first.piece.src.name}" → [${secOf(first.piece.start)}s–${secOf(first.piece.end)}s] set End → Start → In → Out.`);
        prev = s;
        s = await trimTx(ctx, executed, "ilk parça", s0, plan, slots, new Set(), [first]);
        const rest = slots.filter((x) => x !== first);
        if (rest.length) {
          await expectState(ctx, s, prev, executed);
          log(`TX-3 (parçalar): ${rest.length} parça kırpılıyor.`);
          prev = s;
          s = await trimTx(ctx, executed, "parçalar", s0, plan, slots, new Set([first]), rest);
        }
        await expectState(ctx, s, prev, executed);
        const taken = new Set<ClipInfo>();
        const parkedCopies = slots.map((sl) => ({ sl, c: parkedClip(s, sl, true, taken) }));
        const so4 = await selectExactly(ctx, parkedCopies.map((p) => p.c));
        for (const n of so4.notes) log(`   ${n}`, "dim");
        if (!so4.exact) throw new SpreadStop("Kırpılmış park kopyaları birebir seçilemedi — güvenlik için yerleştirme yapılmadı.");
        const work = parkedCopies.map((p) => {
          const f = relocate(so4.snap, p.c);
          if (!f) throw new SpreadStop(`yerleştirme öncesi parça yeniden bulunamadı: ${fmtClip(p.c)}`);
          return { sl: p.sl, c: f };
        });
        log(`TX-4 (yerleştir): ${work.length} parça asıl yerine → park kopyaları siliniyor.`);
        await runTx(ctx, executed, "yerleştir", "BAĞLA: yerleştir", (ops) => {
          for (const { sl, c } of work) ops.clone(c, ticks(-sl.offset), 0, 0);
          ops.remove(so4.sel);
        });
        await settle();
      }
      sF = await snapshot(ctx);
      const fin = [...compareLayout(expectBindFinal(s0, plan), sF), ...verifyBindContent(plan, extFinal(sF)), ...snapshotOverlaps(sF)];
      if (fin.length) throw new SpreadStop("Kesme doğrulaması tutmadı.", fin);
      cutsDone = true;
      log(
        `✓ Kesme/silme doğrulandı: ${nPieces} parça tick düzeyinde doğru; her çapa içindeki ses süresi aynı (boşluk yok); ` +
          `kaynak kayması yok; kılavuz ses ve kapalı kanal kalmadı.`,
        "ok"
      );
    } else {
      sF = await snapshot(ctx);
      if (!multisetEqual(s0, sF)) throw new SpreadStop("Onay beklerken timeline değişti. Güvenlik için durduruldu (hiçbir şey yapılmadı).");
      const fin = verifyBindContent(plan, extFinal(sF));
      if (fin.length) throw new SpreadStop("Düzen beklenen hâlde değil.", fin);
      cutsDone = true;
    }
    // kesme/silme doğrulandı → bağlama grupları kayda (yeniden basınca yalnız bağlama; kesilmiş düzen yeniden analiz edilmez)
    const specs: LinkSpec[] = groups.map((t) => ({ id: t.group.id, label: t.label, items: t.items }));
    const created: LinkItemRec[] = plan.pieces
      .filter((p) => !p.whole)
      .map((p) => ({ kind: "A", track: p.src.track, start: String(p.start), end: String(p.end), name: itemOf(p.src).name }));
    const removed: LinkItemRec[] = [...deletes, ...plan.cuts.map((c) => c.src)].map(itemOf);
    const bind: BindRecord = { stage: "cut", groups: specs, created, removed, at: new Date().toISOString() };
    saveBindRecord(ctx.guid, bind);

    for (const t of targets.filter((x) => x.items.length < 2)) log(`   ${t.label}: bağlanacak ikinci öğe yok — atlandı`, "dim");
    const unverified = await linkGroups(ctx, specs, sF, edits);
    saveBindRecord(ctx.guid, { ...bind, stage: "linked" });
    forgetStopped();
    reportLinked(groups.length, unverified, executed);
    if (executed.length) log(`Beğenmezsen: yedek sequence "${backupName}"i kullan (ya da Ctrl+Z; ${LINK_UNDO_NOTE})`, "dim");
  } catch (e) {
    if (executed.length && ctx && !cutsDone) await rememberStopped(ctx, "BAĞLA");
    else if (cutsDone) forgetStopped();
    reportStop("BAĞLA", e, executed, backupName, executed.length ? [LINK_UNDO_NOTE] : []);
  }
}
