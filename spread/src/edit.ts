// Düzenleme (Spread). Kalıplar Adobe örneğiyle aynı (AdobeDocs/uxp-premiere-pro-samples, sample-panels/premiere-api):
//   düzenleme: project.lockedAccess(() => project.executeTransaction(compound => {...}, "isim"))   (src/sequenceEditor.ts)
//   seçim    : sel = await sequence.getSelection(); sel.addItem(item, false); sequence.setSelection(sel)   (src/sequence.ts)
// Action'lar lexically executeTransaction callback'inin İÇİNDE üretilir (eslint @adobe/premierepro/require-action-lock-scope).

import { ppro } from "./ppro";
import type { Action, CompoundAction, TickTime, TrackItemSelection } from "./ppro";
import { assertSameSequence, type SeqContext } from "./session";
import {
  assertFresh,
  currentGen,
  fmtClip,
  invalidateRefs,
  locKey,
  relocate,
  snapshot,
  tt,
  useProj,
  useRef,
  type ClipInfo,
  type Snapshot,
} from "./model";

/** getSelection() ile alınmış, alındığı kuşağı bilen seçim. */
export interface FreshSelection {
  sel: TrackItemSelection;
  gen: number;
}

export interface TxResult {
  ok: boolean;
  addResults: boolean[];
}

export interface TxOps {
  /** Klibi zaman ofseti + dikey ofsetle kopyalar. overwrite (isInsert=false), alignToVideo=false. Kopya tek öğedir (bağlı partner gelmez). */
  clone(clip: ClipInfo, timeOffset: TickTime, vOffset: number, aOffset: number): boolean;
  /** Seçimi ripple=false ile siler. mediaType filtre değil (Probe T7) → video+ses tek action. */
  remove(sel: FreshSelection): boolean;
  /** Klibin proje öğesini verilen zamana/track index'lerine overwrite eder → video+ses BAĞLI doğar (Probe T8). */
  overwrite(source: ClipInfo, at: TickTime, videoTrackIndex: number, audioTrackIndex: number): boolean;
  setIn(clip: ClipInfo, t: TickTime): boolean;
  setOut(clip: ClipInfo, t: TickTime): boolean;
  setStart(clip: ClipInfo, t: TickTime): boolean;
  setEnd(clip: ClipInfo, t: TickTime): boolean;
  /** Sequence'ın kopyasını (yedek) oluşturur. */
  cloneSequence(): boolean;
}

/**
 * Adobe kalıbı. Önce sequence sabitlemesi doğrulanır; transaction denendikten sonra (hata verse bile) tüm referanslar bayat sayılır.
 */
export async function transact(ctx: SeqContext, undoName: string, build: (ops: TxOps) => void): Promise<TxResult> {
  await assertSameSequence(ctx);
  const ed = ppro.SequenceEditor.getEditor(ctx.sequence); // d.ts:L3288 SequenceEditorStatic.getEditor
  const MT = ppro.Constants.MediaType; // d.ts:L4692 Constants.MediaType
  let ok = false;
  let inner: unknown = null;
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
          clone: (clip, off, v, a) =>
            add(ed.createCloneTrackItemAction(useRef(clip), off, v, a, false, false)), // d.ts:L3354 SequenceEditor.createCloneTrackItemAction
          remove: (fs) => {
            assertFresh(fs.gen, "seçim");
            return add(ed.createRemoveItemsAction(fs.sel, false, MT.VIDEO)); // d.ts:L3305 SequenceEditor.createRemoveItemsAction
          },
          overwrite: (src, at, v, a) => add(ed.createOverwriteItemAction(useProj(src), at, v, a)), // d.ts:L3337 SequenceEditor.createOverwriteItemAction
          setIn: (c, t) => add(useRef(c).createSetInPointAction(t)), // d.ts:L4160 VideoClipTrackItem.createSetInPointAction / d.ts:L441 AudioClipTrackItem.createSetInPointAction
          setOut: (c, t) => add(useRef(c).createSetOutPointAction(t)), // d.ts:L4174 VideoClipTrackItem.createSetOutPointAction / d.ts:L455 AudioClipTrackItem.createSetOutPointAction
          setStart: (c, t) => add(useRef(c).createSetStartAction(t)), // d.ts:L4181 VideoClipTrackItem.createSetStartAction / d.ts:L462 AudioClipTrackItem.createSetStartAction
          setEnd: (c, t) => add(useRef(c).createSetEndAction(t)), // d.ts:L4153 VideoClipTrackItem.createSetEndAction / d.ts:L434 AudioClipTrackItem.createSetEndAction
          cloneSequence: () => add(ctx.sequence.createCloneAction()), // d.ts:L3117 Sequence.createCloneAction
        };
        try {
          build(ops);
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
  return { ok, addResults };
}

export interface SelectOutcome {
  /** setSelection'dan SONRA getSelection() ile alınmış seçim (silme için). */
  sel: FreshSelection;
  /** setSelection'dan SONRA baştan okunan sequence — hemen ardından gelen transaction'ın referansları buradan. */
  snap: Snapshot;
  addResults: boolean[];
  setOk: boolean;
  readCount: number;
  exact: boolean;
  notes: string[];
}

/**
 * Tam olarak verilen klipleri seçer (Adobe kalıbı) ve geri okuyarak doğrular.
 * clips yalnızca DEĞER olarak kullanılır: clearSelection'dan sonra sequence baştan okunur, klipler yeniden bulunur.
 * exact: istenen her klip seçili, başka klip seçili değil, getSelection öğeleri getIsSelected klipleriyle aynı.
 */
export async function selectExactly(ctx: SeqContext, clips: ClipInfo[]): Promise<SelectOutcome> {
  await assertSameSequence(ctx);
  const notes: string[] = [];
  const cleared = await ctx.sequence.clearSelection(); // d.ts:L3112 Sequence.clearSelection
  invalidateRefs();
  const s0 = await snapshot(ctx);
  const targets = clips.map((c) => relocate(s0, c));
  const missing = targets.findIndex((t) => t === null);
  if (missing >= 0) throw new Error(`seçilecek klip yeniden bulunamadı: ${fmtClip(clips[missing])}`);
  const refs = (targets as ClipInfo[]).map(useRef);
  const sel = await ctx.sequence.getSelection(); // d.ts:L3211 Sequence.getSelection
  const leftovers = await sel.getTrackItems(); // d.ts:L4039 TrackItemSelection.getTrackItems
  for (const it of leftovers) sel.removeItem(it); // d.ts:L4034 TrackItemSelection.removeItem
  const addResults = refs.map((r) => sel.addItem(r, false)); // d.ts:L4024 TrackItemSelection.addItem
  await assertSameSequence(ctx);
  const setOk = ctx.sequence.setSelection(sel); // d.ts:L3267 Sequence.setSelection
  invalidateRefs();
  notes.push(`clearSelection → ${String(cleared)}; addItem ×${addResults.length} (false: ${addResults.filter((x) => !x).length}); setSelection → ${String(setOk)}`);

  const rb = await ctx.sequence.getSelection(); // d.ts:L3211 Sequence.getSelection
  const rbGen = currentGen();
  const rbItems = await rb.getTrackItems(); // d.ts:L4039 TrackItemSelection.getTrackItems
  const rbKeys: string[] = [];
  for (const it of rbItems) {
    const tr = await it.getTrackIndex(); // d.ts:L4241 VideoClipTrackItem.getTrackIndex / d.ts:L522 AudioClipTrackItem.getTrackIndex
    const st = tt(await it.getStartTime()); // d.ts:L4236 VideoClipTrackItem.getStartTime / d.ts:L517 AudioClipTrackItem.getStartTime
    const en = tt(await it.getEndTime()); // d.ts:L4191 VideoClipTrackItem.getEndTime / d.ts:L472 AudioClipTrackItem.getEndTime
    const pi = await it.getProjectItem(); // d.ts:L4226 VideoClipTrackItem.getProjectItem / d.ts:L507 AudioClipTrackItem.getProjectItem
    rbKeys.push([tr, st.ticks, en.ticks, pi ? pi.name : "?"].join("|")); // d.ts:L2854 ProjectItem.name
  }
  const s = await snapshot(ctx);
  const noKind = (c: ClipInfo) => [c.track, c.start, c.end, c.projName].join("|");
  const want = new Set(clips.map(locKey));
  const selectedNow = s.clips.filter((c) => c.selected);
  const exact =
    selectedNow.length === clips.length &&
    selectedNow.every((c) => want.has(locKey(c))) &&
    rbKeys.slice().sort().join("\n") === selectedNow.map(noKind).sort().join("\n");
  notes.push(`geri okuma: getSelection ${rbItems.length} öğe, getIsSelected ${selectedNow.length} klip (istenen ${clips.length}) → ${exact ? "uygun" : "UYGUN DEĞİL"}`);
  return { sel: { sel: rb, gen: rbGen }, snap: s, addResults, setOk, readCount: rbItems.length, exact, notes };
}

/** İş bitince: tüm klipleri programla seç (Adobe kalıbı). Probe T5: programla doğru ama timeline'da görünmeyebilir. */
export async function selectAll(ctx: SeqContext): Promise<{ requested: number; read: number; setOk: boolean }> {
  await assertSameSequence(ctx);
  await ctx.sequence.clearSelection(); // d.ts:L3112 Sequence.clearSelection
  invalidateRefs();
  const s = await snapshot(ctx);
  const sel = await ctx.sequence.getSelection(); // d.ts:L3211 Sequence.getSelection
  for (const c of s.clips) sel.addItem(useRef(c), false); // d.ts:L4024 TrackItemSelection.addItem
  const setOk = ctx.sequence.setSelection(sel); // d.ts:L3267 Sequence.setSelection
  invalidateRefs();
  const rb = await ctx.sequence.getSelection(); // d.ts:L3211 Sequence.getSelection
  const read = (await rb.getTrackItems()).length; // d.ts:L4039 TrackItemSelection.getTrackItems
  return { requested: s.clips.length, read, setOk };
}
