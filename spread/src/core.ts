// Saf zaman / etiket yardımcıları — Premiere API'si YOK. Kimlik → sınıflama → oturum/grup zinciri (identity, classify, sessions)
// yalnız bunları kullanır; böylece aynı modül yardımcı panele de (cep-helper/js/spread-core.js) derlenebilir. model.ts yeniden dışa aktarır.

import type { Kind } from "./model";

export const TICKS_PER_SECOND = 254016000000n;

export function big(t: string): bigint {
  try {
    return BigInt(t);
  } catch {
    return 0n;
  }
}

export function secOf(t: string | bigint): string {
  const b = typeof t === "bigint" ? t : big(t);
  return (Number(b) / Number(TICKS_PER_SECOND)).toFixed(3);
}

export function trackLabel(kind: Kind, track: number): string {
  return `${kind}${track + 1}`;
}
