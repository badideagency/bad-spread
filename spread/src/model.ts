// Timeline okuma modeli (Spread).
// KESİN BULGU (Premiere 26.5.1, Probe raporu): TrackItem referansları bir transaction işlendikten sonra GEÇERSİZ olur.
//   → her snapshot bir "kuşak" (gen) taşır; transaction / kullanıcı etkileşimi / seçim çağrısından sonra kuşak artar;
//     referans yalnızca aldığı kuşakta kullanılabilir (useRef); klipler (tür, track, start, end, kaynak adı) ile yeniden bulunur.

import { ppro } from "./ppro";
import type { ProjectItem, TickTime, TrackItem } from "./ppro";
import type { SeqContext } from "./session";
import { secOf, trackLabel } from "./core";

export type Kind = "V" | "A";

export interface ClipInfo {
  kind: Kind;
  track: number; // 0 tabanlı (getTrackIndex)
  loopTrack: number;
  start: string; // tick (string)
  end: string;
  inPt: string;
  outPt: string;
  startSec: number;
  endSec: number;
  speed: number;
  disabled: boolean;
  adjustment: boolean;
  name: string;
  projId: string;
  projName: string;
  projType: number | null;
  /** Kaynağın (medyanın) toplam süresi, tick — okunamazsa null. */
  mediaDur: string | null;
  selected: boolean;
  /** Probe'da sınanmamış, isteğe bağlı okumaların hataları (ayar katmanı, proje öğesi türü, medya süresi) — engel değil. */
  optErrors: string[];
  ref: TrackItem; // YALNIZCA useRef() ile
  projRef: ProjectItem | null; // YALNIZCA useProj() ile
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

export function invalidateRefs(): void {
  refGen++;
}

export function currentGen(): number {
  return refGen;
}

export class StaleRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleRefError";
  }
}

export function assertFresh(gen: number, what: string): void {
  if (gen !== refGen) {
    throw new StaleRefError(`BAYAT REFERANS: ${what} ${gen}. kuşaktan, şu an ${refGen}. kuşak (yeniden okunmalıydı)`);
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

export function tt(t: TickTime | null | undefined): { ticks: string; sec: number } {
  if (!t) return { ticks: "?", sec: NaN };
  return { ticks: t.ticks, sec: t.seconds }; // d.ts:L3992 TickTime.ticks, d.ts:L3986 TickTime.seconds
}

export function ticks(t: string | bigint): TickTime {
  return ppro.TickTime.createWithTicks(String(t)); // d.ts:L3887 TickTimeStatic.createWithTicks
}

export { TICKS_PER_SECOND, big, secOf, trackLabel } from "./core";

async function readClip(item: TrackItem, kind: Kind, loopTrack: number, gen: number, media: boolean): Promise<ClipInfo> {
  const errs: string[] = [];
  const opt: string[] = []; // isteğe bağlı okumalar: hata verirse "bilinmiyor" sayılır
  // VideoClipTrackItem ve AudioClipTrackItem aynı okuma metotlarına sahip:
  const start = tt(await safe("getStartTime", () => item.getStartTime(), null, errs)); // d.ts:L4236 VideoClipTrackItem.getStartTime / d.ts:L517 AudioClipTrackItem.getStartTime
  const end = tt(await safe("getEndTime", () => item.getEndTime(), null, errs)); // d.ts:L4191 VideoClipTrackItem.getEndTime / d.ts:L472 AudioClipTrackItem.getEndTime
  const inPt = tt(await safe("getInPoint", () => item.getInPoint(), null, errs)); // d.ts:L4196 VideoClipTrackItem.getInPoint / d.ts:L477 AudioClipTrackItem.getInPoint
  const outPt = tt(await safe("getOutPoint", () => item.getOutPoint(), null, errs)); // d.ts:L4221 VideoClipTrackItem.getOutPoint / d.ts:L502 AudioClipTrackItem.getOutPoint
  const speed = await safe("getSpeed", () => item.getSpeed(), NaN, errs); // d.ts:L4231 VideoClipTrackItem.getSpeed / d.ts:L512 AudioClipTrackItem.getSpeed
  const disabled = await safe("isDisabled", () => item.isDisabled(), false, errs); // d.ts:L4256 VideoClipTrackItem.isDisabled / d.ts:L537 AudioClipTrackItem.isDisabled
  const adjustment = (await safe("isAdjustmentLayer", () => item.isAdjustmentLayer(), false, opt)) === true; // d.ts:L4251 VideoClipTrackItem.isAdjustmentLayer / d.ts:L532 AudioClipTrackItem.isAdjustmentLayer
  const name = await safe("getName", () => item.getName(), "?", errs); // d.ts:L4216 VideoClipTrackItem.getName / d.ts:L497 AudioClipTrackItem.getName
  const track = await safe("getTrackIndex", () => item.getTrackIndex(), loopTrack, errs); // d.ts:L4241 VideoClipTrackItem.getTrackIndex / d.ts:L522 AudioClipTrackItem.getTrackIndex
  const selected = await safe("getIsSelected", () => item.getIsSelected(), false, errs); // d.ts:L4201 VideoClipTrackItem.getIsSelected / d.ts:L482 AudioClipTrackItem.getIsSelected
  const proj = await safe("getProjectItem", () => item.getProjectItem(), null, errs); // d.ts:L4226 VideoClipTrackItem.getProjectItem / d.ts:L507 AudioClipTrackItem.getProjectItem
  const projId = proj ? await safe("ProjectItem.getId", () => proj.getId(), "?", errs) : "?"; // d.ts:L2843 ProjectItem.getId
  const projName = proj ? proj.name : "?"; // d.ts:L2854 ProjectItem.name
  const rawType = proj ? await safe("ProjectItem.type", () => proj.type, null, opt) : null; // d.ts:L2860 ProjectItem.type
  const projType = typeof rawType === "number" ? rawType : null;
  let mediaDur: string | null = null;
  if (media && proj) {
    const clipItem = await safe("ClipProjectItem.cast", () => ppro.ClipProjectItem.cast(proj), null, opt); // d.ts:L788 ClipProjectItemStatic.cast
    const m = clipItem ? await safe("getMedia", () => clipItem.getMedia(), null, opt) : null; // d.ts:L1029 ClipProjectItem.getMedia
    const d = m ? await safe("Media.getDuration", () => m.getDuration(), null, opt) : null; // d.ts:L2087 Media.getDuration
    const dt = d ? tt(d).ticks : "?";
    mediaDur = /^\d+$/.test(dt) ? dt : null;
  }
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
    adjustment,
    name,
    projId,
    projName,
    projType,
    mediaDur,
    selected,
    optErrors: opt,
    ref: item,
    projRef: proj,
    gen,
    readErrors: errs,
  };
}

/** Sequence'taki tüm video/ses kliplerini BAŞTAN okur (salt okuma). Referanslar bu kuşağa aittir. */
export async function snapshot(ctx: SeqContext, opts: { media?: boolean } = {}): Promise<Snapshot> {
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
    for (const it of items ?? []) clips.push(await readClip(it, "V", i, gen, !!opts.media));
  }
  for (let i = 0; i < aCount; i++) {
    const track = await seq.getAudioTrack(i); // d.ts:L3159 Sequence.getAudioTrack
    if (!track) {
      warnings.push(`getAudioTrack(${i}) boş döndü`);
      continue;
    }
    const items = track.getTrackItems(CLIP, false); // d.ts:L672 AudioTrack.getTrackItems
    for (const it of items ?? []) clips.push(await readClip(it, "A", i, gen, !!opts.media));
  }
  for (const c of clips) {
    if (c.track !== c.loopTrack) warnings.push(`${c.kind}${c.loopTrack + 1} döngüsündeki "${c.name}" için getTrackIndex()=${c.track}`);
    for (const e of c.readErrors) warnings.push(`"${c.name}" okuma hatası — ${e}`);
  }
  if (gen !== refGen) warnings.push("okuma sırasında kuşak değişti (eşzamanlı transaction?)");
  return { vCount, aCount, clips, warnings, gen };
}

// ---------- anahtarlar ----------

export const keyFull = (c: ClipInfo) => [c.kind, c.track, c.start, c.end, c.inPt, c.outPt, c.projId, c.name].join("|");

/** Yeniden bulma anahtarı: (track tipi, track index, start tick, end tick, kaynak adı). */
export const locKey = (c: ClipInfo) => [c.kind, c.track, c.start, c.end, c.projName].join("|");

export function relocate(s: Snapshot, c: ClipInfo): ClipInfo | null {
  const k = locKey(c);
  return s.clips.find((x) => locKey(x) === k) ?? null;
}

export function fmtClip(c: ClipInfo): string {
  return `${trackLabel(c.kind, c.track)} "${c.name}" [${secOf(c.start)}s–${secOf(c.end)}s] in=${c.inPt} out=${c.outPt}`;
}
