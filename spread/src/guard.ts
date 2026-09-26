// Ortak güvenlik katmanı (SPREAD / TOPLA / BAĞLA). Spread v0.2.0'daki kurallar AYNEN:
//   - onay penceresi; önce yedek sequence (yoksa BAŞLAMAZ; içeriği aslıyla aynı olmalı; yedek aktif olursa asıla dönülür)
//   - her transaction'dan sonra baştan okuma + doğrulama; tutmazsa DUR (kendi başına düzeltme yok)
//   - Ctrl+Z sayısı ÖLÇÜLEREK tutulur (hata / false dönen transaction yalnız timeline gerçekten değiştiyse sayılır)
//   - adımlar arasında timeline beklenen hâlde mi (kullanıcı Ctrl+Z / düzenleme) → değilse DUR
//   - yeni track gerekiyorsa KANITLI yöntem (clone ofseti, hedef = mevcut track sayısı, yardımcılar sequence sonunun ötesine park)

import { transact } from "./edit";
import {
  big,
  errText,
  fmtClip,
  invalidateRefs,
  keyFull,
  secOf,
  settle,
  sleep,
  snapshot,
  ticks,
  tt,
  TICKS_PER_SECOND,
  type ClipInfo,
  type Snapshot,
} from "./model";
import { getActive, sequenceGuid, sequenceName, SessionError, type SeqContext } from "./session";
import { ask, log, type Answer } from "./ui";
import { verifyTracks } from "./verify";
import type { Sequence } from "./ppro";

export class SpreadStop extends Error {
  /** true → kullanıcı adımlar arasında timeline'ı değiştirdi; "Ctrl+Z × N" söylenmez, yedek önerilir */
  public unreliableCount = false;
  constructor(message: string, public details: string[] = []) {
    super(message);
    this.name = "SpreadStop";
  }
}

export async function askUser(q: string): Promise<Answer> {
  const a = await ask(q);
  invalidateRefs(); // kullanıcı timeline'da bir şey yapmış olabilir
  return a;
}

/** Park yeri: sequence sonunun (getEndTime ve en büyük klip sonu) 10 sn ötesi. */
export const PARK_GAP = 10n * TICKS_PER_SECOND;

/**
 * Sequence'ın kare süresi (tick). getTimebase Probe'da sınanmadı → okunamazsa / anlamsızsa null (hizalama atlanır).
 * (ExtendScript'teki karşılığı Sequence.timebase = "kare başına tick" dizesi.)
 */
export async function frameTicks(ctx: SeqContext): Promise<bigint | null> {
  try {
    const tb = await ctx.sequence.getTimebase(); // d.ts:L3231 Sequence.getTimebase
    const n = big(String(tb).trim());
    return n > 0n && n <= TICKS_PER_SECOND ? n : null;
  } catch {
    return null;
  }
}

/** x'i kare sınırına YUKARI yuvarlar (frame null → olduğu gibi). */
export function ceilTo(x: bigint, frame: bigint | null): bigint {
  if (!frame) return x;
  const r = x % frame;
  return r === 0n ? x : x + (frame - r);
}

export async function parkBase(ctx: SeqContext, s: Snapshot): Promise<bigint> {
  const seqEnd = big(tt(await ctx.sequence.getEndTime()).ticks); // d.ts:L3181 Sequence.getEndTime
  const lastClip = s.clips.reduce((m, c) => (big(c.end) > m ? big(c.end) : m), 0n);
  // kare hizalı: kare hizalı klipler (kameralar) park yerinde de kare sınırında kalsın
  return ceilTo((seqEnd > lastClip ? seqEnd : lastClip) + PARK_GAP, await frameTicks(ctx));
}

export function multisetEqual(a: Snapshot, b: Snapshot): boolean {
  const ka = a.clips.map(keyFull).sort();
  const kb = b.clips.map(keyFull).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

export type TxBuild = Parameters<typeof transact>[2];
export type TxOut = Awaited<ReturnType<typeof transact>>;

/**
 * Transaction'ı çalıştırır ve "yapılan adımlar"a yazar. Hata verirse: önce/sonra karşılaştırıp Premiere'in kısmen uygulayıp
 * uygulamadığını ÖLÇER (Ctrl+Z sayısı doğru söylensin), sonra DURUR.
 */
export async function runTx(ctx: SeqContext, executed: string[], label: string, undoName: string, build: TxBuild): Promise<TxOut> {
  const pre = await snapshot(ctx); // yalnız karşılaştırma için değerler (kuşak değişmez)
  const measure = async () => {
    await settle();
    const now = await snapshot(ctx);
    return !multisetEqual(pre, now) || now.vCount !== pre.vCount || now.aCount !== pre.aCount;
  };
  let r: TxOut;
  try {
    r = await transact(ctx, undoName, build);
  } catch (e) {
    const changed = await measure();
    if (changed) executed.push(`${label} (hata verdi, kısmen uygulanmış)`);
    throw new SpreadStop(`"${label}" adımı hata verdi: ${errText(e)}${changed ? "" : " (timeline değişmedi)"}`);
  }
  if (!r.ok) {
    // executeTransaction false: undo kaydı oluşmamış olabilir → ancak timeline değiştiyse say (Ctrl+Z sayısı doğru kalsın)
    const changed = await measure();
    if (changed) executed.push(`${label} (false döndü, kısmen uygulanmış)`);
    throw new SpreadStop(`"${label}" adımı başarısız (executeTransaction → false)${changed ? "" : " — timeline değişmedi"}.`);
  }
  executed.push(label);
  log(`   executeTransaction → ${r.ok}; addAction ${r.addResults.filter(Boolean).length}/${r.addResults.length}`, "dim");
  return r;
}

/**
 * İki adım arasında timeline'ın beklenen hâlde olduğunu doğrular (kullanıcı arada Ctrl+Z / düzenleme yaptıysa DUR).
 * Son adım geri alınmışsa (timeline adım öncesine dönmüş) o adım "yapılanlar"dan düşülür → Ctrl+Z sayısı doğru kalır.
 */
export async function expectState(ctx: SeqContext, expected: Snapshot, beforeLast: Snapshot | null, executed: string[]): Promise<void> {
  const now = await snapshot(ctx);
  const same = (a: Snapshot, b: Snapshot) => multisetEqual(a, b) && a.vCount === b.vCount && a.aCount === b.aCount;
  if (same(expected, now)) return;
  if (beforeLast && same(beforeLast, now)) {
    const undone = executed.pop();
    throw new SpreadStop(`Adımlar arasında timeline değişti: "${undone}" adımı geri alınmış görünüyor. Güvenlik için durduruldu.`);
  }
  const stop = new SpreadStop("Adımlar arasında timeline değişti (kullanıcı düzenlemesi?). Güvenlik için durduruldu.");
  stop.unreliableCount = true;
  throw stop;
}

// ------------------------------------------------------------------ yedek
/** @param op kullanıcıya gösterilen işlem adı ("Spread", "TOPLA", "BAĞLA") — "… BAŞLAMADI" mesajlarında */
export async function makeBackup(ctx: SeqContext, op: string): Promise<{ name: string; guid: string }> {
  const before = await ctx.project.getSequences(); // d.ts:L2520 Project.getSequences
  const ids = new Set(before.map(sequenceGuid));
  const tx = await transact(ctx, `${op}: yedek sequence`, (ops) => {
    ops.cloneSequence();
  });
  let fresh: Sequence[] = [];
  for (let i = 0; i < 10 && fresh.length === 0; i++) {
    await sleep(300);
    const after = await ctx.project.getSequences(); // d.ts:L2520 Project.getSequences
    fresh = after.filter((s) => !ids.has(sequenceGuid(s)));
  }
  if (fresh.length !== 1)
    throw new SpreadStop(`Yedek sequence oluşmadı (executeTransaction → ${tx.ok}, yeni sequence: ${fresh.length}). ${op} BAŞLAMADI, timeline'a dokunulmadı.`);
  const backup = { name: sequenceName(fresh[0]), guid: sequenceGuid(fresh[0]) };
  // Yedeğin İÇERİĞİ aslıyla aynı mı (salt okuma) — her DUR mesajı kullanıcıyı buna yönlendiriyor
  const orig = await snapshot(ctx);
  const copy = await snapshot({ ...ctx, sequence: fresh[0], guid: backup.guid, name: backup.name });
  if (!multisetEqual(orig, copy))
    throw new SpreadStop(
      `Yedek "${backup.name}" oluştu ama içeriği aslıyla aynı değil (asıl ${orig.clips.length} klip, yedek ${copy.clips.length}). ${op} BAŞLAMADI, timeline'a dokunulmadı.`
    );
  log(`✓ Yedek oluştu ve içeriği aslıyla aynı: "${backup.name}" (${copy.clips.length} klip)`, "ok");

  const { sequence: active } = await getActive();
  const activeGuid = active ? sequenceGuid(active) : null;
  if (activeGuid !== ctx.guid) {
    if (activeGuid !== backup.guid)
      throw new SpreadStop(`Yedek alınırken aktif sequence değişti (yedek değil, başka bir sequence). ${op} BAŞLAMADI.`);
    log("Yedek aktif oldu → asıl sequence'a dönülüyor…", "warn");
    const back = await ctx.project.setActiveSequence(ctx.sequence); // d.ts:L2590 Project.setActiveSequence
    const { sequence: now } = await getActive();
    if (!back || !now || sequenceGuid(now) !== ctx.guid)
      throw new SpreadStop(`Yedek aktif oldu ve asıl sequence'a dönülemedi (setActiveSequence → ${String(back)}). ${op} BAŞLAMADI.`);
    log(`✓ Asıl sequence "${ctx.name}" tekrar aktif.`, "ok");
  }
  return backup;
}

// ------------------------------------------------------------------ track hazırlığı (TX-A)
/**
 * Gereken track'leri KANITLI yöntemle açar: her yeni track için bir geçici yardımcı kopya, hedef index = o anki track sayısı,
 * sequence sonunun ötesine park. Doğrular (asıllar birebir, her yeni track'te tam 1 yardımcı, yardımcılar park yerinde).
 * Yardımcılar sonraki transaction'da silinmelidir.
 */
export async function prepareTracks(
  ctx: SeqContext,
  s1: Snapshot,
  neededV: number,
  neededA: number,
  executed: string[],
  undoName: string
): Promise<{ helpers: ClipInfo[]; after: Snapshot }> {
  const newV = Math.max(0, neededV - s1.vCount);
  const newA = Math.max(0, neededA - s1.aCount);
  const hv = s1.clips.find((c) => c.kind === "V") ?? null;
  const ha = s1.clips.find((c) => c.kind === "A") ?? null;
  if ((newV && !hv) || (newA && !ha)) throw new SpreadStop("Track açmak için kopyalanacak klip yok.");
  const park = await parkBase(ctx, s1);
  log(`TX-A: ${newV} video + ${newA} ses track'i clone ofsetiyle açılıyor (yardımcılar ${secOf(park)}s'ye park edilir).`);
  await runTx(ctx, executed, "track hazırlığı", undoName, (ops) => {
    for (let t = s1.vCount; t < neededV; t++) ops.clone(hv!, ticks(park - big(hv!.start)), t - hv!.track, 0);
    for (let t = s1.aCount; t < neededA; t++) ops.clone(ha!, ticks(park - big(ha!.start)), 0, t - ha!.track);
  });
  await settle();
  const s2 = await snapshot(ctx);
  const probs = verifyTracks(s1, s2, neededV, neededA, { V: newV, A: newA });
  for (const w of s2.warnings) probs.push(`okuma uyarısı: ${w}`);
  const extra = s2.clips.filter((c) => !s1.clips.some((o) => keyFull(o) === keyFull(c)));
  for (const c of extra) if (big(c.start) < park) probs.push(`yardımcı park yerinde değil: ${fmtClip(c)}`);
  if (probs.length) throw new SpreadStop("Track hazırlığı beklendiği gibi olmadı.", probs);
  log(`✓ TX-A doğrulandı: V ${s1.vCount}→${s2.vCount}, A ${s1.aCount}→${s2.aCount}; asıllar birebir duruyor.`, "ok");
  return { helpers: extra, after: s2 };
}

// ------------------------------------------------------------------ DUR raporu
/** @param op "SPREAD" / "TOPLA" / "BAĞLA" */
export function reportStop(op: string, e: unknown, executed: string[], backupName: string | null, extra: string[] = []): void {
  const stop = e instanceof SpreadStop ? e : null;
  const msg = stop ? stop.message : e instanceof SessionError ? e.message : `Beklenmeyen hata: ${errText(e)}`;
  log(`✗ ${op} DURDU: ${msg}`, "err");
  for (const d of stop?.details ?? []) log(`   • ${d}`, "err");
  if (executed.length && stop?.unreliableCount) {
    log(`Yapılan adımlar (${executed.length}): ${executed.join(", ")}.`, "warn");
    log(
      `Timeline arada başka biçimde de değiştiği için Ctrl+Z sayısı GÜVENİLİR DEĞİL — yedek sequence "${backupName ?? "?"}"i kullan. ` +
        "Panel kendi başına düzeltme yapmaz.",
      "warn"
    );
  } else if (executed.length) {
    log(`Yapılan adımlar (${executed.length}): ${executed.join(", ")}.`, "warn");
    log(
      `Geri almak için: timeline'a tıkla ve Ctrl+Z'ye ${executed.length} kez bas — ya da yedek sequence "${backupName ?? "?"}"i kullan. ` +
        "Panel kendi başına düzeltme yapmaz.",
      "warn"
    );
  } else if (backupName) {
    log(`Timeline'da değişiklik yapılmadı. (Yedek "${backupName}" oluştu; silebilirsin.)`, "warn");
  } else {
    log("Timeline'da değişiklik yapılmadı.", "warn");
  }
  for (const x of extra) log(x, "warn");
}

// ------------------------------------------------------------------ yarım kalmış iş koruması
// TOPLA / BAĞLA bir adımdan sonra DURURSA timeline'ın o anki hâli (klip kümesinin özeti) localStorage'da saklanır. Kullanıcı geri
// almadan tekrar basarsa (timeline hâlâ birebir o hâlde) işlem BAŞLAMAZ: aksi hâlde park kopyaları "çapa dışı ses" sanılıp silinebilir,
// ya da yarım düzen yeni bir yedeğe kopyalanır. localStorage yoksa koruma sessizce devre dışıdır (panel çökmez).
const STOP_KEY = "spread.stoppedState.v1";

function digest(s: Snapshot): string {
  const text = s.clips.map(keyFull).sort().join("\n") + `|${s.vCount}|${s.aCount}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x5bd1e995) >>> 0;
  }
  return `${text.length}:${h1.toString(16)}:${h2.toString(16)}`;
}

export async function rememberStopped(ctx: SeqContext, op: string): Promise<void> {
  try {
    const s = await snapshot(ctx);
    window.localStorage.setItem(STOP_KEY, JSON.stringify({ guid: ctx.guid, op, digest: digest(s) }));
  } catch {
    /* koruma yok */
  }
}

export function forgetStopped(): void {
  try {
    window.localStorage.removeItem(STOP_KEY);
  } catch {
    /* yoksa geç */
  }
}

/** Timeline, önceki bir DURDU'nun bıraktığı hâlde mi → öyleyse SpreadStop. */
export function assertNotStopped(ctx: SeqContext, s: Snapshot, op: string): void {
  interface Rec {
    guid?: string;
    op?: string;
    digest?: string;
  }
  let rec: Rec | null;
  try {
    const raw = window.localStorage.getItem(STOP_KEY);
    rec = raw ? (JSON.parse(raw) as Rec) : null;
  } catch {
    return;
  }
  if (rec && rec.guid === ctx.guid && rec.digest === digest(s))
    throw new SpreadStop(
      `Timeline, önceki ${rec.op ?? "işlem"} durduğunda kalan YARIM hâlde (geri alınmamış). ${op} BAŞLAMADI, hiçbir şey değişmedi. ` +
        "Önce geri al (DURDU mesajındaki kadar Ctrl+Z) ya da yedek sequence'ı kullan, sonra tekrar bas."
    );
}
