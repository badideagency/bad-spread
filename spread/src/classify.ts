// Sınıflama (TOPLA / BAĞLA) — SAF fonksiyonlar (Premiere çağrısı yok; yalnız snapshot DEĞERLERİ).
//
// Dosya adı = klibin proje öğesinin adı (ProjectItem.name; okunamazsa klip adı).
//   KAMERA   : video klibi, uzantısı bir video dosyası (.MP4/.MOV/.MXF…), ayar katmanı değil.
//              CİHAZ = dosya adının ilk rakamdan önceki kısmı: "A038C001_….MP4" → "A", "C0112.MP4" → "C".
//   KILAVUZ  : ses klibi, kaynağı (proje öğesi) timeline'daki bir kamera videosuyla AYNI → kameranın kendi sesi.
//   HARİCİ   : ses klibi, uzantısı bir ses dosyası (.WAV/.BWF/.MP3…), kılavuz değil.
//              KANAL = dosya adının son eki "_Tr1", "_Tr2", "_TrLR"… → "Tr1", "Tr2", "TrLR"; eki yoksa "(eksiz)".
//   BİLİNMEYEN: geri kalan her şey (grafik, metin, renk, ayar katmanı, videosu timeline'da olmayan kamera sesi…) → DOKUNULMAZ.

import { big, trackLabel, type ClipInfo, type Snapshot } from "./model";

export type Role = "camera" | "guide" | "external" | "unknown";

export interface Classified {
  clip: ClipInfo;
  role: Role;
  /** kamera / kılavuz: cihaz anahtarı */
  device: string | null;
  /** harici: kanal anahtarı */
  channel: string | null;
  /** bilinmeyen: neden */
  why: string;
}

export const NO_CHANNEL = "(eksiz)";

const VIDEO_EXT = new Set(["mp4", "mov", "mxf", "mts", "m2ts", "avi", "mkv", "m4v", "3gp", "mpg", "mpeg", "wmv", "r3d", "braw", "crm", "insv", "lrv", "hevc", "h264"]);
const AUDIO_EXT = new Set(["wav", "bwf", "mp3", "aif", "aiff", "m4a", "flac", "aac", "ogg", "wma", "caf"]);

export function fileName(c: ClipInfo): string {
  return c.projName && c.projName !== "?" ? c.projName : c.name;
}

export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

export function baseOf(name: string): string {
  return name.trim().replace(/\.[A-Za-z0-9]{1,5}$/, "");
}

/** "A038C001_260912.MP4" → "A"; "C0112.MP4" → "C"; "DJI_0001.MP4" → "DJI"; "20230101_1.mp4" → "#" */
export function deviceOf(name: string): string {
  const head = (/^[^0-9]*/.exec(baseOf(name)) ?? [""])[0].replace(/[\s._-]+$/, "").toUpperCase();
  return head || "#";
}

/** "260912_101512_Tr1.WAV" → "Tr1"; "…_TrLR.WAV" → "TrLR"; eki yoksa NO_CHANNEL */
export function channelOf(name: string): string {
  const m = /_tr([A-Za-z0-9]+)$/i.exec(baseOf(name));
  return m ? `Tr${m[1].toUpperCase()}` : NO_CHANNEL;
}

/** Kanal sırası: Tr1, Tr2, … (sayısal) → TrLR, TrMS … (alfabetik) → (eksiz) */
export function channelCompare(a: string, b: string): number {
  const rank = (c: string) => (c === NO_CHANNEL ? 2 : /^Tr\d+$/.test(c) ? 0 : 1);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return Number(a.slice(2)) - Number(b.slice(2));
  return a < b ? -1 : a > b ? 1 : 0;
}

export function classify(s: Snapshot): Classified[] {
  const out: Classified[] = [];
  const camSources = new Set<string>();
  const mk = (clip: ClipInfo, role: Role, device: string | null, channel: string | null, why: string): Classified => ({ clip, role, device, channel, why });
  for (const c of s.clips) {
    if (c.kind !== "V") continue;
    const fn = fileName(c);
    if (c.adjustment) out.push(mk(c, "unknown", null, null, "ayar katmanı"));
    else if (c.projId === "?") out.push(mk(c, "unknown", null, null, "proje öğesi okunamadı"));
    else if (!VIDEO_EXT.has(extOf(fn))) out.push(mk(c, "unknown", null, null, "video dosyası değil (grafik / metin / renk?)"));
    else {
      out.push(mk(c, "camera", deviceOf(fn), null, ""));
      camSources.add(c.projId);
    }
  }
  const deviceOfSource = new Map<string, string>();
  for (const x of out) if (x.role === "camera" && !deviceOfSource.has(x.clip.projId)) deviceOfSource.set(x.clip.projId, x.device!);
  for (const c of s.clips) {
    if (c.kind !== "A") continue;
    const fn = fileName(c);
    if (c.projId !== "?" && camSources.has(c.projId)) out.push(mk(c, "guide", deviceOfSource.get(c.projId)!, null, ""));
    else if (c.projId === "?") out.push(mk(c, "unknown", null, null, "proje öğesi okunamadı"));
    else if (AUDIO_EXT.has(extOf(fn))) out.push(mk(c, "external", null, channelOf(fn), ""));
    else if (VIDEO_EXT.has(extOf(fn))) out.push(mk(c, "unknown", null, null, "kamera sesi ama videosu timeline'da yok"));
    else out.push(mk(c, "unknown", null, null, "ses dosyası değil"));
  }
  return out;
}

export interface DeviceInfo {
  key: string;
  total: bigint;
  clips: ClipInfo[];
  sample: string;
}

/** Cihazlar, toplam süreye göre (uzun olan önce; eşitlikte ada göre). İndeks = hedef V track. */
export function devicesOf(items: Classified[]): DeviceInfo[] {
  const m = new Map<string, DeviceInfo>();
  for (const x of items) {
    if (x.role !== "camera") continue;
    const d = m.get(x.device!) ?? { key: x.device!, total: 0n, clips: [], sample: fileName(x.clip) };
    d.total += big(x.clip.end) - big(x.clip.start);
    d.clips.push(x.clip);
    m.set(x.device!, d);
  }
  return [...m.values()].sort((a, b) => (a.total > b.total ? -1 : a.total < b.total ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Sequence'ta bulunan harici kanallar (sıralı). */
export function channelsOf(items: Classified[]): string[] {
  return [...new Set(items.filter((x) => x.role === "external").map((x) => x.channel!))].sort(channelCompare);
}

export const overlapTicks = (a: { start: string; end: string }, b: { start: string; end: string }): bigint => {
  const s = big(a.start) > big(b.start) ? big(a.start) : big(b.start);
  const e = big(a.end) < big(b.end) ? big(a.end) : big(b.end);
  return e > s ? e - s : 0n;
};

export const cmpStart = (a: ClipInfo, b: ClipInfo): number => {
  const d = big(a.start) - big(b.start);
  return d < 0n ? -1 : d > 0n ? 1 : a.kind !== b.kind ? (a.kind === "V" ? -1 : 1) : a.track - b.track;
};

export function roleLabel(x: Classified): string {
  switch (x.role) {
    case "camera":
      return `kamera ${x.device}`;
    case "guide":
      return `kılavuz ses (${x.device})`;
    case "external":
      return `harici ${x.channel}`;
    default:
      return `DOKUNULMAZ (${x.why})`;
  }
}

export const where = (c: ClipInfo): string => `${trackLabel(c.kind, c.track)} "${c.name}"`;
