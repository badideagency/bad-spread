// BAĞLA planı — SAF fonksiyonlar (Premiere çağrısı yok). Oturumlar ve gruplar TEK modülden: sessions.ts.
//
// Yalnız OTURUM İÇİNDE çalışır:
// 1) GRUP: oturumdaki zamanda çakışan kamera klipleri; ÇAPA: en uzun (eşitlikte V1 cihazı) — sessions.sessionGroups.
// 2) KESME: oturumun her harici kaynağı (Zoom kanalları, DJI…) KENDİ oturumunun çapalarına göre parçalanır:
//      parça = ses ∩ çapa;  parça.in = ses.in + (parça.start − ses.start);  parça.out = parça.in + (parça.end − parça.start)
//    Bir oturumun sesi başka oturumun kamerasına ASLA kesilmez. Oturumunun hiçbir çapasına düşmeyen ses SİLİNİR. Tamamen tek
//    çapanın içindeki ses kesilmez. Kaynak eşlemede "sil" seçilen kaynaklar silinir.
// 3) KAMERA SESİ: grubunda tutulan harici ses VARSA kılavuz sesler silinir; YOKSA (ör. oturumda Zoom/yaka yok) kamera sesi asıl
//    sestir → silinmez, bağlanır.
// 4) BAĞLAMA grubu: gruptaki kamera videoları + o grubun çapasına düşen harici ses parçaları (+ korunan kamera sesleri).
// 5) KAMERA SESİ KORUNACAK (v0.3.3, kullanıcı kararı): harici sesli grupta harici sesin kapsamadığı > 1 sn'lik aralıklar (çapa içindeki
//    boşluklar, çapa dışına taşan kamera kısımları) için kamera sesi SİLİNMEZ: o aralığı kapsayan, kılavuz sesi olan en iyi kameranın
//    (çapa kuralı: en uzun, eşitlikte alt track) kılavuz sesi YALNIZ o aralığa kesilir, TOPLA'nın ayırdığı "korunan kamera sesi"
//    track'ine (harici kanal track'lerinin hemen altı; kanal başına bir track) konur ve gruba bağlanır. Onayda "KAMERA SESİ KORUNACAK".
//    Kılavuz sesi olan kamera yoksa o aralık "SESSİZ KALACAK" diye listelenir.
// Sahipsizler, park track'lerindekiler ve dokunulmayan öğeler BAĞLA'ya girmez. KAMERASIZ oturumun (ör. Zoom + DJI, kamera yok) sesleri
// de olduğu gibi kalır (çapa yok → kesilmez, silinmez, bağlanmaz; bildirilir).
//
// UXP'de razor yok → parça = createCloneTrackItemAction + set End/Start/In/Out, sonra aslı silinir. Yöntem (tümü AYNI track'te):
//   TX-1 "kesim hazırlığı": her parça için sesin tam boy kopyası sequence sonunun ötesindeki bir PARK YUVASINA (clone, zaman
//        ofseti) + silinecekler ve kesilecek asıllar silinir (tek seçim, ripple=false)
//   TX-2 "ilk parça"      : YALNIZ ilk parçanın park kopyası kırpılır (set End → Start → In → Out) — ÖLÇÜM: tutmazsa DUR
//   TX-3 "parçalar"       : kalan park kopyaları kırpılır
//   TX-4 "yerleştir"      : kırpılmış park kopyaları −(yuva − ses.start) zaman ofsetiyle asıl yerlerine + park kopyaları silinir
// Kırpma sırası End → Start → In → Out: "kenar kırpma", "start taşır" ve "end taşır" anlamlarının üçünde de aynı sonuca varır;
// her yuvanın iki yanındaki boşluk (≥ ses boyu) ara durumda gerçek kliplere / komşu yuvaya taşmayı önler.

import { cmpStart, fileName, where, type Classified } from "./classify";
import { LINK_LIMITS } from "./linker";
import { expOf, type Exp } from "./layout";
import { big, secOf, TICKS_PER_SECOND, type ClipInfo, type Snapshot } from "./model";
import { anchorLess, sessionGroups, unionLength, type Analysis, type Group, type Session } from "./sessions";
import type { Target } from "./settings";

export type { Group };

export interface Piece {
  src: ClipInfo;
  source: string;
  group: Group;
  start: bigint;
  end: bigint;
  inPt: bigint;
  outPt: bigint;
  /** ses tamamen tek çapanın içinde → kesilmez, olduğu gibi kalır (korunan kamera sesinde hep false: track'i değişir) */
  whole: boolean;
  /** son yeri (A track): harici seste kendi track'i, korunan kamera sesinde "korunan kamera sesi" track'i */
  track: number;
  /** korunan kamera sesi parçası (harici sesin olmadığı aralığa kesilmiş kılavuz ses) */
  camera: boolean;
}

/** TOPLA'nın ayırdığı "korunan kamera sesi" track'leri: base, base+1, … (kılavuz kanalı başına). count 0 = eski çerçeve. */
export interface KeptTracks {
  base: number;
  count: number;
}

export interface Cut {
  src: ClipInfo;
  pieces: Piece[];
}

export interface BindPlan {
  groups: Group[];
  pieces: Piece[];
  cuts: Cut[];
  deleteGuides: ClipInfo[];
  deleteSil: ClipInfo[];
  deleteOutside: ClipInfo[];
  /** grubunda tutulan harici ses YOK → kamera sesi korunur ve bağlanır */
  keptGuides: Map<Group, ClipInfo[]>;
  keptSources: string[];
  /** grup.id|kaynak → çapa içindeki harici ses süresi (birleşim, tick) — BAĞLA ÖNCESİ */
  coverage: Map<string, bigint>;
  /** harici sesin kapsamadığı (> 1 sn) ama kılavuz sesi olan kamerası da olmayan yerler — onayda gösterilir */
  silent: string[];
  /** KAMERA SESİ KORUNACAK satırları (harici sesin olmadığı aralıkta kamera sesi kesilip korunan track'e konur) */
  keptCamera: string[];
  /** kamerasız oturumlar: sesleri olduğu gibi kalır */
  camless: Session[];
  errors: string[];
  warnings: string[];
}

/** Bundan kısa sessiz kalan kısım bildirilmez (senkron kenar payı). */
const SILENT_MIN = TICKS_PER_SECOND;

const clampTo = (c: { start: bigint; end: bigint }, g: Group): [bigint, bigint] => {
  const as = big(g.anchor.start);
  const ae = big(g.anchor.end);
  return [c.start > as ? c.start : as, c.end < ae ? c.end : ae];
};

/** [s,e) aralıklarından başka aralıkları çıkarır (sonuç sıralı, ayrık). */
function subtract(from: [bigint, bigint], cut: [bigint, bigint][]): [bigint, bigint][] {
  let out: [bigint, bigint][] = [from];
  for (const [cs, ce] of cut) {
    const next: [bigint, bigint][] = [];
    for (const [s, e] of out) {
      if (ce <= s || cs >= e) next.push([s, e]);
      else {
        if (cs > s) next.push([s, cs]);
        if (ce < e) next.push([ce, e]);
      }
    }
    out = next;
  }
  return out.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
}

export function makeBindPlan(a: Analysis, mapping: Map<string, Target>, kept: KeptTracks = { base: 0, count: 0 }): BindPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const groups: Group[] = [];
  const pieces: Piece[] = [];
  const cuts: Cut[] = [];
  const deleteGuides: ClipInfo[] = [];
  const deleteSil: ClipInfo[] = [];
  const deleteOutside: ClipInfo[] = [];
  const keptGuides = new Map<Group, ClipInfo[]>();
  const keptSet = new Set<string>();
  const coverage = new Map<string, bigint>();
  const silent: string[] = [];
  const keptCamera: string[] = [];
  const camless: Session[] = [];
  if (!a.sessions.length) errors.push("oturum yok (güçlü bağlı kayıt yok) → BAĞLA'nın bağlayacağı bir şey yok");

  for (const session of a.sessions) {
    const gs = sessionGroups(session);
    if (!gs.length) {
      camless.push(session);
      warnings.push(`${session.id} (${session.label}): oturumda kamera yok → sesleri olduğu gibi kalır (kesilmez, silinmez, bağlanmaz)`);
      continue;
    }
    groups.push(...gs);
    const ext: Classified[] = session.recordings.filter((r) => r.kind === "audio").flatMap((r) => r.items.filter((x) => x.role === "external"));
    for (const x of ext.sort((p, q) => cmpStart(p.clip, q.clip))) {
      const w = x.clip;
      if (mapping.get(x.source!) === "sil") {
        deleteSil.push(w);
        continue;
      }
      keptSet.add(x.source!);
      const ws = big(w.start);
      const we = big(w.end);
      const win = big(w.inPt);
      const mine: Piece[] = [];
      for (const g of gs) {
        const [ps, pe] = clampTo({ start: ws, end: we }, g);
        if (pe <= ps) continue;
        mine.push({ src: w, source: x.source!, group: g, start: ps, end: pe, inPt: win + (ps - ws), outPt: win + (pe - ws), whole: ps === ws && pe === we, track: w.track, camera: false });
      }
      if (!mine.length) {
        deleteOutside.push(w);
        continue;
      }
      pieces.push(...mine);
      if (mine.length === 1 && mine[0].whole) continue;
      if (w.speed !== 1) errors.push(`hızı ${w.speed} olan harici ses kesilemez: ${where(w)}`);
      else if (we - ws !== big(w.outPt) - win)
        errors.push(`harici seste süre ≠ kaynak aralığı (end−start=${we - ws}, out−in=${big(w.outPt) - win} tick): ${where(w)}`);
      cuts.push({ src: w, pieces: mine });
    }
    // kamera sesleri: grubunda harici ses varsa sil (harici sesin olmadığı > 1 sn'lik aralıklar hariç: orada kesilip korunur), yoksa
    // koru ve bağla. Kılavuz kanalları asıl track sırasıyla 0, 1, … (korunan track'ler de aynı sırayla)
    const guideOf = (v: ClipInfo) =>
      session.recordings
        .flatMap((r) => r.items)
        .filter((x) => x.role === "guide" && x.clip.projId === v.projId && x.clip.start === v.start && x.clip.end === v.end)
        .map((x) => x.clip)
        .sort((p, q) => p.track - q.track);
    const guideCut = new Map<ClipInfo, Piece[]>();
    for (const g of gs) {
      const ext0 = pieces.filter((p) => p.group === g && !p.camera);
      if (!ext0.length) continue;
      const gaps = subtract([g.start, g.end], ext0.map((p) => [p.start, p.end] as [bigint, bigint]));
      // ≤ 1 sn'lik boşluklar senkron kenar payı sayılır (kamera sesi korunmaz); toplamları 1 sn'yi aşarsa bildirilir
      const small = gaps.filter(([x, y]) => y - x <= SILENT_MIN);
      const smallSum = small.reduce((n, [x, y]) => n + (y - x), 0n);
      if (smallSum > SILENT_MIN)
        silent.push(`${g.id}: ${small.length} kısa boşluk (her biri ≤ 1 sn) toplam ${secOf(smallSum)} sn — senkron kenar payı sayıldı, kamera sesi korunmadı → oralarda ses kalmaz`);
      const as0 = big(g.anchor.start);
      const ae0 = big(g.anchor.end);
      for (const [gs0, ge0] of gaps) {
        if (ge0 - gs0 <= SILENT_MIN) continue; // senkron kenar payı (yukarıda toplamı bildirildi)
        // aralığı kamera sınırlarında böl; her dilimde kılavuzu olan, dilimi kapsayan en iyi kamera (çapa kuralı)
        const pts = [...new Set([gs0, ge0, ...g.cams.flatMap((v) => [big(v.start), big(v.end)]).filter((t) => t > gs0 && t < ge0)])].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
        const segs: { s: bigint; e: bigint; v: ClipInfo | null }[] = [];
        for (let i = 0; i + 1 < pts.length; i++) {
          const [x, y] = [pts[i], pts[i + 1]];
          const cands = g.cams.filter((v) => big(v.start) <= x && big(v.end) >= y && guideOf(v).length);
          const best = cands.length ? cands.reduce((m, c) => (anchorLess(c, m) ? c : m)) : null;
          const last = segs[segs.length - 1];
          if (last && last.v === best && last.e === x) last.e = y;
          else segs.push({ s: x, e: y, v: best });
        }
        for (const sg of segs) {
          // dilim ya çapanın içinde (orada harici ses yok) ya dışında (harici ses çapaya göre kesildiği için oraya ulaşmaz) — dilimler çapa
          // sınırlarında da bölündüğü için ikisi karışmaz
          const why = sg.s >= as0 && sg.e <= ae0 ? "çapa içinde harici ses yok" : "çapa dışında: harici ses çapaya göre kesilir";
          const span = `${secOf(sg.s)}–${secOf(sg.e)} s (${secOf(sg.e - sg.s)} sn, ${why})`;
          if (!sg.v) {
            silent.push(`${g.id}: ${span}; kılavuz sesi olan kamera yok → orada ses kalmaz`);
            continue;
          }
          const gg = guideOf(sg.v);
          if (gg.length > kept.count) {
            errors.push(
              `${g.id}: "${sg.v.name}" ${span} için kamera sesi korunacak ama ${kept.count ? `yalnız ${kept.count} "korunan kamera sesi" track'i var` : `"korunan kamera sesi" track'i yok`} ` +
                `(${gg.length} kanal gerekli) — TOPLA'ya tekrar bas (v0.3.3 track çerçevesi)`
            );
            continue;
          }
          gg.forEach((c, j) => {
            const cs = big(c.start);
            const cin = big(c.inPt);
            const piece: Piece = { src: c, source: "kamera sesi", group: g, start: sg.s, end: sg.e, inPt: cin + (sg.s - cs), outPt: cin + (sg.e - cs), whole: false, track: kept.base + j, camera: true };
            guideCut.set(c, [...(guideCut.get(c) ?? []), piece]);
            pieces.push(piece);
          });
          keptCamera.push(`${g.id}: "${sg.v.name}" ${span} → ${gg.map((_, j) => `A${kept.base + j + 1}`).join("+")}`);
        }
      }
    }
    for (const [c, ps] of guideCut) {
      if (c.speed !== 1) errors.push(`hızı ${c.speed} olan kamera sesi kesilemez: ${where(c)}`);
      else if (big(c.end) - big(c.start) !== big(c.outPt) - big(c.inPt))
        errors.push(`kamera sesinde süre ≠ kaynak aralığı (end−start=${big(c.end) - big(c.start)}, out−in=${big(c.outPt) - big(c.inPt)} tick): ${where(c)}`);
      cuts.push({ src: c, pieces: ps });
    }
    for (const g of gs) {
      const has = pieces.some((p) => p.group === g && !p.camera);
      const gg = g.cams.flatMap((v) => guideOf(v));
      if (has) deleteGuides.push(...gg.filter((c) => !guideCut.has(c))); // kesilenler "kesim" olarak silinir (TX-1)
      else {
        keptGuides.set(g, gg);
        warnings.push(`${g.id} (çapa "${g.anchor.name}"): grupta harici ses yok → kamera sesi korunuyor ve bağlanacak`);
      }
    }
    // bir kameraya bağlı olmayan (yeri farklı) kılavuzlar: harici ses olan oturumda silinir, olmayanda dokunulmaz
    const placed = new Set([...deleteGuides, ...[...keptGuides.values()].flat(), ...guideCut.keys()]);
    const stray = session.recordings.flatMap((r) => r.items).filter((x) => x.role === "guide" && !placed.has(x.clip));
    if (stray.length) {
      if (ext.length) deleteGuides.push(...stray.map((x) => x.clip));
      warnings.push(`${session.id}: ${stray.length} kılavuz ses videosuyla aynı yerde değil (${stray.map((x) => where(x.clip)).join(", ")})`);
    }
    for (const g of gs)
      for (const src of new Set(ext.map((x) => x.source!).filter((k) => mapping.get(k) !== "sil"))) {
        const iv = ext.filter((x) => x.source === src).map((x) => clampTo({ start: big(x.clip.start), end: big(x.clip.end) }, g));
        coverage.set(`${g.id}|${src}`, unionLength(iv));
      }
  }

  if (a.sessions.length && !groups.length) errors.push("hiçbir oturumda kamera yok → BAĞLA'nın bağlayacağı grup yok");
  // yardımcının sınırları (bağlama isteği bunları aşarsa kesmeden SONRA reddedilirdi → şimdi, hiçbir şey değişmeden)
  for (const g of groups) {
    const n = g.cams.length + pieces.filter((p) => p.group === g).length + (keptGuides.get(g)?.length ?? 0);
    if (n > LINK_LIMITS.groupItems) errors.push(`${g.id}: bağlanacak ${n} öğe var, yardımcı en çok ${LINK_LIMITS.groupItems} kabul ediyor`);
  }
  for (const c of [...groups.flatMap((g) => g.cams), ...pieces.map((p) => p.src)])
    if (fileName(c).length > LINK_LIMITS.name) errors.push(`kaynak adı çok uzun (${fileName(c).length} > ${LINK_LIMITS.name}): ${where(c)}`);

  return { groups, pieces, cuts, deleteGuides, deleteSil, deleteOutside, keptGuides, keptSources: [...keptSet], coverage, silent, keptCamera, camless, errors, warnings };
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

const ceil = (x: bigint, frame: bigint | null) => (!frame || x % frame === 0n ? x : x + (frame - (x % frame)));

/**
 * Her parça için WAV'ın AYNI track'inde, P'den sonra ardışık park yuvaları. Her yuvanın İKİ yanında da ≥ WAV boyu boşluk bırakılır
 * (ilk yuvanın önünde de): set action'ların anlamı ölçülmedi — "end klibi taşır" ise kopya sola, "start klibi taşır" ise sağa en
 * çok bir WAV boyu kayabilir; boşluk bu durumda da gerçek kliplere ve komşu yuvaya değmemesini sağlar.
 * frame: yuva başlangıçları kare sınırına yukarı yuvarlanır (null → yuvarlama yok).
 */
export function makeSlots(plan: BindPlan, P: bigint, frame: bigint | null = null): Slot[] {
  const cursor = new Map<number, bigint>(); // track → bir sonraki yuvanın en erken sol kenarı (önündeki boşluk dahil)
  const slots: Slot[] = [];
  for (const cut of plan.cuts.slice().sort((a, b) => a.src.track - b.src.track || cmpStart(a.src, b.src))) {
    const L = big(cut.src.end) - big(cut.src.start);
    for (const p of cut.pieces) {
      const q = ceil((cursor.get(cut.src.track) ?? P) + L, frame);
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
  return new Set([...plan.deleteGuides, ...plan.deleteSil, ...plan.deleteOutside, ...plan.cuts.map((c) => c.src)]);
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

/**
 * KES'ten sonra BEKLENEN düzenin klipleri (asıl ClipInfo kopyaları; kesilen seslerin yerine parçaları) — yardımcıyla ortak "düzenden
 * gruplar" kuralını (sessions.groupsFromLayout) KES'TEN ÖNCE, hiçbir şey değişmeden sınamak için.
 */
export function expectedFinalClips(s0: Snapshot, plan: BindPlan): ClipInfo[] {
  const gone = removedSet(plan);
  const out = s0.clips.filter((c) => !gone.has(c));
  for (const cut of plan.cuts)
    for (const p of cut.pieces) out.push({ ...cut.src, track: p.track, start: String(p.start), end: String(p.end), inPt: String(p.inPt), outPt: String(p.outPt) });
  return out;
}

export function expectBindFinal(s0: Snapshot, plan: BindPlan): Exp[] {
  const gone = removedSet(plan);
  const exp = s0.clips.filter((c) => !gone.has(c)).map((c) => expOf(c));
  for (const cut of plan.cuts)
    for (const p of cut.pieces) exp.push(expOf(cut.src, { track: p.track, start: p.start, end: p.end, inPt: p.inPt, outPt: p.outPt }));
  return exp;
}

/**
 * BAĞLA sonrası içerik doğrulaması (tick düzeyinde karşılaştırmaya EK, okunur rapor için):
 *  - her grubun her tutulan kaynağının çapa içindeki ses süresi öncekiyle aynı (hiçbir çapa içinde boşluk kalmadı)
 *  - her harici klipte (in − start) kaynağıyla aynı (parça kaynağın doğru yerini çalıyor)
 *  - her harici parça KENDİ oturumunun bir çapasının içinde (başka oturumun kamerasına kesilmedi)
 * @param fin son düzen; @param extFinal son düzendeki harici klipler (park bölgesi hariç) ve ait oldukları oturum kimliği
 */
export function verifyBindContent(plan: BindPlan, extFinal: { clip: ClipInfo; source: string; sessionId: string | null }[]): string[] {
  const problems: string[] = [];
  const kept = extFinal.filter((x) => plan.keptSources.includes(x.source));
  for (const g of plan.groups)
    for (const src of plan.keptSources) {
      if (!plan.coverage.has(`${g.id}|${src}`)) continue;
      const before = plan.coverage.get(`${g.id}|${src}`) ?? 0n;
      const after = unionLength(kept.filter((x) => x.source === src).map((x) => clampTo({ start: big(x.clip.start), end: big(x.clip.end) }, g)));
      if (after !== before) problems.push(`${g.id} çapası "${g.anchor.name}" içinde ${src} sesi ${before} tick idi, şimdi ${after} tick (fark ${before - after})`);
    }
  const srcOffset = new Map<string, Set<bigint>>();
  const allow = (c: ClipInfo) => {
    const k = c.projId + "|" + c.track;
    srcOffset.set(k, (srcOffset.get(k) ?? new Set<bigint>()).add(big(c.inPt) - big(c.start)));
  };
  for (const cut of plan.cuts) allow(cut.src);
  for (const p of plan.pieces) if (p.whole) allow(p.src);
  for (const x of kept) {
    const want = srcOffset.get(x.clip.projId + "|" + x.clip.track);
    const got = big(x.clip.inPt) - big(x.clip.start);
    if (want !== undefined && !want.has(got)) problems.push(`${where(x.clip)}: kaynak kayması (in − start) ${got}, beklenen ${[...want].join(" / ")}`);
    const own = plan.groups.filter((g) => g.session.id === x.sessionId);
    const inside = own.some((g) => big(x.clip.start) >= big(g.anchor.start) && big(x.clip.end) <= big(g.anchor.end));
    if (!inside) problems.push(`${where(x.clip)} kendi oturumunun (${x.sessionId ?? "?"}) hiçbir çapasının içinde değil`);
  }
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

/** Her grubun bağlanacak öğeleri — plan DEĞERLERİNDEN (son düzen compareLayout ile birebir doğrulandıktan sonra kullanılır). */
export function linkTargets(plan: BindPlan): { group: Group; items: LinkTarget[]; label: string }[] {
  return plan.groups.map((g) => {
    const lt: LinkTarget[] = [];
    for (const c of g.cams.slice().sort(cmpStart)) lt.push({ kind: "V", track: c.track, start: c.start, end: c.end, name: fileName(c) });
    for (const c of plan.keptGuides.get(g) ?? []) lt.push({ kind: "A", track: c.track, start: c.start, end: c.end, name: fileName(c) });
    for (const p of plan.pieces.filter((q) => q.group === g).sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : x.track - y.track)))
      lt.push({ kind: "A", track: p.track, start: String(p.start), end: String(p.end), name: fileName(p.src) });
    const nCam = g.cams.length;
    const nG = plan.keptGuides.get(g)?.length ?? 0;
    const nK = plan.pieces.filter((q) => q.group === g && q.camera).length;
    return {
      group: g,
      items: lt,
      label: `${g.id} (${nCam} kamera + ${lt.length - nCam - nG - nK} harici ses${nK ? ` + ${nK} korunan kamera sesi` : ""}${nG ? ` + ${nG} kamera sesi` : ""}; çapa "${g.anchor.name}")`,
    };
  });
}
