// Timeline okuma / düzenleme yardımcıları.
// Düzenleme kalıbı Adobe örneğiyle aynı (sample-panels/premiere-api/src/sequenceEditor.ts):
//   project.lockedAccess(() => project.executeTransaction(compound => {...}, "isim"))
// Seçim kalıbı Adobe örneğiyle aynı (sample-panels/premiere-api/src/sequence.ts → setSequenceSelection,
//   sequenceEditor.ts → removeSelectedTrackItems): sel = await sequence.getSelection(); sel.addItem(item,false); sequence.setSelection(sel)
//
// KURAL (Premiere 26.5.1'de ölçüldü, v0.1.0 raporu): TrackItem referansları bir transaction işlendikten sonra
// GEÇERSİZ olur ("The script object is no longer valid"). Bu yüzden:
//   - her snapshot bir "kuşak" (gen) numarası taşır; her transaction'dan (ve kullanıcı etkileşiminden) sonra kuşak artar,
//   - bir referans yalnızca aldığı kuşakta kullanılabilir (useRef); eskisi kullanılırsa Premiere'e gitmeden hata verilir,
//   - klipler transaction'lar arasında referansla değil, (tür, track, start, end, kaynak adı) ile yeniden bulunur.

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
  ref: TrackItem; // YALNIZCA useRef() ile, aynı kuşakta kullan
  projRef: ProjectItem | null; // YALNIZCA useProj() ile, aynı kuşakta kullan
  gen: number;
  readErrors: string[];
}

export interface Snapshot {
  vCount: number;
  aCount: number;
  clips: ClipInfo[];
  warnings: string[];
  gen: number;
}

// ---------- referans kuşağı ----------

let refGen = 0;

/** Transaction sonrası ya da kullanıcı timeline'da bir şey yaptıktan sonra: eldeki tüm referanslar bayat sayılır. */
export function invalidateRefs(): void {
  refGen++;
}

export class StaleRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleRefError";
  }
}

function assertFresh(gen: number, what: string): void {
  if (gen !== refGen) {
    throw new StaleRefError(
      `BAYAT REFERANS: ${what} ${gen}. kuşaktan, şu an ${refGen}. kuşak (transaction sonrası yeniden okunmalıydı)`
    );
  }
}

export function useRef(c: ClipInfo): TrackItem {
  assertFresh(c.gen, `"${c.name}" (${trackLabel(c.kind, c.track)})`);
  return c.ref;
}

export function useProj(c: ClipInfo): ProjectItem {
  assertFresh(c.gen, `"${c.projName}" proje öğesi`);
  if (!c.projRef) throw new Error(`"${c.name}" için ProjectItem okunamadı`);
  return c.projRef;
}

/** getSelection() ile alınmış, alındığı kuşağı bilen seçim. */
export interface FreshSelection {
  sel: TrackItemSelection;
  gen: number;
}

// ---------- genel ----------

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

export function ticks(t: string): TickTime {
  return ppro.TickTime.createWithTicks(t); // d.ts:L3887 TickTimeStatic.createWithTicks
}

async function readClip(item: TrackItem, kind: Kind, loopTrack: number, gen: number): Promise<ClipInfo> {
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
    projRef: proj,
    gen,
    readErrors: errs,
  };
}

/** Sequence'taki tüm video/ses kliplerini baştan okur (salt okuma). Referanslar bu kuşağa aittir. */
export async function snapshot(ctx: ProbeContext): Promise<Snapshot> {
  const gen = refGen;
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
    for (const it of items ?? []) clips.push(await readClip(it, "V", i, gen));
  }
  for (let i = 0; i < aCount; i++) {
    const track = await seq.getAudioTrack(i); // d.ts:L3159 Sequence.getAudioTrack
    if (!track) {
      warnings.push(`getAudioTrack(${i}) boş döndü`);
      continue;
    }
    const items = track.getTrackItems(CLIP, false); // d.ts:L672 AudioTrack.getTrackItems
    for (const it of items ?? []) clips.push(await readClip(it, "A", i, gen));
  }
  for (const c of clips) {
    if (c.track !== c.loopTrack) {
      warnings.push(`${c.kind}${c.loopTrack + 1} döngüsündeki "${c.name}" için getTrackIndex()=${c.track} (uyuşmuyor)`);
    }
    for (const e of c.readErrors) warnings.push(`"${c.name}" okuma hatası — ${e}`);
  }
  if (gen !== refGen) warnings.push("okuma sırasında kuşak değişti (eşzamanlı transaction?)");
  return { vCount, aCount, clips, warnings, gen };
}

// ---------- anahtarlar / farklar ----------

export const keyFull = (c: ClipInfo) =>
  [c.kind, c.track, c.start, c.end, c.inPt, c.outPt, c.projId, c.name].join("|");

/** Yeniden bulma anahtarı: (track tipi, track index, start tick, end tick, kaynak adı). */
export const locKey = (c: ClipInfo) => [c.kind, c.track, c.start, c.end, c.projName].join("|");

/** Zamandan bağımsız kimlik (ripple ölçümü için). */
export const keyNoTime = (c: ClipInfo) => [c.kind, c.track, c.inPt, c.outPt, c.projId, c.name].join("|");

/** Önceki bir snapshot'taki klibi, taze snapshot'ta (tür, track, start, end, kaynak adı) ile yeniden bulur. */
export function relocate(s: Snapshot, c: ClipInfo): ClipInfo | null {
  const k = locKey(c);
  return s.clips.find((x) => locKey(x) === k) ?? null;
}

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

/** V1/A1 dışındaki boş track index'leri, ardından henüz olmayan ilk iki index (count, count+1). */
export function emptyTracks(s: Snapshot, kind: Kind): number[] {
  const count = kind === "V" ? s.vCount : s.aCount;
  const out: number[] = [];
  for (let i = 1; i < count; i++) if (!s.clips.some((c) => c.kind === kind && c.track === i)) out.push(i);
  out.push(count, count + 1);
  return out;
}

// ---------- probe yapısını bulma ----------

export interface ProbeSet {
  camV: ClipInfo | null;
  camA: ClipInfo | null;
  /** Kaynağı hiçbir video klibinin kaynağı olmayan ses klipleri (TÜM ses track'leri), (track, start) sıralı. */
  ext: ClipInfo[];
  /** Aynı track'te arka arkaya duran iki harici ses (T7 için; önce A2, sonra diğer track'ler). */
  extPair: [ClipInfo, ClipInfo] | null;
  notes: string[];
}

/**
 * Geçerli kurulum (kullanıcının gerçek düzeni): kameralar V1'de arka arkaya (sesleri bağlı, genelde A1),
 * harici sesler herhangi bir ses track'inde (ör. A2/A3'te arka arkaya).
 *  - kamera video = V1'deki ilk klip
 *  - kamera sesi  = kamera videosuyla aynı kaynaklı, aynı start/end'li ses klibi (en alttaki track)
 *  - harici ses   = kaynağı hiçbir video klibinin kaynağıyla aynı olmayan ses klibi
 */
export function findProbeSet(s: Snapshot): ProbeSet {
  const notes: string[] = [];
  const byTrackStart = (a: ClipInfo, b: ClipInfo) => a.track - b.track || a.startSec - b.startSec;
  const v1 = s.clips.filter((c) => c.kind === "V" && c.track === 0).sort(byTrackStart);
  const camV = v1[0] ?? null;
  if (!camV) notes.push("V1'de video klibi bulunamadı (kamera klibi V1'de olmalı).");
  let camA: ClipInfo | null = null;
  if (camV) {
    camA =
      s.clips
        .filter((c) => c.kind === "A" && c.projId === camV.projId && c.start === camV.start && c.end === camV.end)
        .sort(byTrackStart)[0] ?? null;
    if (!camA) notes.push("Kamera klibinin sesi bulunamadı (aynı kaynak + aynı start/end'li ses klibi yok).");
  }
  const videoSources = new Set(s.clips.filter((c) => c.kind === "V").map((c) => c.projId));
  const ext = s.clips.filter((c) => c.kind === "A" && !videoSources.has(c.projId)).sort(byTrackStart);
  if (ext.length === 0) notes.push("Harici ses bulunamadı (kaynağı hiçbir videoyla aynı olmayan ses klibi yok).");

  let extPair: [ClipInfo, ClipInfo] | null = null;
  const tracks = [...new Set(ext.map((c) => c.track))].sort((a, b) => (a === 1 ? -1 : b === 1 ? 1 : a - b));
  for (const t of tracks) {
    const onT = ext.filter((c) => c.track === t);
    for (let i = 0; i + 1 < onT.length && !extPair; i++) {
      if (onT[i + 1].startSec >= onT[i].endSec - 1e-9) extPair = [onT[i], onT[i + 1]];
    }
    if (extPair) break;
  }
  if (!extPair) notes.push("Aynı track'te arka arkaya duran iki harici ses yok (T7 için gerekli, ör. A2'de).");
  return { camV, camA, ext, extPair, notes };
}

// ---------- seçim (Adobe kalıbı) ----------

export interface SelectOutcome {
  sel: FreshSelection; // silme için: setSelection'dan SONRA getSelection() ile yeniden alınmış seçim
  /** setSelection'dan SONRA baştan okunmuş sequence: hemen ardından gelen transaction'ın referansları buradan alınır. */
  snap: Snapshot;
  /** İstenen kliplerin bu taze snapshot'taki karşılıkları (aynı sıra; bulunamayan null). */
  fresh: (ClipInfo | null)[];
  addResults: boolean[];
  setOk: boolean;
  readCount: number;
  exact: boolean;
  notes: string[];
}

/**
 * Tam olarak verilen klipleri seçer ve doğrular.
 * Adobe kalıbı: sel = await sequence.getSelection(); sel.addItem(item, false); sequence.setSelection(sel).
 * Ek güvenlik: önce clearSelection (başka seçili bir şey silinmesin), sonra geri okuyup birebir kontrol.
 * clips yalnızca DEĞER olarak kullanılır: clearSelection'dan sonra sequence baştan okunur ve klipler
 * (tür, track, start, end, kaynak adı) ile yeniden bulunur. clearSelection/setSelection de temkinle
 * "referansları geçersiz kılabilir" sayılır → sonraki transaction dönen `snap`'teki referansları kullanmalı.
 */
export async function selectExactly(ctx: ProbeContext, clips: ClipInfo[]): Promise<SelectOutcome> {
  await assertStillProbe(ctx);
  const notes: string[] = [];
  const cleared = await ctx.sequence.clearSelection(); // d.ts:L3112 Sequence.clearSelection
  invalidateRefs();
  notes.push(`clearSelection → ${String(cleared)}`);
  const s0 = await snapshot(ctx);
  const targets = clips.map((c) => relocate(s0, c));
  const missingIdx = targets.findIndex((t) => t === null);
  if (missingIdx >= 0) throw new Error(`seçilecek klip yeniden bulunamadı: ${fmtClip(clips[missingIdx])}`);
  const refs = (targets as ClipInfo[]).map(useRef); // bayat referans Premiere'e hiç gitmesin
  const sel = await ctx.sequence.getSelection(); // d.ts:L3211 Sequence.getSelection
  const leftovers = await sel.getTrackItems(); // d.ts:L4039 TrackItemSelection.getTrackItems
  if (leftovers.length) {
    notes.push(`clearSelection sonrası seçimde hâlâ ${leftovers.length} öğe var → removeItem`);
    for (const it of leftovers) sel.removeItem(it); // d.ts:L4034 TrackItemSelection.removeItem
  }
  const addResults = refs.map((r) => sel.addItem(r, false)); // d.ts:L4024 TrackItemSelection.addItem
  await assertStillProbe(ctx);
  const setOk = ctx.sequence.setSelection(sel); // d.ts:L3267 Sequence.setSelection
  invalidateRefs();
  notes.push(`addItem → [${addResults.join(", ")}]; setSelection → ${String(setOk)}`);

  // Geri oku: getSelection sayısı + her klibin getIsSelected'i (taze okuma, transaction yok → kuşak aynı)
  const rb = await ctx.sequence.getSelection(); // d.ts:L3211 Sequence.getSelection
  const readCount = (await rb.getTrackItems()).length; // d.ts:L4039 TrackItemSelection.getTrackItems
  const s = await snapshot(ctx);
  const want = new Set(clips.map(locKey));
  const selectedNow = s.clips.filter((c) => c.selected);
  const exact =
    readCount === clips.length &&
    selectedNow.length === clips.length &&
    selectedNow.every((c) => want.has(locKey(c)));
  notes.push(
    `geri okuma: getSelection ${readCount} öğe, getIsSelected ${selectedNow.length} klip → birebir: ${exact ? "EVET" : "HAYIR"}`
  );
  if (!exact) for (const c of selectedNow) notes.push(`   seçili: ${fmtClip(c)}`);
  const fresh = clips.map((c) => relocate(s, c));
  return { sel: { sel: rb, gen: refGen }, snap: s, fresh, addResults, setOk, readCount, exact, notes };
}

/** Kullanıcı timeline'da tıkladıktan sonra: kaç öğe seçili (getSelection) ve hangileri (getIsSelected). */
export async function readSelection(ctx: ProbeContext): Promise<{ count: number; clips: ClipInfo[] }> {
  const rb = await ctx.sequence.getSelection(); // d.ts:L3211 Sequence.getSelection
  const count = (await rb.getTrackItems()).length; // d.ts:L4039 TrackItemSelection.getTrackItems
  const s = await snapshot(ctx);
  return { count, clips: s.clips.filter((c) => c.selected) };
}

// ---------- düzenleme ----------

export interface TxResult {
  ok: boolean;
  addResults: boolean[];
  compoundEmpty: boolean | null;
}

/** Silinen seçimin türü: "mixed" (video+ses birlikte) için Adobe örneği gibi VIDEO verilir. */
export type RemoveKind = Kind | "mixed";

/**
 * Transaction içinde kullanılabilen düzenlemeler. Her biri Action'ı executeTransaction callback'inin
 * İÇİNDE üretir ve hemen compound'a ekler (dönüş: addAction sonucu). Referanslar useRef ile kuşak kontrolünden geçer.
 * Adobe kuralı (eslint @adobe/premierepro/require-action-lock-scope): kilit dışında üretilen Action runtime'da hata verir.
 */
export interface TxOps {
  /** Klibi zaman ofseti 0 ile dikey ofsetle kopyalar. overwrite (isInsert=false), alignToVideo=false. */
  clone(clip: ClipInfo, vOffset: number, aOffset: number): boolean;
  /** Seçimi ripple=false ile siler. mediaType: V→VIDEO, A→AUDIO, mixed→VIDEO (Adobe örneği). */
  remove(sel: FreshSelection, kind: RemoveKind): boolean;
  /** Klibin proje öğesini verilen zamana/track index'lerine insert eder (limitShift=true). */
  insert(source: ClipInfo, at: TickTime, videoTrackIndex: number, audioTrackIndex: number): boolean;
  /** Klibin proje öğesini verilen zamana/track index'lerine overwrite eder. */
  overwrite(source: ClipInfo, at: TickTime, videoTrackIndex: number, audioTrackIndex: number): boolean;
  setIn(clip: ClipInfo, t: TickTime): boolean;
  setOut(clip: ClipInfo, t: TickTime): boolean;
  setStart(clip: ClipInfo, t: TickTime): boolean;
  setEnd(clip: ClipInfo, t: TickTime): boolean;
  /** PROBE_ sequence'ın kopyasını (yedek) oluşturur. */
  cloneSequence(): boolean;
}

/**
 * Adobe kalıbı: lockedAccess(() => executeTransaction(compound => {...}, isim)).
 * Çağırmadan önce PROBE_ kilidi yeniden doğrulanır; tüm düzenlemeler ctx.sequence'ın editörüyle yapılır.
 * Transaction denendikten sonra (başarılı ya da değil) eldeki tüm referanslar bayat sayılır.
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
  try {
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
                useRef(clip),
                ppro.TickTime.TIME_ZERO, // d.ts:L3929 TickTimeStatic.TIME_ZERO
                v,
                a,
                false, // alignToVideo: kare hizalaması yapmasın (sadakat ölçümü bozulmasın)
                false // isInsert=false → overwrite; diğer track'lerde kaydırma olmasın
              )
            ),
          remove: (fs, kind) => {
            assertFresh(fs.gen, "seçim");
            return add(ed.createRemoveItemsAction(fs.sel, false, kind === "A" ? MT.AUDIO : MT.VIDEO)); // d.ts:L3305 SequenceEditor.createRemoveItemsAction
          },
          insert: (src, at, v, a) => add(ed.createInsertProjectItemAction(useProj(src), at, v, a, true)), // d.ts:L3321 SequenceEditor.createInsertProjectItemAction
          overwrite: (src, at, v, a) => add(ed.createOverwriteItemAction(useProj(src), at, v, a)), // d.ts:L3337 SequenceEditor.createOverwriteItemAction
          setIn: (c, t) => add(useRef(c).createSetInPointAction(t)), // d.ts:L4160 VideoClipTrackItem.createSetInPointAction / d.ts:L441 AudioClipTrackItem.createSetInPointAction
          setOut: (c, t) => add(useRef(c).createSetOutPointAction(t)), // d.ts:L4174 VideoClipTrackItem.createSetOutPointAction / d.ts:L455 AudioClipTrackItem.createSetOutPointAction
          setStart: (c, t) => add(useRef(c).createSetStartAction(t)), // d.ts:L4181 VideoClipTrackItem.createSetStartAction / d.ts:L462 AudioClipTrackItem.createSetStartAction
          setEnd: (c, t) => add(useRef(c).createSetEndAction(t)), // d.ts:L4153 VideoClipTrackItem.createSetEndAction / d.ts:L434 AudioClipTrackItem.createSetEndAction
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
  } finally {
    invalidateRefs(); // KURAL: hiçbir referans bu transaction'ı aşamaz
  }
  if (inner) throw inner;
  return { ok, addResults, compoundEmpty };
}

// ---------- hata sınıflama ----------

export type FailClass = "api" | "kod" | "belirsiz";

/** Rapor etiketi (toUpperCase Türkçe "i"yi bozar: "belirsiz" → "BELIRSIZ"). */
export const FAIL_LABEL: Record<FailClass, string> = { api: "API", kod: "KOD", belirsiz: "BELİRSİZ" };

/**
 * Yakalanan bir istisna tek başına "API yok" demek değildir.
 *  kod     : bizim kullanımımız (bayat referans, geçersiz nesne) — panel düzeltilir, API hakkında karar verdirmez
 *  api     : metot çalışma zamanında yok / desteklenmiyor
 *  belirsiz: sınıflanamadı — kararı "GEÇİCİ" yapar, CEP gerekçesi olamaz
 */
export function classifyError(e: unknown): { cls: FailClass; why: string } {
  const t = errText(e);
  if (e instanceof StaleRefError || /no longer valid|BAYAT REFERANS/i.test(t))
    return { cls: "kod", why: "bayat TrackItem referansı (transaction sonrası yeniden okunmamış)" };
  if (/nullptr|null pointer/i.test(t)) return { cls: "kod", why: "geçersiz nesneyle çağrı (nullptr) — kullanım hatası" };
  if (/is not a function|has no method|not supported|not implemented|undefined is not/i.test(t))
    return { cls: "api", why: "metot çalışma zamanında yok / desteklenmiyor" };
  return { cls: "belirsiz", why: "sınıflanamayan istisna" };
}
