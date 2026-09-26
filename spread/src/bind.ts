// BAĞLA planı — SAF fonksiyonlar (Premiere çağrısı yok).
//
// 1) GRUP: zamanda çakışan KAMERA klipleri (bitiş = başlangıç çakışma değil; zincirleme çakışan hepsi tek grup).
//    Harici sesler grup tanımına KATILMAZ (bir WAV birden çok grubu kapsayabilir).
// 2) ÇAPA: gruptaki en uzun kamera klibi (eşitlikte alt V track, sonra erken start).
// 3) KESME: tutulan kanallardaki her harici ses, çakıştığı her grubun çapa aralığına göre parçalanır:
//      parça = WAV ∩ çapa;  parça.in = WAV.in + (parça.start − WAV.start);  parça.out = parça.in + (parça.end − parça.start)
//    Hiçbir çapaya düşmeyen ses SİLİNİR. Tamamen tek çapanın içindeki ses OLDUĞU GİBİ kalır (kesilmez).
// 4) SİLME: kamera kılavuz sesleri + kapatılmış kanalların klipleri + çapa dışı sesler.
// 5) BAĞLAMA grubu: gruptaki bütün kamera videoları + o grubun çapasına düşen harici ses parçaları.
//
// UXP'de razor yok → parça = createCloneTrackItemAction + set End/Start/In/Out, sonra aslı silinir. Yöntem (tümü AYNI track'te):
//   TX-1 "kesim hazırlığı": her parça için WAV'ın tam boy kopyası sequence sonunun ötesindeki bir PARK YUVASINA (clone, zaman
//        ofseti) + silinecekler ve kesilecek asıllar silinir (tek seçim, ripple=false)
//   TX-2 "ilk parça"      : YALNIZ ilk parçanın park kopyası kırpılır (set End → Start → In → Out) — ÖLÇÜM: tutmazsa DUR
//   TX-3 "parçalar"       : kalan park kopyaları kırpılır
//   TX-4 "yerleştir"      : kırpılmış park kopyaları −(yuva − WAV.start) zaman ofsetiyle asıl yerlerine kopyalanır + park kopyaları silinir
// Neden park: set action'lar klibi zamanda TAŞIMAK zorunda kalmasın (yalnız kenar kırpma; taşıma kanıtlı clone ofsetiyle).
// Kırpma sırası End → Start → In → Out: "baş/son kırpma" anlamında da "start taşır" anlamında da aynı sonuca varır; yuvalar arası
// boşluk (≥ WAV boyu) ara durumda komşu yuvaya taşmayı önler. Hangi anlamda olursa olsun her parça tick düzeyinde doğrulanır.

import { classify, cmpStart, fileName, where, type Classified } from "./classify";
import { expOf, type Exp } from "./layout";
import { big, TICKS_PER_SECOND, trackLabel, type ClipInfo, type Snapshot } from "./model";

export interface Group {
  id: string;
  cams: ClipInfo[];
  anchor: ClipInfo;
  start: bigint;
  end: bigint;
}

export interface Piece {
  src: ClipInfo;
  channel: string;
  group: Group;
  start: bigint;
  end: bigint;
  inPt: bigint;
  outPt: bigint;
  /** WAV tamamen tek çapanın içinde → kesilmez, olduğu gibi kalır */
  whole: boolean;
}

export interface Cut {
  src: ClipInfo;
  pieces: Piece[];
}

export interface BindPlan {
  items: Classified[];
  groups: Group[];
  pieces: Piece[];
  cuts: Cut[];
  deleteGuides: ClipInfo[];
  deleteUnkept: ClipInfo[];
  deleteOutside: ClipInfo[];
  unknown: Classified[];
  keptChannels: string[];
  /** grup.id|kanal → çapa içindeki harici ses süresi (birleşim, tick) — BAĞLA ÖNCESİ */
  coverage: Map<string, bigint>;
  errors: string[];
  warnings: string[];
}

export const anchorLess = (a: ClipInfo, b: ClipInfo): boolean => {
  const la = big(a.end) - big(a.start);
  const lb = big(b.end) - big(b.start);
  if (la !== lb) return la > lb;
  if (a.track !== b.track) return a.track < b.track;
  return big(a.start) < big(b.start);
};

/** Zamanda çakışan kamera klipleri → gruplar (aralık grafiğinin bağlı bileşenleri). */
export function makeGroups(cams: ClipInfo[]): Group[] {
  const sorted = cams.slice().sort(cmpStart);
  const groups: Group[] = [];
  let cur: ClipInfo[] = [];
  let curEnd = -1n;
  const flush = () => {
    if (!cur.length) return;
    let anchor = cur[0];
    for (const c of cur) if (anchorLess(c, anchor)) anchor = c;
    groups.push({ id: `G${groups.length + 1}`, cams: cur, anchor, start: big(cur[0].start), end: curEnd });
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

const clampTo = (c: { start: bigint; end: bigint }, g: Group): [bigint, bigint] => {
  const as = big(g.anchor.start);
  const ae = big(g.anchor.end);
  return [c.start > as ? c.start : as, c.end < ae ? c.end : ae];
};

export function makeBindPlan(s: Snapshot, kept: (channel: string) => boolean): BindPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const w of s.warnings) errors.push(`okuma uyarısı: ${w}`);
  for (const c of s.clips) for (const e of c.readErrors) errors.push(`okunamadı: ${where(c)} — ${e}`);
  const items = classify(s);
  const cams = items.filter((x) => x.role === "camera").map((x) => x.clip);
  const groups = makeGroups(cams);
  if (!groups.length) errors.push("kamera klibi yok → grup yok; BAĞLA'nın bağlayacağı bir şey yok");

  const pieces: Piece[] = [];
  const cuts: Cut[] = [];
  const deleteGuides = items.filter((x) => x.role === "guide").map((x) => x.clip);
  const deleteUnkept: ClipInfo[] = [];
  const deleteOutside: ClipInfo[] = [];
  const keptSet = new Set<string>();

  for (const x of items.filter((i) => i.role === "external").sort((a, b) => cmpStart(a.clip, b.clip))) {
    const w = x.clip;
    if (!kept(x.channel!)) {
      deleteUnkept.push(w);
      continue;
    }
    keptSet.add(x.channel!);
    const ws = big(w.start);
    const we = big(w.end);
    const win = big(w.inPt);
    const mine: Piece[] = [];
    for (const g of groups) {
      const [ps, pe] = clampTo({ start: ws, end: we }, g);
      if (pe <= ps) continue;
      mine.push({ src: w, channel: x.channel!, group: g, start: ps, end: pe, inPt: win + (ps - ws), outPt: win + (pe - ws), whole: ps === ws && pe === we });
    }
    if (!mine.length) {
      deleteOutside.push(w);
      continue;
    }
    pieces.push(...mine);
    if (mine.length === 1 && mine[0].whole) continue;
    // kesilecek: hız 1 ve süre = kaynak aralığı olmalı (parça.in hesabı buna dayanır)
    if (w.speed !== 1) errors.push(`hızı ${w.speed} olan harici ses kesilemez: ${where(w)}`);
    else if (we - ws !== big(w.outPt) - win)
      errors.push(`harici seste süre ≠ kaynak aralığı (end−start=${we - ws}, out−in=${big(w.outPt) - win} tick): ${where(w)}`);
    cuts.push({ src: w, pieces: mine });
  }

  const coverage = new Map<string, bigint>();
  for (const g of groups)
    for (const ch of keptSet) {
      const iv = items
        .filter((x) => x.role === "external" && x.channel === ch)
        .map((x) => clampTo({ start: big(x.clip.start), end: big(x.clip.end) }, g));
      coverage.set(`${g.id}|${ch}`, unionLength(iv));
    }

  const unknown = items.filter((x) => x.role === "unknown");
  for (const u of unknown) warnings.push(`dokunulmayacak: ${where(u.clip)} (${u.why})`);
  for (const g of groups)
    if (g.cams.length > 1 && new Set(g.cams.map((c) => c.track)).size < g.cams.length)
      warnings.push(`${g.id}: aynı track'te birden çok kamera klibi (${g.cams.map((c) => where(c)).join(", ")}) — bağlama Premiere'e bağlı`);

  return {
    items,
    groups,
    pieces,
    cuts,
    deleteGuides,
    deleteUnkept,
    deleteOutside,
    unknown,
    keptChannels: [...keptSet],
    coverage,
    errors,
    warnings,
  };
}

// ------------------------------------------------------------------ park yuvaları ve beklenen düzenler

export interface Slot {
  piece: Piece;
  /** park kopyasının (tam boy) başlangıcı */
  q: bigint;
  /** TX-1 clone zaman ofseti = q − WAV.start */
  offset: bigint;
}

const SLOT_GAP = TICKS_PER_SECOND;

/** Her parça için WAV'ın AYNI track'inde, P'den başlayan ardışık park yuvaları (aralarında ≥ WAV boyu boşluk). */
export function makeSlots(plan: BindPlan, P: bigint): Slot[] {
  const cursor = new Map<number, bigint>();
  const slots: Slot[] = [];
  for (const cut of plan.cuts.slice().sort((a, b) => a.src.track - b.src.track || cmpStart(a.src, b.src))) {
    const L = big(cut.src.end) - big(cut.src.start);
    for (const p of cut.pieces) {
      const q = cursor.get(cut.src.track) ?? P;
      cursor.set(cut.src.track, q + 2n * L + SLOT_GAP);
      slots.push({ piece: p, q, offset: q - big(cut.src.start) });
    }
  }
  return slots;
}

/** Park kopyasının kırpılmış hâli (yuva koordinatlarında). */
export function trimmedAtSlot(sl: Slot): { start: bigint; end: bigint; inPt: bigint; outPt: bigint } {
  const ws = big(sl.piece.src.start);
  return { start: sl.q + (sl.piece.start - ws), end: sl.q + (sl.piece.end - ws), inPt: sl.piece.inPt, outPt: sl.piece.outPt };
}

/** İlk parça = zamanda en erken (eşitlikte alt track) — ölçüm transaction'ı yalnız onu kırpar. */
export function firstSlot(slots: Slot[]): Slot | null {
  return (
    slots
      .slice()
      .sort((a, b) =>
        a.piece.start < b.piece.start ? -1 : a.piece.start > b.piece.start ? 1 : a.piece.src.track - b.piece.src.track
      )[0] ?? null
  );
}

function removedSet(plan: BindPlan): Set<ClipInfo> {
  return new Set([...plan.deleteGuides, ...plan.deleteUnkept, ...plan.deleteOutside, ...plan.cuts.map((c) => c.src)]);
}

/** @param trimmed hangi yuvaların kırpılmış olması beklenir */
export function expectParked(s0: Snapshot, plan: BindPlan, slots: Slot[], trimmed: Set<Slot>): Exp[] {
  const gone = removedSet(plan);
  const exp = s0.clips.filter((c) => !gone.has(c)).map((c) => expOf(c));
  for (const sl of slots) {
    const src = sl.piece.src;
    if (trimmed.has(sl)) exp.push(expOf(src, trimmedAtSlot(sl)));
    else exp.push(expOf(src, { start: sl.q, end: sl.q + (big(src.end) - big(src.start)) }));
  }
  return exp;
}

export function expectBindFinal(s0: Snapshot, plan: BindPlan): Exp[] {
  const gone = removedSet(plan);
  const exp = s0.clips.filter((c) => !gone.has(c)).map((c) => expOf(c));
  for (const cut of plan.cuts)
    for (const p of cut.pieces) exp.push(expOf(cut.src, { start: p.start, end: p.end, inPt: p.inPt, outPt: p.outPt }));
  return exp;
}

/**
 * BAĞLA sonrası içerik doğrulaması (tick düzeyinde karşılaştırmaya EK, okunur rapor için):
 *  - her tutulan kanalın her çapa içindeki ses süresi öncekiyle aynı (hiçbir çapa içinde boşluk kalmadı)
 *  - her harici klipte (in − start) kaynağıyla aynı (parça kaynağın doğru yerini çalıyor)
 *  - hiçbir harici ses çapaların dışına taşmıyor; kılavuz ses ve kapatılmış kanal kalmadı
 */
export function verifyBindContent(plan: BindPlan, fin: Snapshot): string[] {
  const problems: string[] = [];
  const items = classify(fin);
  const ext = items.filter((x) => x.role === "external");
  for (const g of plan.groups)
    for (const ch of plan.keptChannels) {
      const before = plan.coverage.get(`${g.id}|${ch}`) ?? 0n;
      const after = unionLength(
        ext.filter((x) => x.channel === ch).map((x) => clampTo({ start: big(x.clip.start), end: big(x.clip.end) }, g))
      );
      if (after !== before) problems.push(`${g.id} çapası "${g.anchor.name}" içinde ${ch} sesi ${before} tick idi, şimdi ${after} tick (kayıp/fazla ${before - after})`);
    }
  // aynı kaynak aynı track'te birden çok kez olabilir → izin verilen (in − start) değerleri küme olarak
  const srcOffset = new Map<string, Set<bigint>>();
  const allow = (c: ClipInfo) => {
    const k = c.projId + "|" + c.track;
    srcOffset.set(k, (srcOffset.get(k) ?? new Set<bigint>()).add(big(c.inPt) - big(c.start)));
  };
  for (const cut of plan.cuts) allow(cut.src);
  for (const p of plan.pieces) if (p.whole) allow(p.src);
  for (const x of ext) {
    const want = srcOffset.get(x.clip.projId + "|" + x.clip.track);
    const got = big(x.clip.inPt) - big(x.clip.start);
    if (want !== undefined && !want.has(got)) problems.push(`${where(x.clip)}: kaynak kayması (in − start) ${got}, beklenen ${[...want].join(" / ")}`);
    const inside = plan.groups.some((g) => big(x.clip.start) >= big(g.anchor.start) && big(x.clip.end) <= big(g.anchor.end));
    if (!inside && plan.keptChannels.includes(x.channel!)) problems.push(`${where(x.clip)} hiçbir çapanın içinde değil`);
    if (!plan.keptChannels.includes(x.channel!)) problems.push(`kapatılmış kanal ${x.channel} hâlâ var: ${where(x.clip)}`);
  }
  for (const x of items.filter((i) => i.role === "guide")) problems.push(`kılavuz ses hâlâ var: ${where(x.clip)}`);
  return problems;
}

// ------------------------------------------------------------------ bağlama grupları

export interface LinkTarget {
  kind: "V" | "A";
  track: number;
  start: string;
  end: string;
  name: string;
}

/** Son (kesilmiş) düzenden her grubun bağlanacak öğeleri. fin'deki klipler DEĞER olarak okunur. */
export function linkTargets(plan: BindPlan, fin: Snapshot): { group: Group; items: LinkTarget[]; label: string }[] {
  const items = classify(fin);
  const out: { group: Group; items: LinkTarget[]; label: string }[] = [];
  for (const g of plan.groups) {
    const as = big(g.anchor.start);
    const ae = big(g.anchor.end);
    const camKeys = new Set(g.cams.map((c) => [c.kind, c.track, c.start, c.end, c.projId].join("|")));
    const members = items.filter((x) => {
      if (x.role === "camera") return camKeys.has([x.clip.kind, x.clip.track, x.clip.start, x.clip.end, x.clip.projId].join("|"));
      if (x.role === "external") return plan.keptChannels.includes(x.channel!) && big(x.clip.start) >= as && big(x.clip.end) <= ae;
      return false;
    });
    const lt = members
      .map((x) => x.clip)
      .sort(cmpStart)
      .map((c) => ({ kind: c.kind, track: c.track, start: c.start, end: c.end, name: fileName(c) }));
    const nCam = members.filter((x) => x.role === "camera").length;
    out.push({ group: g, items: lt, label: `${g.id} (${nCam} kamera + ${lt.length - nCam} ses; çapa ${trackLabel("V", g.anchor.track)} "${g.anchor.name}")` });
  }
  return out;
}
