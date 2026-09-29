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
import { askUser, digest, forgetStopped, stoppedOf } from "./guard";
import { dropLinkPlan, readPanelLinkResult } from "./linker";
import type { Snapshot } from "./model";
import { forgetRecord, loadRecord, saveBindRecord } from "./settings";
import { forgetSteps, stepMarks } from "./steps";
import { log, type StepId } from "./ui";

export const STEP_LABEL: Record<StepId, string> = { spread: "Dağıt", topla: "Topla", bagla: "Bağla" };
const ORDER: StepId[] = ["spread", "topla", "bagla"];
const OP_STEP: Record<string, StepId> = { SPREAD: "spread", Spread: "spread", TOPLA: "topla", BAĞLA: "bagla" };

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

/** Bu sequence için hiç kayıt var mı (yoksa şekil izlemeye gerek yok). */
export function hasRecords(guid: string): boolean {
  const m = stepMarks(guid);
  return Object.keys(m).length > 0 || !!stoppedOf(guid) || !!loadRecord(guid);
}

export const stale = (what: string) => `Timeline değişmiş (geri alma/elle düzenleme) — önceki ${what} kaydı unutuldu.`;
const legacy = (what: string) => `Önceki ${what} kaydı timeline'la doğrulanamıyor (eski sürümün kaydı, parmak izi yok) — unutuldu.`;

/**
 * Bu sequence'ın kayıtlarını canlı timeline'la karşılaştırır; tutmayanları siler. @returns günlük satırları (bir şey silinmediyse boş)
 * Silme sırası: yarım iş → BAĞLA aşaması (bindState "none" / "partial") → TOPLA kaydı (layoutState "undone") → adım işaretleri
 * (en son geçerli adım ve öncekiler kalır; sonrakiler silinir).
 */
export async function reconcile(guid: string, s: Snapshot): Promise<string[]> {
  const lines: string[] = [];
  const said = new Set<StepId>();
  const forget = (id: StepId | null, text: string) => {
    lines.push(text);
    if (id) said.add(id);
  };

  // 1) yarım iş koruması: DURDU anındaki timeline birebir duruyor mu
  const st = stoppedOf(guid);
  if (st && st.digest !== digest(s)) {
    forgetStopped(guid);
    forget(null, stale(`${STEP_LABEL[OP_STEP[st.op ?? ""] ?? "spread"] ?? st.op} (yarım iş)`));
  }

  // 2) BAĞLA aşaması: kesme/silme duruyor mu ("none" = tamamen geri alınmış, "partial" = kısmen geri alınmış / elle değişmiş)
  let rec = loadRecord(guid);
  if (rec?.bind) {
    const bs = bindState(rec, s);
    if (bs === "none" || bs === "partial") {
      saveBindRecord(guid, null);
      await dropLinkPlan(guid); // bu sequence'ın planı bu (bayat) BAĞLA'nındır; yeni bir BAĞLA yeni plan yazar
      forget("bagla", stale("Bağla"));
      rec = loadRecord(guid);
    }
  }

  // 3) TOPLA kaydı: TOPLA tamamen geri alınmışsa (timeline TOPLA öncesi hâlinde) bayat. Elle düzenleme ("changed") bayat SAYILMAZ:
  //    BAĞLA'nın çerçevesi / eşlemesi / park listesi bu kayıttan gelir; tutarlılığı BAĞLA canlı timeline'dan kendisi denetler.
  if (rec && layoutState(rec, s) === "undone") {
    forgetRecord(guid);
    forget("topla", stale("Topla"));
    rec = null;
  }

  // 4) adım işaretleri (yalnız görünüm): sondan başa, geçerli olan ilk adım ve öncekiler kalır
  const m = stepMarks(guid);
  const fp = fingerprint(s);
  const tp = trackPrint(s);
  const recFresh = rec && (!m.spread || rec.at >= m.spread.at) ? rec : null;
  const valid: Record<StepId, boolean> = {
    bagla: !!recFresh?.bind || m.bagla?.fp === fp,
    topla: !!recFresh || m.topla?.fp === fp,
    spread: !!m.spread && (m.spread.tp === tp || m.spread.fp === fp),
  };
  const drop: StepId[] = [];
  for (const id of [...ORDER].reverse()) {
    if (valid[id]) break;
    if (!m[id]) continue;
    drop.push(id);
    if (!said.has(id)) forget(id, m[id]!.fp ? stale(STEP_LABEL[id]) : legacy(STEP_LABEL[id]));
  }
  if (drop.length) forgetSteps(guid, drop);
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

/** ↻ Yenile: bu sequence'ın BÜTÜN kayıtlarını siler (adım işaretleri, yarım iş, TOPLA / BAĞLA kaydı, eski KES planı). Kalibrasyon kalır. */
export async function clearSequenceRecords(guid: string): Promise<void> {
  forgetSteps(guid);
  forgetStopped(guid);
  forgetRecord(guid);
  await dropLinkPlan(guid);
}
