// Timeline okuma / düzenleme yardımcıları.
// Düzenleme kalıbı Adobe örneğiyle aynı (sample-panels/premiere-api/src/sequenceEditor.ts):
//   project.lockedAccess(() => project.executeTransaction(compound => {...}, "isim"))

import { ppro } from "./ppro";
import type { Action, CompoundAction, ProjectItem, TickTime, TrackItem, TrackItemSelection } from "./ppro";
import { assertStillProbe, type ProbeContext } from "./guard";

export type Kind = "V" | "A";

export interface ClipInfo {
  kind: Kind;
  track: number; // 0 tabanlı; getTrackIndex() ile okunan
  loopTrack: number; // getVideoTrack(i)/getAudioTrack(i) döngüsündeki i
  start: string; // tick (string)
  end: string;
  inPt: string;
  outPt: string;
  startSec: number;
  endSec: number;
  speed: number;
  disabled: boolean;
  name: string;
  projId: string;
  projName: string;
  selected: boolean;
  ref: TrackItem;
  readErrors: string[];
}

export interface Snapshot {
  vCount: number;
  aCount: number;
  clips: ClipInfo[];
  warnings: string[];
}

export function errText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  try {
    return typeof e === "string" ? e : JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Premiere'in modeli güncellesin diye transaction sonrası kısa bekleme. */
export const settle = () => sleep(400);

async function safe<T>(label: string, fn: () => Promise<T> | T, fallback: T, errs: string[]): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    errs.push(`${label}: ${errText(e)}`);
    return fallback;
  }
}

function tt(t: TickTime | null | undefined): { ticks: string; sec: number } {
  if (!t) return { ticks: "?", sec: NaN };
  return { ticks: t.ticks, sec: t.seconds }; // d.ts:L3992 TickTime.ticks, d.ts:L3986 TickTime.seconds
}

async function readClip(item: TrackItem, kind: Kind, loopTrack: number): Promise<ClipInfo> {
  const errs: string[] = [];
  // VideoClipTrackItem ve AudioClipTrackItem aynı okuma metotlarına sahip:
  const start = tt(await safe("getStartTime", () => item.getStartTime(), null, errs)); // d.ts:L4236 VideoClipTrackItem.getStartTime / d.ts:L517 AudioClipTrackItem.getStartTime
  const end = tt(await safe("getEndTime", () => item.getEndTime(), null, errs)); // d.ts:L4191 VideoClipTrackItem.getEndTime / d.ts:L472 AudioClipTrackItem.getEndTime
  const inPt = tt(await safe("getInPoint", () => item.getInPoint(), null, errs)); // d.ts:L4196 VideoClipTrackItem.getInPoint / d.ts:L477 AudioClipTrackItem.getInPoint
  const outPt = tt(await safe("getOutPoint", () => item.getOutPoint(), null, errs)); // d.ts:L4221 VideoClipTrackItem.getOutPoint / d.ts:L502 AudioClipTrackItem.getOutPoint
  const speed = await safe("getSpeed", () => item.getSpeed(), NaN, errs); // d.ts:L4231 VideoClipTrackItem.getSpeed / d.ts:L512 AudioClipTrackItem.getSpeed
  const disabled = await safe("isDisabled", () => item.isDisabled(), false, errs); // d.ts:L4256 VideoClipTrackItem.isDisabled / d.ts:L537 AudioClipTrackItem.isDisabled
  const name = await safe("getName", () => item.getName(), "?", errs); // d.ts:L4216 VideoClipTrackItem.getName / d.ts:L497 AudioClipTrackItem.getName
  const track = await safe("getTrackIndex", () => item.getTrackIndex(), loopTrack, errs); // d.ts:L4241 VideoClipTrackItem.getTrackIndex / d.ts:L522 AudioClipTrackItem.getTrackIndex
  const selected = await safe("getIsSelected", () => item.getIsSelected(), false, errs); // d.ts:L4201 VideoClipTrackItem.getIsSelected / d.ts:L482 AudioClipTrackItem.getIsSelected
  const proj = await safe("getProjectItem", () => item.getProjectItem(), null, errs); // d.ts:L4226 VideoClipTrackItem.getProjectItem / d.ts:L507 AudioClipTrackItem.getProjectItem
  const projId = proj ? await safe("ProjectItem.getId", () => proj.getId(), "?", errs) : "?"; // d.ts:L2843 ProjectItem.getId
  const projName = proj ? proj.name : "?"; // d.ts:L2854 ProjectItem.name
  return {
    kind,
    track,
    loopTrack,
    start: start.ticks,
    end: end.ticks,
    inPt: inPt.ticks,
    outPt: outPt.ticks,
    startSec: start.sec,
    endSec: end.sec,
    speed,
    disabled,
    name,
    projId,
    projName,
    selected,
    ref: item,
    readErrors: errs,
  };
}

/** Sequence'taki tüm video/ses kliplerini okur (salt okuma). */
export async function snapshot(ctx: ProbeContext): Promise<Snapshot> {
  const seq = ctx.sequence;
  const warnings: string[] = [];
  const vCount = await seq.getVideoTrackCount(); // d.ts:L3243 Sequence.getVideoTrackCount
  const aCount = await seq.getAudioTrackCount(); // d.ts:L3164 Sequence.getAudioTrackCount
  const clips: ClipInfo[] = [];
  const CLIP = ppro.Constants.TrackItemType.CLIP; // d.ts:L4804 Constants.TrackItemType
  for (let i = 0; i < vCount; i++) {
    const track = await seq.getVideoTrack(i); // d.ts:L3238 Sequence.getVideoTrack
    if (!track) {
      warnings.push(`getVideoTrack(${i}) boş döndü`);
      continue;
    }
    const items = track.getTrackItems(CLIP, false); // d.ts:L4392 VideoTrack.getTrackItems
    for (const it of items ?? []) clips.push(await readClip(it, "V", i));
  }
  for (let i = 0; i < aCount; i++) {
    const track = await seq.getAudioTrack(i); // d.ts:L3159 Sequence.getAudioTrack
    if (!track) {
      warnings.push(`getAudioTrack(${i}) boş döndü`);
      continue;
    }
    const items = track.getTrackItems(CLIP, false); // d.ts:L672 AudioTrack.getTrackItems
    for (const it of items ?? []) clips.push(await readClip(it, "A", i));
  }
  for (const c of clips) {
    if (c.track !== c.loopTrack) {
      warnings.push(
        `${c.kind}${c.loopTrack + 1} döngüsündeki "${c.name}" için getTrackIndex()=${c.track} (uyuşmuyor)`
      );
    }
    for (const e of c.readErrors) warnings.push(`"${c.name}" okuma hatası — ${e}`);
  }
  return { vCount, aCount, clips, warnings };
}

// ---------- anahtarlar / farklar ----------

export const keyFull = (c: ClipInfo) =>
  [c.kind, c.track, c.start, c.end, c.inPt, c.outPt, c.projId, c.name].join("|");

/** Zamandan bağımsız kimlik (ripple ölçümü için). */
export const keyNoTime = (c: ClipInfo) =>
  [c.kind, c.track, c.inPt, c.outPt, c.projId, c.name].join("|");

function multiset(clips: ClipInfo[], key: (c: ClipInfo) => string): Map<string, ClipInfo[]> {
  const m = new Map<string, ClipInfo[]>();
  for (const c of clips) {
    const k = key(c);
    const arr = m.get(k);
    if (arr) arr.push(c);
    else m.set(k, [c]);
  }
  return m;
}

/** post'ta olup pre'de olmayan klipler (çoklu küme farkı). */
export function added(pre: Snapshot, post: Snapshot): ClipInfo[] {
  const m = multiset(pre.clips, keyFull);
  const out: ClipInfo[] = [];
  for (const c of post.clips) {
    const arr = m.get(keyFull(c));
    if (arr && arr.length) arr.pop();
    else out.push(c);
  }
  return out;
}

/** pre'de olup post'ta olmayan klipler. */
export function removed(pre: Snapshot, post: Snapshot): ClipInfo[] {
  return added(post, pre);
}

export function sameClips(a: Snapshot, b: Snapshot): boolean {
  return added(a, b).length === 0 && removed(a, b).length === 0;
}

export function tickDiff(a: string, b: string): string {
  try {
    return (BigInt(b) - BigInt(a)).toString();
  } catch {
    return String(Number(b) - Number(a));
  }
}

export function trackLabel(kind: Kind, track: number): string {
  return `${kind}${track + 1}`;
}

export function fmtClip(c: ClipInfo): string {
  const s = Number.isFinite(c.startSec) ? c.startSec.toFixed(3) : "?";
  const e = Number.isFinite(c.endSec) ? c.endSec.toFixed(3) : "?";
  return `${trackLabel(c.kind, c.track)} "${c.name}" [${s}s–${e}s] start=${c.start} end=${c.end}`;
}

// ---------- probe yapısını bulma ----------

export interface ProbeSet {
  camV: ClipInfo | null;
  camA: ClipInfo | null;
  ext: ClipInfo[]; // V1'deki videoyla aynı kaynaktan gelmeyen A1 klipleri
  notes: string[];
}

/**
 * Kurulum: V1'de 1 kamera klibi (kendi sesi A1'de bağlı) + A1'de arka arkaya 2 harici ses.
 * Orijinaller hep V1/A1'de kalır; testlerin kopyaları yeni (üst) track'lere gider.
 */
export function findProbeSet(s: Snapshot): ProbeSet {
  const notes: string[] = [];
  const byStart = (a: ClipInfo, b: ClipInfo) => a.startSec - b.startSec;
  const v1 = s.clips.filter((c) => c.kind === "V" && c.track === 0).sort(byStart);
  const a1 = s.clips.filter((c) => c.kind === "A" && c.track === 0).sort(byStart);
  const camV = v1[0] ?? null;
  if (!camV) notes.push("V1'de video klibi bulunamadı (kamera klibi V1'de olmalı).");
  if (v1.length > 1) notes.push(`V1'de ${v1.length} klip var; ilki kamera klibi sayıldı.`);
  let camA: ClipInfo | null = null;
  if (camV) {
    camA =
      a1.find((c) => c.projId === camV.projId && c.start === camV.start) ??
      a1.find((c) => c.projId === camV.projId) ??
      null;
    if (!camA) notes.push("Kamera klibinin sesi A1'de bulunamadı (aynı kaynak + aynı başlangıç).");
  }
  const videoProj = new Set(s.clips.filter((c) => c.kind === "V").map((c) => c.projId));
  const ext = a1.filter((c) => c !== camA && !videoProj.has(c.projId));
  if (ext.length === 0) notes.push("A1'de harici ses klibi bulunamadı.");
  return { camV, camA, ext, notes };
}

// ---------- düzenleme ----------

export interface TxResult {
  ok: boolean;
  addResults: boolean[];
  compoundEmpty: boolean | null;
}

/**
 * Transaction içinde kullanılabilen düzenlemeler. Her biri Action'ı executeTransaction callback'inin
 * İÇİNDE üretir ve hemen compound'a ekler (dönüş: addAction sonucu).
 * Adobe kuralı (eslint @adobe/premierepro/require-action-lock-scope): kilit dışında üretilen Action runtime'da hata verir.
 */
export interface TxOps {
  /** Klibi zaman ofseti 0 ile dikey ofsetle kopyalar. overwrite (isInsert=false), alignToVideo=false. */
  clone(clip: ClipInfo, vOffset: number, aOffset: number): boolean;
  /** Seçimi ripple=false ile siler; mediaType silinenlerin türüyle aynı verilir (VIDEO / AUDIO ayrı çağrı). */
  remove(sel: TrackItemSelection, kind: Kind): boolean;
  /** Proje öğesini verilen zamana ve track index'lerine insert eder (limitShift=true). */
  insert(projectItem: ProjectItem, at: TickTime, videoTrackIndex: number, audioTrackIndex: number): boolean;
  /** PROBE_ sequence'ın kopyasını (yedek) oluşturur. */
  cloneSequence(): boolean;
}

/**
 * Adobe kalıbı: lockedAccess(() => executeTransaction(compound => {...}, isim)).
 * Çağırmadan önce PROBE_ kilidi yeniden doğrulanır; tüm düzenlemeler ctx.sequence'ın editörüyle yapılır.
 */
export async function transact(
  ctx: ProbeContext,
  undoName: string,
  build: (ops: TxOps) => void
): Promise<TxResult> {
  await assertStillProbe(ctx);
  const ed = ppro.SequenceEditor.getEditor(ctx.sequence); // d.ts:L3288 SequenceEditorStatic.getEditor
  const MT = ppro.Constants.MediaType; // d.ts:L4692 Constants.MediaType
  let ok = false;
  let inner: unknown = null;
  let compoundEmpty: boolean | null = null;
  const addResults: boolean[] = [];
  ctx.project.lockedAccess(() => { // d.ts:L2608 Project.lockedAccess
    ok = ctx.project.executeTransaction((compound: CompoundAction) => { // d.ts:L2598 Project.executeTransaction
      const add = (a: Action) => {
        const r = compound.addAction(a); // d.ts:L1308 CompoundAction.addAction
        addResults.push(r);
        return r;
      };
      const ops: TxOps = {
        clone: (clip, v, a) =>
          add(
            ed.createCloneTrackItemAction( // d.ts:L3354 SequenceEditor.createCloneTrackItemAction
              clip.ref,
              ppro.TickTime.TIME_ZERO, // d.ts:L3929 TickTimeStatic.TIME_ZERO
              v,
              a,
              false, // alignToVideo: kare hizalaması yapmasın (sadakat ölçümü bozulmasın)
              false // isInsert=false → overwrite; diğer track'lerde kaydırma olmasın
            )
          ),
        remove: (sel, kind) =>
          add(ed.createRemoveItemsAction(sel, false, kind === "V" ? MT.VIDEO : MT.AUDIO)), // d.ts:L3305 SequenceEditor.createRemoveItemsAction
        insert: (pi, at, v, a) => add(ed.createInsertProjectItemAction(pi, at, v, a, true)), // d.ts:L3321 SequenceEditor.createInsertProjectItemAction
        cloneSequence: () => add(ctx.sequence.createCloneAction()), // d.ts:L3117 Sequence.createCloneAction
      };
      try {
        build(ops);
        compoundEmpty = compound.empty; // d.ts:L1314 CompoundAction.empty
      } catch (e) {
        inner = e;
        throw e;
      }
    }, undoName);
  });
  if (inner) throw inner;
  return { ok, addResults, compoundEmpty };
}

/**
 * createEmptySelection callback'le seçim verir. Callback gelmezse 3 sn sonra hata.
 * Önce düz çağrı; senkron hata olursa lockedAccess içinde yeniden dener.
 */
export function createEmptySelection(ctx: ProbeContext, notes: string[]): Promise<TrackItemSelection> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error("createEmptySelection: callback 3 sn içinde gelmedi"))),
      3000
    );
    const cb = (sel: TrackItemSelection) => finish(() => resolve(sel));
    try {
      const r = ppro.TrackItemSelection.createEmptySelection(cb); // d.ts:L4014 TrackItemSelectionStatic.createEmptySelection
      notes.push(`createEmptySelection dönüş değeri: ${String(r)}`);
    } catch (e1) {
      notes.push(`createEmptySelection düz çağrıda hata: ${errText(e1)} → lockedAccess içinde deneniyor`);
      try {
        ctx.project.lockedAccess(() => { // d.ts:L2608 Project.lockedAccess
          const r = ppro.TrackItemSelection.createEmptySelection(cb); // d.ts:L4014 TrackItemSelectionStatic.createEmptySelection
          notes.push(`createEmptySelection (lockedAccess içinde) dönüş değeri: ${String(r)}`);
        });
      } catch (e2) {
        finish(() => reject(e2));
      }
    }
  });
}

/**
 * Verilen kliplerden bir TrackItemSelection kurar.
 * Birincil yol: createEmptySelection + addItem. Olmazsa yedek: sequence.getSelection() + removeItem + addItem.
 */
export async function buildSelection(
  ctx: ProbeContext,
  clips: ClipInfo[],
  notes: string[]
): Promise<{ sel: TrackItemSelection; method: string; addResults: boolean[] }> {
  await assertStillProbe(ctx); // yedek yol canlı seçimi değiştirebilir → önce kilit
  let sel: TrackItemSelection;
  let method = "createEmptySelection";
  try {
    sel = await createEmptySelection(ctx, notes);
  } catch (e) {
    notes.push(`createEmptySelection başarısız: ${errText(e)} → yedek yol: getSelection + removeItem`);
    method = "getSelection+removeItem (yedek)";
    sel = await ctx.sequence.getSelection(); // d.ts:L3211 Sequence.getSelection
    const current = await sel.getTrackItems(); // d.ts:L4039 TrackItemSelection.getTrackItems
    for (const it of current) sel.removeItem(it); // d.ts:L4034 TrackItemSelection.removeItem
  }
  const addResults = clips.map((c) => sel.addItem(c.ref, false)); // d.ts:L4024 TrackItemSelection.addItem
  return { sel, method, addResults };
}
