// BAĞLA — TOPLA + gözle kontrolden SONRA, OTURUM İÇİNDE: gruplar → çapalar → harici sesleri KENDİ oturumunun çapasına göre kes →
// kılavuz sesleri (grubunda harici ses varsa) ve "sil" kaynaklarını sil → her grubu yardımcı (CEP / ExtendScript linkSelection) ile bağla.
// Oturumlar TOPLA ile aynı modülden (sessions.ts); track çerçevesi, eşik, eşleme ve park listesi TOPLA KAYDINDAN (settings.ts) —
// track sırasından tahmin yok. Kayıt yoksa ya da eşleme/eşik TOPLA'dan sonra değiştiyse BAŞLAMAZ ("önce TOPLA").
// Kesme/silme doğrulanınca bağlama grupları kayda yazılır; yeniden basınca (ör. yardımcı düştüyse) YALNIZ bağlama yapılır — kesilmiş
// düzen yeniden analiz edilmez (harici sesler çapalara bölündüğü için senkron kanıtı artık yok).
// Plan: bind.ts (saf). Bağlama: linker.ts (TEK modül). Güvenlik: guard.ts (onay → yedek → her transaction sonrası tick düzeyinde
// doğrulama → tutmazsa DUR + Ctrl+Z sayısı + yedeğin adı; kendi başına düzeltme yok).
// v0.3.2 — BAĞLANTIDAN BAĞIMSIZ: iki aşama. KES (bu panel, UXP): parçalar + kılavuz / "sil" silme, doğrulanır, kayda ve KES PLANI
// dosyasına (yardımcıyla ortak klasör) yazılır. BAĞLA: köprü (HTTP) çalışıyorsa hemen, tek tıkla; çalışmıyorsa kullanıcı Spread Helper
// panelindeki BAĞLA'ya basar. İki yol aynı grupları kullanır: gruplar tek modülden (sessions.ts) — KES'ten ÖNCE beklenen düzende, SONRA
// gerçek düzende "düzenden gruplar" kuralıyla (yardımcı panelin kullandığı kural) planla birebir karşılaştırılır.
//
// Transaction'lar (yalnız gerekenler): [yedek] → [KALİBRASYON: sequence'ta ilk kesimde, 6 adım — calibrate.ts] → TX-1 kesim
// hazırlığı (park kopyaları + silme) → TX-2 ilk parça (ÖLÇÜM) → TX-3 parçalar → TX-4 yerleştir → bağlama (yardımcı).
// v0.3.4 — KIRPMA: set action'lar tek transaction'da klibin İLK hâlinden fark olarak uygulanıp aynı kenarda BİRİKİYOR (kanıtlandı,
// trimcal.ts). Kırpma kalibre edilmiş kuralla: her kenara TEK action (farkı 0 olan kenara hiç), sonuç transaction'dan ÖNCE
// "fark ilk hâlden, etkiler toplanır" varsayımıyla hesaplanır; tutarlı kural yoksa kesim yapılmaz (YEDEK PLAN mesajı).

import { applySet, calibrateTrim, edgesOf, hostVersion } from "./calibrate";
import { selectExactly } from "./edit";
import {
  expectBindFinal,
  expectedFinalClips,
  expectParked,
  firstSlot,
  linkTargets,
  makeBindPlan,
  makeSlots,
  trimmedAtSlot,
  verifyBindContent,
  type BindPlan,
  type Group,
  type Slot,
} from "./bind";
import { channelOutliers, channelTypeName, mixedChannels, type ChannelItem } from "./channels";
import { classify, fileName, sourcesOf, where } from "./classify";
import {
  askUser,
  confirmNotStopped,
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
import { analyze, compareLinkGroups, groupsFromLayout, partlyParked, reduceToPresent, type LayoutFrame } from "./sessions";
import { compareLayout, expOf, findExp, snapshotOverlaps } from "./layout";
import { getLinker, HELPER_VERSION, readPanelLinkResult, writeLinkPlan, type LinkGroupResult, type PingResult } from "./linker";
import { big, fmtClip, relocate, secOf, settle, sleep, snapshot, ticks, trackLabel, type ClipInfo, type Snapshot } from "./model";
import { confirmRedo, reconcileAndLog, stale } from "./records";
import { assertSameSequence, requireActive, type SeqContext } from "./session";
import {
  forgetTrimCal,
  getThreshold,
  loadRecord,
  loadTrimCal,
  mappingFor,
  recordDrift,
  saveBindRecord,
  saveTrimCal,
  type BindRecord,
  type CollectRecord,
  type LinkItemRec,
} from "./settings";
import { describeCal, fmtRule, planTrim, type TrimCal } from "./trimcal";
import { done, log, progress, setHelperStatus, setReportText } from "./ui";

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
        `     ${p.source.padEnd(10)} ${trackLabel("A", p.src.track)} "${p.src.name}" → ${p.camera ? `${trackLabel("A", p.track)} ` : ""}[${secOf(p.start)}s–${secOf(p.end)}s] in=${secOf(p.inPt)}s` +
          (p.whole ? " (olduğu gibi kalır)" : p.camera ? " (korunan kamera sesi: kesilip taşınacak)" : " (kesilecek)"),
        "dim"
      );
  }
  for (const c of plan.deleteOutside) log(`  sil (hiçbir çapaya düşmüyor): ${where(c)}`, "dim");
  if (plan.deleteSil.length) log(`  sil (kaynak eşlemede "sil"): ${plan.deleteSil.map(where).join(", ")}`, "dim");
  for (const [g, gg] of plan.keptGuides) if (gg.length) log(`  ${g.id}: kamera sesi korunur (${gg.map(where).join(", ")})`, "dim");
  for (const x of plan.camless) log(`  ${x.id}: kamerasız oturum — sesleri olduğu gibi kalır`, "dim");
  if (plan.deleteGuides.length) log(`  sil: ${plan.deleteGuides.length} kamera kılavuz sesi`, "dim");
  for (const w of plan.warnings) log(`uyarı: ${w}`, "warn");
  for (const w of plan.keptCamera) log(`KAMERA SESİ KORUNACAK: ${w}`, "ok");
  for (const w of plan.silent) log(`SESSİZ KALACAK: ${w}`, "warn");
  for (const e of plan.errors) log(`HATA: ${e}`, "err");
}

const FALLBACK =
  "YEDEK PLAN (Spread Helper'da QE razor) gerekiyor — bu sürümde ÇALIŞTIRILMADI: QE DOM'un razor'u Adobe belgelerinde yok (yalnız " +
  "üçüncü taraf kaynaklar) ve gerçek Premiere'de ölçülmedi; ayrıca zaman kodu alır (kare hassasiyeti), korunan kamera sesinin WAV " +
  "kenarına düşen uçları kare arasında kalabilir. Kanıtsız yöntemle kesim yapılmaz — yedek planın ölçülmesi (yoklama) SENİN KARARIN. " +
  "Tekrar basmak büyük olasılıkla aynı sonucu verir; bu raporu getir (ölçümler yukarıda).";

/** Kalibre edilmiş kuralla bir park kopyasının kırpma adımları — transaction'dan ÖNCE, sonucu önceden hesaplanarak. */
function trimSteps(c: ClipInfo, sl: Slot, cal: TrimCal) {
  const t = trimmedAtSlot(sl);
  const p = planTrim(edgesOf(c), { start: t.start, end: t.end, inPt: t.inPt, outPt: t.outPt }, cal.rule, cal.vec);
  if (p.problem) throw new SpreadStop(`Kırpma kurulamadı (${where(c)} → [${secOf(t.start)}s–${secOf(t.end)}s]): ${p.problem}. Bu adımda hiçbir şey yapılmadı.`);
  return p.steps;
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
  now: Slot[],
  cal: TrimCal
): Promise<Snapshot> {
  const sPre = await snapshot(ctx);
  const taken = new Set<ClipInfo>();
  const work = now.map((sl) => {
    const c = parkedClip(sPre, sl, false, taken);
    return { c, steps: trimSteps(c, sl, cal) };
  });
  try {
    await runTx(ctx, executed, label, `BAĞLA: ${label}`, (ops) => {
      for (const { c, steps } of work) for (const st of steps) applySet(ops, c, st.act, st.value);
    });
  } catch (e) {
    forgetTrimCal(ctx.guid); // kalibre edilmiş kural bu kırpmada hata verdi → bir sonraki BAĞLA yeniden ölçer
    throw e;
  }
  await settle();
  const s = await snapshot(ctx);
  const done = new Set([...doneBefore, ...now]);
  const probs = compareLayout(expectParked(s0, plan, slots, done), s);
  if (probs.length) {
    const first = label === "ilk parça";
    forgetTrimCal(ctx.guid); // kural bu kırpmada tutmadı → bir sonraki BAĞLA yeniden ölçer
    throw new SpreadStop(
      (first
        ? `İLK PARÇA TUTMADI: kalibre edilmiş kırpma (${fmtRule(cal.rule)}) ilk parçada beklenen sonucu vermedi ("fark ilk hâlden, ` +
          "etkiler toplanır\" varsayımı bu kırpmada tutmuyor). Kalan parçalar kesilmedi. "
        : `"${label}" doğrulaması tutmadı (kural: ${fmtRule(cal.rule)}). `) +
        "Kalibrasyon kaydı silindi. " +
        FALLBACK,
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

/** Kayıttaki çerçeveden yardımcıyla ortak "düzenden gruplar" kuralının çerçevesi. */
const layoutFrameOf = (rec: CollectRecord): LayoutFrame => {
  const f = frameFromRecord(rec.frame);
  return {
    vPark: f.vPark,
    aPark: f.aPark,
    silTracks: [...f.silTrack.values()],
    keptTracks: Array.from({ length: f.keptCount }, (_, j) => f.keptBase + j),
  };
};

/** Düzenden gruplar (yardımcı panelin kuralı) bu gruplarla BİREBİR aynı mı; farklar / hatalar satır satır. */
function layoutMismatch(clips: ClipInfo[], lf: LayoutFrame, groups: LinkSpec[]): string[] {
  const lay = groupsFromLayout(classify({ vCount: 0, aCount: 0, clips, warnings: [], gen: 0 }), lf);
  return [...lay.errors, ...compareLinkGroups(groups, lay.groups)];
}

/**
 * Yardımcı panelin okuduğu KES planı (JSON).
 * @param handoff v1.0.0 (yalnız görünüm): "panel" → yardımcı panel köprüsüz BAĞLA bölümünü gösterir; "bridge" → köprü bağlayacak
 */
function planText(ctx: SeqContext, bind: BindRecord, lf: LayoutFrame, handoff: "panel" | "bridge"): string {
  return JSON.stringify(
    // created (v1.1.0): kesimin yarattığı parçalar — yardımcı panel "elle silinmiş" ile "Ctrl+Z ile geri alınmış"ı ayırsın (hiçbiri yoksa DUR)
    { v: 1, kind: "spread-link-plan", panel: HELPER_VERSION, handoff, sequence: { name: ctx.name, guid: ctx.guid }, createdAt: bind.at, frame: lf, groups: bind.groups, created: bind.created },
    null,
    1
  );
}

/**
 * KES planını yardımcı panele bırak: dosyaya yaz (yazılamazsa rapor kutusundan yapıştırılır) ve kullanıcıya ne yapacağını söyle.
 * @param bridge köprü yok (why) → "yardımcı paneldeki BAĞLA'ya bas"; varsa (null) yalnız dosyayı yaz (panel yolu da hazır dursun)
 */
async function handToPanel(ctx: SeqContext, bind: BindRecord, lf: LayoutFrame, why: string | null, cutNow: boolean): Promise<void> {
  const text = planText(ctx, bind, lf, why === null ? "bridge" : "panel");
  const w = await writeLinkPlan(text);
  if (why === null) {
    if (w.ok) log(`   KES planı: ${w.path}`, "dim");
    else {
      // köprü bu an çalışıyor ama bağlama yine de düşebilir: panel yolu her zaman açık kalsın → plan rapor kutusunda
      setReportText(text);
      log(`   KES planı dosyaya yazılamadı (${w.path}): ${w.detail} — plan rapor kutusunda (gerekirse Spread Helper panelinde 'Planı yapıştır').`, "warn");
    }
    return;
  }
  setReportText(text);
  // bu plan (aynı createdAt) Spread Helper panelinde zaten bağlandıysa (yardımcının doğrulayıp yazdığı sonuç dosyası) — yalnız görünüm
  const pr = readPanelLinkResult();
  const linkedInPanel = !!(pr && pr.ok && pr.planCreatedAt === bind.at);
  log(
    `${cutNow ? "✓ KES tamam: kesme/silme tick düzeyinde doğrulandı" : "✓ KES tamam (daha önce yapılmış ve doğrulanmış)"} — ` +
      (linkedInPanel ? `${bind.groups.length} grup Spread Helper panelinde zaten bağlanmış (${pr?.at ?? "?"}).` : `${bind.groups.length} grup bağlanmayı bekliyor.`),
    "ok"
  );
  log(`Yardımcıya köprü yok: ${why}`, "warn");
  if (w.ok) {
    log(`KES planı yazıldı: ${w.path}`, "dim");
    if (!linkedInPanel) log("→ Premiere'de Window → Extensions (Legacy) → Spread Helper panelini aç ve oradaki BAĞLA'ya bas.", "head");
  } else {
    log(`KES planı dosyaya YAZILAMADI (${w.path}): ${w.detail}`, "warn");
    if (!linkedInPanel) log("→ Plan aşağıdaki rapor kutusunda: 'Raporu kopyala' → Spread Helper panelinde 'Planı yapıştır' → BAĞLA.", "head");
  }
  if (linkedInPanel) {
    done("bagla", "ok", "Gruplar Spread Helper panelinde zaten bağlandı.", "Yapılacak bir şey yok.");
    return;
  }
  done(
    "bagla",
    "warn",
    `Kesim tamam; ${bind.groups.length} grup bağlanmayı bekliyor.`,
    w.ok
      ? "Spread Helper panelinde Bağla'ya bas (Window › Extensions (Legacy) › Spread Helper)."
      : "Plan dosyası yazılamadı: ⚙ Ayarlar → Raporu kopyala → Spread Helper'da durum satırına tıkla → Planı yapıştır → Bağla."
  );
}

/**
 * v1.1.0 — BAĞLA onayından ÖNCE (salt okuma): her grubun seslerinin kanal tipi yardımcıdan (ExtendScript) okunur. Premiere mono +
 * stereo karışık bağ grubunu reddetti (gerçek Premiere 26.5.1, handoff.md); onayda tek satır uyarı verilir. Tip, sesin ŞİMDİKİ
 * kaynak klibinden okunur (parçalar aynı proje öğesinden kesilir). Köprü yoksa ya da tip okunamazsa uyarı yok, günlükte not.
 */
async function channelCheck(
  ctx: SeqContext,
  plan: BindPlan,
  targets: { group: Group; label: string }[],
  pingOk: boolean
): Promise<ChannelCheck> {
  if (!pingOk) return { mixed: [], unknown: 0, kinds: "", detail: "yardımcıya köprü yok — kanal tipi okunamadı (bağlamada Premiere reddederse yardımcı yine ikinci kez dener)" };
  const src = new Map<string, ClipInfo>();
  const per = targets.map((t) => {
    const aud: { src: ClipInfo; track: number }[] = [
      ...(plan.keptGuides.get(t.group) ?? []).map((c) => ({ src: c, track: c.track })),
      ...plan.pieces.filter((p) => p.group === t.group).map((p) => ({ src: p.src, track: p.track })),
    ];
    for (const a of aud) src.set(itemKey(itemOf(a.src)), a.src);
    return { t, aud };
  });
  const keys = [...src.keys()];
  const res = await getLinker().channels(
    ctx.name,
    keys.map((k) => itemOf(src.get(k)!))
  );
  if (!res.ok) return { mixed: [], unknown: 0, kinds: "", detail: `kanal tipi okunamadı: ${res.detail}` };
  const typeOf = new Map(keys.map((k, i) => [k, res.types[i] ?? null]));
  const mixed: { label: string; out: string[] }[] = [];
  const kinds = new Set<number>();
  let unknown = 0;
  for (const { t, aud } of per) {
    const nV = t.group.cams.length;
    const items: ChannelItem[] = [
      ...t.group.cams.map((c) => ({ kind: "V" as const, track: c.track, type: null })),
      ...aud.map((a) => ({ kind: "A" as const, track: a.track, type: typeOf.get(itemKey(itemOf(a.src))) ?? null })),
    ];
    const m = mixedChannels(items);
    if (m === null) unknown++;
    if (m !== true) continue;
    for (const x of items) if (x.kind === "A" && x.type !== null) kinds.add(x.type);
    mixed.push({
      label: t.label,
      out: channelOutliers(items).map((i) => `${trackLabel("A", aud[i - nV].track)} "${fileName(aud[i - nV].src)}" (${channelTypeName(items[i].type)})`),
    });
  }
  return { mixed, unknown, kinds: [...kinds].sort().map(channelTypeName).join(" + "), detail: "" };
}

interface ChannelCheck {
  mixed: { label: string; out: string[] }[];
  unknown: number;
  /** karışık gruplardaki tipler ("mono + stereo") */
  kinds: string;
  detail: string;
}

/**
 * v1.1.0 — "yalnız bağla" yolunda aynı kontrol (inceleme #9, M2): öğeler kesimden sonra ZATEN timeline'da → tipleri doğrudan
 * kendilerinden okunur (salt okuma).
 */
async function channelCheckItems(ctx: SeqContext, groups: LinkSpec[], pingOk: boolean): Promise<ChannelCheck> {
  if (!pingOk) return { mixed: [], unknown: 0, kinds: "", detail: "yardımcıya köprü yok — kanal tipi okunamadı" };
  const uniq = new Map<string, LinkItemRec>();
  for (const g of groups) for (const i of g.items) if (i.kind === "A") uniq.set(itemKey(i), i);
  const keys = [...uniq.keys()];
  const res = await getLinker().channels(
    ctx.name,
    keys.map((k) => uniq.get(k)!)
  );
  if (!res.ok) return { mixed: [], unknown: 0, kinds: "", detail: `kanal tipi okunamadı: ${res.detail}` };
  const typeOf = new Map(keys.map((k, i) => [k, res.types[i] ?? null]));
  const mixed: { label: string; out: string[] }[] = [];
  const kinds = new Set<number>();
  let unknown = 0;
  for (const g of groups) {
    const items: ChannelItem[] = g.items.map((i) => ({ kind: i.kind, track: i.track, type: i.kind === "A" ? (typeOf.get(itemKey(i)) ?? null) : null }));
    const m = mixedChannels(items);
    if (m === null) unknown++;
    if (m !== true) continue;
    for (const x of items) if (x.kind === "A" && x.type !== null) kinds.add(x.type);
    mixed.push({
      label: g.label,
      out: channelOutliers(items).map((k) => `${trackLabel("A", g.items[k].track)} "${g.items[k].name}" (${channelTypeName(items[k].type)})`),
    });
  }
  return { mixed, unknown, kinds: [...kinds].sort().map(channelTypeName).join(" + "), detail: "" };
}

/** Kanal kontrolünün günlük satırları (iki yolda aynı). */
function logChannelCheck(chk: ChannelCheck): void {
  if (chk.detail) log(`   ${chk.detail}`, "dim");
  if (chk.unknown) log(`   ${chk.unknown} grupta bazı seslerin kanal tipi okunamadı — karışık olup olmadığı bilinmiyor`, "dim");
  if (chk.mixed.length) {
    log(`KARIŞIK KANAL: ${chk.mixed.length} grupta ${chk.kinds} ses var (Premiere böyle bir grubu bağlamayı reddedebilir):`, "warn");
    for (const x of chk.mixed) log(`   • ${x.label} — reddedilirse bağ dışında kalacak (silinmez): ${x.out.join(", ")}`, "warn");
  }
}

/** Onay özetindeki tek satır. */
const mixedLine = (chk: ChannelCheck): string[] =>
  chk.mixed.length ? [`KARIŞIK KANAL: ${chk.mixed.length} grupta ${chk.kinds}; Premiere reddederse farklı olanlar bağ dışında kalır (silinmez).`] : [];

/**
 * Bağlama (köprü) — en son. Klip zamanları bağlamada değişmemeli.
 * @returns unverified: doğrulanamayan grupların satırları (boşsa hepsi getLinkedItems ile doğrulandı); excluded: v1.1.0 — Premiere
 *          grubu reddedince yardımcının kanal tipi farklı sesleri çıkarıp ikinci denemede bağladığı grupların satırları (o sesler
 *          SİLİNMEZ, bağ dışında yerinde kalır); nExcluded: bağ dışında kalan ses sayısı
 */
async function linkGroups(ctx: SeqContext, groups: LinkSpec[], sF: Snapshot, edits: boolean): Promise<{ unverified: string[]; excluded: string[]; nExcluded: number }> {
  const linker = getLinker();
  const again = "Yardımcıyı düzelt ve BAĞLA'ya tekrar bas (kesilecek bir şey kalmadığı için yalnız bağlama yapılır) ya da Spread Helper panelindeki BAĞLA'ya bas.";
  await assertSameSequence(ctx);
  log(`Bağlama: ${groups.length} grup yardımcıya gönderiliyor (${linker.name}).`);
  progress(0.9, `${groups.length} grup bağlanıyor…`);
  let out: Awaited<ReturnType<typeof linker.link>>;
  try {
    out = await linker.link(ctx.name, groups.map((t) => ({ id: t.id, items: t.items })));
  } catch (e) {
    const stop = new SpreadStop(`${edits ? "Kesme/silme doğrulandı ve yerinde; " : ""}bağlama isteği başarısız: ${e instanceof Error ? e.message : String(e)}. ${again}`);
    stop.retryLink = true; // yalnız arayüz ipucu
    throw stop;
  }
  await settle();
  const sAfter = await snapshot(ctx);
  if (!multisetEqual(sF, sAfter)) throw new SpreadStop("Bağlama sırasında klipler değişti (beklenmiyordu).", compareLayout(sF.clips.map((c) => expOf(c)), sAfter));
  const byId = new Map<string, LinkGroupResult>(out.results.map((r) => [r.id, r]));
  const bad: string[] = [];
  const unverified: string[] = [];
  const excluded: string[] = [];
  let nExcluded = 0;
  for (const t of groups) {
    const r = byId.get(t.id);
    const ex = r?.excluded?.length ? r.excluded : [];
    if (r?.retried)
      log(
        `   ${r.linked ? "⚠" : "✗"} ${t.label}: Premiere grubu reddetti (linkSelection false; ${r.firstDetail ?? "?"}) → kanal tipi farklı ${ex.length} ses ` +
          `çıkarılarak ikinci deneme: ${r.linked ? "bağlandı" : "yine başarısız"}${ex.length ? ` — bağ dışında (silinmedi): ${ex.join(", ")}` : ""}`,
        r.linked ? "warn" : "err"
      );
    if (!r) bad.push(`${t.label}: yardımcıdan sonuç gelmedi${out.detail ? ` (${out.detail})` : ""}`);
    else if (r.found !== r.total) bad.push(`${t.label}: ${r.total} öğeden ${r.found} bulundu (eksik: ${r.missing.join(", ")}) — bağlanmadı`);
    else if (!r.linked) bad.push(`${t.label}: linkSelection başarısız — ${r.detail}${r.retried ? " (kanal tipi farklı sesler çıkarılarak yapılan ikinci deneme de başarısız)" : ""}`);
    else if (r.verified === false) bad.push(`${t.label}: bağ doğrulanamadı — ${r.detail}`);
    else {
      if (ex.length) {
        excluded.push(`${t.label}: ${ex.join(", ")}`);
        nExcluded += ex.length;
      }
      if (r.verified === null) unverified.push(`${t.label}: ${r.detail}`);
      else log(`   ✓ ${t.label}: bulundu ${r.found}/${r.total}, bağlandı${ex.length ? ` (${ex.length} ses bağ dışında)` : ""}, doğrulandı`, "dim");
    }
  }
  if (bad.length) {
    const stop = new SpreadStop(`${bad.length}/${groups.length} grup bağlanamadı${edits ? " (kesme/silme doğru ve yerinde)" : ""}. ${again}`, bad);
    stop.retryLink = true; // yalnız arayüz ipucu
    // ikinci deneme de reddedildiyse tekrar basmak aynı sonucu verir (inceleme #9, m7)
    if (groups.some((t) => byId.get(t.id)?.retried && !byId.get(t.id)?.linked))
      stop.hint = "Kesim yerinde ve doğru. Premiere bazı grupları, kanal tipi farklı sesler çıkarıldıktan sonra da bağlamadı — tekrar basmak aynı sonucu verir. Sorun bildir'e bas.";
    throw stop;
  }
  return { unverified, excluded, nExcluded };
}

/**
 * @param extra v1.1.0 — excluded: kanal tipi farklı olduğu için bağ dışında kalan sesler (grup başına satır; SİLİNMEDİ);
 *              missing: "yalnız bağla"da kesimden sonra timeline'da olmayan öğeler (bağlanmadı)
 */
function reportLinked(
  n: number,
  unverified: string[],
  executed: string[],
  extra: { excluded: string[]; nExcluded: number; missing: string[] } = { excluded: [], nExcluded: 0, missing: [] }
): void {
  if (extra.excluded.length) {
    log(
      `⚠ ${extra.nExcluded} ses bağ dışında kaldı (${extra.excluded.length} grupta): kanal tipi grubun geri kalanından farklı ve Premiere karışık grubu ` +
        "reddetti; grup onlarsız bağlandı. Hiçbir klip SİLİNMEDİ — hepsi yerinde:",
      "warn"
    );
    for (const x of extra.excluded) log(`   • ${x}`, "warn");
  }
  if (extra.missing.length) {
    log(`⚠ ${extra.missing.length} öğe kesimden sonra timeline'da yok (elle silinmiş ya da taşınmış; listesi yukarıda) — onlar bağlanmadı, var olanlar bağlandı.`, "warn");
  }
  const notes = [
    extra.nExcluded ? `${extra.nExcluded} ses bağ dışında kaldı (silinmedi)` : "",
    extra.missing.length ? `${extra.missing.length} eksik öğe bağlanmadı` : "",
  ].filter(Boolean);
  if (notes.length && !unverified.length) {
    log(
      `✓ BAĞLA tamam: ${n} grup bağlandı ve getLinkedItems ile doğrulandı; klip zamanları bağlamada değişmedi — ${notes.join("; ")} (yukarıda).` +
        `${executed.length ? ` (${executed.length} adım: ${executed.join(", ")})` : ""}`,
      "ok"
    );
    done(
      "bagla",
      "warn",
      `${n} grup bağlandı; ${notes.join(", ")}.`,
      extra.nExcluded ? "Bağ dışında kalan sesler yerinde duruyor; istersen elle bağla ya da sil." : "Eksik öğeler elle silinmişti; başka bir şey yapman gerekmez."
    );
    return;
  }
  if (unverified.length) {
    // linkSelection "true" dedi ama bağ okunarak DOĞRULANAMADI → "tamam" denmez (uydurma yok)
    log(`⚠ BAĞLA bitti ama ${unverified.length}/${n} grubun bağı DOĞRULANAMADI (Premiere "bağlandı" dedi; okuyarak teyit edilemedi):`, "warn");
    for (const u of unverified) log(`   • ${u}`, "warn");
    log("Kontrol et: timeline'da bir kamera klibine tıkla — grubun kameraları ve ses parçaları birlikte seçilmeli (Linked Selection açık).", "head");
    done(
      "bagla",
      "warn",
      `${n} grup bağlandı; ${unverified.length} grubun bağı okunarak doğrulanamadı${notes.length ? `; ${notes.join(", ")}` : ""}.`,
      "Timeline'da bir kamera klibine tıkla: grubun kameraları ve sesleri birlikte seçilmeli."
    );
  } else {
    log(
      `✓ BAĞLA tamam: ${n} grup bağlandı ve getLinkedItems ile doğrulandı; klip zamanları bağlamada değişmedi.` +
        `${executed.length ? ` (${executed.length} adım: ${executed.join(", ")})` : ""}`,
      "ok"
    );
    done("bagla", "ok", `${n} grup bağlandı.`, executed.length ? "Beğenmezsen yedek sequence'ı kullan (ya da Ctrl+Z)." : "");
  }
}

/**
 * Kesme/silme önceden yapılıp doğrulanmış (kayıtta) → YALNIZ bağlama. Düzenleme yok, yedek yok. v1.1.0: kesimden sonra elle silinen
 * öğeler varsa ("thinned") var olanlar bağlanır, eksikler yazılır.
 */
async function linkOnly(ctx: SeqContext, rec: CollectRecord, bind: BindRecord, s0: Snapshot, ping: PingResult): Promise<void> {
  const lf = layoutFrameOf(rec);
  // v1.1.0: kesimden sonra elle silinen / taşınan öğeler → gruplar o an VAR olan öğelere indirilir; eksikler raporlanır (durulmaz).
  // İndirilmiş gruplar yine yardımcıyla ortak kuralla (düzenden gruplar) birebir karşılaştırılır.
  const red = reduceToPresent(bind.groups, new Set(s0.clips.map((c) => itemKey(itemOf(c)))));
  const linkable = red.groups.filter((g) => g.items.length >= 2);
  const mm = layoutMismatch(s0.clips, lf, red.groups);
  if (mm.length)
    throw new SpreadStop(
      red.missing.length
        ? `Kesimden sonra ${red.missing.length} öğe yok ve kalanlar yardımcıyla ortak kuralla aynı grupları vermiyor (ör. bir kamera klibi silinmiş / taşınmış) — BAĞLA BAŞLAMADI, hiçbir şey değişmedi.`
        : "Düzen, kayıttaki KES planıyla uyuşmuyor (yardımcıyla ortak kural) — BAĞLA BAŞLAMADI, hiçbir şey değişmedi.",
      [...red.missing, ...mm]
    );
  const count = new Map<string, number>();
  for (const c of s0.clips) count.set(itemKey(itemOf(c)), (count.get(itemKey(itemOf(c))) ?? 0) + 1);
  const dup = red.groups.flatMap((g) => g.items).filter((i) => (count.get(itemKey(i)) ?? 0) > 1);
  if (dup.length)
    throw new SpreadStop(
      "Bağlanacak öğelerden bazıları timeline'da birden çok kez var (aynı ad/track/start/end) — hangisinin bağlanacağı belli değil, BAĞLA BAŞLAMADI.",
      dup.map((i) => `${trackLabel(i.kind, i.track)} "${i.name}" [${secOf(i.start)}s–${secOf(i.end)}s]`)
    );
  if (!linkable.length) {
    log(`Kesimden sonra ${red.missing.length} öğe timeline'da yok; bağlanacak (en az iki öğesi kalan) grup yok — hiçbir şey yapılmadı:`, "warn");
    for (const m of red.missing) log(`   • ${m}`, "warn");
    done("bagla", "warn", "Bağlanacak bir şey kalmadı: kesilen parçalar elle silinmiş.", "Hiçbir şey değişmedi.");
    return;
  }
  if (red.missing.length) {
    log(`Kayıt: kesme/silme ${bind.at} tarihinde yapıldı ve doğrulandı; kesimden sonra ${red.missing.length} öğe timeline'da yok (elle silinmiş ya da taşınmış) — var olanlar bağlanacak:`, "warn");
    for (const m of red.missing) log(`   • ${m}`, "warn");
  } else log(`Kayıt: kesme/silme ${bind.at} tarihinde yapıldı ve doğrulandı; ${bind.groups.length} grubun bütün öğeleri yerinde.`, "dim");
  for (const g of bind.groups) log(`  ${g.label}`, "dim");
  if (!ping.ok) {
    await handToPanel(ctx, bind, lf, ping.detail, false);
    forgetStopped(ctx.guid);
    return;
  }
  // v1.1.0: kanal tipi (salt okuma) — karışık gruplar onayda tek satır (inceleme #9, M2)
  const chk = await channelCheckItems(ctx, linkable, true);
  logChannelCheck(chk);
  const ans = await askUser(
    `BAĞLA: kesme/silme daha önce yapıldı ve doğrulandı (TOPLA kaydı ${rec.at}); ` +
      (red.missing.length
        ? `kesimden sonra ${red.missing.length} öğe yok (elle silinmiş / taşınmış) — onlar bağlanmaz, ${linkable.length} grup var olan öğeleriyle bağlanır. `
        : `${bind.groups.length} grubun bütün öğeleri yerinde. `) +
      "Kesilmiş düzen yeniden analiz edilmez — kayıttaki gruplar kullanılır. Kesme/silme yok → yalnız bağlama (yedek alınmaz). " +
      (chk.mixed.length
        ? `KARIŞIK KANAL: ${chk.mixed.length} grupta ${chk.kinds} ses var; Premiere grubu reddederse yardımcı kanal tipi farklı sesleri çıkarıp grubu yeniden bağlar — o sesler bağ dışında, yerinde kalır (hiçbir klip silinmez). `
        : "") +
      "Devam?",
    [
      `Kesim yerinde; ${linkable.length} grup yalnız bağlanacak.`,
      ...(red.missing.length ? [`EKSİK: ${red.missing.length} öğe kesimden sonra silinmiş / taşınmış — onlar bağlanmaz.`] : []),
      ...mixedLine(chk),
      "Kesme / silme yok, yedek alınmaz. Devam?",
    ],
    { title: `${linkable.length} grup bağlansın mı?` }
  );
  if (ans !== "Evet") {
    log("İptal edildi — hiçbir şey değişmedi.", "warn");
    return;
  }
  const sF = await snapshot(ctx);
  if (!multisetEqual(s0, sF)) throw new SpreadStop("Onay beklerken timeline değişti. Güvenlik için durduruldu (hiçbir şey yapılmadı).");
  await handToPanel(ctx, bind, lf, null, false);
  const p2 = await pingRetry(3);
  setHelperStatus(p2.ok, p2.detail);
  if (!p2.ok) {
    await handToPanel(ctx, bind, lf, p2.detail, false);
    forgetStopped(ctx.guid);
    return;
  }
  const lr = await linkGroups(ctx, linkable, sF, false);
  saveBindRecord(ctx.guid, { ...bind, stage: "linked", at: new Date().toISOString() });
  forgetStopped(ctx.guid);
  reportLinked(linkable.length, lr.unverified, [], { excluded: lr.excluded, nExcluded: lr.nExcluded, missing: red.missing });
}

export async function runBind(): Promise<void> {
  const executed: string[] = [];
  let backupName: string | null = null;
  let ctx: SeqContext | null = null;
  let cutsDone = false; // kesme/silme doğrulandıysa, bağlama hatasında tekrar basmak GÜVENLİ (yarım iş sayılmaz)
  let calRestored = false; // kalibrasyon kural vermedi ama düzen birebir eski hâlinde (doğrulandı) → yarım iş değil
  const linker = getLinker();
  log("▶ BAĞLA", "head");
  try {
    // 0) yardımcı (köprü) — yoksa KES yine yapılır; bağlama Spread Helper panelinden
    const ping = await linker.ping();
    setHelperStatus(ping.ok, ping.detail);
    if (ping.ok) log(`✓ Yardımcı ${ping.detail}`, "ok");
    else {
      log(`Yardımcıya köprü yok: ${ping.detail}`, "warn");
      for (const h of linker.installHint()) log(`   ${h}`, "dim");
      log("→ KES yine yapılabilir; bağlama sonra Spread Helper panelindeki BAĞLA ile (ya da köprü düzelince burada).", "dim");
    }

    ctx = await requireActive();
    log(`sequence: "${ctx.name}"`, "dim");
    const s0 = await snapshot(ctx);
    // v1.2.1: kayıt ipucudur, kilit değil — tutmayan kayıt silinir; tutan kayıtta yalnız soru
    await reconcileAndLog(ctx.guid, s0);
    if (!(await confirmNotStopped(ctx, s0, "BAĞLA"))) return log("İptal edildi — hiçbir şey değişmedi.", "warn");
    if (!(await confirmRedo(ctx.guid, s0, "bagla"))) return;
    for (const w of s0.warnings) throw new SpreadStop(`Okuma sorunu: ${w}. BAĞLA BAŞLAMADI.`);
    const readErr = s0.clips.flatMap((c) => c.readErrors.map((e) => `${where(c)} — ${e}`));
    if (readErr.length) throw new SpreadStop("Bazı klipler okunamadı. BAĞLA BAŞLAMADI.", readErr);

    // TOPLA kaydı: çerçeve, eşleme, eşik, park listesi (+ varsa BAĞLA aşaması) — tahmin yok
    let rec = loadRecord(ctx.guid);
    if (!rec)
      throw new SpreadStop(
        "Önce TOPLA'ya bas: bu sequence için TOPLA kaydı yok (TOPLA bu panelde bu sequence'ta tamamlanmadı, geri alındı ya da panel verisi silindi). BAĞLA BAŞLAMADI, hiçbir şey değişmedi."
      );
    let bs = bindState(rec, s0);
    if (bs === "partial") {
      // v1.2.1: BAĞLA kaydı bu düzenle tutmuyor → bayat: unutulur; BAĞLA planını canlı timeline'dan kurar (ön koşullar aşağıda denetlenir)
      saveBindRecord(ctx.guid, null);
      log(stale("Bağla"), "warn");
      rec = loadRecord(ctx.guid)!;
      bs = bindState(rec, s0);
    }
    if (bs === "applied" || bs === "thinned") return await linkOnly(ctx, rec, rec.bind!, s0, ping);

    const items = classify(s0);
    const mapping = mappingFor(sourcesOf(items));
    const drift = recordDrift(rec, mapping, Math.round(getThreshold() * 100));
    if (drift.length)
      throw new SpreadStop("Ayar TOPLA'dan sonra değişti — TOPLA'ya tekrar bas (oturumlar ve track'ler yeni ayarla yeniden kurulur). BAĞLA BAŞLAMADI, hiçbir şey değişmedi.", drift);
    const frame = frameFromRecord(rec.frame);
    const parked = parkedFromRecord(items, rec);
    const a = analyze(s0, items, { threshold: rec.thresholdPct / 100, exclude: parked });
    const plan = makeBindPlan(a, mapping, { base: frame.keptBase, count: frame.keptCount }, await frameTicks(ctx));
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
    for (const d of a.duplicates) pre.push(`çift kopya: ${d} — önce TOPLA'ya bas (harici ses çiftini ilk adımında siler; kamera çiftini elle sil)`);
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
    // bağlama grupları + KES'TEN ÖNCE kanıt: yardımcı panelin "düzenden gruplar" kuralı, KES'ten sonra BEKLENEN düzende AYNI grupları
    // buluyor mu (bulamayacaksa hiçbir şeye dokunmadan dur — iki yol birbirinden sapamaz)
    const lf = layoutFrameOf(rec);
    const targets = linkTargets(plan);
    const groups = targets.filter((t) => t.items.length >= 2);
    const specs: LinkSpec[] = groups.map((t) => ({ id: t.group.id, label: t.label, items: t.items }));
    if (!plan.errors.length) {
      const fin = expectedFinalClips(s0, plan);
      const mm = layoutMismatch(fin, lf, specs);
      if (mm.length)
        plan.errors.push(`yardımcıyla ortak "düzenden gruplar" kuralı KES'ten sonra bu grupları bulamayacak (iç tutarsızlık — raporu getir): ${mm.slice(0, 4).join(" | ")}`);
      // KES'ten sonraki düzende aynı track'te üst üste binen klip olmamalı (ör. "korunan kamera sesi" track'inde duran başka bir klip:
      // TX-4 onun üstüne yazardı) → düzenlemeden ÖNCE dur
      const ov = snapshotOverlaps({ vCount: s0.vCount, aCount: s0.aCount, clips: fin, warnings: [], gen: 0 });
      for (const o of ov) plan.errors.push(`KES'ten sonra üst üste binecek: ${o} — o track'teki klibi başka bir track'e al`);
    }
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
    const extCuts = plan.cuts.filter((c) => !c.pieces[0]?.camera);
    const nPieces = extCuts.reduce((n, c) => n + c.pieces.length, 0);
    const nKept = plan.pieces.filter((p) => p.camera).length;
    const edits = deletes.length + plan.cuts.length > 0;
    const host = hostVersion();
    const cached = plan.cuts.length ? loadTrimCal(ctx.guid, host) : null;
    // v1.1.0: kanal tipi (salt okuma) — karışık gruplar onayda tek satır
    const chk = await channelCheck(ctx, plan, groups, ping.ok);
    logChannelCheck(chk);

    const ans = await askUser(
      `BAĞLA: ${plan.groups.length} grup (çapa = gruptaki en uzun kamera klibi). ` +
        `${extCuts.length} harici ses ${nPieces} parçaya kesilecek, ${plan.pieces.filter((p) => p.whole).length} ses olduğu gibi kalacak` +
        `${nKept ? `, ${nKept} korunan kamera sesi parçası kesilecek` : ""}; ` +
        `silinecek: ${plan.deleteGuides.length} kılavuz ses, ${plan.deleteSil.length} "sil" kaynağı klibi, ${plan.deleteOutside.length} çapa dışı ses; ` +
        `${[...plan.keptGuides.values()].reduce((n, g) => n + g.length, 0)} kamera sesi (grubunda harici ses yok) korunacak. ` +
        (plan.camless.length ? `${plan.camless.length} kamerasız oturumun (${plan.camless.map((x) => x.id).join(", ")}) seslerine dokunulmayacak. ` : "") +
        `Kaynaklar: ${plan.keptSources.join(", ") || "yok"}. Kesim yalnız oturum içinde. ` +
        (ping.ok
          ? `Sonra ${groups.length} grup yardımcıyla (köprü) bağlanacak. `
          : `Yardımcıya köprü YOK → yalnız KES yapılacak; ${groups.length} grup sonra Spread Helper panelindeki BAĞLA ile bağlanacak. `) +
        `${plan.warnings.length ? `${plan.warnings.length} uyarı (günlükte). ` : ""}` +
        (chk.mixed.length
          ? `KARIŞIK KANAL: ${chk.mixed.length} grupta ${chk.kinds} ses var; Premiere grubu reddederse yardımcı kanal tipi farklı sesleri ` +
            "çıkarıp grubu yeniden bağlar — o sesler bağ dışında, yerinde kalır (hiçbir klip silinmez). "
          : "") +
        (plan.keptCamera.length
          ? `\nKAMERA SESİ KORUNACAK (harici ses parçasının olmadığı aralıkta — çapa içindeki boşluk ya da çapa dışına taşan kamera kısmı, harici ses çapaya göre kesildiği için — kamera sesi o aralığa kesilip "korunan kamera sesi" track'ine konacak ve gruba bağlanacak):\n${plan.keptCamera
              .slice(0, 8)
              .map((x) => "  • " + x)
              .join("\n")}${plan.keptCamera.length > 8 ? `\n  … ${plan.keptCamera.length - 8} tane daha (günlükte)` : ""}\n`
          : "") +
        (plan.silent.length
          ? `\nSESSİZ KALACAK (harici ses parçası yok ve kamera sesi korunamıyor):\n${plan.silent
              .slice(0, 8)
              .map((x) => "  • " + x)
              .join("\n")}${plan.silent.length > 8 ? `\n  … ${plan.silent.length - 8} tane daha (günlükte)` : ""}\n`
          : "") +
        (plan.cuts.length
          ? cached
            ? `Kırpma: bu sequence'ta ölçülmüş kural (${fmtRule(cached.rule)}; ${cached.at}). `
            : "Kırpma: bu sequence'ta ilk kesim → önce KALİBRASYON (set action'lar park alanındaki geçici kopyalarda AYRI adımlarda tek tek, sonra seçilen kural baş + kuyruk birlikte ölçülür; 7 adım, düzeni değiştirmez, kopyalar sonra silinir). "
          : "") +
        `${edits ? "Önce yedek sequence oluşturulacak." : "Kesme/silme yok → yalnız bağlama (yedek alınmaz)."} Devam?`,
      // özet (yalnız görünüm; tam metin "Ayrıntı ▸" altında)
      [
        `${plan.groups.length} grup bağlanacak; ${extCuts.length} harici ses ${nPieces} parçaya kesilecek (yalnız kendi oturumunda).`,
        ...(deletes.length
          ? [
              `Silinecek: ${[
                plan.deleteGuides.length ? `${plan.deleteGuides.length} kamera kılavuz sesi` : "",
                plan.deleteSil.length ? `${plan.deleteSil.length} "Sil" kaynağı klibi` : "",
                plan.deleteOutside.length ? `${plan.deleteOutside.length} çapa dışı ses` : "",
              ]
                .filter(Boolean)
                .join(", ")}.${edits ? ` Önce yedek sequence alınır ("${ctx.name}" kopyası).` : ""}`,
            ]
          : []),
        ...(plan.keptCamera.length ? [`KAMERA SESİ KORUNACAK: ${plan.keptCamera.length} aralıkta (harici ses parçası olmayan yerler).`] : []),
        ...mixedLine(chk),
        ...(plan.silent.length
          ? [`SESSİZ KALACAK: ${plan.silent[0]}${plan.silent.length > 1 ? ` (+${plan.silent.length - 1} aralık daha)` : ""}`]
          : []),
        ...((): string[] => {
          const n = [
            plan.cuts.length && !cached ? "ilk kesimde kırpma komutları önce geçici kopyalarda ölçülür (7 adım, düzen değişmez)" : "",
            ping.ok ? "" : "yardımcı kapalı: kesimden sonra Spread Helper panelinde BAĞLA'ya basacaksın",
            plan.camless.length ? `${plan.camless.length} kamerasız oturumun seslerine dokunulmaz` : "",
            plan.warnings.length ? `${plan.warnings.length} uyarı` : "",
          ].filter(Boolean);
          return n.length ? [`Not: ${n.join("; ")}.`] : [];
        })(),
        deletes.length ? "Devam?" : edits ? `Önce yedek sequence alınır ("${ctx.name}" kopyası). Devam?` : "Kesme/silme yok; yalnız bağlanacak. Devam?",
      ],
      { title: edits ? `${groups.length} grup kesilip bağlansın mı?` : `${groups.length} grup bağlansın mı?` }
    );
    if (ans !== "Evet") {
      log("İptal edildi — hiçbir şey değişmedi.", "warn");
      return;
    }

    let sF: Snapshot;
    if (edits) {
      progress(0.05, "Yedek sequence alınıyor…");
      const backup = await makeBackup(ctx, "BAĞLA");
      backupName = backup.name;
      let s1 = await snapshot(ctx);
      if (!multisetEqual(s0, s1)) throw new SpreadStop("Yedek alınırken asıl sequence'ın klipleri değişti. Durduruldu.");

      // KALİBRASYON (sequence'ta ilk kesimde): set action'ların etkisi geçici kopyalarda ölçülür, kural seçilir, kopyalar silinir
      let cal: TrimCal | null = cached;
      let s1Before: Snapshot | null = null; // kalibrasyonun son adımından önceki düzen (kullanıcı onu geri alırsa sayı doğru kalsın)
      if (plan.cuts.length && !cal) {
        await expectState(ctx, s1, null, executed);
        const co = await calibrateTrim(ctx, executed, s1, firstSlot(makeSlots(plan, 0n))!.piece.src, ctx.guid, host);
        s1 = co.after;
        s1Before = co.beforeLast;
        if (!co.cal) {
          calRestored = true;
          const stop = new SpreadStop(
            "KALİBRASYON TUTARLI BİR KURAL VERMEDİ — hiçbir kesim yapılmadı; kalibrasyon kopyaları silindi, timeline BAĞLA öncesiyle birebir " +
              "aynı (doğrulandı). " +
              FALLBACK,
            [...co.lines, ...co.why]
          );
          stop.restored = true;
          throw stop;
        }
        cal = co.cal;
        const saved = saveTrimCal(cal);
        log(
          `KALİBRASYON SONUCU (kanıtlanmış — Premiere ${host}; ${saved ? "bu sequence için saklandı" : "Premiere sürümü okunamadığı için SAKLANMADI, her BAĞLA'da yeniden ölçülür"}; handoff.md'ye işlenecek):`,
          "ok"
        );
        for (const l of [...describeCal(cal), ...co.lines.filter((x) => /BİRLİKTE/.test(x))]) log(`   ${l}`, "ok");
      } else if (cal) log(`Kırpma kuralı (bu sequence'ta ${cal.at} ölçüldü, Premiere ${cal.host}): ${fmtRule(cal.rule)}.`, "dim");

      // TX-1 kesim hazırlığı: park kopyaları + silme (tek seçim)
      await expectState(ctx, s1, s1Before, executed);
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
      progress(0.42, "Kesim hazırlanıyor (kılavuz sesler siliniyor)…");
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
        if (!cal) throw new SpreadStop("iç hata: kesilecek parça var ama kırpma kuralı yok (raporu getir).");
        // TX-2 ilk parça (ölçüm) → TX-3 kalanlar → TX-4 yerleştir. Her adımdan önce: timeline beklenen hâlde mi (geri alınan adım düşülür)
        const first = firstSlot(slots)!;
        let prev = s1;
        await expectState(ctx, s, prev, executed);
        log(
          `TX-2 (ilk parça — ölçüm): "${first.piece.src.name}" → [${secOf(first.piece.start)}s–${secOf(first.piece.end)}s] ` +
            `(${fmtRule(cal.rule)}; kenar başına tek action, farkı 0 olan kenara action yok).`
        );
        prev = s;
        progress(0.5, "İlk ses parçası kesiliyor (ölçüm)…");
        s = await trimTx(ctx, executed, "ilk parça", s0, plan, slots, new Set(), [first], cal);
        const rest = slots.filter((x) => x !== first);
        if (rest.length) {
          await expectState(ctx, s, prev, executed);
          log(`TX-3 (parçalar): ${rest.length} parça kırpılıyor.`);
          progress(0.6, `${rest.length} ses parçası kesiliyor…`);
          prev = s;
          s = await trimTx(ctx, executed, "parçalar", s0, plan, slots, new Set([first]), rest, cal);
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
        log(`TX-4 (yerleştir): ${work.length} parça asıl yerine (korunan kamera sesi kendi track'ine) → park kopyaları siliniyor.`);
        progress(0.75, `${work.length} parça yerine konuyor…`);
        await runTx(ctx, executed, "yerleştir", "BAĞLA: yerleştir", (ops) => {
          for (const { sl, c } of work) ops.clone(c, ticks(-sl.offset), 0, sl.piece.track - c.track);
          ops.remove(so4.sel);
        });
        await settle();
      }
      sF = await snapshot(ctx);
      const fin = [...compareLayout(expectBindFinal(s0, plan), sF), ...verifyBindContent(plan, extFinal(sF)), ...snapshotOverlaps(sF)];
      if (fin.length) throw new SpreadStop("Kesme doğrulaması tutmadı.", fin);
      cutsDone = true;
      log(
        `✓ Kesme/silme doğrulandı: ${nPieces} harici ses parçası${nKept ? ` + ${nKept} korunan kamera sesi parçası` : ""} tick düzeyinde doğru; ` +
          `her çapa içindeki harici ses süresi aynı; kaynak kayması yok; silinecek kılavuz sesler ve "sil" kaynakları silindi` +
          `${nKept ? ` (kamera sesi yalnız "korunan kamera sesi" track'inde, harici sesin olmadığı aralıklarda)` : ""}.`,
        "ok"
      );
    } else {
      sF = await snapshot(ctx);
      if (!multisetEqual(s0, sF)) throw new SpreadStop("Onay beklerken timeline değişti. Güvenlik için durduruldu (hiçbir şey yapılmadı).");
      const fin = verifyBindContent(plan, extFinal(sF));
      if (fin.length) throw new SpreadStop("Düzen beklenen hâlde değil.", fin);
      cutsDone = true;
    }
    // KES'ten SONRA gerçek düzende aynı kanıt (yardımcı panel de tam bunu yapacak)
    const mmF = layoutMismatch(sF.clips, lf, specs);
    if (mmF.length) throw new SpreadStop("KES doğrulandı ama yardımcıyla ortak 'düzenden gruplar' kuralı planın gruplarını bulmuyor — bağlama yapılmadı (raporu getir).", mmF);
    // kesme/silme doğrulandı → bağlama grupları kayda (yeniden basınca yalnız bağlama; kesilmiş düzen yeniden analiz edilmez)
    const created: LinkItemRec[] = plan.pieces
      .filter((p) => !p.whole)
      .map((p) => ({ kind: "A", track: p.track, start: String(p.start), end: String(p.end), name: itemOf(p.src).name }));
    const removed: LinkItemRec[] = [...deletes, ...plan.cuts.map((c) => c.src)].map(itemOf);
    const bind: BindRecord = { stage: "cut", groups: specs, created, removed, at: new Date().toISOString() };
    saveBindRecord(ctx.guid, bind);

    for (const t of targets.filter((x) => x.items.length < 2)) log(`   ${t.label}: bağlanacak ikinci öğe yok — atlandı`, "dim");
    // köprü: başta yoksa bir kez, varsa birkaç kez yokla (ağır transaction'lardan sonra ilk yanıt gecikebilir; kullanıcı bu arada
    // yardımcı paneli açmış olabilir). Yoksa plan yardımcı panele bırakılır — KES tamam, bu bir hata değil.
    await handToPanel(ctx, bind, lf, null, edits);
    const p2 = await pingRetry(ping.ok ? 3 : 1);
    setHelperStatus(p2.ok, p2.detail);
    if (!p2.ok) {
      await handToPanel(ctx, bind, lf, p2.detail, edits);
      forgetStopped(ctx.guid);
      if (executed.length) log(`Beğenmezsen: yedek sequence "${backupName}"i kullan (ya da Ctrl+Z × ${executed.length}).`, "dim");
      return;
    }
    const lr = await linkGroups(ctx, specs, sF, edits);
    saveBindRecord(ctx.guid, { ...bind, stage: "linked" });
    forgetStopped(ctx.guid);
    reportLinked(groups.length, lr.unverified, executed, { excluded: lr.excluded, nExcluded: lr.nExcluded, missing: [] });
    if (executed.length) log(`Beğenmezsen: yedek sequence "${backupName}"i kullan (ya da Ctrl+Z; ${LINK_UNDO_NOTE})`, "dim");
  } catch (e) {
    // kalibrasyon kural vermedi ama düzen doğrulanarak eski hâlinde → "yarım iş" kaydı tutulmaz (başka bir kayda da dokunulmaz)
    if (executed.length && ctx && !cutsDone && !calRestored) await rememberStopped(ctx, "BAĞLA");
    else if (cutsDone && ctx) forgetStopped(ctx.guid);
    reportStop("BAĞLA", e, executed, backupName, !calRestored && executed.length ? [LINK_UNDO_NOTE] : []);
  }
}
