// OTURUM / GRUP MODÜLÜ — TEK kaynak. SAF (Premiere çağrısı yok). TOPLA, BAĞLA ve durum raporu bunu kullanır; yardımcı (CEP)
// kendi başına gruplama YAPMAZ, bu modülün çıktısını (grup başına öğe listesi) uygular.
//
// KANIT (kullanıcı, gerçek Premiere, 12 Eylül): Synchronize her ilişkili grubu kendi içinde doğru hizalar, ilişkisiz grupları ise
// rastgele ve ÜST ÜSTE koyar. → Gruplama senkron sonucundan yapılır, dosya adından DEĞİL. Adlandırma yalnız cihaz kimliği ve sıra için.
//
// 1) KAYIT: kamera dosyası (video + kılavuz sesleri) ya da harici ses kaydı (Zoom: aynı saat = tek kayıt, kanalları birlikte; DJI:
//    dosya). Anahtar (cihaz, kayıt): aynı kaydın timeline'daki bütün klipleri (kanallar, parçalar) TEK kayıttır — hepsinin (in − start)
//    farkı aynı olmak ZORUNDA (değilse DUR), yani senkron onları birbirine göre tutarlı koymuştur; aralığı en erken start → en geç end.
//    (Kanallarından biri kısa diye ayrı "sahipsiz" sayılıp park'a gitseydi, kanallar birbirinden kayardı.)
// 2) GÜÇLÜ BAĞ: farklı cihazlardan iki kayıt zamanda çakışıyor VE çakışma kısa olanın ≥ eşik'i (varsayılan %90).
//    Gerçek veride doğru eşleşmelerin en düşüğü %97.96, yanlış çakışmaların en yükseği %49.
// 3) OTURUM = güçlü bağların bağlı bileşeni.
// 4) VETO: aynı cihazın iki FARKLI kaydı zamanda çakışamaz (aynı kaydın kanalları hariç) → çakışıyorsa ilişkisiz gruplar üst üste
//    konmuştur. Bileşen içinde veto varsa en zayıf bağlar kesilerek ayrılır — YALNIZ tek anlamlıysa (kesilen bağların en güçlüsü,
//    kalan bağların en zayıfından en az VETO_MARGIN kadar zayıfsa). Değilse TAHMİN EDİLMEZ → "ayrılamadı" (kullanıcıya sorulur).
// 5) SAHİPSİZ: hiçbir güçlü bağı olmayan kayıt (ör. eşsiz 1 sn'lik klip) — silinmez, park track'lerine (zamanı aynı) konur.
// 6) SIRA: her cihazın sıra anahtarları (sayaç / Zoom saati / DJI saati) oturumları sıralar; birden çok oturumdaki her cihaz aynı
//    sırayı vermeli. Çelişki ya da belirsizlik → kullanıcıya sorulur (tahmin yok).
// 7) GRUP (BAĞLA): oturum İÇİNDE zamanda çakışan kameralar; çapa = en uzun (eşitlikte alt V track = V1 cihazı, sonra erken start).

import { cmpStart, fileName, type Classified } from "./classify";
import { cmpOrder, recordingLabel, type Identity } from "./identity";
import { big, secOf, trackLabel, type ClipInfo, type Snapshot } from "./model";

export const DEFAULT_THRESHOLD = 0.9;
/** Veto çözümünde "tek anlamlı" sayılmak için kesilen ile kalan bağlar arasındaki en küçük oran farkı. */
export const VETO_MARGIN = 0.05;

export interface Recording {
  id: string;
  device: string;
  kind: "camera" | "audio";
  ident: Identity;
  label: string;
  items: Classified[];
  clips: ClipInfo[];
  start: bigint;
  end: bigint;
}

export interface Link {
  a: Recording;
  b: Recording;
  overlap: bigint;
  ratio: number;
}

export interface Session {
  id: string;
  recordings: Recording[];
  start: bigint;
  end: bigint;
  label: string;
}

export interface Unresolved {
  recordings: Recording[];
  lines: string[];
}

export interface OrderIssue {
  kind: "conflict" | "ambiguous";
  lines: string[];
}

export interface Analysis {
  recordings: Recording[];
  links: Link[];
  /** kronolojik sırada (orderIssue varsa: timeline'daki mevcut sırada — yalnız kullanıcı onaylarsa kullanılır) */
  sessions: Session[];
  orphans: Recording[];
  unresolved: Unresolved[];
  vetoDecisions: string[];
  duplicates: string[];
  orderIssue: OrderIssue | null;
  errors: string[];
  warnings: string[];
  sessionOf: Map<Recording, Session>;
  recordingOf: Map<ClipInfo, Recording>;
}

export interface AnalyzeOpts {
  threshold: number;
  /** bu klipler analize girmez (TOPLA düzeninde park track'lerindekiler) */
  exclude?: Set<ClipInfo>;
}

const pct = (r: number) => `%${(r * 100).toFixed(1)}`;
const recSpan = (r: Recording) => `[${secOf(r.start)}s–${secOf(r.end)}s]`;
const fmtOrder = (o: number[]) => o.join(".");

/** ÇİFT KOPYA: aynı tür + aynı kaynak + aynı start/end/in/out (kamera kılavuz sesleri hariç: çok kanallı kamera meşru). */
export function findDuplicates(items: Classified[]): string[] {
  const seen = new Map<string, ClipInfo[]>();
  for (const x of items) {
    if (x.role === "guide" || x.role === "unknown") continue;
    const c = x.clip;
    const k = [c.kind, c.projId, c.start, c.end, c.inPt, c.outPt].join("|");
    seen.set(k, [...(seen.get(k) ?? []), c]);
  }
  const out: string[] = [];
  for (const list of seen.values())
    if (list.length > 1)
      out.push(`${list.map((c) => trackLabel(c.kind, c.track)).join(" / ")}: "${list[0].name}" aynı kaynak, aynı start/end/in/out (${list.length} kopya)`);
  return out;
}

/** Kaydın anahtarı (cihaz | kayıt); kılavuz ses kendi kamerasının kaydı. Bilinmeyen → null. */
export function recordingKey(x: Classified): string | null {
  if (!x.ident || x.role === "unknown") return null;
  return `${x.role === "external" ? x.ident.device : x.device}|${x.ident.recording}`;
}

function buildRecordings(items: Classified[], warnings: string[]): { recordings: Recording[]; recordingOf: Map<ClipInfo, Recording> } {
  const byKey = new Map<string, Recording>();
  const recordingOf = new Map<ClipInfo, Recording>();
  const add = (key: string, kind: "camera" | "audio", x: Classified) => {
    let r = byKey.get(key);
    if (!r) {
      r = {
        id: key,
        device: x.ident!.device,
        kind,
        ident: x.ident!,
        label: kind === "audio" ? recordingLabel(x.ident!) : x.ident!.recording,
        items: [],
        clips: [],
        start: big(x.clip.start),
        end: big(x.clip.end),
      };
      byKey.set(key, r);
    }
    r.items.push(x);
    r.clips.push(x.clip);
    if (big(x.clip.start) < r.start) r.start = big(x.clip.start);
    if (big(x.clip.end) > r.end) r.end = big(x.clip.end);
    recordingOf.set(x.clip, r);
  };
  for (const x of items.filter((i) => i.role === "camera")) add(recordingKey(x)!, "camera", x);
  for (const x of items.filter((i) => i.role === "external")) add(recordingKey(x)!, "audio", x);
  // kılavuz sesler kendi kamerasının kaydına (aynı kaynak + aynı start/end; yoksa aynı kaynaklı ilk kamera örneği)
  const cams = [...byKey.values()].filter((r) => r.kind === "camera");
  const ovl = (r: Recording, c: ClipInfo) => {
    const s0 = big(c.start) > r.start ? big(c.start) : r.start;
    const e0 = big(c.end) < r.end ? big(c.end) : r.end;
    return e0 > s0 ? e0 - s0 : 0n;
  };
  for (const g of items.filter((i) => i.role === "guide")) {
    const exact = cams.find((r) => r.clips.some((c) => c.kind === "V" && c.projId === g.clip.projId && c.start === g.clip.start && c.end === g.clip.end));
    // yeri farklı kılavuz: aynı kaynaklı kamera örneklerinden zamanda EN ÇOK çakışana
    const same = cams.filter((r) => r.clips.some((c) => c.kind === "V" && c.projId === g.clip.projId)).sort((x, y) => (ovl(y, g.clip) > ovl(x, g.clip) ? 1 : ovl(y, g.clip) < ovl(x, g.clip) ? -1 : 0));
    const any = exact ?? same[0];
    if (!any) continue; // kamerası analizde değil (ör. park'ta) → dokunulmaz
    if (!exact) warnings.push(`kılavuz ses videosuyla aynı yerde değil: ${trackLabel("A", g.clip.track)} "${g.clip.name}"`);
    any.items.push(g);
    any.clips.push(g.clip);
    recordingOf.set(g.clip, any);
  }
  return { recordings: [...byKey.values()], recordingOf };
}

const overlapOf = (a: Recording, b: Recording): bigint => {
  const s = a.start > b.start ? a.start : b.start;
  const e = a.end < b.end ? a.end : b.end;
  return e > s ? e - s : 0n;
};

function strongLinks(recs: Recording[], threshold: number): Link[] {
  const links: Link[] = [];
  for (let i = 0; i < recs.length; i++)
    for (let j = i + 1; j < recs.length; j++) {
      const a = recs[i];
      const b = recs[j];
      if (a.device === b.device) continue; // aynı cihaz: bağ değil, veto konusu
      const ov = overlapOf(a, b);
      if (ov <= 0n) continue;
      const shorter = a.end - a.start < b.end - b.start ? a.end - a.start : b.end - b.start;
      if (shorter <= 0n) continue;
      const ratio = Number(ov) / Number(shorter);
      if (ratio >= threshold) links.push({ a, b, overlap: ov, ratio });
    }
  return links;
}

function components(nodes: Recording[], links: Link[]): Recording[][] {
  const parent = new Map<Recording, Recording>(nodes.map((n) => [n, n]));
  const find = (x: Recording): Recording => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const l of links) {
    const ra = find(l.a);
    const rb = find(l.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<Recording, Recording[]>();
  for (const n of nodes) groups.set(find(n), [...(groups.get(find(n)) ?? []), n]);
  return [...groups.values()];
}

function vetoPairs(recs: Recording[]): [Recording, Recording][] {
  const out: [Recording, Recording][] = [];
  for (let i = 0; i < recs.length; i++)
    for (let j = i + 1; j < recs.length; j++) {
      const a = recs[i];
      const b = recs[j];
      if (a.device === b.device && a.ident.recording !== b.ident.recording && overlapOf(a, b) > 0n) out.push([a, b]);
    }
  return out;
}

/**
 * Veto ihlali olan bileşeni en zayıf bağları keserek ayırmaya çalışır.
 * Tek anlamlı: kesme düzeyi (kesilen en güçlü bağ) < kalan en zayıf bağ − VETO_MARGIN, kesim hiçbir kaydı sahipsiz bırakmıyor VE
 * kesilen her bağ gerekli (tek başına geri eklenince veto geri geliyor). Değilse null (→ kullanıcıya sorulur).
 */
function resolveVeto(comp: Recording[], links: Link[]): { parts: Recording[][]; cut: Link[]; level: number; next: number } | null {
  const inComp = new Set(comp);
  const own = links.filter((l) => inComp.has(l.a) && inComp.has(l.b)).sort((x, y) => x.ratio - y.ratio);
  const levels = [...new Set(own.map((l) => l.ratio))].sort((x, y) => x - y);
  for (let k = 0; k < levels.length; k++) {
    const cut = own.filter((l) => l.ratio <= levels[k]);
    const keep = own.filter((l) => l.ratio > levels[k]);
    const parts = components(comp, keep);
    if (parts.some((p) => vetoPairs(p).length)) continue;
    // tek anlamlı değilse TAHMİN YOK: (a) kesilen bağlar kalanlardan açıkça zayıf olmalı, (b) kesim hiçbir kaydı sahipsiz
    // bırakmamalı (her parça hâlâ bir oturum) — aksi hâlde "hepsini kes" de bir "çözüm" sayılırdı
    if (!keep.length || parts.some((p) => p.length < 2)) return null;
    const next = Math.min(...keep.map((l) => l.ratio));
    if (next - levels[k] < VETO_MARGIN) return null;
    // (c) kesilen HER bağ gerekli olmalı: tek başına geri eklenince veto geri gelmeli. Gereksiz bir bağ da kesiliyorsa (ör. aynı
    // oturumun iki yarısını birleştiren zayıf bir köprü) kesim gerçek bir oturumu böler → tek anlamlı değil
    for (const l of cut) if (!components(comp, [...keep, l]).some((p) => vetoPairs(p).length)) return null;
    return { parts, cut, level: levels[k], next };
  }
  return null;
}

function sessionLabel(recs: Recording[]): string {
  const aud = recs.filter((r) => r.kind === "audio").sort((a, b) => cmpOrder(a.ident.order, b.ident.order));
  const cam = recs.filter((r) => r.kind === "camera").sort((a, b) => (a.device < b.device ? -1 : a.device > b.device ? 1 : cmpOrder(a.ident.order, b.ident.order)));
  const auds = [...new Set(aud.map((r) => r.label))];
  const byDev = new Map<string, string[]>();
  for (const c of cam) byDev.set(c.device, [...(byDev.get(c.device) ?? []), c.label]);
  const cams = [...byDev.entries()].map(([d, l]) => `${d}: ${l.length > 2 ? `${l[0]}..${l[l.length - 1]} (${l.length})` : l.join(", ")}`);
  return [...auds, ...cams].join(" + ");
}

/**
 * Oturumları cihaz sıra anahtarlarıyla sıralar. Döndürülen sıra, kullanıcı onaylarsa KULLANILACAK sıradır:
 *  - sorun yok: cihazların verdiği tek sıra
 *  - BELİRSİZ: bilinen bütün kısıtlara uyan sıra; kısıtın olmadığı yerde timeline'daki mevcut sıra
 *  - ÇELİŞKİ: kısıtlar birbirini tutmuyor → timeline'daki mevcut sıra
 */
function orderSessions(sessions: Session[]): { order: Session[]; issue: OrderIssue | null } {
  const byTimeline = sessions.slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const devs = new Map<string, { s: Session; min: number[]; max: number[] }[]>();
  for (const s of sessions) {
    const per = new Map<string, { min: number[]; max: number[] }>();
    for (const r of s.recordings) {
      const cur = per.get(r.device);
      if (!cur) per.set(r.device, { min: r.ident.order, max: r.ident.order });
      else {
        if (cmpOrder(r.ident.order, cur.min) < 0) cur.min = r.ident.order;
        if (cmpOrder(r.ident.order, cur.max) > 0) cur.max = r.ident.order;
      }
    }
    for (const [d, v] of per) devs.set(d, [...(devs.get(d) ?? []), { s, ...v }]);
  }
  const lines: string[] = [];
  const after = new Map<Session, Set<Session>>(sessions.map((s) => [s, new Set<Session>()]));
  for (const [d, list] of devs) {
    list.sort((x, y) => cmpOrder(x.min, y.min));
    for (let i = 1; i < list.length; i++) {
      const p = list[i - 1];
      const q = list[i];
      if (cmpOrder(p.max, q.min) >= 0)
        lines.push(`cihaz ${d}: "${p.s.label}" [${fmtOrder(p.min)}–${fmtOrder(p.max)}] ile "${q.s.label}" [${fmtOrder(q.min)}–${fmtOrder(q.max)}] sıra anahtarları iç içe`);
      after.get(p.s)!.add(q.s);
    }
  }
  // Kahn: her adımda tek aday olmalı (yoksa belirsiz); döngü = çelişki
  const indeg = new Map<Session, number>(sessions.map((s) => [s, 0]));
  for (const [, nexts] of after) for (const n of nexts) indeg.set(n, indeg.get(n)! + 1);
  // Kahn: her adımda tek aday olmalı; birden çoksa BELİRSİZ (bilinen kısıtlara UYAN sıra, eşitlikte timeline — kullanıcı onaylarsa)
  const order: Session[] = [];
  const amb: string[] = [];
  const left = new Set(sessions);
  while (left.size) {
    const ready = byTimeline.filter((s) => left.has(s) && indeg.get(s) === 0);
    if (!ready.length) {
      lines.push(`cihaz sıraları döngü oluşturuyor: ${[...left].map((x) => `"${x.label}"`).join(", ")}`);
      break;
    }
    if (ready.length > 1) amb.push(`${ready.map((x) => `"${x.label}"`).join(" / ")} arasındaki sıra cihaz sayaçlarından çıkarılamıyor`);
    const pick = ready[0];
    order.push(pick);
    left.delete(pick);
    for (const n of after.get(pick)!) indeg.set(n, indeg.get(n)! - 1);
  }
  if (lines.length) {
    lines.push("kısıtlar çelişkili olduğundan, onaylarsan oturumlar senkronun bıraktığı (timeline'daki) sırayla dizilir");
    for (const [d, list] of devs)
      if (list.length > 1) lines.push(`cihaz ${d} sırası: ${list.map((x) => `"${x.s.label}" [${fmtOrder(x.min)}]`).join(" < ")}`);
    return { order: byTimeline, issue: { kind: "conflict", lines } };
  }
  if (amb.length) return { order, issue: { kind: "ambiguous", lines: amb } };
  return { order, issue: null };
}

export function analyze(s: Snapshot, items: Classified[], opts: AnalyzeOpts): Analysis {
  const errors: string[] = [];
  const warnings: string[] = [];
  const duplicates = findDuplicates(items);
  const included = items.filter((x) => x.role !== "unknown" && !opts.exclude?.has(x.clip));
  const { recordings, recordingOf } = buildRecordings(included, warnings);
  const links = strongLinks(recordings, opts.threshold);
  // aynı kaydın bütün klipleri (kanallar, parçalar, örnekler) AYNI senkron konumunda olmalı: (in − start) hepsinde aynı
  const offsets = new Map<string, Map<string, ClipInfo>>();
  for (const r of recordings)
    for (const x of r.items) {
      if (x.role === "guide" || x.clip.speed !== 1) continue;
      const k = `${r.device}|${r.ident.recording}`;
      const off = String(big(x.clip.inPt) - big(x.clip.start));
      const m = offsets.get(k) ?? new Map<string, ClipInfo>();
      if (!m.has(off)) m.set(off, x.clip);
      offsets.set(k, m);
    }
  for (const [k, m] of offsets)
    if (m.size > 1)
      errors.push(
        `aynı kaydın klipleri farklı senkron konumunda (${k.split("|")[1]}): ${[...m.values()].map((c) => `${trackLabel(c.kind, c.track)} "${c.name}" [${secOf(big(c.start))}s]`).join(", ")} — senkronu kontrol et`
      );

  const vetoDecisions: string[] = [];
  const unresolved: Unresolved[] = [];
  const finalComps: Recording[][] = [];
  for (const comp of components(recordings, links)) {
    const v = vetoPairs(comp);
    if (!v.length) {
      finalComps.push(comp);
      continue;
    }
    const conflicts = v.map(([a, b]) => `${a.device}: ${a.label} ${recSpan(a)} ↔ ${b.label} ${recSpan(b)} (aynı cihazın iki kaydı üst üste)`);
    const res = resolveVeto(comp, links);
    if (res) {
      finalComps.push(...res.parts);
      vetoDecisions.push(
        `VETO: ${conflicts.join("; ")} → en zayıf ${res.cut.length} bağ (≤ ${pct(res.level)}; kalanların en zayıfı ${pct(res.next)}) kesildi: ` +
          res.cut.map((l) => `${l.a.label}↔${l.b.label} ${pct(l.ratio)}`).join(", ")
      );
    } else {
      const inComp = new Set(comp);
      const own = links.filter((l) => inComp.has(l.a) && inComp.has(l.b)).sort((x, y) => x.ratio - y.ratio);
      unresolved.push({
        recordings: comp,
        lines: [
          ...conflicts,
          `bağlar (zayıftan güçlüye): ${own.slice(0, 12).map((l) => `${l.a.label}↔${l.b.label} ${pct(l.ratio)}`).join(", ")}${own.length > 12 ? " …" : ""}`,
          "en zayıf bağları kesmek tek anlamlı bir ayrım vermiyor → tahmin edilmedi",
        ],
      });
    }
  }
  const orphans = finalComps.filter((c) => c.length === 1).map((c) => c[0]);
  const raw: Session[] = finalComps
    .filter((c) => c.length > 1)
    .map((recs, i) => ({
      id: `S${i + 1}`,
      recordings: recs,
      start: recs.reduce((m, r) => (r.start < m ? r.start : m), recs[0].start),
      end: recs.reduce((m, r) => (r.end > m ? r.end : m), recs[0].end),
      label: sessionLabel(recs),
    }));
  const { order, issue: orderIssue } = orderSessions(raw);
  order.forEach((x, i) => (x.id = `O${i + 1}`));
  const sessionOf = new Map<Recording, Session>();
  for (const x of order) for (const r of x.recordings) sessionOf.set(r, x);
  return { recordings, links, sessions: order, orphans, unresolved, vetoDecisions, duplicates, orderIssue, errors, warnings, sessionOf, recordingOf };
}

/**
 * BÖLÜNMÜŞ KAYIT: analizden çıkarılan (park kaydındaki) bir klibin kaydı (aynı cihaz + kayıt) analizde bir oturumda. Park'taki parça
 * zamanı değişmeden kalırken oturum taşınırsa aynı kaydın parçaları birbirinden kayar → TOPLA sorar, BAĞLA durur.
 */
export function partlyParked(a: Analysis, items: Classified[], excluded: Set<ClipInfo>): { rec: Recording; session: Session; parked: ClipInfo[] }[] {
  const byId = new Map(a.recordings.map((r) => [r.id, r]));
  const out = new Map<Recording, ClipInfo[]>();
  for (const x of items) {
    if (!excluded.has(x.clip)) continue;
    const k = recordingKey(x);
    const r = k ? byId.get(k) : undefined;
    if (r && a.sessionOf.has(r)) out.set(r, [...(out.get(r) ?? []), x.clip]);
  }
  return [...out].map(([rec, parked]) => ({ rec, session: a.sessionOf.get(rec)!, parked }));
}

/** Kısa olanın kendinden en az bu kadar kat uzun bir kaydın içine düşmesi "yalnız içerilme" kanıtı sayılır. */
export const SUSPECT_FACTOR = 20n;

/**
 * ŞÜPHELİ ÜYE: bir oturumdaki kaydın BÜTÜN güçlü bağları, kendinden en az SUSPECT_FACTOR kat uzun kayıtların içine düşmesinden geliyor
 * (ör. eşsiz 1 sn'lik klip, senkronun eşleyemeyip uzun bir Zoom/DJI kaydının ortasına bıraktığı). Oran kısa olana göre ölçüldüğü için
 * bu hep %100 çıkar → kanıt zayıf. Karar kullanıcının (TOPLA sorar).
 */
export function suspiciousMembers(a: Analysis): { rec: Recording; session: Session; line: string }[] {
  const out: { rec: Recording; session: Session; line: string }[] = [];
  for (const s of a.sessions)
    for (const r of s.recordings) {
      const mine = a.links.filter((l) => (l.a === r || l.b === r) && a.sessionOf.get(l.a) === s && a.sessionOf.get(l.b) === s);
      if (!mine.length) continue;
      const len = r.end - r.start;
      const allContained = mine.every((l) => {
        const o = l.a === r ? l.b : l.a;
        return (o.end - o.start) >= len * SUSPECT_FACTOR;
      });
      if (allContained)
        out.push({
          rec: r,
          session: s,
          line: `${r.label} (${secOf(len)} sn) ${s.id} oturumuna yalnız kendinden çok uzun ${mine.map((l) => (l.a === r ? l.b : l.a).label).join(", ")} kaydının içine düştüğü için bağlı`,
        });
    }
  return out;
}

// ------------------------------------------------------------------ BAĞLA: oturum içi gruplar

export interface Group {
  id: string;
  session: Session;
  cams: ClipInfo[];
  anchor: ClipInfo;
  start: bigint;
  end: bigint;
}

export const anchorLess = (a: ClipInfo, b: ClipInfo): boolean => {
  const la = big(a.end) - big(a.start);
  const lb = big(b.end) - big(b.start);
  if (la !== lb) return la > lb;
  if (a.track !== b.track) return a.track < b.track; // eşitlikte V1 cihazı
  return big(a.start) < big(b.start);
};

/** Zamanda çakışan kamera klipleri → gruplar (aralık grafiğinin bağlı bileşenleri). */
export function makeGroups(cams: ClipInfo[], session: Session, prefix: string): Group[] {
  const sorted = cams.slice().sort(cmpStart);
  const groups: Group[] = [];
  let cur: ClipInfo[] = [];
  let curEnd = -1n;
  const flush = () => {
    if (!cur.length) return;
    let anchor = cur[0];
    for (const c of cur) if (anchorLess(c, anchor)) anchor = c;
    groups.push({ id: `${prefix}G${groups.length + 1}`, session, cams: cur, anchor, start: big(cur[0].start), end: curEnd });
  };
  for (const c of sorted) {
    if (cur.length && big(c.start) < curEnd) {
      cur.push(c);
      if (big(c.end) > curEnd) curEnd = big(c.end);
    } else {
      flush();
      cur = [c];
      curEnd = big(c.end);
    }
  }
  flush();
  return groups;
}

/** Oturumun grupları (yalnız o oturumun kameraları). */
export function sessionGroups(session: Session): Group[] {
  const cams = session.recordings.filter((r) => r.kind === "camera").flatMap((r) => r.clips.filter((c) => c.kind === "V"));
  return makeGroups(cams, session, `${session.id}-`); // yardımcının kimlik biçimi: [A-Za-z0-9_-]
}

/** [s,e) aralıklarının birleşim uzunluğu. */
export function unionLength(iv: [bigint, bigint][]): bigint {
  const s = iv.filter(([a, b]) => b > a).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  let total = 0n;
  let cs = -1n;
  let ce = -1n;
  for (const [a, b] of s) {
    if (a > ce) {
      if (ce > cs) total += ce - cs;
      cs = a;
      ce = b;
    } else if (b > ce) ce = b;
  }
  if (ce > cs) total += ce - cs;
  return total;
}

export function describeLinks(a: Analysis, limit = 40): string[] {
  return a.links
    .slice()
    .sort((x, y) => y.ratio - x.ratio)
    .slice(0, limit)
    .map((l) => `${l.a.label} ↔ ${l.b.label}: çakışma ${secOf(l.overlap)} sn = kısa olanın ${pct(l.ratio)}`);
}

export const recordingName = (r: Recording): string => (r.kind === "audio" ? r.label : fileName(r.clips.find((c) => c.kind === "V") ?? r.clips[0]));
