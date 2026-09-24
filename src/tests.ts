// T1–T7 yoklama testleri. SPREAD / RE-STACK burada YOK; sadece API davranışı ölçülür.
// Her test: requireProbe() ile başlar (PROBE_ kilidi), her düzenlemeden önce transact()/assertStillProbe() kilidi yeniden doğrular.

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
  buildSelection,
  errText,
  findProbeSet,
  fmtClip,
  keyFull,
  keyNoTime,
  removed,
  sameClips,
  settle,
  sleep,
  snapshot,
  tickDiff,
  trackLabel,
  transact,
  type ClipInfo,
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
  lines: string[];
  facts: Record<string, unknown>;
  ranAt: string;
  lockError: boolean;
}

class Rec {
  lines: string[] = [];
  facts: Record<string, unknown> = {};
  status: Status = "BELİRSİZ";
  lockError = false;
  constructor(public id: string, public title: string) {}
  m(msg: string, tone: "info" | "ok" | "warn" | "err" | "dim" = "info"): void {
    this.lines.push(msg);
    log(`  ${msg}`, tone);
  }
}

type TestFn = (ctx: ProbeContext, r: Rec) => Promise<void>;

export interface TestDef {
  id: string;
  title: string;
  fn: TestFn;
}

const yesNo = (b: boolean | null | undefined) => (b === null || b === undefined ? "ÖLÇÜLEMEDİ" : b ? "EVET" : "HAYIR");

function refind(s: Snapshot, c: ClipInfo): ClipInfo | null {
  const k = keyFull(c);
  return s.clips.find((x) => keyFull(x) === k) ?? null;
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

interface CloneOutcome {
  pre: Snapshot;
  post: Snapshot;
  src: ClipInfo;
  newClips: ClipInfo[];
  lost: ClipInfo[];
  tx: TxResult;
  vOffset: number;
  aOffset: number;
}

/** V1/A1 dışındaki boş track index'leri, ardından henüz olmayan ilk iki index (count, count+1). */
function emptyTracks(s: Snapshot, kind: Kind): number[] {
  const count = kind === "V" ? s.vCount : s.aCount;
  const out: number[] = [];
  for (let i = 1; i < count; i++) if (!s.clips.some((c) => c.kind === kind && c.track === i)) out.push(i);
  out.push(count, count + 1);
  return out;
}

/** V1/A1 dışındaki ilk boş track'in index'i; yoksa track sayısı (= henüz olmayan ilk track). */
function firstEmptyTrack(s: Snapshot, kind: Kind): number {
  return emptyTracks(s, kind)[0];
}

/**
 * Klibi zaman ofseti 0 ile başka bir track'e kopyalar.
 *  target "new"  : hedef = track sayısı (ilk OLMAYAN track) → track açılıyor mu ölçülür (T2, T3).
 *  target "empty": hedef = mevcut ilk boş track, yoksa yeni → sadakat track açmadan ölçülür (T4).
 * Kaynak V ise vOffset = hedefV - klibinTrack; bağlı ses gelirse A1'deki aslını ezmesin diye aOffset = hedefA - sesinTrack.
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
  const src = refind(pre, clip);
  if (!src) throw new Error(`${label}: kaynak klip timeline'da artık bulunamadı (${fmtClip(clip)})`);
  const vTarget = target === "empty" ? firstEmptyTrack(pre, "V") : pre.vCount;
  const aTarget = target === "empty" ? firstEmptyTrack(pre, "A") : pre.aCount;
  const vOffset = vTarget - (src.kind === "V" ? src.track : 0);
  const aOffset = aTarget - (src.kind === "A" ? src.track : linkedAudio ? linkedAudio.track : 0);
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
  return { pre, post, src, newClips, lost, tx, vOffset, aOffset };
}

async function probeSet(ctx: ProbeContext, r: Rec) {
  const s = await snapshot(ctx);
  const ps = findProbeSet(s);
  for (const n of ps.notes) r.m(`not: ${n}`, "warn");
  for (const w of s.warnings) r.m(`uyarı: ${w}`, "warn");
  return { s, ps };
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

  let returned: boolean | null = null;
  r.facts = { cloneCreated: fresh.length === 1, cloneName: names[0] ?? null, activeChanged, cloneBecameActive, returnedToOriginal: returned };
  if (activeChanged && !cloneBecameActive) {
    // Kullanıcı bilerek başka sequence'a geçmiş: zorla geri dönme, dur.
    throw new ProbeLockError("T1 sırasında kullanıcı başka bir sequence'a geçti. Güvenlik için durduruldu (geri dönülmedi).");
  }
  if (cloneBecameActive) {
    // Sonraki testler yedeğe değil ASLINA dokunsun: yalnız "kopya aktif oldu" durumunda orijinale dön.
    if (!isProbeName(sequenceName(ctx.sequence))) throw new ProbeLockError("Orijinal sequence'ın adı artık PROBE_ değil.");
    returned = await ctx.project.setActiveSequence(ctx.sequence); // d.ts:L2590 Project.setActiveSequence
    r.m(`   → orijinal "${ctx.name}" tekrar aktif yapıldı (setActiveSequence): ${String(returned)}`, returned ? "info" : "err");
    r.facts.returnedToOriginal = returned;
  }
  r.status = fresh.length === 1 ? "PASS" : fresh.length === 0 ? "FAIL" : "BELİRSİZ";
};

// ------------------------------------------------------------------ T2
const t2: TestFn = async (ctx, r) => {
  const { ps } = await probeSet(ctx, r);
  if (!ps.camV) {
    r.status = "BELİRSİZ";
    r.m("V1'de kamera klibi yok; test yapılamadı.", "err");
    return;
  }

  // --- Video (clone hata verirse de yedek yönteme geçilsin diye yakalanır)
  let openedV = false;
  try {
    const v = await cloneToTracks(ctx, r, ps.camV, ps.camA, "T2 video");
    const newV = v.newClips.filter((c) => c.kind === "V" && c.projId === v.src.projId);
    openedV = v.post.vCount > v.pre.vCount && newV.some((c) => c.track >= v.pre.vCount);
    if (!openedV && newV.length) r.m(`   kopya mevcut bir track'e düştü: ${newV.map(fmtClip).join("; ")}`, "warn");
  } catch (e) {
    if (e instanceof ProbeLockError) throw e;
    r.m(`   clone HATA verdi: ${errText(e)}`, "err");
  }
  r.m(`→ Video: yeni track açıldı mı: ${yesNo(openedV)}`, openedV ? "ok" : "err");

  // --- Ses (bağlı olmayan harici ses tercih edilir)
  let openedA = false;
  const audioSrc = ps.ext[0] ?? ps.camA;
  if (!audioSrc) {
    r.m("Ses için kopyalanacak klip yok (A1 boş).", "err");
  } else {
    try {
      const a = await cloneToTracks(ctx, r, audioSrc, null, "T2 ses");
      const newA = a.newClips.filter((c) => c.kind === "A" && c.projId === a.src.projId);
      openedA = a.post.aCount > a.pre.aCount && newA.some((c) => c.track >= a.pre.aCount);
      if (!openedA && newA.length) r.m(`   kopya mevcut bir track'e düştü: ${newA.map(fmtClip).join("; ")}`, "warn");
    } catch (e) {
      if (e instanceof ProbeLockError) throw e;
      r.m(`   clone HATA verdi: ${errText(e)}`, "err");
    }
    r.m(`→ Ses: yeni track açıldı mı: ${yesNo(openedA)}`, openedA ? "ok" : "err");
  }

  let fallbackV: boolean | null = null;
  let fallbackA: boolean | null = null;
  const fallbackRan = !openedV || !openedA;

  if (fallbackRan) {
    r.m("Clone ile track açılmadı → YEDEK YÖNTEM: createInsertProjectItemAction (index = track sayısı) + sil", "warn");
    const pre = await snapshot(ctx);
    const cam = refind(pre, ps.camV) ?? findProbeSet(pre).camV;
    if (!cam) throw new Error("Yedek yöntem: kamera klibi bulunamadı");
    const projItem = await cam.ref.getProjectItem(); // d.ts:L4226 VideoClipTrackItem.getProjectItem
    const at = await ctx.sequence.getEndTime(); // d.ts:L3181 Sequence.getEndTime
    const vIdx = pre.vCount;
    const aIdx = pre.aCount;
    r.m(
      `createInsertProjectItemAction("${projItem.name}", time=sequence sonu (${at.seconds.toFixed(3)}s), videoTrackIndex=${vIdx}, audioTrackIndex=${aIdx}, limitShift=true)` // d.ts:L2854 ProjectItem.name, d.ts:L3986 TickTime.seconds
    );
    const tx = await transact(ctx, "PROBE T2 yedek insert", (ops) => {
      ops.insert(projItem, at, vIdx, aIdx); // → SequenceEditor.createInsertProjectItemAction (timeline.ts transact)
    });
    txLine(r, "insert", tx);
    await settle();
    const mid = await snapshot(ctx);
    const ins = added(pre, mid);
    r.m(`   insert sonrası track: V ${pre.vCount}→${mid.vCount}, A ${pre.aCount}→${mid.aCount}`);
    listClips(r, "   eklenen", ins);
    const shifted = removed(pre, mid);
    if (shifted.length) listClips(r, "   ⚠ insert eski klipleri değiştirdi", shifted, "warn");

    // Her tür için seçim hemen silmeden önce kurulur (yedek seçim yolu canlı/paylaşılan nesne döndürse de karışmasın).
    for (const kind of ["V", "A"] as Kind[]) {
      const list = ins.filter((c) => c.kind === kind);
      if (!list.length) continue;
      const notes: string[] = [];
      const { sel } = await buildSelection(ctx, list, notes);
      for (const n of notes) r.m(`   ${n}`, "dim");
      const tx2 = await transact(ctx, `PROBE T2 yedek sil ${kind}`, (ops) => {
        ops.remove(sel, kind);
      });
      txLine(r, `eklenen ${kind === "V" ? "videoyu" : "sesi"} sil (ripple=false)`, tx2);
      await settle();
    }
    const fin = await snapshot(ctx);
    const left = ins.filter((c) => refind(fin, c));
    r.m(`   sil sonrası track: V ${fin.vCount}, A ${fin.aCount}; eklenenlerden kalan: ${left.length}`);
    fallbackV = fin.vCount > pre.vCount && !left.some((c) => c.kind === "V");
    fallbackA = fin.aCount > pre.aCount && !left.some((c) => c.kind === "A");
    r.m(`→ Yedek: boş VIDEO track kaldı mı: ${yesNo(fallbackV)}; boş SES track kaldı mı: ${yesNo(fallbackA)}`,
      fallbackV && fallbackA ? "ok" : "err");
  }

  r.facts = { openedV, openedA, fallbackRan, fallbackV, fallbackA };
  const okV = openedV || fallbackV === true;
  const okA = openedA || fallbackA === true;
  if (openedV && openedA) {
    r.status = "PASS";
    r.m("Sonuç: clone ofsetiyle hem video hem ses için yeni track açılıyor.", "ok");
  } else if (okV && okA) {
    r.status = "PASS";
    r.m("Sonuç: clone ile açılmadı ama YEDEK yöntemle (insert + sil) boş track açılabiliyor.", "warn");
  } else {
    r.status = "FAIL";
    r.m("Sonuç: iki yöntemle de gerekli track'ler açılamadı.", "err");
  }
};

// ------------------------------------------------------------------ T3
const t3: TestFn = async (ctx, r) => {
  const { ps } = await probeSet(ctx, r);
  if (!ps.camV) {
    r.status = "BELİRSİZ";
    r.m("V1'de kamera klibi yok (önceki bir test silmiş olabilir). Ctrl+Z ya da T1 yedeğiyle geri dön.", "err");
    return;
  }
  if (!ps.camA) r.m("Kamera klibinin A1'de sesi bulunamadı; bağlı çift ölçümü zayıf olacak.", "warn");

  // 1) sadece video öğesini ofsetle kopyala (hata verirse 3. adım yine ölçülür)
  let newV: ClipInfo[] = [];
  let newA: ClipInfo[] = [];
  let cloneOk = false;
  try {
    // bağlı çift davranışı track açmaktan bağımsız ölçülsün: önce mevcut boş track, yoksa yeni
    const c = await cloneToTracks(ctx, r, ps.camV, ps.camA, "T3 sadece video", "empty");
    newV = c.newClips.filter((x) => x.kind === "V" && x.projId === c.src.projId);
    newA = c.newClips.filter((x) => x.kind === "A" && x.projId === c.src.projId);
    cloneOk = true;
  } catch (e) {
    if (e instanceof ProbeLockError) throw e;
    r.m(`   clone HATA verdi: ${errText(e)}`, "err");
  }
  const linkedAudioCame: boolean | null = cloneOk ? newA.length > 0 : null;
  r.m(`→ Bağlı ses de geldi mi: ${yesNo(linkedAudioCame)}${linkedAudioCame ? ` (${newA.map(fmtClip).join("; ")})` : ""}`,
    linkedAudioCame === null ? "err" : "ok");

  // 2) kopya bağlı mı? d.ts'te "link" sorgulayan bir metot YOK → kullanıcıya sor + seçimden oku
  let copyLinked: "EVET" | "HAYIR" | "BİLİNMİYOR" = "BİLİNMİYOR";
  if (newV.length && linkedAudioCame) {
    const vq = newV[0];
    const aq = newA[0];
    const ans: Answer = await ask(
      `Timeline'ın sol üstündeki "Linked Selection" (zincir) açık olsun. ${trackLabel("V", vq.track)} üzerindeki KOPYA videoya ("${vq.name}") bir kez tıkla. ` +
        `${trackLabel("A", aq.track)} üzerindeki kopya ses de kendiliğinden seçildi mi (ikisi birden vurgulandı mı)?`
    );
    const after = await snapshot(ctx);
    const vSel = refind(after, vq)?.selected ?? null;
    const aSel = refind(after, aq)?.selected ?? null;
    r.m(`   panelin okuduğu seçim → kopya video seçili: ${yesNo(vSel)}, kopya ses seçili: ${yesNo(aSel)}`);
    const auto = vSel === true ? (aSel === true ? "EVET" : "HAYIR") : "BİLİNMİYOR";
    copyLinked = ans === "Evet" ? "EVET" : ans === "Hayır" ? "HAYIR" : auto;
    if (ans !== "Atla" && auto !== "BİLİNMİYOR" && auto !== copyLinked) {
      r.m(`   ⚠ kullanıcı cevabı (${ans}) ile okunan seçim (${auto}) çelişiyor`, "warn");
    }
  } else if (linkedAudioCame === false) {
    r.m("   kopya ses gelmediği için 'kopya bağlı mı' sorusu anlamsız → atlandı", "dim");
  }
  r.m(`→ Kopya bağlı mı: ${copyLinked}`, copyLinked === "BİLİNMİYOR" ? "warn" : "ok");

  // 3) ASLI (V1'deki video) ripple=false ile sil → yetim ses kalıyor mu?
  const pre = await snapshot(ctx);
  const camV = refind(pre, ps.camV);
  const camA = ps.camA ? refind(pre, ps.camA) : null;
  if (!camV) throw new Error("Asıl kamera videosu silmeden önce bulunamadı");
  const notes: string[] = [];
  const { sel, method } = await buildSelection(ctx, [camV], notes);
  for (const n of notes) r.m(`   ${n}`, "dim");
  r.m(`createRemoveItemsAction(seçim=[${fmtClip(camV)}] (${method}), ripple=false, mediaType=VIDEO)`);
  const tx = await transact(ctx, "PROBE T3 asli sil (ripple=false)", (ops) => {
    ops.remove(sel, "V");
  });
  txLine(r, "sil", tx);
  await settle();
  const post = await snapshot(ctx);
  const gone = removed(pre, post);
  const camVRemoved = refind(post, camV) === null;
  const orphanAudio = camA ? refind(post, camA) !== null : null;
  listClips(r, "   silinen/değişen", gone);
  r.m(`→ Asıl video silindi mi: ${yesNo(camVRemoved)}`, camVRemoved ? "ok" : "err");
  r.m(
    `→ Geride yetim ses kaldı mı: ${
      orphanAudio === null ? "ÖLÇÜLEMEDİ (kamera sesi yok)" : orphanAudio ? "EVET — asıl ses A1'de duruyor" : "HAYIR — ses de silindi"
    }`,
    "ok"
  );
  const collateral = gone.filter((g) => keyFull(g) !== keyFull(camV) && (!camA || keyFull(g) !== keyFull(camA)));
  if (collateral.length) listClips(r, "   ⚠ beklenmeyen şekilde değişen diğer klipler", collateral, "warn");

  r.facts = { cloneOk, linkedAudioCame, copyLinked, camVRemoved, orphanAudio, collateral: collateral.length };
  if (!camVRemoved) r.status = "FAIL";
  else if (!cloneOk || orphanAudio === null) r.status = "BELİRSİZ"; // clone istisnası T2/T4'te ölçülür
  else if (!newV.length) r.status = "FAIL";
  else r.status = "PASS";
};

// ------------------------------------------------------------------ T4
const FIELDS: { key: keyof ClipInfo; label: string; ticks: boolean }[] = [
  { key: "start", label: "start", ticks: true },
  { key: "end", label: "end", ticks: true },
  { key: "inPt", label: "inPoint", ticks: true },
  { key: "outPt", label: "outPoint", ticks: true },
  { key: "speed", label: "speed", ticks: false },
  { key: "disabled", label: "disabled", ticks: false },
  { key: "name", label: "name", ticks: false },
];

const t4: TestFn = async (ctx, r) => {
  const { ps } = await probeSet(ctx, r);
  if (!ps.camV) {
    r.status = "BELİRSİZ";
    r.m("V1'de kamera klibi yok; test yapılamadı.", "err");
    return;
  }
  const pairs: { label: string; orig: ClipInfo; copy: ClipInfo | null }[] = [];

  const c1 = await cloneToTracks(ctx, r, ps.camV, ps.camA, "T4 kamera", "empty");
  pairs.push({
    label: "kamera video",
    orig: c1.src,
    copy: c1.newClips.find((x) => x.kind === "V" && x.projId === c1.src.projId) ?? null,
  });
  const camA = ps.camA ? refind(c1.pre, ps.camA) : null;
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
    r.m(`${p.label}: asıl ${trackLabel(p.orig.kind, p.orig.track)} ↔ kopya ${trackLabel(p.copy.kind, p.copy.track)}`);
    for (const f of FIELDS) {
      const a = p.orig[f.key];
      const b = p.copy[f.key];
      const eq = a === b;
      if (!eq) mismatchFields.push(`${p.label}:${f.label}`);
      const extra = f.ticks && !eq ? ` fark=${tickDiff(String(a), String(b))} tick` : "";
      r.m(`   ${eq ? "✓" : "✗"} ${f.label}: asıl=${String(a)} kopya=${String(b)}${extra}`, eq ? "dim" : "err");
    }
  }
  r.facts = { pairs: compared, mismatchFields };
  if (compared === 0) r.status = pairs.length ? "FAIL" : "BELİRSİZ";
  else r.status = mismatchFields.length === 0 ? "PASS" : "FAIL";
  r.m(
    `Sonuç: ${compared} çift karşılaştırıldı (tolerans 0), fark: ${mismatchFields.length ? mismatchFields.join(", ") : "yok"}`,
    r.status === "PASS" ? "ok" : "err"
  );
};

// ------------------------------------------------------------------ T5
const t5: TestFn = async (ctx, r) => {
  const { ps } = await probeSet(ctx, r);
  const targets = [ps.camV, ps.camA, ...ps.ext].filter((x): x is ClipInfo => x !== null);
  if (targets.length < 2) {
    r.status = "BELİRSİZ";
    r.m("Seçilecek en az 2 klip bulunamadı.", "err");
    return;
  }
  const notes: string[] = [];
  const { sel, method, addResults } = await buildSelection(ctx, targets, notes);
  for (const n of notes) r.m(`   ${n}`, "dim");
  r.m(`Seçim kuruldu (${method}); addItem → [${addResults.join(", ")}]`);
  await assertStillProbe(ctx);
  const setOk = ctx.sequence.setSelection(sel); // d.ts:L3267 Sequence.setSelection
  r.m(`sequence.setSelection → ${String(setOk)}`);
  await settle();
  const readSel = await ctx.sequence.getSelection(); // d.ts:L3211 Sequence.getSelection
  const readItems = await readSel.getTrackItems(); // d.ts:L4039 TrackItemSelection.getTrackItems
  const s1 = await snapshot(ctx);
  const flags = targets.map((t) => ({ t, sel: refind(s1, t)?.selected ?? null }));
  const targetKeys = new Set(targets.map(keyFull));
  const extraSelected = s1.clips.filter((c) => c.selected && !targetKeys.has(keyFull(c)));
  r.m(`getSelection().getTrackItems() → ${readItems.length} öğe (istenen ${targets.length})`);
  for (const f of flags) r.m(`   ${f.sel ? "✓" : "✗"} getIsSelected ${fmtClip(f.t)} → ${yesNo(f.sel)}`, f.sel ? "dim" : "err");
  if (extraSelected.length) listClips(r, "   istenmeden seçili olanlar", extraSelected, "warn");
  const programmaticOk = setOk === true && readItems.length >= targets.length && flags.every((f) => f.sel === true);

  const ans = await ask(
    `Timeline'a bak: şu ${targets.length} klip SEÇİLİ (vurgulu) görünüyor mu? ` +
      targets.map((t) => `${trackLabel(t.kind, t.track)} "${t.name}"`).join(", ")
  );
  r.facts = { programmaticOk, userSees: ans, method, readCount: readItems.length };
  r.m(`→ Programla okunan seçim doğru mu: ${yesNo(programmaticOk)}; kullanıcı timeline'da görüyor mu: ${ans}`);
  if (ans === "Hayır" || !setOk) r.status = "FAIL";
  else if (ans === "Evet" && programmaticOk) r.status = "PASS";
  else r.status = "BELİRSİZ";
};

// ------------------------------------------------------------------ T6
const t6: TestFn = async (ctx, r) => {
  const { s: pre, ps } = await probeSet(ctx, r);
  const ext = ps.ext[0] ?? null;
  if (!ps.camV || !ext) {
    r.status = "BELİRSİZ";
    r.m("Kamera videosu (V1) ve en az bir harici ses (A1) gerekli.", "err");
    return;
  }
  const camV = ps.camV;
  // Geri alma testi track açmaktan bağımsız olsun: önce mevcut boş track'ler, yoksa yenileri (track açma T2'de ölçülür).
  const emptyV = emptyTracks(pre, "V");
  const emptyA = emptyTracks(pre, "A");
  const vT = emptyV[0];
  const aT = emptyA[0];
  // Harici ses, kamera sesi kopyasıyla zamanda çakışmıyorsa aynı boş track'e; çakışıyorsa bir sonrakine.
  const overlaps = ps.camA ? ext.startSec < ps.camA.endSec && ps.camA.startSec < ext.endSec : false;
  const extT = overlaps ? emptyA[1] : aT;
  const vOffCam = vT - camV.track;
  const aOffCam = aT - (ps.camA ? ps.camA.track : 0);
  const aOffExt = extT - ext.track;
  const vOffExt = emptyV[1] - 0; // harici sesin videosu yok; olsaydı kamera kopyasını ezmesin
  const notes: string[] = [];
  const { sel } = await buildSelection(ctx, [camV], notes);
  for (const n of notes) r.m(`   ${n}`, "dim");
  r.m("TEK transaction içinde: (1) kamera videosunu yeni V/A track'e kopyala, (2) harici sesi bir üst yeni A track'e kopyala, (3) asıl videoyu ripple=false sil");
  r.m(
    `   hedefler: kamera → ${trackLabel("V", vT)}/${trackLabel("A", aT)}, harici → ${trackLabel("A", extT)} ` +
      `(mevcut V${pre.vCount}/A${pre.aCount}; ötesi yeni track). clone kamera: vOffset=${vOffCam}, aOffset=${aOffCam}; clone harici: vOffset=${vOffExt}, aOffset=${aOffExt}`,
    "dim"
  );
  const tx = await transact(ctx, "PROBE T6 (T2+T3 tek adim)", (ops) => {
    ops.clone(camV, vOffCam, aOffCam);
    ops.clone(ext, vOffExt, aOffExt);
    ops.remove(sel, "V");
  });
  txLine(r, "tek transaction", tx);
  await settle();
  const mid = await snapshot(ctx);
  const plus = added(pre, mid);
  const minus = removed(pre, mid);
  r.m(`   track sayısı: V ${pre.vCount}→${mid.vCount}, A ${pre.aCount}→${mid.aCount}`);
  listClips(r, "   eklenen", plus);
  listClips(r, "   silinen/değişen", minus);
  const extCopy = plus.find((c) => c.kind === "A" && c.projId === ext.projId) ?? null;
  r.m(`   harici ses kopyası nereye düştü: ${extCopy ? trackLabel("A", extCopy.track) : "YOK"} (hedef ${trackLabel("A", extT)})`);
  r.facts = {
    txOk: tx.ok,
    changed: plus.length + minus.length,
    tracksAddedInOneTx: { V: mid.vCount - pre.vCount, A: mid.aCount - pre.aCount },
    extCopyTrack: extCopy ? extCopy.track : null,
  };
  if (plus.length === 0 && minus.length === 0) {
    r.status = "FAIL";
    r.m("Transaction hiçbir şey değiştirmedi; geri alma sorusu atlandı.", "err");
    return;
  }

  await assertStillProbe(ctx); // Ctrl+Z istemeden önce: kullanıcı hâlâ PROBE_ sequence'ta mı
  const ans = await ask(
    `Şimdi Premiere'de "${ctx.name}" timeline'ına bir kez tıkla, sonra Ctrl+Z'ye (Mac: Cmd+Z) YALNIZCA BİR KEZ bas ` +
      "(ya da Edit menüsünden 'Undo PROBE T6…' seç). Buraya dön: yapılanların HEPSİ geri geldi mi? " +
      "(kopyalar kayboldu, silinen video V1'e geri döndü)"
  );
  await settle();
  const { sequence: activeAfter } = await getActive();
  if (!activeAfter || sequenceGuid(activeAfter) !== ctx.guid) {
    r.m("   ⚠ Cevap anında aktif sequence PROBE_ değildi: Ctrl+Z başka bir sequence'ta basılmış olabilir.", "warn");
  }
  const post = await snapshot(ctx);
  const restored = sameClips(pre, post);
  r.m(`→ Otomatik karşılaştırma: klipler başlangıçla birebir aynı mı: ${yesNo(restored)}`, restored ? "ok" : "err");
  if (!restored) {
    listClips(r, "   fazladan kalan", added(pre, post), "warn");
    listClips(r, "   eksik kalan", removed(pre, post), "warn");
  }
  r.m(`   track sayısı: başta V${pre.vCount}/A${pre.aCount}, şimdi V${post.vCount}/A${post.aCount}`);
  r.facts = { ...r.facts, userAnswer: ans, restored, tracksAfterUndo: { V: post.vCount, A: post.aCount } };
  if (restored && ans !== "Hayır") r.status = "PASS";
  else if (!restored && ans === "Hayır") r.status = "FAIL";
  else r.status = "BELİRSİZ";
  if (r.status === "BELİRSİZ" && ans !== "Atla") r.m("   ⚠ kullanıcı cevabı ile otomatik karşılaştırma çelişiyor", "warn");
  if (!restored && !refind(post, camV)) {
    r.m("   ⚠ V1'deki asıl kamera videosu hâlâ silinmiş. T3 için önce Edit > Undo ile geri al (ya da T1 yedeğini kullan).", "warn");
  }
};

// ------------------------------------------------------------------ T7
const t7: TestFn = async (ctx, r) => {
  const { s: pre, ps } = await probeSet(ctx, r);
  const after = (c: ClipInfo) => pre.clips.filter((x) => x !== c && x.startSec >= c.endSec - 1e-9);
  const sameTrackAfter = (c: ClipInfo) => after(c).filter((x) => x.kind === c.kind && x.track === c.track);
  const target =
    ps.ext.find((c) => sameTrackAfter(c).length > 0) ?? ps.ext.find((c) => after(c).length > 0) ?? null;
  if (!target) {
    r.status = "BELİRSİZ";
    r.m("Arkasında başka klip olan bir harici ses bulunamadı (A1'de 2 harici ses arka arkaya olmalı).", "err");
    return;
  }
  const followers = sameTrackAfter(target);
  r.m(`Silinecek: ${fmtClip(target)}; aynı track'te arkasındaki klip: ${followers.length}`);
  const notes: string[] = [];
  const { sel, method } = await buildSelection(ctx, [target], notes);
  for (const n of notes) r.m(`   ${n}`, "dim");
  r.m(`createRemoveItemsAction(seçim (${method}), ripple=false, mediaType=${target.kind === "V" ? "VIDEO" : "AUDIO"})`);
  const tx = await transact(ctx, "PROBE T7 ripple=false sil", (ops) => {
    ops.remove(sel, target.kind);
  });
  txLine(r, "sil", tx);
  await settle();
  const post = await snapshot(ctx);
  const targetRemoved = refind(post, target) === null;

  // Zamandan bağımsız kimlikle eşleştir: önce aynı start'lı eşleşmeler, kalanlar "kaydı" sayılır.
  const others = pre.clips.filter((c) => c !== target);
  const pool = new Map<string, ClipInfo[]>();
  for (const c of post.clips) {
    const k = keyNoTime(c);
    pool.set(k, [...(pool.get(k) ?? []), c]);
  }
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
    const arr = pool.get(keyNoTime(c)) ?? [];
    const m = arr.shift();
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
  for (const f of followers) {
    const now = post.clips.find((x) => keyNoTime(x) === keyNoTime(f));
    r.m(`   arkadaki ${trackLabel(f.kind, f.track)} "${f.name}": önce start=${f.start}, sonra start=${now ? now.start : "?"}`);
  }
  r.facts = { targetRemoved, shifted: moved, missing };
  r.status = targetRemoved && unmatched.length === 0 ? "PASS" : "FAIL";
};

// ------------------------------------------------------------------ kayıt

export const TESTS: TestDef[] = [
  { id: "T1", title: "Yedek (sequence.createCloneAction)", fn: t1 },
  { id: "T2", title: "Track açma (clone ofseti / yedek: insert)", fn: t2 },
  { id: "T3", title: "Bağlı çift (video+ses) kopyala / aslı sil", fn: t3 },
  { id: "T4", title: "Sadakat (tick tolerans 0)", fn: t4 },
  { id: "T5", title: "Seçim (createEmptySelection+addItem+setSelection)", fn: t5 },
  { id: "T6", title: "Geri alma (tek transaction, tek Ctrl+Z)", fn: t6 },
  { id: "T7", title: "Ripple (ripple=false başkasını kaydırıyor mu)", fn: t7 },
];

/** "Hepsini çalıştır" sırası: silen testler sona. T6 (geri alınır) T3'ten önce, T7 en son. */
export const RUN_ALL_ORDER = ["T1", "T2", "T4", "T5", "T6", "T3", "T7"];

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
      r.status = "FAIL";
      r.m(`HATA (yakalandı): ${errText(e)}`, "err");
      const stack = e instanceof Error && e.stack ? e.stack.split("\n").slice(1, 4) : [];
      for (const s of stack) r.m(`   ${s.trim()}`, "dim");
    }
  }
  const tone = r.status === "PASS" ? "ok" : r.status === "FAIL" ? "err" : "warn";
  log(`■ ${def.id} → ${r.status}`, tone);
  return {
    id: r.id,
    title: r.title,
    status: r.status,
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
    out(`harici ses  : ${ps.ext.length} adet${ps.ext.length ? " — " + ps.ext.map((c) => `"${c.name}"`).join(", ") : ""}`,
      ps.ext.length >= 2 ? "info" : "warn");
    for (const n of ps.notes) out(`not: ${n}`, "warn");
    for (const w of s.warnings) out(`uyarı: ${w}`, "warn");
    const ok = !!ps.camV && !!ps.camA && ps.ext.length >= 2;
    out(ok ? "Kurulum uygun görünüyor." : "Kurulum eksik — KURULUM_TR.md'deki PROBE_test adımlarına bak.", ok ? "info" : "warn");
  } catch (e) {
    out(`${e instanceof Error && e.name === "ProbeLockError" ? "KİLİT" : "HATA"}: ${errText(e)}`, "err");
  }
  return lines;
}
