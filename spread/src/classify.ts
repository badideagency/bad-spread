// Sınıflama (TOPLA / BAĞLA) — SAF fonksiyonlar (Premiere çağrısı yok; yalnız snapshot DEĞERLERİ).
//
// Rol timeline'dan ve dosya türünden gelir; cihaz / kayıt / kanal kimliği dosya adından (identity.ts):
//   KAMERA    : video klibi, uzantısı bir video dosyası (.MP4/.MOV/.MXF…), ayar katmanı değil.
//   KILAVUZ   : ses klibi, kaynağı (proje öğesi) timeline'daki bir kamera videosuyla AYNI → kameranın kendi sesi.
//   HARİCİ    : ses klibi, uzantısı bir ses dosyası (.WAV/.BWF/.MP3…), kılavuz değil. Kaynak anahtarı: "Zoom Tr1", "DJI", …
//   BİLİNMEYEN: geri kalan her şey (grafik, metin, renk, ayar katmanı, videosu timeline'da olmayan kamera sesi…) → DOKUNULMAZ.

import { identify, sourceCompare, sourceKey, type Identity } from "./identity";
import { big, trackLabel } from "./core";
import type { ClipInfo, Snapshot } from "./model";

export type Role = "camera" | "guide" | "external" | "unknown";

export interface Classified {
  clip: ClipInfo;
  role: Role;
  /** kamera / kılavuz: kamera dosyasının kimliği; harici: ses dosyasının kimliği; bilinmeyen: null */
  ident: Identity | null;
  /** kamera / kılavuz: cihaz (V track'i belirler) */
  device: string | null;
  /** harici: kaynak anahtarı (A track'i belirler) */
  source: string | null;
  /** bilinmeyen: neden */
  why: string;
}

const VIDEO_EXT = new Set(["mp4", "mov", "mxf", "mts", "m2ts", "avi", "mkv", "m4v", "3gp", "mpg", "mpeg", "wmv", "r3d", "braw", "crm", "insv", "lrv", "hevc", "h264"]);
const AUDIO_EXT = new Set(["wav", "bwf", "mp3", "aif", "aiff", "m4a", "flac", "aac", "ogg", "wma", "caf"]);

export function fileName(c: ClipInfo): string {
  return c.projName && c.projName !== "?" ? c.projName : c.name;
}

export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

export function classify(s: Snapshot): Classified[] {
  const out: Classified[] = [];
  const camIdent = new Map<string, Identity>(); // projId → kamera kimliği
  const mk = (clip: ClipInfo, role: Role, ident: Identity | null, why = ""): Classified => ({
    clip,
    role,
    ident,
    device: role === "camera" || role === "guide" ? ident!.device : null,
    source: role === "external" ? sourceKey(ident!) : null,
    why,
  });
  for (const c of s.clips) {
    if (c.kind !== "V") continue;
    const fn = fileName(c);
    if (c.adjustment) out.push(mk(c, "unknown", null, "ayar katmanı"));
    else if (c.projId === "?") out.push(mk(c, "unknown", null, "proje öğesi okunamadı"));
    else if (!VIDEO_EXT.has(extOf(fn))) out.push(mk(c, "unknown", null, "video dosyası değil (grafik / metin / renk?)"));
    else {
      const id = identify(fn);
      out.push(mk(c, "camera", id));
      if (!camIdent.has(c.projId)) camIdent.set(c.projId, id);
    }
  }
  for (const c of s.clips) {
    if (c.kind !== "A") continue;
    const fn = fileName(c);
    if (c.projId !== "?" && camIdent.has(c.projId)) out.push(mk(c, "guide", camIdent.get(c.projId)!));
    else if (c.projId === "?") out.push(mk(c, "unknown", null, "proje öğesi okunamadı"));
    else if (AUDIO_EXT.has(extOf(fn))) out.push(mk(c, "external", identify(fn)));
    else if (VIDEO_EXT.has(extOf(fn))) out.push(mk(c, "unknown", null, "kamera sesi ama videosu timeline'da yok"));
    else out.push(mk(c, "unknown", null, "ses dosyası değil"));
  }
  return out;
}

export interface DeviceInfo {
  key: string;
  total: bigint;
  clips: ClipInfo[];
  sample: string;
}

/** Kamera cihazları: toplam süre uzun olan önce; EŞİTSE cihaz adı alfabetik. İndeks = hedef V track. */
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

/** Sequence'ta bulunan harici kaynaklar (sıralı): "Zoom Tr1", "Zoom Tr2", "Zoom TrLR", "DJI", … */
export function sourcesOf(items: Classified[]): string[] {
  return [...new Set(items.filter((x) => x.role === "external").map((x) => x.source!))].sort(sourceCompare);
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
      return `harici ${x.source}`;
    default:
      return `DOKUNULMAZ (${x.why})`;
  }
}

export const where = (c: ClipInfo): string => `${trackLabel(c.kind, c.track)} "${c.name}"`;
