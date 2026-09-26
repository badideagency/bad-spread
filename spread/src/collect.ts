// TOPLA planı — SAF fonksiyonlar (Premiere çağrısı yok). Senkrondan SONRA çalışır; YALNIZ DİKEY taşır.
//
// Hedef düzen:
//   V1, V2, …     : kamera cihazları (dosya adı öneki), TOPLAM süresi uzun olan cihaz V1'e
//   A1, A2, …     : harici kanallar (_Tr1 → A1, _Tr2 → A2, …; kapatılmış kanallar tutulanların altında)
//   onların altı  : kamera kılavuz sesleri, cihaz sırasıyla (cihaz başına kanal sayısı kadar track) — kontrol için; BAĞLA siler
//   bilinmeyenler : (grafik, ayar katmanı, …) OLDUĞU YERDE kalır, hiç dokunulmaz
// Hiçbir klibin start/end/in/out'u değişmez. Aynı hedef track'te zamanda çakışan iki klip (ya da hedefte bir bilinmeyen öğe)
// → plan HATASI: TOPLA başlamaz, çakışma raporlanır (sessizce başka track'e konmaz).
//
// Taşıma (kanıtlı yöntemler: clone + remove(ripple=false), SPREAD'de gerçek Premiere'de çalıştı):
//   TX-1 "park"      : taşınacak her klip AYNI track'te zaman ofseti P ile sequence sonunun ötesine kopyalanır + asıllar silinir
//   TX-2 "yerleştir" : park kopyaları −P zaman ofseti + dikey ofsetle hedef track'e kopyalanır + park kopyaları silinir
// Neden iki adım: hedef yerlerin çoğunda (ör. A1) henüz taşınmamış bir asıl var (Spread sonrası kılavuz sesler A1..A22'de);
// bir kopyanın aynı transaction'da, silinecek bir asılın üstüne yazılması KANITLANMADI (Spread planı da bunu yasaklıyor).
// Park bölgesi hiçbir klipten çakışmaz (P > en büyük klip sonu); park kopyaları kendi aralarında çakışmaz (aynı track'teki
// asıllar zaten çakışmaz).
// Bağlı çift kuralı: bir kamera videosu ile aynı yerdeki kılavuz ses(ler)inden BİRİ taşınıyorsa HEPSİ taşınır — silme seçiminde
// bağlı bir çiftin yalnız bir yarısı bulunmasın (bağlı partnerin de silinip silinmediği kanıtlanmadı).

import {
  channelsOf,
  classify,
  devicesOf,
  roleLabel,
  where,
  type Classified,
  type DeviceInfo,
} from "./classify";
import { expOf, overlapsIn, type Exp, type OvItem } from "./layout";
import { big, type ClipInfo, type Snapshot } from "./model";

export interface CollectTarget {
  x: Classified;
  /** klibin kendi türündeki hedef track index'i */
  target: number;
  moves: boolean;
}

export interface CollectDevice extends DeviceInfo {
  vTrack: number;
  guideBase: number;
  guideCh: number;
}

export interface CollectChannel {
  key: string;
  kept: boolean;
  aTrack: number;
  count: number;
}

export interface CollectPlan {
  items: Classified[];
  devices: CollectDevice[];
  channels: CollectChannel[];
  targets: CollectTarget[];
  moves: CollectTarget[];
  unknown: Classified[];
  guideCount: number;
  neededV: number;
  neededA: number;
  conflicts: string[];
  errors: string[];
  warnings: string[];
}

interface Ov extends OvItem {
  x: Classified;
}

export function makeCollectPlan(s: Snapshot, kept: (channel: string) => boolean): CollectPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const w of s.warnings) errors.push(`okuma uyarısı: ${w}`);
  for (const c of s.clips) for (const e of c.readErrors) errors.push(`okunamadı: ${where(c)} — ${e}`);

  const items = classify(s);
  const cams = items.filter((x) => x.role === "camera");
  const guides = items.filter((x) => x.role === "guide");
  const unknown = items.filter((x) => x.role === "unknown");
  if (!cams.length) errors.push("kamera klibi bulunamadı (video dosyası olan klip yok) — TOPLA'nın dizeceği bir şey yok");

  // harici kanallar: tutulanlar önce, kapatılanlar altta
  const chKeys = channelsOf(items);
  const ordered = [...chKeys.filter((k) => kept(k)), ...chKeys.filter((k) => !kept(k))];
  const channels: CollectChannel[] = ordered.map((key, i) => ({
    key,
    kept: kept(key),
    aTrack: i,
    count: items.filter((x) => x.role === "external" && x.channel === key).length,
  }));

  // kamera ↔ kılavuz çiftleri (aynı kaynak, aynı start/end) — kanal sırası = asıl track sırası
  const chIndex = new Map<Classified, number>();
  const bundles: Classified[][] = [];
  const used = new Set<Classified>();
  for (const v of cams) {
    const g = guides
      .filter((a) => !used.has(a) && a.clip.projId === v.clip.projId && a.clip.start === v.clip.start && a.clip.end === v.clip.end)
      .sort((a, b) => a.clip.track - b.clip.track);
    g.forEach((a, j) => {
      used.add(a);
      chIndex.set(a, j);
    });
    bundles.push([v, ...g]);
  }
  const orphanGroups = new Map<string, Classified[]>();
  for (const a of guides) {
    if (used.has(a)) continue;
    const k = [a.clip.projId, a.clip.start, a.clip.end].join("|");
    orphanGroups.set(k, [...(orphanGroups.get(k) ?? []), a]);
    warnings.push(`kılavuz ses videosuyla aynı yerde değil: ${where(a.clip)} — kılavuz track'lerine konacak`);
  }
  for (const list of orphanGroups.values()) list.sort((a, b) => a.clip.track - b.clip.track).forEach((a, j) => chIndex.set(a, j));
  const guideCh = new Map<string, number>();
  for (const a of guides) guideCh.set(a.device!, Math.max(guideCh.get(a.device!) ?? 0, chIndex.get(a)! + 1));

  let base = channels.length;
  const devices: CollectDevice[] = devicesOf(items).map((d, i) => {
    const ch = guideCh.get(d.key) ?? 0;
    const r = { ...d, vTrack: i, guideBase: base, guideCh: ch };
    base += ch;
    return r;
  });
  const dev = new Map(devices.map((d) => [d.key, d]));
  const chTrack = new Map(channels.map((c) => [c.key, c.aTrack]));

  const targets: CollectTarget[] = [];
  for (const x of items) {
    let t: number | null = null;
    if (x.role === "camera") t = dev.get(x.device!)!.vTrack;
    else if (x.role === "guide") t = dev.get(x.device!)!.guideBase + chIndex.get(x)!;
    else if (x.role === "external") t = chTrack.get(x.channel!)!;
    if (t !== null) targets.push({ x, target: t, moves: x.clip.track !== t });
  }
  const byX = new Map(targets.map((t) => [t.x, t]));
  for (const b of bundles) {
    const members = b.map((m) => byX.get(m)!);
    if (members.some((m) => m.moves)) for (const m of members) m.moves = true;
  }
  const moves = targets.filter((t) => t.moves);

  // son düzende çakışma → HATA (TOPLA başlamaz)
  const fin: Ov[] = [
    ...targets.map((t) => ({ kind: t.x.clip.kind, track: t.target, start: big(t.x.clip.start), end: big(t.x.clip.end), label: t.x.clip.name, x: t.x })),
    ...unknown.map((u) => ({ kind: u.clip.kind, track: u.clip.track, start: big(u.clip.start), end: big(u.clip.end), label: u.clip.name, x: u })),
  ];
  const conflicts = overlapsIn(fin, (a, b) => {
    if (a.x.role === "unknown" || b.x.role === "unknown")
      return ` — sınıflanamayan öğe (${(a.x.role === "unknown" ? a : b).x.why}) hedef yerde; ona dokunulmaz`;
    if (a.x.role === "camera") return ` — aynı cihazın (${a.x.device}) iki klibi üst üste: senkron ilgisiz iki çekimi bindirmiş olabilir`;
    if (a.x.role === "external") return ` — aynı kanalın (${a.x.channel}) iki kaydı üst üste`;
    if (a.x.role === "guide" && b.x.role === "guide" && a.x.device === b.x.device)
      return ` — aynı cihazın (${a.x.device}) iki kılavuz sesi üst üste (videoları da çakışıyor olmalı)`;
    return ` — ${roleLabel(a.x)} / ${roleLabel(b.x)}`;
  });

  for (const u of unknown) warnings.push(`dokunulmayacak: ${where(u.clip)} (${u.why})`);
  if (channels.some((c) => c.key === "(eksiz)"))
    warnings.push(`adında _Tr eki olmayan harici ses(ler) "(eksiz)" kanalında toplanacak`);

  const guideCount = [...guideCh.values()].reduce((a, b) => a + b, 0);
  return {
    items,
    devices,
    channels,
    targets,
    moves,
    unknown,
    guideCount,
    neededV: devices.length,
    neededA: channels.length + guideCount,
    conflicts,
    errors,
    warnings,
  };
}

/** TX-1 (park) sonrası beklenen: taşınanlar AYNI track'te +P; diğerleri (TX-A yardımcıları hariç, onlar silinir) birebir. */
export function expectAfterPark(s0: Snapshot, plan: CollectPlan, P: bigint): Exp[] {
  const moving = new Set(plan.moves.map((m) => m.x.clip));
  return s0.clips.map((c) => (moving.has(c) ? expOf(c, { start: big(c.start) + P, end: big(c.end) + P }) : expOf(c)));
}

/** TX-2 (yerleştir) sonrası beklenen: taşınanlar hedef track'te, zamanlar ASLIYLA AYNI; diğerleri birebir. */
export function expectFinal(s0: Snapshot, plan: CollectPlan): Exp[] {
  const tgt = new Map(plan.moves.map((m) => [m.x.clip, m.target]));
  return s0.clips.map((c) => (tgt.has(c) ? expOf(c, { track: tgt.get(c)! }) : expOf(c)));
}

/** Park kopyasının değer anahtarı (TX-1 sonrası yeniden bulmak için). */
export function parkedOf(c: ClipInfo, P: bigint): Exp {
  return expOf(c, { start: big(c.start) + P, end: big(c.end) + P });
}
