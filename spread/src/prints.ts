// Timeline parmak izleri (v1.2.1) — SAF (Premiere çağrısı yok). records.ts (kayıt ↔ canlı timeline) ve guard.ts (yarım iş) kullanır.

import type { Snapshot } from "./model";

function hash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16)}:${h2.toString(16)}`;
}

/** Tam parmak izi: klip sayısı + klip başına (kaynak, tür, track, start, end, in, out) — sırasız. */
export function fingerprint(s: Snapshot): string {
  const keys = s.clips.map((c) => [c.projId, c.projName, c.kind, c.track, c.start, c.end, c.inPt, c.outPt].join("|")).sort();
  return `${s.clips.length}:${hash(keys.join("\n"))}`;
}

/** Yerleşim parmak izi: klip sayısı + klip başına (kaynak, tür, track) — zamanlar HARİÇ (Synchronize bunu değiştirmez). */
export function trackPrint(s: Snapshot): string {
  const keys = s.clips.map((c) => [c.projId, c.projName, c.kind, c.track].join("|")).sort();
  return `${s.clips.length}:${hash(keys.join("\n"))}`;
}

/**
 * Çok adımlı bir işlemin ARA hâli: o adımdan sonraki timeline'ın tam parmak izi + işlemin başındaki hâle dönmek için gereken Ctrl+Z
 * sayısı. Kısmi Ctrl+Z (ör. Dağıt'ın 3 adımından yalnız 1'i geri alındı) böylece tanınır: kamera klipleri o anda eksik olabilir →
 * işlem "normal" çalışmaz, SORAR ve kaç Ctrl+Z daha gerektiğini söyler.
 */
export interface Mid {
  fp: string;
  left: number;
}

/** İşlem boyunca doğrulanmış her ara hâli toplar. */
export class Trail {
  readonly mids: Mid[] = [];
  note(s: Snapshot, left: number): void {
    if (left > 0) this.mids.push({ fp: fingerprint(s), left });
  }
  /** son (işlemin bitişindeki) hâl hariç ara hâller */
  between(total: number): Mid[] {
    return this.mids.filter((m) => m.left > 0 && m.left < total);
  }
}
