// T1–T8 yoklama testleri. SPREAD / RE-STACK burada YOK; sadece API davranışı ölçülür.
// Her test: requireProbe() ile başlar (PROBE_ kilidi), sequence'ı BAŞTAN okur, önceki testten referans devralmaz.
// Her düzenlemeden önce transact()/selectExactly() kilidi yeniden doğrular.
// KURAL (v0.1.0 raporu): TrackItem referansı bir transaction'dan sonrakine TAŞINMAZ — bkz. timeline.ts useRef/invalidateRefs.

import type { Sequence } from "./ppro";
import {
  assertStillProbe,
  getActive,
  isProbeName,
  ProbeLockError,
  requireProbe,
  sequenceGuid,
  sequenceName,
  type ProbeContext,
} from "./guard";
import {
  added,
  classifyError,
  emptyTracks,
  errText,
  FAIL_LABEL,
  findProbeSet,
  fmtClip,
  invalidateRefs,
  keyFull,
  keyNoTime,
  locKey,
  readSelection,
  relocate,
  removed,
  selectExactly,
  settle,
  sleep,
  snapshot,
  tickDiff,
  ticks,
  trackLabel,
  transact,
  type ClipInfo,
  type FailClass,
  type Kind,
  type Snapshot,
  type TxResult,
} from "./timeline";
import { ask, log, type Answer } from "./ui";

export type Status = "PASS" | "FAIL" | "BELİRSİZ";

export interface TestResult {
  id: string;
  title: string;
  status: Status;
  /** FAIL ise: "api" (API eksik / davranış yok) | "kod" (bizim kullanımımız) | "belirsiz" */
  failClass: FailClass | null;
  failWhy: string | null;
  lines: string[];
  facts: Record<string, unknown>;
  ranAt: string;
  lockError: boolean;
}

class Rec {
  lines: string[] = [];
  facts: Record<string, unknown> = {};
  status: Status = "BELİRSİZ";
  failClass: FailClass | null = null;
  failWhy: string | null = null;
  lockError = false;
  constructor(public id: string, public title: string) {}
  m(msg: string, tone: "info" | "ok" | "warn" | "err" | "dim" = "info"): void {
    this.lines.push(msg);
    log(`  ${msg}`, tone);
  }
  /** Ölçülmüş bir FAIL. "api" yalnızca taze referans + Adobe kalıbıyla yapılmış bir çağrının sonucu için verilir. */
  fail(cls: FailClass, why: string): void {
    this.status = "FAIL";
    this.failClass = cls;
    this.failWhy = why;
    this.m(`✗ FAIL [${FAIL_LABEL[cls]}] ${why}`, "err");
  }
  pass(msg: string): void {
    this.status = "PASS";
    this.m(`✓ ${msg}`, "ok");
  }
  unclear(msg: string): void {
    this.status = "BELİRSİZ";
    this.m(`? ${msg}`, "warn");
  }
}

type TestFn = (ctx: ProbeContext, r: Rec) => Promise<void>;

export interface TestDef {
  id: string;
  title: string;
  fn: TestFn;
}

const yesNo = (b: boolean | null | undefined) => (b === null || b === undefined ? "ÖLÇÜLEMEDİ" : b ? "EVET" : "HAYIR");

/** Kullanıcıya sor. Kullanıcı timeline'da bir şey yapmış olabilir → eldeki tüm referanslar bayat. */
async function askUser(q: string): Promise<Answer> {
  const a = await ask(q);
  invalidateRefs();
  return a;
}

function listClips(r: Rec, title: string, clips: ClipInfo[], tone: "info" | "warn" | "dim" = "dim"): void {
  if (clips.length === 0) {
    r.m(`${title}: (yok)`, tone);
    return;
  }
  r.m(`${title}: ${clips.length}`, tone);
  for (const c of clips) r.m(`    • ${fmtClip(c)}`, tone);
}

function txLine(r: Rec, label: string, tx: TxResult): void {
  r.m(
    `${label}: executeTransaction → ${tx.ok}; addAction → [${tx.addResults.join(", ")}]; compound.empty → ${String(tx.compoundEmpty)}`,
    tx.ok ? "info" : "warn"
  );
}

async function probeSet(ctx: ProbeContext, r: Rec) {
  const s = await snapshot(ctx);
  const ps = findProbeSet(s);
  for (const n of ps.notes) r.m(`not: ${n}`, "warn");
  for (const w of s.warnings) r.m(`uyarı: ${w}`, "warn");
  return { s, ps };
}

// T4 / T3 / T8 sadakat alanları (tolerans 0)
const FIELDS: { key: keyof ClipInfo; label: string; ticks: boolean }[] = [
  { key: "start", label: "start", ticks: true },
  { key: "end", label: "end", ticks: true },
  { key: "inPt", label: "inPoint", ticks: true },
  { key: "outPt", label: "outPoint", ticks: true },
  { key: "speed", label: "speed", ticks: false },
  { key: "disabled", label: "disabled", ticks: false },
  { key: "name", label: "name", ticks: false },
];

/** Aslı↔kopya alan alan karşılaştırır; farklı alanları "etiket:alan" olarak döndürür. */
function compareFields(r: Rec, label: string, orig: ClipInfo, copy: ClipInfo): string[] {
  const bad: string[] = [];
  r.m(`${label}: asıl ${trackLabel(orig.kind, orig.track)} ↔ kopya ${trackLabel(copy.kind, copy.track)}`);
  for (const f of FIELDS) {
    const a = orig[f.key];
    const b = copy[f.key];
    const eq = a === b;
    if (!eq) bad.push(`${label}:${f.label}`);
    const extra = f.ticks && !eq ? ` fark=${tickDiff(String(a), String(b))} tick` : "";
    r.m(`   ${eq ? "✓" : "✗"} ${f.label}: asıl=${String(a)} kopya=${String(b)}${extra}`, eq ? "dim" : "err");
  }
  return bad;
}

/** Multiset anahtar karşılaştırması için: sıralı keyFull listesi (referans DEĞİL, sadece değer). */
const keysOf = (s: Snapshot) => s.clips.map(keyFull).sort();
const sameKeys = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

interface CloneOutcome {
  pre: Snapshot;
  post: Snapshot;
  src: ClipInfo;
  newClips: ClipInfo[];
  lost: ClipInfo[];
  tx: TxResult;
}

/**
 * Klibi zaman ofseti 0 ile başka bir track'e kopyalar (tek transaction). Sequence'ı transaction'dan HEMEN ÖNCE baştan okur.
 *  target "new"  : hedef = track sayısı (ilk OLMAYAN track) → track açılıyor mu ölçülür (T2).
 *  target "empty": hedef = mevcut ilk boş track, yoksa yeni → sadakat track açmadan ölçülür (T4).
 * Kaynak V ise vOffset = hedefV - klibinTrack; bağlı ses gelirse aslını ezmesin diye aOffset = hedefA - sesinTrack.
 * Kaynak A ise aOffset = hedefA - klibinTrack; vOffset = hedefV - 0 (bağlı bir video olsaydı V1'i ezmesin).
 */
async function cloneToTracks(
  ctx: ProbeContext,
  r: Rec,
  clip: ClipInfo,
  linkedAudio: ClipInfo | null,
  label: string,
  target: "new" | "empty" = "new"
): Promise<CloneOutcome> {
  const pre = await snapshot(ctx);
  const src = relocate(pre, clip);
  if (!src) throw new Error(`${label}: kaynak klip timeline'da artık bulunamadı (${fmtClip(clip)})`);
  const vTarget = target === "empty" ? emptyTracks(pre, "V")[0] : pre.vCount;
  const aTarget = target === "empty" ? emptyTracks(pre, "A")[0] : pre.aCount;
  const linked = linkedAudio ? relocate(pre, linkedAudio) : null;
  const vOffset = vTarget - (src.kind === "V" ? src.track : 0);
  const aOffset = aTarget - (src.kind === "A" ? src.track : linked ? linked.track : 0);
  r.m(
    `${label}: createCloneTrackItemAction(${fmtClip(src)}, timeOffset=0, vOffset=${vOffset}, aOffset=${aOffset}, alignToVideo=false, isInsert=false)`
  );
  const tgt = src.kind === "V" ? vTarget : aTarget;
  const cnt = src.kind === "V" ? pre.vCount : pre.aCount;
  r.m(
    `   mevcut: V1..V${pre.vCount}, A1..A${pre.aCount} → hedef: ${trackLabel(src.kind, tgt)} (${tgt >= cnt ? "henüz yok" : "mevcut, boş"})`,
    "dim"
  );
  const tx = await transact(ctx, `PROBE ${label}`, (ops) => {
    ops.clone(src, vOffset, aOffset);
  });
  txLine(r, label, tx);
  await settle();
  const post = await snapshot(ctx);
  const newClips = added(pre, post);
  const lost = removed(pre, post);
  r.m(`   track sayısı: V ${pre.vCount}→${post.vCount}, A ${pre.aCount}→${post.aCount}`);
  listClips(r, "   yeni klipler", newClips);
  if (lost.length) listClips(r, "   ⚠ değişen/kaybolan ESKİ klipler", lost, "warn");
  return { pre, post, src, newClips, lost, tx };
}

// T3 → T6 köprüsü: yalnızca DEĞERLER (anahtar listeleri), referans değil.
let lastT3: { guid: string; preKeys: string[]; postKeys: string[]; pre: { V: number; A: number } } | null = null;

export function resetRunState(): void {
  lastT3 = null;
}

// ------------------------------------------------------------------ T1
const t1: TestFn = async (ctx, r) => {
  const before = await ctx.project.getSequences(); // d.ts:L2520 Project.getSequences
  const beforeIds = new Set(before.map(sequenceGuid));
  r.m(`Önce: projede ${before.length} sequence var.`);
  const tx = await transact(ctx, "PROBE T1 sequence yedek", (ops) => {
    ops.cloneSequence(); // → Sequence.createCloneAction (timeline.ts transact)
  });
  txLine(r, "createCloneAction", tx);

  let fresh: Sequence[] = [];
  let total = before.length;
  for (let i = 0; i < 10 && fresh.length === 0; i++) {
    await sleep(300);
    const after = await ctx.project.getSequences(); // d.ts:L2520 Project.getSequences
    total = after.length;
    fresh = after.filter((s) => !beforeIds.has(sequenceGuid(s)));
  }
  r.m(`Sonra: projede ${total} sequence var; yeni: ${fresh.length}`);
  const names = fresh.map(sequenceName);
  for (const n of names) r.m(`   yeni sequence adı: "${n}" (PROBE_ ile başlıyor mu: ${yesNo(isProbeName(n))})`);

  const { sequence: activeNow } = await getActive();
  const activeGuid = activeNow ? sequenceGuid(activeNow) : null;
  const activeChanged = activeGuid !== ctx.guid;
  const cloneBecameActive = activeGuid !== null && fresh.some((s) => sequenceGuid(s) === activeGuid);
  r.m(
    `Aktif sequence değişti mi: ${
      !activeChanged ? "HAYIR" : cloneBecameActive ? "EVET → yeni kopya aktif oldu" : `EVET → "${activeNow ? sequenceName(activeNow) : "(yok)"}" (kopya değil)`
    }`,
    activeChanged ? "warn" : "info"
  );

  const returned: boolean | null = null;
  r.facts = { cloneCreated: fresh.length === 1, cloneName: names[0] ?? null, activeChanged, cloneBecameActive, returnedToOriginal: returned };
  if (activeChanged && !cloneBecameActive) {
    // Kullanıcı bilerek başka sequence'a geçmiş: zorla geri dönme, dur.
    throw new ProbeLockError("T1 sırasında kullanıcı başka bir sequence'a geçti. Güvenlik için durduruldu (geri dönülmedi).");
  }
  if (cloneBecameActive) {
    // Sonraki testler yedeğe değil ASLINA dokunsun: yalnız "kopya aktif oldu" durumunda orijinale dön.
    if (!isProbeName(sequenceName(ctx.sequence))) throw new ProbeLockError("Orijinal sequence'ın adı artık PROBE_ değil.");
    const back = await ctx.project.setActiveSequence(ctx.sequence); // d.ts:L2590 Project.setActiveSequence
    r.m(`   → orijinal "${ctx.name}" tekrar aktif yapıldı (setActiveSequence): ${String(back)}`, back ? "info" : "err");
    r.facts.returnedToOriginal = back;
  }
  if (fresh.length === 1) r.pass(`yedek sequence oluştu: "${names[0]}"`);
  else if (fresh.length === 0) r.fail("api", "createCloneAction yeni sequence oluşturmadı");
  else r.unclear(`${fresh.length} yeni sequence göründü`);
};

// ------------------------------------------------------------------ T2
const t2: TestFn = async (ctx, r) => {
  const { ps } = await probeSet(ctx, r);
  if (!ps.camV) return r.unclear("V1'de kamera klibi yok; test yapılamadı.");

  // --- Video (clone hata verirse de yedek yönteme geçilsin diye yakalanır)
  let openedV = false;
  try {
    const v = await cloneToTracks(ctx, r, ps.camV, ps.camA, "T2 video");
    const newV = v.newClips.filter((c) => c.kind === "V" && c.projId === v.src.projId);
    openedV = v.post.vCount > v.pre.vCount && newV.some((c) => c.track >= v.pre.vCount);
    if (!openedV && newV.length) r.m(`   kopya mevcut bir track'e düştü: ${newV.map(fmtClip).join("; ")}`, "warn");
  } catch (e) {
    if (e instanceof ProbeLockError) throw e;
    r.m(`   clone HATA verdi: ${errText(e)} [${classifyError(e).cls}]`, "err");
  }
  r.m(`→ Video: yeni track açıldı mı: ${yesNo(openedV)}`, openedV ? "ok" : "err");

  // --- Ses (bağlı olmayan harici ses tercih edilir)
  let openedA = false;
  const audioSrc = ps.ext[0] ?? ps.camA;
  if (!audioSrc) {
    r.m("Ses için kopyalanacak klip yok.", "err");
  } else {
    try {
      const a = await cloneToTracks(ctx, r, audioSrc, null, "T2 ses");
      const newA = a.newClips.filter((c) => c.kind === "A" && c.projId === a.src.projId);
      openedA = a.post.aCount > a.pre.aCount && newA.some((c) => c.track >= a.pre.aCount);
      if (!openedA && newA.length) r.m(`   kopya mevcut bir track'e düştü: ${newA.map(fmtClip).join("; ")}`, "warn");
    } catch (e) {
      if (e instanceof ProbeLockError) throw e;
      r.m(`   clone HATA verdi: ${errText(e)} [${classifyError(e).cls}]`, "err");
    }
    r.m(`→ Ses: yeni track açıldı mı: ${yesNo(openedA)}`, openedA ? "ok" : "err");
  }

  let fallbackV: boolean | null = null;
  let fallbackA: boolean | null = null;
  const fallbackRan = !openedV || !openedA;

  if (fallbackRan) {
    r.m("Clone ile track açılmadı → YEDEK YÖNTEM: createInsertProjectItemAction (index = track sayısı) + sil", "warn");
    const pre = await snapshot(ctx);
    const cam = relocate(pre, ps.camV) ?? findProbeSet(pre).camV;
    if (!cam) throw new Error("Yedek yöntem: kamera klibi bulunamadı");
    const at = await ctx.sequence.getEndTime(); // d.ts:L3181 Sequence.getEndTime
    const vIdx = pre.vCount;
    const aIdx = pre.aCount;
    r.m(
      `createInsertProjectItemAction("${cam.projName}", time=sequence sonu (${at.seconds.toFixed(3)}s), videoTrackIndex=${vIdx}, audioTrackIndex=${aIdx}, limitShift=true)` // d.ts:L3986 TickTime.seconds
    );
    const tx = await transact(ctx, "PROBE T2 yedek insert", (ops) => {
      ops.insert(cam, at, vIdx, aIdx); // → SequenceEditor.createInsertProjectItemAction (timeline.ts transact)
    });
    txLine(r, "insert", tx);
    await settle();
    const mid = await snapshot(ctx);
    const ins = added(pre, mid);
    r.m(`   insert sonrası track: V ${pre.vCount}→${mid.vCount}, A ${pre.aCount}→${mid.aCount}`);
    listClips(r, "   eklenen", ins);
    const shifted = removed(pre, mid);
    if (shifted.length) listClips(r, "   ⚠ insert eski klipleri değiştirdi", shifted, "warn");

    // Her tür için: seç (Adobe kalıbı; selectExactly sequence'ı baştan okuyup yeniden bulur) → sil. Referans transaction aşmaz.
    for (const kind of ["V", "A"] as Kind[]) {
      const list = ins.filter((c) => c.kind === kind);
      if (!list.length) continue;
      const so = await selectExactly(ctx, list);
      for (const n of so.notes) r.m(`   ${n}`, "dim");
      if (!so.exact) {
        r.m(`   seçim birebir değil → ${kind} silme İPTAL (yanlış klip silinmesin)`, "err");
        continue;
      }
      const tx2 = await transact(ctx, `PROBE T2 yedek sil ${kind}`, (ops) => {
        ops.remove(so.sel, kind);
      });
      txLine(r, `eklenen ${kind === "V" ? "videoyu" : "sesi"} sil (ripple=false)`, tx2);
      await settle();
    }
    const fin = await snapshot(ctx);
    const left = ins.filter((c) => relocate(fin, c));
    r.m(`   sil sonrası track: V ${fin.vCount}, A ${fin.aCount}; eklenenlerden kalan: ${left.length}`);
    fallbackV = fin.vCount > pre.vCount && !left.some((c) => c.kind === "V");
    fallbackA = fin.aCount > pre.aCount && !left.some((c) => c.kind === "A");
    r.m(`→ Yedek: boş VIDEO track kaldı mı: ${yesNo(fallbackV)}; boş SES track kaldı mı: ${yesNo(fallbackA)}`,
      fallbackV && fallbackA ? "ok" : "err");
  }

  r.facts = { openedV, openedA, fallbackRan, fallbackV, fallbackA };
  const okV = openedV || fallbackV === true;
  const okA = openedA || fallbackA === true;
  if (openedV && openedA) r.pass("clone ofsetiyle hem video hem ses için yeni track açılıyor.");
  else if (okV && okA) r.pass("clone ile açılmadı ama YEDEK yöntemle (insert + sil) boş track açılabiliyor.");
  else r.fail("api", "iki yöntemle de gerekli track'ler açılamadı");
};

// ------------------------------------------------------------------ T3
/**
 * TEK executeTransaction içinde: kamera videosunu +kV video track'e, kamera sesini +kA ses track'ine clone et,
 * ikisinin aslını createRemoveItemsAction(ripple=false) ile sil. Seçim ve referanslar transaction'ın hemen öncesinde taze.
 */
const t3: TestFn = async (ctx, r) => {
  const { s: s0, ps } = await probeSet(ctx, r);
  if (!ps.camV || !ps.camA) return r.unclear("Kamera klibi (V1) ve onun sesi gerekli (önceki bir test silmiş olabilir → Edit > Undo).");
  const vT = emptyTracks(s0, "V")[0];
  const aT = emptyTracks(s0, "A")[0];
  const kV = vT - ps.camV.track;
  const kA = aT - ps.camA.track;
  r.m(
    `TEK transaction: clone ${fmtClip(ps.camV)} → ${trackLabel("V", vT)} (+${kV}); clone ${fmtClip(ps.camA)} → ${trackLabel("A", aT)} (+${kA}); ` +
      "asıl video + asıl ses: createRemoveItemsAction(ripple=false, mediaType=VIDEO — Adobe örneğindeki gibi)"
  );
  r.m(`   (her iki clone da aynı hedefe gider: bağlı partner birlikte gelirse aynı yere overwrite olur → tek kopya)`, "dim");

  // Seçim + taze referanslar: transaction'ın HEMEN öncesinde (setSelection'dan sonra baştan okunan snapshot'tan)
  const so = await selectExactly(ctx, [ps.camV, ps.camA]);
  for (const n of so.notes) r.m(`   ${n}`, "dim");
  if (!so.exact) return r.fail("api", "Adobe kalıbıyla (getSelection+addItem+setSelection, taze referans) iki asıl birebir seçilemedi → silme yapılmadı");
  const s1 = so.snap;
  const [camV, camA] = so.fresh;
  if (!camV || !camA) throw new Error("T3: asıllar transaction öncesi yeniden bulunamadı");

  const tx = await transact(ctx, "PROBE T3 tasi (tek adim)", (ops) => {
    ops.clone(camV, kV, kA);
    ops.clone(camA, kV, kA);
    ops.remove(so.sel, "mixed");
  });
  txLine(r, "tek transaction", tx);
  await settle();
  const s2 = await snapshot(ctx);
  lastT3 = { guid: ctx.guid, preKeys: keysOf(s1), postKeys: keysOf(s2), pre: { V: s1.vCount, A: s1.aCount } };

  const origVGone = relocate(s2, camV) === null;
  const origAGone = relocate(s2, camA) === null;
  const plus = added(s1, s2);
  const minus = removed(s1, s2);
  const copiesV = plus.filter((c) => c.kind === "V" && c.projId === camV.projId);
  const copiesA = plus.filter((c) => c.kind === "A" && c.projId === camV.projId);
  const copyV = copiesV.find((c) => c.track === vT) ?? copiesV[0] ?? null;
  const copyA = copiesA.find((c) => c.track === aT) ?? copiesA[0] ?? null;
  r.m(`   track sayısı: V ${s1.vCount}→${s2.vCount}, A ${s1.aCount}→${s2.aCount}`);
  listClips(r, "   eklenen", plus);
  listClips(r, "   silinen/değişen", minus);
  r.m(`→ Asıl video gitti mi: ${yesNo(origVGone)}; asıl ses gitti mi: ${yesNo(origAGone)}`, origVGone && origAGone ? "ok" : "err");
  r.m(`→ Kopyalar: video ${copiesV.length} adet, ses ${copiesA.length} adet (beklenen 1 + 1)`, copiesV.length === 1 && copiesA.length === 1 ? "ok" : "warn");
  const collateral = minus.filter((c) => locKey(c) !== locKey(camV) && locKey(c) !== locKey(camA));
  if (collateral.length) listClips(r, "   ⚠ beklenmeyen şekilde değişen diğer klipler", collateral, "warn");

  const mismatch: string[] = [];
  if (copyV) mismatch.push(...compareFields(r, "kamera video", camV, copyV));
  if (copyA) mismatch.push(...compareFields(r, "kamera sesi", camA, copyA));

  // Bağ kontrolü: d.ts'te "bağlı mı" sorgusu yok → kullanıcı tıklar, panel getSelection ile okur.
  let linkedAnswer: Answer | null = null;
  let selectedCount: number | null = null;
  let autoLinked: boolean | null = null;
  if (copyV && copyA) {
    linkedAnswer = await askUser(
      `Timeline'ın sol üstündeki "Linked Selection" (zincir) açık olsun. ${trackLabel("V", copyV.track)} üzerindeki KOPYA videoya bir kez tıkla. ` +
        `${trackLabel("A", copyA.track)} üzerindeki kopya sesi de seçildi mi (ikisi birden vurgulandı mı)?`
    );
    const rs = await readSelection(ctx);
    selectedCount = rs.count;
    const vSel = rs.clips.some((c) => c.kind === "V" && c.track === copyV.track && c.start === copyV.start);
    const aSel = rs.clips.some((c) => c.kind === "A" && c.track === copyA.track && c.start === copyA.start);
    autoLinked = vSel ? aSel : null;
    r.m(`   panelin okuduğu: getSelection ${rs.count} öğe; kopya video seçili: ${yesNo(vSel)}, kopya ses seçili: ${yesNo(aSel)}`);
    for (const c of rs.clips) r.m(`     seçili: ${fmtClip(c)}`, "dim");
  }
  r.facts = {
    origVGone,
    origAGone,
    copiesV: copiesV.length,
    copiesA: copiesA.length,
    mismatchFields: mismatch,
    collateral: collateral.length,
    linkedAnswer,
    selectedCount,
    autoLinked,
  };
  if (!copyV || !copyA) return r.fail("api", "tek transaction'da kopya(lar) oluşmadı (taze referans + Adobe kalıbı)");
  if (!origVGone || !origAGone)
    return r.fail("api", `asıl ${!origVGone ? "video" : ""}${!origVGone && !origAGone ? " + " : ""}${!origAGone ? "ses" : ""} silinmedi (createRemoveItemsAction, mediaType=VIDEO)`);
  if (mismatch.length) return r.fail("api", `kopya aslıyla birebir değil: ${mismatch.join(", ")}`);
  if (collateral.length) return r.fail("api", `${collateral.length} başka klip değişti`);
  r.pass("tek transaction'da video+ses kopyalandı, asıllar silindi, kopyalar birebir aynı tick'lerde.");
};

// ------------------------------------------------------------------ T4
const t4: TestFn = async (ctx, r) => {
  const { ps } = await probeSet(ctx, r);
  if (!ps.camV) return r.unclear("V1'de kamera klibi yok; test yapılamadı.");
  const pairs: { label: string; orig: ClipInfo; copy: ClipInfo | null }[] = [];

  const c1 = await cloneToTracks(ctx, r, ps.camV, ps.camA, "T4 kamera", "empty");
  pairs.push({
    label: "kamera video",
    orig: c1.src,
    copy: c1.newClips.find((x) => x.kind === "V" && x.projId === c1.src.projId) ?? null,
  });
  const camA = ps.camA ? relocate(c1.pre, ps.camA) : null;
  const copyA = c1.newClips.find((x) => x.kind === "A" && x.projId === c1.src.projId) ?? null;
  if (camA && copyA) pairs.push({ label: "kamera sesi (bağlı gelen)", orig: camA, copy: copyA });

  if (ps.ext[0]) {
    const c2 = await cloneToTracks(ctx, r, ps.ext[0], null, "T4 harici ses", "empty");
    pairs.push({
      label: "harici ses",
      orig: c2.src,
      copy: c2.newClips.find((x) => x.kind === "A" && x.projId === c2.src.projId) ?? null,
    });
  }

  const mismatchFields: string[] = [];
  let compared = 0;
  for (const p of pairs) {
    if (!p.copy) {
      r.m(`${p.label}: KOPYA BULUNAMADI`, "err");
      mismatchFields.push(`${p.label}:kopya-yok`);
      continue;
    }
    compared++;
    mismatchFields.push(...compareFields(r, p.label, p.orig, p.copy));
  }
  r.facts = { pairs: compared, mismatchFields };
  r.m(`${compared} çift karşılaştırıldı (tolerans 0), fark: ${mismatchFields.length ? mismatchFields.join(", ") : "yok"}`);
  if (compared === 0) return pairs.length ? r.fail("api", "hiç kopya oluşmadı") : r.unclear("karşılaştırılacak çift yok");
  if (mismatchFields.length) return r.fail("api", `kopya aslıyla birebir değil: ${mismatchFields.join(", ")}`);
  r.pass("tüm kopyalar aslıyla tick düzeyinde birebir aynı.");
};

// ------------------------------------------------------------------ T5
const t5: TestFn = async (ctx, r) => {
  const { ps } = await probeSet(ctx, r);
  const targets = [ps.camV, ps.camA, ...ps.ext].filter((x): x is ClipInfo => x !== null).slice(0, 3);
  if (targets.length < 2) return r.unclear("Seçilecek en az 2 klip bulunamadı.");
  r.m(`Adobe kalıbı: getSelection → addItem × ${targets.length} → setSelection (önce clearSelection, sonra geri okuma)`);
  const so = await selectExactly(ctx, targets); // klipleri kendisi baştan okuyup yeniden bulur
  for (const n of so.notes) r.m(`   ${n}`, "dim");
  const ans = await askUser(
    `Timeline'a bak: şu ${targets.length} klip SEÇİLİ (vurgulu) görünüyor mu? ` +
      targets.map((t) => `${trackLabel(t.kind, t.track)} "${t.name}"`).join(", ")
  );
  r.facts = { programmaticOk: so.exact, setOk: so.setOk, addResults: so.addResults, readCount: so.readCount, userSees: ans };
  r.m(`→ Programla okunan seçim birebir mi: ${yesNo(so.exact)}; kullanıcı timeline'da görüyor mu: ${ans}`);
  if (ans === "Hayır") return r.fail("api", "setSelection timeline'a yansımıyor (Adobe kalıbı, taze referans)");
  if (!so.setOk || !so.exact) return ans === "Evet" ? r.unclear("kullanıcı 'Evet' dedi ama geri okuma birebir değil") : r.fail("api", "seçim programla kurulamadı (Adobe kalıbı, taze referans)");
  if (ans === "Evet") return r.pass(`${targets.length} klip programla seçildi ve timeline'da görünüyor.`);
  r.unclear("kullanıcı cevabı yok (Atla)");
};

// ------------------------------------------------------------------ T6
const t6: TestFn = async (ctx, r) => {
  const t3state = lastT3;
  if (!t3state || t3state.guid !== ctx.guid) return r.unclear("Önce bu sequence'ta T3 çalışmalı (T6, T3'ün tek transaction'ını geri alır).");
  const now = await snapshot(ctx);
  if (!sameKeys(keysOf(now), t3state.postKeys)) r.m("⚠ T3'ten sonra timeline değişmiş; Ctrl+Z başka bir şeyi geri alabilir.", "warn");
  await assertStillProbe(ctx); // Ctrl+Z istemeden önce: kullanıcı hâlâ PROBE_ sequence'ta mı
  const ans = await askUser(
    `Şimdi Premiere'de "${ctx.name}" timeline'ına bir kez tıkla, sonra Ctrl+Z'ye (Mac: Cmd+Z) YALNIZCA BİR KEZ bas ` +
      "(ya da Edit menüsünden 'Undo PROBE T3…' seç). Buraya dön: T3'ün yaptığı HER ŞEY geri geldi mi? " +
      "(iki kopya kayboldu, asıl video ve ses yerine döndü)"
  );
  await settle();
  const { sequence: activeAfter } = await getActive();
  if (!activeAfter || sequenceGuid(activeAfter) !== ctx.guid) {
    r.m("⚠ Cevap anında aktif sequence PROBE_ değildi: Ctrl+Z başka bir sequence'ta basılmış olabilir.", "warn");
  }
  const post = await snapshot(ctx);
  const restored = sameKeys(keysOf(post), t3state.preKeys);
  r.m(`→ Otomatik karşılaştırma: klipler T3 öncesiyle birebir aynı mı: ${yesNo(restored)}`, restored ? "ok" : "err");
  r.m(`   track sayısı: T3 öncesi V${t3state.pre.V}/A${t3state.pre.A}, şimdi V${post.vCount}/A${post.aCount}`);
  r.facts = { userAnswer: ans, restored, tracksAfterUndo: { V: post.vCount, A: post.aCount } };
  lastT3 = null;
  if (restored && ans !== "Hayır") return r.pass("T3'ün tek transaction'ı tek Ctrl+Z ile tamamen geri geldi.");
  if (!restored && ans === "Hayır") return r.fail("api", "tek Ctrl+Z T3'ün tamamını geri almadı");
  r.unclear(ans === "Atla" ? "kullanıcı atladı" : "kullanıcı cevabı ile otomatik karşılaştırma çelişiyor");
};

// ------------------------------------------------------------------ T7
const t7: TestFn = async (ctx, r) => {
  const { s: pre, ps } = await probeSet(ctx, r);
  if (!ps.extPair) return r.unclear("Aynı track'te arka arkaya iki harici ses yok (ör. A2'de).");
  const [target, follower] = ps.extPair;
  r.m(`Silinecek: ${fmtClip(target)}; aynı track'te arkasındaki: ${fmtClip(follower)}`);
  const so = await selectExactly(ctx, [target]); // klibi kendisi baştan okuyup yeniden bulur
  for (const n of so.notes) r.m(`   ${n}`, "dim");
  if (!so.exact) return r.fail("api", "hedef klip Adobe kalıbıyla birebir seçilemedi → silme yapılmadı");
  r.m("createRemoveItemsAction(seçim, ripple=false, mediaType=AUDIO)");
  const tx = await transact(ctx, "PROBE T7 ripple=false sil", (ops) => {
    ops.remove(so.sel, "A");
  });
  txLine(r, "sil", tx);
  await settle();
  const post = await snapshot(ctx);
  const targetRemoved = relocate(post, target) === null;

  // Zamandan bağımsız kimlikle eşleştir: önce aynı start'lı eşleşmeler, kalanlar "kaydı" sayılır. (yalnız değerler)
  const others = pre.clips.filter((c) => locKey(c) !== locKey(target));
  const pool = new Map<string, ClipInfo[]>();
  for (const c of post.clips) pool.set(keyNoTime(c), [...(pool.get(keyNoTime(c)) ?? []), c]);
  const unmatched: ClipInfo[] = [];
  for (const c of others) {
    const arr = pool.get(keyNoTime(c)) ?? [];
    const i = arr.findIndex((x) => x.start === c.start);
    if (i >= 0) arr.splice(i, 1);
    else unmatched.push(c);
  }
  const shifts: string[] = [];
  let missing = 0;
  for (const c of unmatched) {
    const m = (pool.get(keyNoTime(c)) ?? []).shift();
    if (m) shifts.push(`${fmtClip(c)} → start ${m.start} (fark ${tickDiff(c.start, m.start)} tick)`);
    else {
      missing++;
      shifts.push(`${fmtClip(c)} → KAYBOLDU`);
    }
  }
  const moved = shifts.length - missing;
  r.m(`→ Hedef silindi mi: ${yesNo(targetRemoved)}`, targetRemoved ? "ok" : "err");
  r.m(`→ Diğer ${others.length} klip: değişmeyen ${others.length - unmatched.length}, kayan ${moved}, kaybolan ${missing}`,
    unmatched.length ? "err" : "ok");
  for (const s of shifts) r.m(`   ✗ ${s}`, "err");
  const fNow = post.clips.find((x) => keyNoTime(x) === keyNoTime(follower));
  r.m(`   arkadaki "${follower.name}": önce start=${follower.start}, sonra start=${fNow ? fNow.start : "?"}`);
  r.facts = { targetRemoved, shifted: moved, missing };
  if (!targetRemoved) return r.fail("api", "createRemoveItemsAction hedefi silmedi (taze seçim, Adobe kalıbı)");
  if (unmatched.length) return r.fail("api", "ripple=false olsa bile başka klipler kaydı/kayboldu");
  r.pass("ripple=false silme başka hiçbir klibin start'ını değiştirmedi.");
};

// ------------------------------------------------------------------ T8
/**
 * Bağlı doğurma: kamera klibinin ProjectItem'ı ile createOverwriteItemAction → aynı anda V+A oluşuyor mu?
 * Sonra set In/Out/Start/End action'larıyla aslına tick düzeyinde eşitle (her adım ayrı transaction, her seferinde taze okuma).
 */
const t8: TestFn = async (ctx, r) => {
  const { s: s0, ps } = await probeSet(ctx, r);
  if (!ps.camV) return r.unclear("V1'de kamera klibi yok (T3/T6 sonrası geri alınmamış olabilir).");
  const camV = ps.camV;
  const camA = ps.camA; // ses hedef değerleri; yoksa videonunkiler kullanılır
  const vIdx = emptyTracks(s0, "V")[0];
  const aIdx = emptyTracks(s0, "A")[0];
  r.m(
    `createOverwriteItemAction("${camV.projName}", time=${camV.start} (aslın start'ı), videoTrackIndex=${vIdx} (${trackLabel("V", vIdx)}), audioTrackIndex=${aIdx} (${trackLabel("A", aIdx)}))`
  );
  const tx1 = await transact(ctx, "PROBE T8 overwrite", (ops) => {
    ops.overwrite(camV, ticks(camV.start), vIdx, aIdx); // camV bu kuşaktan (probeSet snapshot'ı)
  });
  txLine(r, "overwrite", tx1);
  await settle();
  const s1 = await snapshot(ctx);
  const born = added(s0, s1);
  const bornV = born.filter((c) => c.kind === "V" && c.projId === camV.projId);
  const bornA = born.filter((c) => c.kind === "A" && c.projId === camV.projId);
  listClips(r, "   oluşan", born);
  const lost = removed(s0, s1);
  if (lost.length) listClips(r, "   ⚠ değişen/kaybolan eski klipler", lost, "warn");
  const bornTogether = bornV.length >= 1 && bornA.length >= 1;
  r.m(`→ Aynı anda hem video hem ses oluştu mu: ${yesNo(bornTogether)} (video ${bornV.length}, ses ${bornA.length})`, bornTogether ? "ok" : "err");
  if (!bornV.length && !bornA.length) {
    r.facts = { bornTogether, videoBorn: 0, audioBorn: 0 };
    return r.fail("api", "createOverwriteItemAction hiç klip oluşturmadı (taze ProjectItem, Adobe kalıbı)");
  }
  const vTrack = bornV[0]?.track ?? null;
  const aTrack = bornA[0]?.track ?? null;
  const tgtV = camV;
  const tgtA = camA ?? camV;

  // Eşitleme adımları: her adım öncesi sequence baştan okunur, yeni klipler (tür, track, kaynak) ile yeniden bulunur.
  const steps: { name: "setIn" | "setOut" | "setStart" | "setEnd"; field: "inPt" | "outPt" | "start" | "end"; api: string }[] = [
    { name: "setIn", field: "inPt", api: "createSetInPointAction" },
    { name: "setOut", field: "outPt", api: "createSetOutPointAction" },
    { name: "setStart", field: "start", api: "createSetStartAction" },
    { name: "setEnd", field: "end", api: "createSetEndAction" },
  ];
  const findNew = (s: Snapshot, kind: Kind, track: number | null) =>
    track === null ? null : s.clips.find((c) => c.kind === kind && c.track === track && c.projId === camV.projId) ?? null;
  for (const st of steps) {
    const sk = await snapshot(ctx);
    const curV = findNew(sk, "V", vTrack);
    const curA = findNew(sk, "A", aTrack);
    const tx = await transact(ctx, `PROBE T8 ${st.name}`, (ops) => {
      if (curV) ops[st.name](curV, ticks(tgtV[st.field]));
      if (curA) ops[st.name](curA, ticks(tgtA[st.field]));
    });
    await settle();
    const after = await snapshot(ctx);
    const v = findNew(after, "V", vTrack);
    const a = findNew(after, "A", aTrack);
    const show = (c: ClipInfo | null) => (c ? `start=${c.start} end=${c.end} in=${c.inPt} out=${c.outPt}` : "YOK");
    r.m(`   ${st.api}(${st.field}) → tx ${tx.ok}; video: ${show(v)}; ses: ${show(a)}`, "dim");
  }

  const fin = await snapshot(ctx);
  const finV = findNew(fin, "V", vTrack);
  const finA = findNew(fin, "A", aTrack);
  const mismatch: string[] = [];
  if (finV) mismatch.push(...compareFields(r, "yeni video", tgtV, finV));
  else mismatch.push("yeni video:yok");
  if (finA) mismatch.push(...compareFields(r, camA ? "yeni ses" : "yeni ses (video değerleriyle)", tgtA, finA));
  else mismatch.push("yeni ses:yok");

  let linkedAnswer: Answer | null = null;
  let autoLinked: boolean | null = null;
  let selectedCount: number | null = null;
  if (finV && finA) {
    linkedAnswer = await askUser(
      `${trackLabel("V", finV.track)} üzerindeki YENİ videoya bir kez tıkla (Linked Selection açık). ${trackLabel("A", finA.track)} üzerindeki sesi de seçildi mi?`
    );
    const rs = await readSelection(ctx);
    selectedCount = rs.count;
    const vSel = rs.clips.some((c) => c.kind === "V" && c.track === finV.track && c.projId === camV.projId);
    const aSel = rs.clips.some((c) => c.kind === "A" && c.track === finA.track && c.projId === camV.projId);
    autoLinked = vSel ? aSel : null;
    r.m(`   panelin okuduğu: getSelection ${rs.count} öğe; yeni video seçili: ${yesNo(vSel)}, yeni ses seçili: ${yesNo(aSel)}`);
  }
  r.facts = { bornTogether, videoBorn: bornV.length, audioBorn: bornA.length, vTrack, aTrack, mismatchFields: mismatch, linkedAnswer, autoLinked, selectedCount };
  if (!bornTogether) return r.fail("api", "overwrite video ve sesi birlikte oluşturmadı");
  if (mismatch.length) return r.fail("api", `set In/Out/Start/End ile aslına eşitlenemedi: ${mismatch.join(", ")}`);
  if (linkedAnswer === "Hayır") return r.fail("api", "overwrite ile doğan video+ses bağlı değil (tıklayınca ses seçilmiyor)");
  if (linkedAnswer === "Evet") return r.pass("overwrite V+A'yı bağlı doğurdu ve set*Action'larla aslına birebir eşitlendi.");
  r.unclear("bağ sorusu cevaplanmadı (Atla)");
};

// ------------------------------------------------------------------ kayıt

export const TESTS: TestDef[] = [
  { id: "T1", title: "Yedek (sequence.createCloneAction)", fn: t1 },
  { id: "T2", title: "Track açma (clone ofseti / yedek: insert)", fn: t2 },
  { id: "T3", title: "Taşı: V+A clone + asılları sil (tek transaction)", fn: t3 },
  { id: "T4", title: "Sadakat (tick tolerans 0)", fn: t4 },
  { id: "T5", title: "Seçim (getSelection+addItem+setSelection)", fn: t5 },
  { id: "T6", title: "Geri alma (T3 tek Ctrl+Z ile geri mi)", fn: t6 },
  { id: "T7", title: "Ripple (ripple=false başkasını kaydırıyor mu)", fn: t7 },
  { id: "T8", title: "Bağlı doğurma (overwrite + set In/Out/Start/End)", fn: t8 },
];

/** "Hepsini çalıştır" sırası. T6 hemen T3'ün ardından (onu geri alır); silen T7 en son. */
export const RUN_ALL_ORDER = ["T1", "T2", "T4", "T3", "T6", "T8", "T5", "T7"];

export async function runOne(def: TestDef, pinGuid?: string): Promise<TestResult> {
  const r = new Rec(def.id, def.title);
  log(`▶ ${def.id} — ${def.title}`, "head");
  try {
    const ctx = await requireProbe(pinGuid);
    r.m(`sequence: "${ctx.name}"`, "dim");
    await def.fn(ctx, r);
  } catch (e) {
    if (e instanceof ProbeLockError || (e instanceof Error && e.name === "ProbeLockError")) {
      r.status = "BELİRSİZ";
      r.lockError = true;
      r.m(`KİLİT: ${(e as Error).message}`, "err");
    } else {
      const { cls, why } = classifyError(e);
      r.m(`HATA (yakalandı): ${errText(e)}`, "err");
      const stack = e instanceof Error && e.stack ? e.stack.split("\n").slice(1, 4) : [];
      for (const s of stack) r.m(`   ${s.trim()}`, "dim");
      r.fail(cls, `${why} — ${errText(e)}`);
    }
  }
  const tone = r.status === "PASS" ? "ok" : r.status === "FAIL" ? "err" : "warn";
  log(`■ ${def.id} → ${r.status}${r.failClass ? ` [${FAIL_LABEL[r.failClass]}]` : ""}`, tone);
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    failClass: r.failClass,
    failWhy: r.failWhy,
    lines: r.lines,
    facts: r.facts,
    ranAt: new Date().toISOString(),
    lockError: r.lockError,
  };
}

/** Salt okuma: kurulumun doğru olup olmadığını gösterir. */
export async function scanSetup(): Promise<string[]> {
  const lines: string[] = [];
  const out = (s: string, tone: "info" | "warn" | "err" | "dim" = "info") => {
    lines.push(s);
    log(`  ${s}`, tone);
  };
  log("▶ Tarama (salt okuma)", "head");
  try {
    const ctx = await requireProbe();
    const s = await snapshot(ctx);
    out(`sequence: "${ctx.name}" — V track: ${s.vCount}, A track: ${s.aCount}, klip: ${s.clips.length}`);
    for (const c of s.clips) out(`  • ${fmtClip(c)} (kaynak: "${c.projName}")`, "dim");
    const ps = findProbeSet(s);
    out(`kamera video: ${ps.camV ? fmtClip(ps.camV) : "YOK"}`, ps.camV ? "info" : "err");
    out(`kamera sesi : ${ps.camA ? fmtClip(ps.camA) : "YOK"}`, ps.camA ? "info" : "err");
    out(`harici ses  : ${ps.ext.length} adet${ps.ext.length ? " — " + ps.ext.map((c) => `${trackLabel("A", c.track)} "${c.name}"`).join(", ") : ""}`,
      ps.ext.length ? "info" : "err");
    out(`T7 çifti    : ${ps.extPair ? `${fmtClip(ps.extPair[0])} → ${fmtClip(ps.extPair[1])}` : "YOK"}`, ps.extPair ? "info" : "warn");
    for (const n of ps.notes) out(`not: ${n}`, "warn");
    for (const w of s.warnings) out(`uyarı: ${w}`, "warn");
    const leftovers = s.clips.filter((c) => (c.kind === "V" && c.track >= 1) || (c.kind === "A" && c.track >= 3));
    if (leftovers.length)
      out(`⚠ V2+ / A4+ üzerinde ${leftovers.length} klip var — önceki test kopyaları olabilir; testten önce silmen önerilir.`, "warn");
    const ok = !!ps.camV && !!ps.camA && ps.ext.length >= 1 && !!ps.extPair;
    out(ok ? "Kurulum uygun görünüyor." : "Kurulum eksik — KURULUM_TR.md'deki PROBE_test adımlarına bak.", ok ? "info" : "warn");
  } catch (e) {
    out(`${e instanceof Error && e.name === "ProbeLockError" ? "KİLİT" : "HATA"}: ${errText(e)}`, "err");
  }
  return lines;
}
