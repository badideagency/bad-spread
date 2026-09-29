// SEQUENCE KAYITLARI (v1.2.1) — "KAYIT İPUCUDUR, KİLİT DEĞİLDİR. Tek gerçek canlı timeline'dır."
//
// Sequence'a (GUID) bağlı kayıtlar ve her birinin timeline'la karşılaştırılan parmak izi:
//   adım işaretleri   spread.steps.v1        fp = işlem sonundaki timeline (klip sayısı + klip başına kaynak/tür/track/start/end/in/out)
//                                            tp = aynısı zamanlar HARİÇ (kaynak/tür/track) — Dağıt'ın bayatlığı buna bakar: Dağıt'tan
//                                            sonra Clip › Synchronize klipleri ZAMANDA kaydırır ama track'lerini değiştirmez (beklenen
//                                            adım, kayıt bayatlamamalı); Ctrl+Z ise klipleri eski track'lerine döndürür
//   yarım iş koruması spread.stoppedState.v2 digest = DURDU anındaki timeline (tam)
//   TOPLA kaydı       spread.collectRecord.v1 layout.pre/post = TOPLA'nın yerleştirdiği klipler (öncesi / sonrası) → layoutState
//   BAĞLA aşaması     (TOPLA kaydının içinde) groups/created/removed = BAĞLA'nın bıraktığı / sildiği öğeler → bindState
//   eski KES planı    link-plan.json (+ link-result.json), yardımcının klasöründe — plan.sequence.guid
// Dokunulmayan: kırpma kalibrasyonu (spread.trimCal.v1; Premiere'in davranışının ölçümü, timeline'ın değil), kaynak eşlemesi
// (sequence'a bağlı değil), güncelleme denetimi.
//
// reconcile: panel açılınca, sequence değişince, timeline'ın şekli değişince ve HER işlemden önce çalışır. Tutmayan kayıt bayattır →
// silinir, günlüğe "Timeline değişmiş (geri alma/elle düzenleme) — önceki <adım> kaydı unutuldu." yazılır, işlem normal çalışır.
// Tutan kayıt kilit DEĞİLDİR: işlem yalnız sorar ("Bu sequence'ta <adım> zaten yapılmış görünüyor. Yine de çalıştırılsın mı?").
// clearSequenceRecords: ↻ Yenile — bu sequence'ın bütün kayıtlarını siler (kalibrasyon hariç).

import { bindState, layoutState } from "./collect";
import { askUser, digest, forgetStopped, setStopped, stoppedOf } from "./guard";
import { dropLinkPlan, readLinkPlanText, readPanelLinkResult, writeLinkPlan } from "./linker";
import type { Snapshot } from "./model";
import { fingerprint, trackPrint } from "./prints";
import { forgetRecord, loadRecord, saveBindRecord, saveRecord, type CollectRecord } from "./settings";
import { forgetSteps, setStepMarks, stepMarks, type StepMarks } from "./steps";
import { log, type StepId } from "./ui";

export const STEP_LABEL: Record<StepId, string> = { spread: "Dağıt", topla: "Topla", bagla: "Bağla" };
const ORDER: StepId[] = ["spread", "topla", "bagla"];
const OP_STEP: Record<string, StepId> = { SPREAD: "spread", Spread: "spread", TOPLA: "topla", BAĞLA: "bagla" };
/** adım olmayan işlemler (işaret bırakmaz; yarım iş kaydı yine tutulur) */
const OP_NAME: Record<string, string> = { SENKRON: "Senkron" };

export { fingerprint, trackPrint } from "./prints";

/** Bu sequence için hiç kayıt var mı (yoksa şekil izlemeye gerek yok). */
export function hasRecords(guid: string): boolean {
  const m = stepMarks(guid);
  return Object.keys(m).length > 0 || !!stoppedOf(guid) || !!loadRecord(guid) || guid in trashAll();
}

export const stale = (what: string) => `Timeline değişmiş (geri alma/elle düzenleme) — önceki ${what} kaydı unutuldu.`;
const unprinted = (what: string) =>
  `Önceki ${what} kaydı timeline'la doğrulanamıyor (parmak izi yok: eski sürümün ya da işlem sonunda okunamamış bir kayıt) — unutuldu.`;
const GEN: Record<string, string> = { Dağıt: "Dağıt'ın", Topla: "Topla'nın", Bağla: "Bağla'nın", Senkron: "Senkron'un" };
const partialLine = (what: string, left: number, backup?: string | null) =>
  `Timeline, önceki ${GEN[what] ?? what} ara hâllerinden birinde (yarım geri alınmış; klipler eksik olabilir): tamamen geri almak için ` +
  `Ctrl+Z × ${left} daha${backup ? ` ya da yedek sequence "${backup}"` : ""}. Bir sonraki işlem sorar.`;

// ------------------------------------------------------------------ unutulanlar (Ctrl+Z → Ctrl+Y)
// reconcile bir şey unutunca, kayıtların EN SON geçerli olduğu timeline'ın parmak izi ile birlikte saklanır. Kullanıcı kısa bir
// geri almadan sonra yinelerse (Ctrl+Y) timeline o hâle döner → kayıtlar (işaretler, TOPLA / BAĞLA verisi, KES planı) geri yüklenir.
// Yeni bir işlem bittiğinde (index.ts) ya da ↻'da silinir.
const TRASH_KEY = "spread.forgotten.v1";
type Trash = { fp: string; marks: StepMarks; rec: CollectRecord | null; plan: string | null };

function trashAll(): Record<string, Trash> {
  try {
    const raw = window.localStorage.getItem(TRASH_KEY);
    const j: unknown = raw ? JSON.parse(raw) : {};
    return j && typeof j === "object" ? (j as Record<string, Trash>) : {};
  } catch {
    return {};
  }
}

function trashSave(a: Record<string, Trash>): void {
  try {
    window.localStorage.setItem(TRASH_KEY, JSON.stringify(a));
  } catch {
    /* saklanamazsa geri yükleme yok */
  }
}

/** Bu sequence'ın "unutulanlar"ını siler (yeni işlem bitti / ↻). */
export function dropForgotten(guid: string): void {
  const a = trashAll();
  if (!(guid in a)) return;
  delete a[guid];
  trashSave(a);
}

/** İşaretlerin en son geçerli olduğu hâl: en son adımın (parmak izi olan) işaretinin fp'si. */
function latestFp(m: StepMarks): string | null {
  for (const id of [...ORDER].reverse()) if (m[id]) return m[id]!.fp ?? null;
  return null;
}

/**
 * Bu sequence'ın kayıtlarını canlı timeline'la karşılaştırır; tutmayanları siler. @returns günlük satırları (bir şey değişmediyse boş)
 * Sıra: yarım iş → biten işlemin ARA hâli (kısmi Ctrl+Z → yarım iş kaydına çevrilir: SORU + kaç Ctrl+Z) → BAĞLA aşaması (bindState
 * "none" → unutulur; "partial" → unutulur + yarım iş kaydı: SORU) → TOPLA kaydı (layoutState "undone") → adım işaretleri (en son geçerli
 * adım ve öncekiler kalır; sonrakiler silinir).
 */
export async function reconcile(guid: string, s: Snapshot): Promise<string[]> {
  const lines: string[] = [];
  const said = new Set<StepId>();
  const forget = (id: StepId | null, text: string) => {
    lines.push(text);
    if (id) said.add(id);
  };
  const fp = fingerprint(s);
  const tp = trackPrint(s);
  const dg = digest(s);

  // 0) Ctrl+Y: timeline, unutulan kayıtların geçerli olduğu hâle döndü (ve bugünkü kayıtlar bu hâli anlatmıyor) → geri yükle
  const tr = trashAll()[guid];
  if (tr && tr.fp === fp && latestFp(stepMarks(guid)) !== fp) {
    setStepMarks(guid, tr.marks);
    if (tr.rec) saveRecord(tr.rec);
    if (tr.plan) await writeLinkPlan(tr.plan);
    const st0 = stoppedOf(guid);
    if (st0 && st0.digest !== dg) forgetStopped(guid); // ara hâl için yazılmış yarım iş kaydı artık geçersiz
    dropForgotten(guid);
    lines.push("Timeline, önceki işlemin bittiği hâle döndü (ör. Ctrl+Y) — unutulan kayıtlar geri yüklendi.");
    return lines;
  }
  const before = { marks: stepMarks(guid), rec: loadRecord(guid), plan: readLinkPlanText(guid) };
  const validFp = latestFp(before.marks);
  let partialLogged = false;

  // 1) yarım iş koruması: DURDU anındaki timeline birebir duruyor mu; değilse durmuş işlemin ara hâllerinden birinde mi (kısmi geri alma)
  const st = stoppedOf(guid);
  if (st && st.digest !== dg) {
    const label = OP_NAME[st.op ?? ""] ?? STEP_LABEL[OP_STEP[st.op ?? ""] ?? "spread"] ?? st.op ?? "işlem";
    const hit = st.mids?.find((x) => x.fp === fp);
    if (hit) {
      setStopped(guid, { ...st, digest: dg, left: hit.left });
      lines.push(partialLine(label, hit.left, st.backup));
      partialLogged = true;
    } else {
      forgetStopped(guid);
      forget(null, stale(`${label} (yarım iş)`));
    }
  }

  // 2) biten bir işlemin ARA hâli: kullanıcı Ctrl+Z'ye gereğinden az basmış → işaret bayat, ama "normal" çalışmak içeriği kaybeder
  //    (ör. Dağıt'ın kameraları eksik) → yarım iş kaydına çevrilir: bir sonraki işlem kaç Ctrl+Z daha gerektiğini söyleyerek SORAR
  const m = stepMarks(guid);
  let partial: StepId | null = null;
  for (const id of ["topla", "spread"] as StepId[]) {
    const x = m[id];
    const hit = x?.mid?.find((y) => y.fp === fp);
    if (!x || !hit) continue;
    partial = id;
    if (stoppedOf(guid)?.digest !== dg) setStopped(guid, { op: id === "spread" ? "SPREAD" : "TOPLA", digest: dg, left: hit.left, backup: x.backup ?? null, mids: x.mid });
    if (!partialLogged) lines.push(partialLine(STEP_LABEL[id], hit.left, x.backup));
    const drop = ORDER.slice(ORDER.indexOf(id));
    forgetSteps(guid, drop);
    for (const d of drop) said.add(d);
    if (id === "topla" && loadRecord(guid)) {
      forgetRecord(guid); // bu TOPLA yürürlükte değil (yarım geri alınmış) → kaydı (park listesi, çerçeve) da
      await dropLinkPlan(guid);
    }
    break;
  }

  // 3) BAĞLA aşaması: kesme/silme duruyor mu ("none" = tamamen geri alınmış → unutulur; "partial" = kısmen geri alınmış / elle değişmiş
  //    → unutulur, ama kesilmiş parçalar ya da silinmiş sesler timeline'da karışık → yarım iş kaydı: bir sonraki işlem SORAR)
  let rec = loadRecord(guid);
  if (rec?.bind) {
    const bs = bindState(rec, s);
    if (bs === "none" || bs === "partial") {
      saveBindRecord(guid, null);
      await dropLinkPlan(guid); // bu sequence'ın planı bu (bayat) BAĞLA'nındır; yeni bir BAĞLA yeni plan yazar
      forget("bagla", bs === "partial" ? `${stale("Bağla")} (Kısmen geri alınmış görünüyor — bir sonraki işlem sorar.)` : stale("Bağla"));
      if (bs === "partial" && stoppedOf(guid)?.digest !== dg) setStopped(guid, { op: "BAĞLA", digest: dg, bindPartial: true, backup: null });
      rec = loadRecord(guid);
    }
  }

  // 4) TOPLA kaydı: TOPLA tamamen geri alınmışsa (timeline TOPLA öncesi hâlinde) bayat. Elle düzenleme ("changed") bayat SAYILMAZ:
  //    BAĞLA'nın çerçevesi / eşlemesi / park listesi bu kayıttan gelir; tutarlılığı BAĞLA canlı timeline'dan kendisi denetler.
  if (rec && layoutState(rec, s) === "undone") {
    forgetRecord(guid);
    forget("topla", stale("Topla"));
    rec = null;
  }

  // 5) adım işaretleri (yalnız görünüm): sondan başa, geçerli olan ilk adım ve öncekiler kalır
  const m2 = stepMarks(guid);
  const recFresh = rec && (!m2.spread || rec.at >= m2.spread.at) ? rec : null;
  const valid: Record<StepId, boolean> = {
    bagla: !!recFresh?.bind || m2.bagla?.fp === fp,
    topla: !!recFresh || m2.topla?.fp === fp,
    // Topla yarım geri alınmışsa Dağıt'ı yapılmış sayılır (Topla ondan sonra çalıştı)
    spread: partial === "topla" || (!!m2.spread && (m2.spread.tp === tp || m2.spread.fp === fp)),
  };
  const drop: StepId[] = [];
  for (const id of [...ORDER].reverse()) {
    if (valid[id]) break;
    if (!m2[id]) continue;
    drop.push(id);
    if (!said.has(id)) forget(id, m2[id]!.fp ? stale(STEP_LABEL[id]) : unprinted(STEP_LABEL[id]));
  }
  if (drop.length) forgetSteps(guid, drop);
  // bir şey unutulduysa: geçerli olduğu hâlle birlikte sakla (Ctrl+Y ile o hâle dönülürse geri yüklensin)
  const changed = JSON.stringify(stepMarks(guid)) !== JSON.stringify(before.marks) || JSON.stringify(loadRecord(guid)) !== JSON.stringify(before.rec);
  if (changed && validFp && validFp !== fp) {
    const a = trashAll();
    a[guid] = { fp: validFp, marks: before.marks, rec: before.rec, plan: before.plan };
    trashSave(a);
  }
  return lines;
}

/** reconcile + günlük. İşlemlerin başında ve panelin doğrulamasında. */
export async function reconcileAndLog(guid: string, s: Snapshot): Promise<boolean> {
  const lines = await reconcile(guid, s);
  for (const l of lines) log(l, "warn");
  return lines.length > 0;
}

/**
 * Adım zaten yapılmış görünüyor mu (bu adımın ya da SONRAKİ bir adımın işareti, işlemin sonundaki timeline'la BİREBİR aynı) →
 * kilit değil, SORU. BAĞLA'da yalnız bağlama bitmişse sorulur (kesilmiş ama bağlanmamışsa BAĞLA'nın işi bağlamak).
 * @param upTo en son hangi adıma bakılır (TOPLA "Bağla'dan sonra" durumunu kendi, daha ayrıntılı sorusuyla ele alır) @returns true = devam
 */
export async function confirmRedo(guid: string, s: Snapshot, step: StepId, upTo: StepId = "bagla"): Promise<boolean> {
  const m = stepMarks(guid);
  const fp = fingerprint(s);
  const rec = loadRecord(guid);
  const pr = rec?.bind ? readPanelLinkResult() : null;
  const linked = rec?.bind?.stage === "linked" || (!!pr && pr.ok && !!rec?.bind && pr.planCreatedAt === rec.bind.at);
  const finished = (id: StepId) => id !== "bagla" || linked;
  const hit = ORDER.slice(ORDER.indexOf(step), ORDER.indexOf(upTo) + 1)
    .reverse()
    .find((id) => m[id]?.fp === fp && finished(id));
  if (!hit) return true;
  const ans = await askUser(
    `Bu sequence'ta ${STEP_LABEL[hit]} zaten yapılmış görünüyor (timeline, ${STEP_LABEL[hit]} bittiğindeki hâliyle birebir aynı). Yine de çalıştırılsın mı?`,
    [
      `Bu sequence'ta ${STEP_LABEL[hit]} zaten yapılmış görünüyor.`,
      "Timeline o işlemin bıraktığı hâlde; kayıt yalnız ipucu, kilit değil.",
      `Devam = ${STEP_LABEL[step]} baştan çalışır (önce onay ve yedek).`,
    ],
    { title: `${STEP_LABEL[step]} yine de çalıştırılsın mı?`, yes: "Yine de çalıştır", no: "Vazgeç" }
  );
  if (ans !== "Evet") log("İptal edildi — hiçbir şey değişmedi.", "warn");
  return ans === "Evet";
}

/** Durum raporu için (SALT OKUMA, hiçbir şey silinmez): bu sequence'ın kayıtları ve canlı timeline'la tutup tutmadıkları. */
export function describeRecords(guid: string, s: Snapshot): string[] {
  const L: string[] = [];
  const fp = fingerprint(s);
  const tp = trackPrint(s);
  L.push(`timeline parmak izi: ${fp} (yerleşim ${tp})`);
  const m = stepMarks(guid);
  for (const id of ORDER) {
    const x = m[id];
    if (!x) continue;
    const st = !x.fp ? "parmak izi YOK (eski sürüm kaydı)" : x.fp === fp ? "timeline BİREBİR aynı" : x.tp === tp ? "yerleşim aynı, zamanlar farklı" : "timeline FARKLI";
    L.push(`adım işareti ${STEP_LABEL[id]}: ${x.kind} "${x.text}" ${x.at || "?"} — ${st}`);
  }
  const st = stoppedOf(guid);
  if (st) L.push(`yarım iş kaydı: ${st.op ?? "?"} — ${st.digest === digest(s) ? "timeline o hâlde (işlem SORAR)" : "timeline farklı (bayat; bir sonraki işlemde unutulur)"}`);
  const rec = loadRecord(guid);
  if (rec) {
    L.push(`TOPLA kaydı: ${rec.at} — düzen ${layoutState(rec, s)}`);
    if (rec.bind) L.push(`BAĞLA aşaması: ${rec.bind.stage} ${rec.bind.at} — ${bindState(rec, s)}`);
  }
  if (L.length === 1) L.push("(bu sequence için kayıt yok)");
  return L;
}

/** ↻ için: BAĞLA kesimi yapılmış, bağlanmayı bekliyor mu (kayıt + yardımcı panelin sonucu; timeline okunmaz). */
export function pendingLink(guid: string): boolean {
  const b = loadRecord(guid)?.bind;
  if (!b || b.stage !== "cut") return false;
  const pr = readPanelLinkResult();
  return !(pr && pr.ok && pr.planCreatedAt === b.at);
}

/**
 * ↻ Yenile: bu sequence'ın BÜTÜN kayıtlarını siler (adım işaretleri, yarım iş, TOPLA / BAĞLA kaydı, eski KES planı). Kalibrasyon kalır.
 * @param keepLink true → yalnız TOPLA / BAĞLA verisi ve KES planı kalır (Bağla kesimi bağlanmayı bekliyorken "Yalnız yenile")
 */
export async function clearSequenceRecords(guid: string, keepLink = false): Promise<void> {
  forgetSteps(guid);
  forgetStopped(guid);
  dropForgotten(guid);
  if (keepLink) return;
  forgetRecord(guid);
  await dropLinkPlan(guid);
}
