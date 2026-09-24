// GÜVENLİK KİLİDİ: panel yalnızca adı "PROBE_" ile başlayan AKTİF sequence üzerinde çalışır.
// Her test requireProbe() ile başlar ve her düzenlemeden hemen önce assertStillProbe() çağırır.
// Butonların kilitlenmesi yalnızca görsel; asıl kilit bu dosyadaki kontrollerdir.

import { ppro } from "./ppro";
import type { Project, Sequence } from "./ppro";

export const PROBE_PREFIX = "PROBE_";

export class ProbeLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeLockError";
  }
}

export interface ProbeContext {
  project: Project;
  sequence: Sequence;
  guid: string;
  name: string;
}

export function isProbeName(name: unknown): boolean {
  return typeof name === "string" && name.startsWith(PROBE_PREFIX);
}

export async function getActive(): Promise<{
  project: Project | null;
  sequence: Sequence | null;
}> {
  const project = await ppro.Project.getActiveProject(); // d.ts:L2414 ProjectStatic.getActiveProject
  if (!project) return { project: null, sequence: null };
  const sequence = await project.getActiveSequence(); // d.ts:L2493 Project.getActiveSequence
  return { project, sequence: sequence ?? null };
}

export function sequenceGuid(sequence: Sequence): string {
  return sequence.guid.toString(); // d.ts:L3273 Sequence.guid, d.ts:L1834 Guid.toString
}

export function sequenceName(sequence: Sequence): string {
  return sequence.name; // d.ts:L3279 Sequence.name
}

/** Aktif sequence PROBE_ değilse ProbeLockError fırlatır. Tek giriş noktası budur. */
export async function requireProbe(): Promise<ProbeContext> {
  const { project, sequence } = await getActive();
  if (!project) throw new ProbeLockError("Açık bir proje yok.");
  if (!sequence) throw new ProbeLockError("Aktif (açık) bir sequence yok.");
  const name = sequenceName(sequence);
  if (!isProbeName(name)) {
    throw new ProbeLockError(
      `Aktif sequence "${name}" — adı "${PROBE_PREFIX}" ile başlamıyor. Test KİLİTLİ, hiçbir şey yapılmadı.`
    );
  }
  return { project, sequence, guid: sequenceGuid(sequence), name };
}

/**
 * Her transaction / seçim değişikliğinden hemen önce çağrılır:
 *  - elimizdeki sequence hâlâ PROBE_ adlı mı,
 *  - kullanıcı test sırasında başka sequence'a geçmedi mi (aktif guid aynı mı).
 * Biri tutmazsa ProbeLockError ile durur.
 */
export async function assertStillProbe(ctx: ProbeContext): Promise<void> {
  const heldName = sequenceName(ctx.sequence);
  if (!isProbeName(heldName)) {
    throw new ProbeLockError(
      `Sequence adı test sırasında "${heldName}" oldu (PROBE_ değil). Güvenlik için durduruldu.`
    );
  }
  const { project, sequence } = await getActive();
  if (!project || !sequence || sequenceGuid(sequence) !== ctx.guid) {
    throw new ProbeLockError(
      "Test sırasında aktif sequence değişti. Güvenlik için durduruldu; PROBE_ sequence'ı tekrar aktif yapıp yeniden deneyin."
    );
  }
}
