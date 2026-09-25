// Aktif sequence bağlamı. PROBE_ kilidi Spread'de YOK; yerine: onay + yedek + her transaction sonrası doğrulama.
// Ek güvenlik: bir Spread koşusu başladığı sequence'a SABİTLENİR; kullanıcı arada başka sequence'a geçerse durur.

import { ppro } from "./ppro";
import type { Project, Sequence } from "./ppro";

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

export interface SeqContext {
  project: Project;
  sequence: Sequence;
  guid: string;
  name: string;
}

export function sequenceGuid(sequence: Sequence): string {
  return sequence.guid.toString(); // d.ts:L3273 Sequence.guid, d.ts:L1834 Guid.toString
}

export function sequenceName(sequence: Sequence): string {
  return sequence.name; // d.ts:L3279 Sequence.name
}

export async function getActive(): Promise<{ project: Project | null; sequence: Sequence | null }> {
  const project = await ppro.Project.getActiveProject(); // d.ts:L2414 ProjectStatic.getActiveProject
  if (!project) return { project: null, sequence: null };
  const sequence = await project.getActiveSequence(); // d.ts:L2493 Project.getActiveSequence
  return { project, sequence: sequence ?? null };
}

export async function requireActive(): Promise<SeqContext> {
  const { project, sequence } = await getActive();
  if (!project) throw new SessionError("Açık bir proje yok.");
  if (!sequence) throw new SessionError("Aktif (açık) bir sequence yok — timeline'a bir kez tıkla.");
  return { project, sequence, guid: sequenceGuid(sequence), name: sequenceName(sequence) };
}

/** Her transaction / seçim değişikliğinden hemen önce: kullanıcı başka sequence'a geçmediyse devam. */
export async function assertSameSequence(ctx: SeqContext): Promise<void> {
  const { project, sequence } = await getActive();
  if (!project || !sequence || sequenceGuid(sequence) !== ctx.guid) {
    throw new SessionError(
      `İşlem sırasında aktif sequence değişti (başlangıç: "${ctx.name}"). Güvenlik için durduruldu.`
    );
  }
}
