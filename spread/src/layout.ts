// Beklenen düzen ↔ okunan düzen karşılaştırması — SAF (TOPLA / BAĞLA doğrulaması).
// Her transaction'dan sonra timeline baştan okunur ve BEKLENEN klip kümesiyle birebir (tick düzeyinde) karşılaştırılır:
// eksik / fazla / farklı her klip bir "sorun"dur → çağıran DURUR. Kendi başına düzeltme yok.

import { big, secOf, trackLabel, type ClipInfo, type Kind, type Snapshot } from "./model";

export interface Exp {
  kind: Kind;
  track: number;
  start: bigint;
  end: bigint;
  inPt: bigint;
  outPt: bigint;
  speed: number;
  projId: string;
  label: string;
}

export function expOf(c: ClipInfo, patch: Partial<Exp> = {}): Exp {
  return {
    kind: c.kind,
    track: c.track,
    start: big(c.start),
    end: big(c.end),
    inPt: big(c.inPt),
    outPt: big(c.outPt),
    speed: c.speed,
    projId: c.projId,
    label: c.name,
    ...patch,
  };
}

export const expKey = (e: Exp): string => [e.kind, e.track, e.start, e.end, e.inPt, e.outPt, e.speed, e.projId].join("|");

const fmtExp = (e: Exp) => `${trackLabel(e.kind, e.track)} "${e.label}" [${secOf(e.start)}s–${secOf(e.end)}s] in=${e.inPt} out=${e.outPt}`;

function diff(want: Exp, got: Exp): string {
  const parts: string[] = [];
  if (want.track !== got.track) parts.push(`track ${trackLabel(want.kind, want.track)} yerine ${trackLabel(got.kind, got.track)}`);
  for (const f of ["start", "end", "inPt", "outPt"] as const)
    if (want[f] !== got[f]) parts.push(`${f}: beklenen=${want[f]} okunan=${got[f]} (fark ${got[f] - want[f]} tick)`);
  if (want.speed !== got.speed) parts.push(`hız: beklenen=${want.speed} okunan=${got.speed}`);
  return parts.join("; ");
}

/** Beklenen kümeyle okunan kümeyi birebir karşılaştırır. Boş dizi = birebir aynı. */
export function compareLayout(expected: Exp[], snap: Snapshot): string[] {
  const problems: string[] = [];
  for (const w of snap.warnings) problems.push(`okuma uyarısı: ${w}`);
  const pool = new Map<string, Exp[]>();
  const got = snap.clips.map((c) => expOf(c));
  for (const g of got) pool.set(expKey(g), [...(pool.get(expKey(g)) ?? []), g]);
  const missing: Exp[] = [];
  for (const e of expected) {
    const list = pool.get(expKey(e));
    if (list && list.length) list.pop();
    else missing.push(e);
  }
  const extra = [...pool.values()].flat();
  if (snap.clips.length !== expected.length) problems.push(`klip sayısı: beklenen ${expected.length}, okunan ${snap.clips.length}`);
  for (const m of missing) {
    // en yakın aday: aynı kaynak + aynı tür, tercihen aynı track
    const cand = extra
      .filter((x) => x.kind === m.kind && x.projId === m.projId)
      .sort((a, b) => Number(a.track !== m.track) - Number(b.track !== m.track) || Number(abs(a.start - m.start) - abs(b.start - m.start)))[0];
    if (cand) {
      extra.splice(extra.indexOf(cand), 1);
      problems.push(`${fmtExp(m)} tutmadı → ${diff(m, cand)}`);
    } else problems.push(`beklenen klip yok: ${fmtExp(m)}`);
  }
  for (const x of extra) problems.push(`beklenmeyen klip: ${fmtExp(x)}`);
  return problems;
}

const abs = (x: bigint) => (x < 0n ? -x : x);

export interface OvItem {
  kind: Kind;
  track: number;
  start: bigint;
  end: bigint;
  label: string;
}

/** Aynı track'te zamanda çakışan klipler (bitiş = başlangıç çakışma değil). why(a, b) → rapora eklenecek açıklama. */
export function overlapsIn<T extends OvItem>(clips: T[], why?: (a: T, b: T) => string): string[] {
  const byTrack = new Map<string, T[]>();
  for (const c of clips) byTrack.set(`${c.kind}|${c.track}`, [...(byTrack.get(`${c.kind}|${c.track}`) ?? []), c]);
  const out: string[] = [];
  for (const list of byTrack.values()) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const s = a.start > b.start ? a.start : b.start;
        const e = a.end < b.end ? a.end : b.end;
        if (e > s)
          out.push(
            `${trackLabel(a.kind, a.track)}: "${a.label}" [${secOf(a.start)}s–${secOf(a.end)}s] ↔ "${b.label}" [${secOf(b.start)}s–${secOf(b.end)}s] ` +
              `zamanda çakışıyor (${secOf(e - s)} sn)${why ? why(a, b) : ""}`
          );
      }
  }
  return out;
}

/** Okunan düzende beklenen değerlere birebir uyan klibi bulur (park kopyalarını yeniden bulmak için). */
export function findExp(snap: Snapshot, e: Exp, taken: Set<ClipInfo> = new Set()): ClipInfo | null {
  const k = expKey(e);
  return snap.clips.find((c) => !taken.has(c) && expKey(expOf(c)) === k) ?? null;
}

/** Okunan düzendeki aynı-track çakışmaları. */
export function snapshotOverlaps(snap: Snapshot): string[] {
  return overlapsIn(snap.clips.map((c) => ({ kind: c.kind, track: c.track, start: big(c.start), end: big(c.end), label: c.name })));
}
