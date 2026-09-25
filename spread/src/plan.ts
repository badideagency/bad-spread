// SPREAD planı — SAF fonksiyonlar (Premiere çağrısı yok; yalnız snapshot DEĞERLERİ). smoke testinden doğrudan sınanır.
//
// Birimler:
//   KAMERA birimi   = bir video klibi + aynı kaynaklı, aynı start/end/in/out'lu ses klip(ler)i (birden çok kanal olabilir)
//   SADECE-VİDEO    = eşleşen sesi olmayan video klibi
//   SES birimi      = kamera birimine ait olmayan her ses klibi (harici WAV'lar)
// Hedef düzen: video birimleri start sırasıyla V1, V2, …; kamera sesleri (kanal kanal) A1, A2, …; ses birimleri onların altında.
// Sonuç: her track'te en fazla 1 klip. HİÇBİR klibin start/end/in/out'u değişmez, yalnız track'i değişir.
//
// Taşıma (TX-B, tek transaction, bu sırayla):
//   1) clone: sadece-video ve ses birimleri → hedef track (kaynak orada olmalı → silmeden ÖNCE)
//   2) remove: taşınan tüm asıllar (+ TX-A yardımcıları) tek seçimle, ripple=false
//   3) overwrite: kamera birimleri proje öğesinden → hedef V/A (BAĞLI doğar); asıllar silindiği için hedefler boş
// "Kalan" birim: tüm klipleri zaten hedef track'indeyse hiç dokunulmaz.

import { big, trackLabel, type ClipInfo, type Snapshot } from "./model";

export type UnitKind = "camera" | "video" | "audio";

export interface Unit {
  id: number;
  kind: UnitKind;
  video: ClipInfo | null;
  /** kamera: kanallar (asıl track sırasıyla); ses birimi: tek klip */
  audio: ClipInfo[];
  start: string;
  startSec: number;
  label: string;
  /** Hedef: video birimleri için V index; kamera kanalları / ses birimi için ilk A index. */
  vTarget: number | null;
  aTarget: number | null;
  stays: boolean;
  /** kamera: in≠0 ya da out≠medya süresi (true), kırpılmamış (false), bilinmiyor (null) */
  trimmed: boolean | null;
}

export interface Placement {
  clip: ClipInfo;
  unit: Unit;
  target: number; // klibin kendi türündeki hedef track index'i
}

export interface Plan {
  units: Unit[];
  placements: Placement[];
  neededV: number;
  neededA: number;
  stay: Unit[];
  overwrite: Unit[]; // kamera birimleri (taşınan)
  clone: Placement[]; // sadece-video + ses birimleri (taşınan), GÜVENLİ SIRADA
  removeClips: ClipInfo[]; // TX-B'de silinecek asıllar
  counts: { camera: number; videoOnly: number; audio: number; cameraChannels: number };
  errors: string[];
  warnings: string[];
}

const cmpStart = (a: ClipInfo, b: ClipInfo) => {
  const d = big(a.start) - big(b.start);
  return d < 0n ? -1 : d > 0n ? 1 : a.track - b.track || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
};

const overlaps = (a: ClipInfo, b: ClipInfo) => big(a.start) < big(b.end) && big(b.start) < big(a.end);

const sameTimes = (a: ClipInfo, b: ClipInfo) => a.start === b.start && a.end === b.end && a.inPt === b.inPt && a.outPt === b.outPt;

/**
 * @param clipType ppro.ProjectItem.TYPE_CLIP (kamera birimlerinin proje öğesi overwrite edilebilir bir klip olmalı)
 */
export function makePlan(s: Snapshot, clipType: number | null): Plan {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const w of s.warnings) warnings.push(`okuma uyarısı: ${w}`);

  const videos = s.clips.filter((c) => c.kind === "V").sort(cmpStart);
  const audios = s.clips.filter((c) => c.kind === "A").sort(cmpStart);
  const used = new Set<ClipInfo>();
  const units: Unit[] = [];
  let id = 0;
  const mk = (kind: UnitKind, video: ClipInfo | null, audio: ClipInfo[]): Unit => {
    const first = video ?? audio[0];
    return {
      id: id++,
      kind,
      video,
      audio,
      start: first.start,
      startSec: first.startSec,
      label: first.name,
      vTarget: null,
      aTarget: null,
      stays: false,
      trimmed: null,
    };
  };

  for (const v of videos) {
    const ch = audios.filter((a) => !used.has(a) && a.projId === v.projId && sameTimes(a, v)).sort((a, b) => a.track - b.track);
    for (const a of ch) used.add(a);
    units.push(mk(ch.length ? "camera" : "video", v, ch));
  }
  const videoSources = new Set(videos.map((v) => v.projId));
  for (const a of audios) {
    if (used.has(a)) continue;
    // Aynı kaynaklı bir videoyla zamanda çakışan ama tick düzeyinde birebir olmayan ses: büyük ihtimalle o kameranın BAĞLI sesi.
    // Ayrı ses birimi olarak taşınırsa bağı kopar ve link API'si olmadığı için geri bağlanamaz → SERT hata, Spread başlamaz.
    const near = videos.find((v) => v.projId === a.projId && overlaps(v, a));
    if (near)
      errors.push(
        `kamera sesi videosuyla tick düzeyinde birebir değil (bağı korunamaz): ${fmt(a)} ↔ ${fmt(near)} — ` +
          ["start", "end", "inPt", "outPt"]
            .filter((k) => a[k as keyof ClipInfo] !== near[k as keyof ClipInfo])
            .map((k) => `${k} fark ${big(String(a[k as keyof ClipInfo])) - big(String(near[k as keyof ClipInfo]))} tick`)
            .join(", ")
      );
    else if (videoSources.has(a.projId))
      warnings.push(`kamera kaynaklı ama hiçbir kamera klibiyle çakışmayan ses: ${fmt(a)} → ayrı ses birimi olarak taşınacak`);
    units.push(mk("audio", null, [a]));
  }

  const videoUnits = units.filter((u) => u.video).sort((a, b) => cmpStart(a.video!, b.video!));
  const audioUnits = units.filter((u) => u.kind === "audio").sort((a, b) => cmpStart(a.audio[0], b.audio[0]));
  let a = 0;
  videoUnits.forEach((u, i) => {
    u.vTarget = i;
    if (u.audio.length) {
      u.aTarget = a;
      a += u.audio.length;
    }
  });
  const cameraChannels = a;
  for (const u of audioUnits) u.aTarget = a++;
  const neededV = videoUnits.length;
  const neededA = a;

  const placements: Placement[] = [];
  for (const u of units) {
    if (u.video) placements.push({ clip: u.video, unit: u, target: u.vTarget! });
    u.audio.forEach((c, k) => placements.push({ clip: c, unit: u, target: u.aTarget! + k }));
    u.stays = placements.filter((p) => p.unit === u).every((p) => p.clip.track === p.target);
  }

  // --- ön kontroller (kamera birimleri proje öğesinden yeniden yerleştirilecek → aslıyla birebir olabilmeli)
  for (const u of units) {
    for (const c of [u.video, ...u.audio].filter((x): x is ClipInfo => !!x))
      for (const e of c.readErrors) errors.push(`okunamadı: ${fmt(c)} — ${e}`);
    if (u.kind !== "camera") continue;
    const v = u.video!;
    if (v.adjustment) errors.push(`ayar katmanı (adjustment layer) kamera birimi olamaz: ${fmt(v)}`);
    if (!v.projRef) errors.push(`proje öğesi okunamadı: ${fmt(v)}`);
    if (clipType !== null && v.projType !== null && v.projType !== clipType)
      errors.push(`proje öğesi bir medya klibi değil (tür ${v.projType}), overwrite edilemez: ${fmt(v)}`);
    for (const c of [v, ...u.audio]) {
      if (c.speed !== 1) errors.push(`hızı ${c.speed} olan kamera klibi (overwrite hızı korumaz): ${fmt(c)}`);
      if (c.disabled) errors.push(`devre dışı kamera klibi (overwrite etkin olarak yerleştirir): ${fmt(c)}`);
      if (c.name !== c.projName && c.projName !== "?")
        warnings.push(`yeniden adlandırılmış kamera klibi "${c.name}" (kaynak "${c.projName}") — overwrite kaynak adını kullanır, klip adı taşınmaz`);
    }
    u.trimmed = v.mediaDur === null ? null : !(v.inPt === "0" && v.outPt === v.mediaDur);
  }

  const stay = units.filter((u) => u.stays);
  const overwrite = videoUnits.filter((u) => u.kind === "camera" && !u.stays);
  const cloneMoves = placements.filter((p) => p.unit.kind !== "camera" && !p.unit.stays);
  const removeClips = placements.filter((p) => !p.unit.stays).map((p) => p.clip);

  // --- clone güvenliği: bir kopya, hedef track'inde zamanda çakıştığı HERHANGİ bir asılın üstüne yazılmaz.
  // (Kopyası alınmış olsa bile aynı transaction'da silme seçimindeki bir asılın üstüne yazmak kanıtlanmadı → plan hatası.)
  // Kullanıcının düzeninde ses hedefleri (A23..) hep yeni track'ler olduğundan bu durum oluşmaz.
  for (const m of cloneMoves) {
    const occupants = s.clips.filter((o) => o !== m.clip && o.kind === m.clip.kind && o.track === m.target && overlaps(o, m.clip));
    for (const o of occupants)
      errors.push(`güvenli sıra yok: ${fmt(m.clip)} → ${trackLabel(m.clip.kind, m.target)} hedefinde zamanda çakışan asıl ${fmt(o)} var`);
  }
  const ordered = cloneMoves;

  return {
    units,
    placements,
    neededV,
    neededA,
    stay,
    overwrite,
    clone: ordered,
    removeClips,
    counts: {
      camera: units.filter((u) => u.kind === "camera").length,
      videoOnly: units.filter((u) => u.kind === "video").length,
      audio: audioUnits.length,
      cameraChannels,
    },
    errors,
    warnings,
  };
}

function fmt(c: ClipInfo): string {
  return `${trackLabel(c.kind, c.track)} "${c.name}"`;
}
