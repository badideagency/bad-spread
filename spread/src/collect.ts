// TOPLA planı — SAF fonksiyonlar (Premiere çağrısı yok). Oturumlar sessions.ts'ten gelir.
//
// YATAY: oturum blokları kronolojik sırayla, sequence başından (0) itibaren, aralarında G boşluk (kareye hizalı). Bloğun TÜM
//        klipleri AYNI ofsetle (Δ, kare katı) kayar → oturum içi göreli konumlar tick-exact korunur. Sahipsizler ve dokunulmayan
//        öğeler zamanda kaymaz.
// DİKEY (track ÇERÇEVESİ, BAĞLA da aynısını kullanır):
//   V: kamera cihazları (toplam süre uzun → V1; eşitse cihaz adı alfabetik) → sonra V PARK track'leri
//   A: eşlenen kaynaklar (kullanıcının seçtiği A track'leri) → kamera kılavuz sesleri (cihaz sırasıyla, kanal kanal) →
//      "sil" seçilen kaynaklar (kontrol için; BAĞLA siler) → A PARK track'leri
//   PARK: sahipsiz kayıtlar ve (kullanıcı onaylarsa) ayrılamayan kayıtlar — zamanı değişmeden, çakışmayacak biçimde.
//   Bilinmeyen öğeler (grafik…) YERİNDE kalır; hedef yerle çakışırsa plan HATASI.
// Taşıma (topla.ts): park (+P) → yerleştir (Δ − P, dikey). İlk oturum hem park'ta hem yerleştirmede TEK BAŞINA (ölçüm).

import { devicesOf, fileName, sourcesOf, where, type Classified, type DeviceInfo } from "./classify";
import { ceilTo } from "./guard";
import { expOf, overlapsIn, type Exp, type OvItem } from "./layout";
import { big, secOf, trackLabel, type ClipInfo, type Kind, type Snapshot } from "./model";
import type { Analysis, Recording, Session } from "./sessions";
import type { CollectRecord, LinkItemRec, Target } from "./settings";

// ------------------------------------------------------------------ track çerçevesi

export interface Frame {
  devices: DeviceInfo[];
  devTrack: Map<string, number>;
  sources: string[];
  srcTrack: Map<string, number>;
  silSources: string[];
  silTrack: Map<string, number>;
  mappedCount: number;
  guideBase: Map<string, number>;
  guideCh: Map<string, number>;
  guideCount: number;
  vPark: number;
  aPark: number;
}

/** Kılavuz seslerin kanal sırası: aynı kamera klibinin (aynı kaynak, aynı start/end) sesleri asıl track sırasıyla 0,1,… */
export function guideChannels(items: Classified[]): Map<ClipInfo, number> {
  const groups = new Map<string, Classified[]>();
  for (const g of items.filter((x) => x.role === "guide")) {
    const k = [g.clip.projId, g.clip.start, g.clip.end].join("|");
    groups.set(k, [...(groups.get(k) ?? []), g]);
  }
  const out = new Map<ClipInfo, number>();
  for (const list of groups.values()) list.sort((a, b) => a.clip.track - b.clip.track).forEach((g, j) => out.set(g.clip, j));
  return out;
}

export function makeFrame(items: Classified[], mapping: Map<string, Target>): Frame {
  const devices = devicesOf(items);
  const devTrack = new Map(devices.map((d, i) => [d.key, i]));
  const sources = sourcesOf(items);
  const srcTrack = new Map<string, number>();
  const silSources: string[] = [];
  for (const s of sources) {
    const t = mapping.get(s);
    if (t === "sil") silSources.push(s);
    else srcTrack.set(s, t ?? 0);
  }
  const mappedCount = srcTrack.size ? Math.max(...srcTrack.values()) + 1 : 0;
  const ch = guideChannels(items);
  const guideCh = new Map<string, number>();
  for (const g of items.filter((x) => x.role === "guide")) guideCh.set(g.device!, Math.max(guideCh.get(g.device!) ?? 0, ch.get(g.clip)! + 1));
  const guideBase = new Map<string, number>();
  let base = mappedCount;
  for (const d of devices) {
    guideBase.set(d.key, base);
    base += guideCh.get(d.key) ?? 0;
  }
  const guideCount = base - mappedCount;
  const silTrack = new Map(silSources.map((s, i) => [s, base + i]));
  return { devices, devTrack, sources, srcTrack, silSources, silTrack, mappedCount, guideBase, guideCh, guideCount, vPark: devices.length, aPark: base + silSources.length };
}

/** Klibin çerçevedeki yeri (bilinmeyen → null). */
export function frameTrack(f: Frame, x: Classified, ch: Map<ClipInfo, number>): number | null {
  if (x.role === "camera") return f.devTrack.get(x.device!) ?? null;
  if (x.role === "guide") return (f.guideBase.get(x.device!) ?? 0) + (ch.get(x.clip) ?? 0);
  if (x.role === "external") return f.srcTrack.get(x.source!) ?? f.silTrack.get(x.source!) ?? null;
  return null;
}

/** Klibin (zamanıyla) kimlik anahtarı — TOPLA kaydındaki park listesi için (track'ten bağımsız). */
export const clipKey = (c: ClipInfo): string => [c.kind, c.projId, c.start, c.end, c.inPt, c.outPt].join("|");

export function frameToRecord(f: Frame): CollectRecord["frame"] {
  return {
    devTrack: [...f.devTrack],
    srcTrack: [...f.srcTrack],
    silTrack: [...f.silTrack],
    guideBase: [...f.guideBase],
    guideCh: [...f.guideCh],
    mappedCount: f.mappedCount,
    guideCount: f.guideCount,
    vPark: f.vPark,
    aPark: f.aPark,
  };
}

export function frameFromRecord(r: CollectRecord["frame"]): Frame {
  const devTrack = new Map(r.devTrack);
  return {
    devices: [...devTrack.entries()].sort((x, y) => x[1] - y[1]).map(([key]) => ({ key, total: 0n, clips: [], sample: "" })),
    devTrack,
    sources: [...r.srcTrack.map(([k]) => k), ...r.silTrack.map(([k]) => k)],
    srcTrack: new Map(r.srcTrack),
    silSources: r.silTrack.map(([k]) => k),
    silTrack: new Map(r.silTrack),
    mappedCount: r.mappedCount,
    guideBase: new Map(r.guideBase),
    guideCh: new Map(r.guideCh),
    guideCount: r.guideCount,
    vPark: r.vPark,
    aPark: r.aPark,
  };
}

/** TOPLA kaydındaki park anahtarlarına uyan klipler (track'i ne olursa olsun). */
export function parkedFromRecord(items: Classified[], rec: CollectRecord | null): Set<ClipInfo> {
  const keys = new Set(rec?.parked ?? []);
  return new Set(items.filter((x) => keys.has(clipKey(x.clip))).map((x) => x.clip));
}

/** Kayıtlı çerçeveye göre yerinde OLMAYAN sınıflı klipler (park'takiler ve bilinmeyenler hariç). */
export function misplacedAgainst(f: Frame, items: Classified[], parked: Set<ClipInfo>): Classified[] {
  const ch = guideChannels(items);
  return items.filter((x) => x.role !== "unknown" && !parked.has(x.clip) && frameTrack(f, x, ch) !== x.clip.track);
}

/** Yardımcının arama anahtarı (tür, track, start, end, kaynak adı). */
export const itemKey = (i: LinkItemRec): string => [i.kind, i.track, i.start, i.end, i.name].join("|");
export const itemOf = (c: ClipInfo): LinkItemRec => ({ kind: c.kind, track: c.track, start: c.start, end: c.end, name: fileName(c) });

/**
 * Kayıttaki BAĞLA aşaması okunan düzende geçerli mi:
 *  - "applied": kayıtlı bağlama gruplarının BÜTÜN öğeleri yerinde (BAĞLA'nın kesme/silmesi duruyor)
 *  - "partial": bir kısmı yok ama kesimin yarattığı parçalardan biri var (BAĞLA'dan sonra düzen değişmiş) → hiçbir komut çalışmaz
 *  - "none"   : BAĞLA'dan geçmedi ya da tamamen geri alındı (kesimin yarattığı hiçbir parça yok)
 */
export function bindState(rec: CollectRecord | null, s: Snapshot): "none" | "applied" | "partial" {
  const b = rec?.bind;
  if (!b) return "none";
  const have = new Set(s.clips.map((c) => itemKey(itemOf(c))));
  const all = b.groups.flatMap((g) => g.items);
  if (all.length && all.every((i) => have.has(itemKey(i)))) return "applied";
  return b.created.some((i) => have.has(itemKey(i))) ? "partial" : "none";
}

// ------------------------------------------------------------------ plan

export interface Placement {
  x: Classified;
  track: number;
  delta: bigint;
  session: Session | null;
  moves: boolean;
}

export interface SessionLayout {
  session: Session;
  delta: bigint;
  newStart: bigint;
  newEnd: bigint;
}

export interface CollectPlan {
  frame: Frame;
  placements: Placement[];
  layouts: SessionLayout[];
  parkedRecs: Recording[];
  moves: Placement[];
  /** ilk (ölçüm) oturumun taşınanları */
  firstMoves: Placement[];
  firstSession: Session | null;
  verticalMoves: number;
  horizontalMoves: number;
  layoutEnd: bigint;
  neededV: number;
  neededA: number;
  conflicts: string[];
  errors: string[];
  warnings: string[];
}

interface Ov extends OvItem {
  x: Classified;
}

/**
 * @param parkedRecs sahipsizler + (kullanıcı onayladıysa) ayrılamayan kayıtlar → park track'leri, zaman aynı
 * @param keepInPlace önceki TOPLA'nın park ettikleri (kayıttan; analize girmez): park bölgesindeyse yerinde kalır, değilse (eşleme
 *        değişip çerçeve büyüdüyse) park track'lerine yeniden yerleşir — ZAMANI hiçbir durumda değişmez
 */
export function makeCollectPlan(
  s0: Snapshot,
  items: Classified[],
  a: Analysis,
  frame: Frame,
  opts: { gap: bigint; frameTicks: bigint | null; parkedRecs: Recording[]; keepInPlace: Set<ClipInfo> }
): CollectPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ch = guideChannels(items);

  // YATAY
  const layouts: SessionLayout[] = [];
  let cursor = 0n;
  for (const s of a.sessions) {
    const delta = ceilTo(cursor - s.start, opts.frameTicks);
    const newStart = s.start + delta;
    const newEnd = s.end + delta;
    layouts.push({ session: s, delta, newStart, newEnd });
    cursor = ceilTo(newEnd + opts.gap, opts.frameTicks);
  }
  const layoutEnd = layouts.length ? layouts[layouts.length - 1].newEnd : 0n;
  const deltaOf = new Map(layouts.map((l) => [l.session, l.delta]));

  // DİKEY + park
  const placements: Placement[] = [];
  const parkedClips = new Set(opts.parkedRecs.flatMap((r) => r.clips));
  const placeLater: Classified[] = [];
  for (const x of items) {
    const parkedBefore = opts.keepInPlace.has(x.clip);
    if (x.role === "unknown" || (parkedBefore && x.clip.track >= (x.clip.kind === "V" ? frame.vPark : frame.aPark))) {
      placements.push({ x, track: x.clip.track, delta: 0n, session: null, moves: false });
      continue;
    }
    if (parkedBefore) {
      placeLater.push(x);
      continue;
    }
    const rec = a.recordingOf.get(x.clip);
    if (parkedClips.has(x.clip) || !rec) {
      placeLater.push(x);
      continue;
    }
    const session = a.sessionOf.get(rec) ?? null;
    if (!session) {
      placeLater.push(x); // sahipsiz
      continue;
    }
    const t = frameTrack(frame, x, ch);
    if (t === null) {
      errors.push(`hedef track'i belirlenemedi: ${where(x.clip)}`);
      continue;
    }
    placements.push({ x, track: t, delta: deltaOf.get(session)!, session, moves: false });
  }
  // park: zaman aynı, çakışmayacak ilk park track'i (V: kamera videoları; A: kılavuz + harici). Dokunulmaz öğeler dolu sayılır.
  const occupied = new Map<string, [bigint, bigint][]>();
  const occ = (k: Kind, t: number) => occupied.get(`${k}|${t}`) ?? [];
  for (const p of placements) {
    const k = `${p.x.clip.kind}|${p.track}`;
    occupied.set(k, [...(occupied.get(k) ?? []), [big(p.x.clip.start) + p.delta, big(p.x.clip.end) + p.delta]]);
  }
  for (const x of placeLater.sort((p, q) => (big(p.clip.start) < big(q.clip.start) ? -1 : 1))) {
    const k = x.clip.kind;
    let t = k === "V" ? frame.vPark : frame.aPark;
    const s = big(x.clip.start);
    const e = big(x.clip.end);
    while (occ(k, t).some(([a0, b0]) => s < b0 && a0 < e)) t++;
    occupied.set(`${k}|${t}`, [...occ(k, t), [s, e]]);
    placements.push({ x, track: t, delta: 0n, session: null, moves: false });
  }

  // taşınanlar (kamera kaydının video + kılavuzları birlikte: biri taşınıyorsa hepsi)
  for (const p of placements) p.moves = p.track !== p.x.clip.track || p.delta !== 0n;
  const byRec = new Map<Recording, Placement[]>();
  for (const p of placements) {
    const r = a.recordingOf.get(p.x.clip);
    if (r && r.kind === "camera") byRec.set(r, [...(byRec.get(r) ?? []), p]);
  }
  for (const list of byRec.values()) if (list.some((p) => p.moves)) for (const p of list) p.moves = true;
  const moves = placements.filter((p) => p.moves);

  // çakışma → HATA (sessizce başka track'e konmaz)
  const fin: Ov[] = placements.map((p) => ({
    kind: p.x.clip.kind,
    track: p.track,
    start: big(p.x.clip.start) + p.delta,
    end: big(p.x.clip.end) + p.delta,
    label: p.x.clip.name,
    x: p.x,
  }));
  const conflicts = overlapsIn(fin, (p, q) => {
    if (p.x.role === "unknown" || q.x.role === "unknown")
      return ` — sınıflanamayan öğe (${(p.x.role === "unknown" ? p : q).x.why}) hedef yerde; ona dokunulmaz, önce onu başka track'e al`;
    return ` — aynı hedef track'e düşen iki klip (kaynak eşlemesini / ayarı kontrol et)`;
  });

  const firstSession = layouts.find((l) => moves.some((p) => p.session === l.session))?.session ?? null;
  const firstMoves = firstSession ? moves.filter((p) => p.session === firstSession) : [];
  const neededV = Math.max(frame.vPark, ...placements.filter((p) => p.x.clip.kind === "V").map((p) => p.track + 1));
  const neededA = Math.max(frame.aPark, ...placements.filter((p) => p.x.clip.kind === "A").map((p) => p.track + 1));
  return {
    frame,
    placements,
    layouts,
    parkedRecs: opts.parkedRecs,
    moves,
    firstMoves,
    firstSession,
    verticalMoves: placements.filter((p) => p.track !== p.x.clip.track).length,
    horizontalMoves: placements.filter((p) => p.delta !== 0n).length,
    layoutEnd,
    neededV,
    neededA,
    conflicts,
    errors,
    warnings,
  };
}

// ------------------------------------------------------------------ beklenen düzenler

/** @param parked hangi taşınanlar park'ta (+P, aynı track); @param placed hangileri hedefte */
export function expectCollect(s0: Snapshot, plan: CollectPlan, P: bigint, parked: Set<Placement>, placed: Set<Placement>): Exp[] {
  const byClip = new Map(plan.placements.map((p) => [p.x.clip, p]));
  return s0.clips.map((c) => {
    const p = byClip.get(c);
    if (!p || !p.moves) return expOf(c);
    if (placed.has(p)) return expOf(c, { track: p.track, start: big(c.start) + p.delta, end: big(c.end) + p.delta });
    if (parked.has(p)) return expOf(c, { start: big(c.start) + P, end: big(c.end) + P });
    return expOf(c);
  });
}

export function parkedExp(p: Placement, P: bigint): Exp {
  return expOf(p.x.clip, { start: big(p.x.clip.start) + P, end: big(p.x.clip.end) + P });
}

/** Oturum içi göreli konumlar: her oturumun bütün klipleri aynı Δ ile mi kaydı (okunan son düzende). */
export function verifyRelative(plan: CollectPlan, fin: Snapshot): string[] {
  const problems: string[] = [];
  const byKey = new Map<string, number>();
  for (const c of fin.clips) {
    const k = [c.kind, c.track, c.start, c.end, c.inPt, c.outPt, c.projId].join("|");
    byKey.set(k, (byKey.get(k) ?? 0) + 1);
  }
  for (const l of plan.layouts) {
    for (const p of plan.placements.filter((q) => q.session === l.session)) {
      const c = p.x.clip;
      const k = [c.kind, p.track, big(c.start) + l.delta, big(c.end) + l.delta, c.inPt, c.outPt, c.projId].join("|");
      if (!byKey.get(k)) problems.push(`${l.session.id}: ${where(c)} bloğun Δ=${secOf(l.delta)} sn ofsetiyle yerinde değil`);
    }
  }
  // bloklar çakışmıyor
  for (let i = 1; i < plan.layouts.length; i++)
    if (plan.layouts[i].newStart < plan.layouts[i - 1].newEnd)
      problems.push(`${plan.layouts[i - 1].session.id} ile ${plan.layouts[i].session.id} blokları çakışıyor`);
  return problems;
}

export function describeFrame(f: Frame): string {
  const dev = f.devices.map((d) => `${d.key} → ${trackLabel("V", f.devTrack.get(d.key)!)}`).join(", ");
  const src = f.sources.map((s) => `${s} → ${f.srcTrack.has(s) ? trackLabel("A", f.srcTrack.get(s)!) : `${trackLabel("A", f.silTrack.get(s)!)} (sil)`}`).join(", ");
  const guides = f.guideCount ? `kılavuz sesler → ${trackLabel("A", f.mappedCount)}–${trackLabel("A", f.mappedCount + f.guideCount - 1)}` : "kılavuz ses yok";
  return `${dev}; ${src || "harici kaynak yok"}; ${guides}`;
}
