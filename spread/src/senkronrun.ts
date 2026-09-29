// SENKRON (v1.4.0) — UXP tarafı. Timeline'daki kamera ve harici ses dosyalarının yollarını okur (ClipProjectItem.getMediaFilePath),
// eşleştirmeyi Spread Helper'a yaptırır (cep-helper/js/senkron.js → SpreadCore.senkronSolve; kaynak spread/src/senkron.ts), sonucu
// raporlar. Hesap YARDIMCIDA (Node); UXP yalnız okur ve yerleştirir.
//
//  "Dene" (varsayılan): timeline'a DOKUNMAZ. Rapor: %APPDATA%\BadIdeaAgency\Spread\senkron-deneme.txt + Sorun bildir bölümü: her dosya
//         için bulunan konum, güven, eşleştiği dosya, saat ipucunun beklediği konum ve fark, timeline'daki yerine göre fark; grup
//         (oturum) özeti; "emin değil" listesi.
//  "Uygula" (Ayarlar › "Deneysel: SENKRON uygula", varsayılan KAPALI): yalnız Dağıt düzeninde (her dosyanın klipleri kendi
//         track'lerinde, başka dosyayla track paylaşmıyor). Önce yedek. Klipler YALNIZ ZAMANDA taşınır (track'ler aynı — Premiere
//         Synchronize'ın çıktısıyla aynı biçim): park (+P) → yerine (Δ − P); ilk dosya TEK BAŞINA ölçülür, her adım tick düzeyinde
//         doğrulanır. Kamera klipleri kareye (sequence timebase) yuvarlanır, harici sesler tick düzeyinde. Gruplar sırayla: saat
//         ipucundaki mesafe (önceki grubun sonundan sonraysa) ya da Ayarlar'daki boşluk. "Emin değil" dosyalar son grubun ardına, tek
//         tek boşlukla (Topla onları sahipsiz bulur → park).

import { classify, type Classified } from "./classify";
import { selectExactly } from "./edit";
import { certainDevice, counterUsable } from "./health";
import {
  askUser,
  ceilTo,
  confirmNotStopped,
  expectState,
  forgetStopped,
  frameTicks,
  makeBackup,
  multisetEqual,
  parkBase,
  PARK_GAP,
  rememberStopped,
  reportStop,
  runTx,
  SpreadStop,
} from "./guard";
import { spreadDataPath } from "./journal";
import { compareLayout, expOf, findExp, snapshotOverlaps, type Exp } from "./layout";
import { getLinker, type SenkronOut } from "./linker";
import { big, errText, fmtClip, relocate, secOf, settle, snapshot, ticks, TICKS_PER_SECOND, trackLabel, type ClipInfo, type Snapshot } from "./model";
import { ppro } from "./ppro";
import { Trail } from "./prints";
import { reconcileAndLog } from "./records";
import { requireActive, type SeqContext } from "./session";
import { getGapSec, getSenkronApply } from "./settings";
import { SPREAD_VERSION } from "./version";
import { log, opEnd, progress, showCancel } from "./ui";

/** Son denemenin raporu (Sorun bildir bölümü; panel oturumu boyunca). */
let lastReport: { at: string; text: string } | null = null;
export const lastSenkronReport = () => lastReport;

let cancelWanted = false;
/** İptal düğmesi: yardımcıdaki işi durdurur (Uygula'nın timeline adımları başladıysa etkisiz). */
export function cancelSenkron(): void {
  cancelWanted = true;
  void getLinker()
    .senkron({ op: "cancel" })
    .catch(() => undefined);
}

interface FileRow {
  id: string;
  path: string;
  name: string;
  kind: "camera" | "audio";
  device: string;
  recording: string;
  certain: boolean;
  order: number[] | null;
  clips: ClipInfo[];
}

const TPS = Number(TICKS_PER_SECOND);
const secToTicks = (s: number): bigint => BigInt(Math.round(s * TPS));
const fmtS = (s: number | null) => (s === null ? "—" : `${s >= 0 ? "+" : ""}${s.toFixed(3)} sn`);
const fmtMs = (s: number | null) => (s === null ? "—" : `${s >= 0 ? "+" : ""}${(s * 1000).toFixed(1)} ms`);

/** Timeline'daki dosyalar: proje öğesi başına bir satır (kamera videosu + sesleri aynı dosya). Yol okunamayan dosya ayrı listede. */
async function readFiles(s: Snapshot, items: Classified[]): Promise<{ files: FileRow[]; unreadable: string[] }> {
  const byProj = new Map<string, Classified[]>();
  for (const x of items) {
    if (x.role === "unknown" || !x.ident) continue;
    byProj.set(x.clip.projId, [...(byProj.get(x.clip.projId) ?? []), x]);
  }
  const files: FileRow[] = [];
  const unreadable: string[] = [];
  for (const [projId, list] of byProj) {
    const c0 = list[0].clip;
    let p = "";
    try {
      const ci = c0.projRef ? await ppro.ClipProjectItem.cast(c0.projRef) : null; // d.ts:L788 ClipProjectItemStatic.cast
      p = ci ? String(await ci.getMediaFilePath()) : ""; // d.ts:L973 ClipProjectItem.getMediaFilePath
    } catch (e) {
      unreadable.push(`"${c0.name}": medya yolu okunamadı (${errText(e)})`);
      continue;
    }
    if (!p) {
      unreadable.push(`"${c0.name}": medya yolu boş (çevrimdışı / oluşturulmuş öğe?)`);
      continue;
    }
    const cam = list.some((x) => x.role === "camera" || x.role === "guide");
    const ident = list[0].ident!;
    files.push({
      id: projId,
      path: p,
      name: p.replace(/^.*[\\/]/, "") || c0.name,
      kind: cam ? "camera" : "audio",
      device: ident.device,
      recording: ident.recording,
      certain: certainDevice(cam ? "camera" : "audio", ident),
      order: null,
      // dosyanın timeline'daki BÜTÜN klipleri (sınıflandırılamayan parçaları da — Uygula hepsini birlikte taşır)
      clips: s.clips.filter((c) => c.projId === projId),
    });
  }
  // sayaç: cihazın bütün dosyaları güvenli desende ve tekilse (health.ts ile aynı kural)
  for (const d of new Set(files.map((f) => f.device))) {
    const fs = files.filter((f) => f.device === d);
    const ids = fs.map((f) => items.find((x) => x.clip.projId === f.id)!.ident!);
    if (counterUsable(ids)) fs.forEach((f, i) => (f.order = ids[i].order));
  }
  return { files, unreadable };
}

/** Dosyanın timeline'daki medya başlangıcı (sn): klip start − in (hepsi aynı olmalı; değilse null). */
function mediaStart(f: FileRow): number | null {
  const v = new Set(f.clips.map((c) => (big(c.start) - big(c.inPt)).toString()));
  return v.size === 1 ? Number(BigInt([...v][0])) / TPS : null;
}

function buildReport(ctx: SeqContext, files: FileRow[], unreadable: string[], out: SenkronOut, secs: number): string {
  const r = out.result;
  const L: string[] = [];
  const byId = new Map(files.map((f) => [f.id, f]));
  const noLead = new Set(out.files.filter((f) => f.leadOk === false).map((f) => f.id));
  L.push("================================================");
  L.push(`SPREAD SENKRON — DENEME RAPORU (Spread v${SPREAD_VERSION})`);
  L.push("================================================");
  L.push(`Tarih: ${new Date().toISOString()}`);
  L.push(`Sequence: "${ctx.name}" — ${files.length} dosya, toplam ses ${(out.files.reduce((s, f) => s + (f.seconds ?? 0), 0) / 60).toFixed(1)} dk, süre ${secs.toFixed(0)} sn`);
  L.push(`ffmpeg: ${out.ffmpeg ?? "?"}`);
  L.push("Timeline'a DOKUNULMADI (Dene). Konumlar: grubun ilk dosyasına göre, saniye. 1 ms ≪ 1 kare.");
  const placed = r.placed.filter((p) => p.status === "ok");
  const unsure = r.placed.filter((p) => p.status !== "ok");
  L.push("");
  L.push(`GRUPLAR (oturum adayları): ${r.groups.length} — yerleşen ${placed.length}, emin değil ${unsure.length + unreadable.length + out.files.filter((f) => !f.ok).length}`);
  for (const g of r.groups)
    L.push(
      `  Grup ${g.n}: ${g.ids.length} dosya, kapsam ${g.start.toFixed(3)}–${g.end.toFixed(3)} sn` +
        (g.n === 1
          ? ""
          : g.clockFrom1 !== null
            ? `; saat ipucuna göre Grup 1'den ${Math.abs(g.clockFrom1).toFixed(3)} sn ${g.clockFrom1 >= 0 ? "sonra" : "ÖNCE"}`
            : "; saat ipucu yok (aralarına boşluk konur)")
    );
  L.push("");
  L.push("DOSYALAR (grup · konum · güven · eşleştiği dosya · saat ipucunun beklediği konum ve fark · timeline'daki yerine göre fark)");
  L.push("  timeline farkı: Premiere senkronundan / elle yerleşimden SONRA anlamlı (Spread ile timeline arasındaki fark); Dağıt'tan hemen sonra anlamsız.");
  for (const g of r.groups) {
    const mem = placed.filter((p) => p.group === g.n).sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
    const ref = mem.find((p) => mediaStart(byId.get(p.id)!) !== null);
    const refTl = ref ? mediaStart(byId.get(ref.id)!)! : null;
    for (const p of mem) {
      const tl = mediaStart(byId.get(p.id)!);
      const tlDiff = ref && refTl !== null && tl !== null ? tl - refTl - (p.pos! - ref.pos!) : null;
      L.push(
        `  G${g.n}  ${p.pos!.toFixed(4).padStart(10)} sn  güven ${p.confidence.toFixed(2)} (tepe ${p.viaPeak.toFixed(3)}, oran ${p.viaRatio.toFixed(1)}, ${p.support} eşleşme)` +
          `  ← ${p.via ?? "dayanak"}  saat: ${p.hintPos === null ? "—" : `${p.hintPos.toFixed(3)} (fark ${fmtS(p.hintDiff)})`}  timeline: ${fmtMs(tlDiff)}  "${p.name}"` +
          (noLead.has(p.id) ? "  · ses başlangıcı bilinmiyor → Uygula'da taşınmaz (en sona)" : "")
      );
    }
  }
  L.push("");
  L.push("EMİN DEĞİL (yerleştirilmedi; Uygula'da en sona, tek tek konur → Topla sahipsiz sayar)");
  if (!unsure.length && !unreadable.length && out.files.every((f) => f.ok)) L.push("  (yok)");
  for (const p of unsure) L.push(`  "${p.name}" — ${p.why}${p.maybe ? `  · olası yer: G${p.maybe.group} ${p.maybe.pos.toFixed(3)} sn (dar kanıt — kontrol et)` : ""}`);
  for (const f of out.files.filter((x) => !x.ok)) L.push(`  "${f.name}" — ${f.why}`);
  for (const u of unreadable) L.push(`  ${u}`);
  L.push("");
  L.push("CİHAZ SAATİ (dosya adı / timecode / creation_time — yalnız aramayı daraltır)");
  if (!r.deviceClock.length) L.push("  (saat ipucu yok)");
  for (const d of r.deviceClock) L.push(`  ${d.device}: ${d.n} dosyadan (konum − saat) medyanı ${d.offset.toFixed(3)} sn, sapma medyanı ${d.spread.toFixed(3)} sn`);
  for (const f of out.files.filter((x) => x.clockSrc)) L.push(`  "${f.name}": saat kaynağı ${f.clockSrc}`);
  L.push("");
  L.push("EŞLEŞMELER (ham; s = b'nin a'ya göre başlangıcı; tepe = GCC-PHAT; oran = sonraki adaya; artık = sonuçla fark)");
  for (const e of r.edges)
    L.push(
      `  ${e.a} ↔ ${e.b}: ${e.s === null ? "—" : `s ${e.s.toFixed(4)}`} tepe ${e.peak.toFixed(3)} oran ${e.ratio.toFixed(1)}${e.used ? " [kullanıldı]" : ""}` +
        `${e.residualMs !== null ? ` artık ${e.residualMs.toFixed(2)} ms` : ""}${e.why ? ` — ${e.why}` : ""}`
    );
  for (const n of r.notes) L.push(`not: ${n}`);
  L.push("");
  L.push("OKUNAN DOSYALAR");
  for (const f of out.files)
    L.push(
      `  "${f.name}" ${f.ok ? `${(f.seconds ?? 0).toFixed(3)} sn${f.cached ? " (önbellek)" : ""}` : `OKUNAMADI: ${f.why}`}` +
        `${f.lead ? ` · ses akışı dosya başından ${fmtS(f.lead)} (konuma işlendi)` : ""}${f.note ? ` · not: ${f.note}` : ""}  ${byId.get(f.id)?.path ?? ""}`
    );
  return L.join("\n");
}

async function writeReport(text: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("os") as { platform(): string; homedir(): string };
    const p = spreadDataPath(os.platform(), os.homedir(), "senkron-deneme.txt"); // uxp.d.ts:L9198 OS.platform, uxp.d.ts:L9232 OS.homedir
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as { writeFileSync(p: string, d: string, o: { encoding?: string }): number; mkdir(p: string, o: { recursive?: boolean }): Promise<number> };
    try {
      await fs.mkdir(p.replace(/[\\/][^\\/]+$/, ""), { recursive: true }); // uxp.d.ts:L9159 fs.mkdir
    } catch {
      /* klasör var */
    }
    fs.writeFileSync(p, text, { encoding: "utf-8" }); // uxp.d.ts:L9022 fs.writeFileSync
    return p;
  } catch (e) {
    log(`senkron-deneme.txt yazılamadı: ${errText(e)}`, "warn");
    return null;
  }
}

/** SENKRON: Dene (+ ayar açıksa Uygula). */
export async function runSenkron(): Promise<void> {
  cancelWanted = false;
  let ctx: SeqContext | null = null;
  const executed: string[] = [];
  let backupName: string | null = null;
  const trail = new Trail();
  log("▶ SENKRON", "head");
  try {
    ctx = await requireActive();
    log(`sequence: "${ctx.name}"`, "dim");
    const s0 = await snapshot(ctx);
    for (const w of s0.warnings) throw new SpreadStop(`Okuma sorunu: ${w}. SENKRON BAŞLAMADI.`);
    const items = classify(s0);
    const { files, unreadable } = await readFiles(s0, items);
    if (files.length < 2) throw new SpreadStop(`Eşleştirilecek en az iki ses dosyası gerekir (okunan: ${files.length}).`, unreadable);
    const linker = getLinker();
    const ping = await linker.ping();
    if (!ping.ok) throw Object.assign(new SpreadStop("SENKRON Spread Helper'la çalışır (ses çözme ve eşleştirme orada) — yardımcıya ulaşılamadı.", [ping.detail, ...linker.installHint()]), { restored: true });
    const st0 = await linker.senkron({ op: "status" });
    if (st0.state === "running") throw new SpreadStop("Spread Helper'da bir SENKRON işi zaten sürüyor; bitmesini bekle ya da İptal.");
    if (st0.ffmpeg && !st0.ffmpeg.supported) throw new SpreadStop("SENKRON şimdilik yalnız Windows'ta (sabit ffmpeg derlemesi Windows için). Timeline'a dokunulmadı.");
    if (st0.ffmpeg && !st0.ffmpeg.installed) {
      const ans = await askUser(
        `SENKRON ilk kullanımda ffmpeg'i indirir: resmî Windows derlemesi (${st0.ffmpeg.version}, ~88 MB, GPL v3), sabit adresten; sha256 doğrulanır, ` +
          `${st0.ffmpeg.dir} klasörüne kurulur. İndirilsin mi?`,
        ["SENKRON ilk kullanımda ffmpeg'i indirir (~88 MB, bir kez).", "Resmî derleme; dosyanın bozulmadığı sha256 ile doğrulanır.", "İndirilsin mi?"],
        { title: "ffmpeg indirilsin mi?", yes: "İndir", no: "Vazgeç" }
      );
      if (ans !== "Evet") return void log("İptal edildi — hiçbir şey değişmedi.", "warn");
    }
    const fr = await frameTicks(ctx);
    log(`${files.length} dosya (${files.filter((f) => f.kind === "camera").length} kamera, ${files.filter((f) => f.kind === "audio").length} harici ses) eşleştirilecek; timeline'a dokunulmaz (Dene).`, "dim");
    for (const u of unreadable) log(`  ${u}`, "warn");
    const t0 = Date.now();
    await linker.senkron({
      op: "start",
      files: files.map((f) => ({ id: f.id, path: f.path, name: f.name, kind: f.kind, device: f.device, recording: f.recording, certain: f.certain, order: f.order })),
      opts: fr ? { frameSec: Number(fr) / TPS } : {},
    });
    let out: SenkronOut | null = null;
    showCancel(true);
    for (;;) {
      await new Promise((r) => setTimeout(r, 600));
      const st = await linker.senkron({ op: "status" }).catch((e: unknown) => {
        showCancel(false);
        throw e;
      });
      if (st.progress) progress(Math.min(0.95, 0.03 + 0.9 * st.progress.frac), st.progress.text);
      if (st.state === "running" || st.state === "cancelling") continue;
      showCancel(false);
      if (st.state === "done" && st.out) {
        out = st.out;
        break;
      }
      if (st.state === "cancelled" || cancelWanted) return void (log("İptal edildi — hiçbir şey değişmedi.", "warn"), opEnd("cancel", "SENKRON iptal edildi; hiçbir şey değişmedi."));
      throw new SpreadStop(`SENKRON yardımcıda durdu: ${st.error ?? st.state}. Timeline'a dokunulmadı.`);
    }
    const secs = (Date.now() - t0) / 1000;
    const text = buildReport(ctx, files, unreadable, out, secs);
    lastReport = { at: new Date().toISOString(), text };
    const path = await writeReport(text);
    const r = out.result;
    const nOk = r.placed.filter((p) => p.status === "ok").length;
    const nNo = files.length + unreadable.length - nOk;
    const nNoLead = r.placed.filter((p) => p.status === "ok" && out.files.some((f) => f.id === p.id && f.leadOk === false)).length;
    log(`✓ SENKRON (Dene) bitti: ${nOk}/${files.length + unreadable.length} dosya ${r.groups.length} grupta yerleşti; emin değil ${nNo}. Timeline'a dokunulmadı.`, "ok");
    if (nNoLead) log(`  ${nNoLead} dosyanın sesi eşleşti ama ses akışının dosya başına göre yeri bilinmiyor → Uygula onları taşımaz (en sona).`, "warn");
    for (const l of text.split("\n").filter((x) => /^ {2}(Grup|G\d|")/.test(x)).slice(0, 80)) log(l, "dim");
    if (path) log(`Rapor: ${path} (Sorun bildir raporuna da eklenir).`, "dim");
    if (!getSenkronApply() || !nOk) {
      opEnd(
        nNo ? "warn" : "ok",
        `SENKRON denemesi: ${nOk} dosya ${r.groups.length} grupta yerleşti${nNo ? `, ${nNo} emin değil` : ""}. Timeline değişmedi.`,
        `Rapor: ${path ?? "Sorun bildir"}. Uygulamak için Ayarlar › "Deneysel: SENKRON uygula" (ya da Clip › Synchronize).`
      );
      return;
    }
    await apply(ctx, s0, files, out, fr, executed, trail, (n) => (backupName = n));
  } catch (e) {
    if (executed.length && ctx) await rememberStopped(ctx, "SENKRON", { backup: backupName, mids: trail.mids });
    reportStop("SENKRON", e, executed, backupName);
  }
}

/** Aynı klipler, aynı yerlerde, aynı track sayısıyla. */
const sameTimeline = (a: Snapshot, b: Snapshot) => multisetEqual(a, b) && a.vCount === b.vCount && a.aCount === b.aCount;

interface Move {
  c: ClipInfo;
  delta: bigint;
  file: FileRow;
}

/** Uygula (deneysel): Dağıt düzeninde yalnız zamanda taşı. */
async function apply(
  ctx: SeqContext,
  s0: Snapshot,
  files: FileRow[],
  out: SenkronOut,
  fr: bigint | null,
  executed: string[],
  trail: Trail,
  setBackup: (n: string) => void
): Promise<void> {
  // eşleştirme dakikalar sürebilir: timeline bu arada değiştiyse sonuç eski okumaya göre → hiçbir şey yapılmaz
  const sF = await snapshot(ctx);
  for (const w of sF.warnings) throw new SpreadStop(`Okuma sorunu: ${w}. Uygula başlamadı.`);
  if (!sameTimeline(s0, sF)) throw new SpreadStop("Eşleştirme sürerken timeline değişti — Uygula başlamadı (hiçbir şey yapılmadı). SENKRON'u yeniden çalıştır.");
  await reconcileAndLog(ctx.guid, sF);
  if (!(await confirmNotStopped(ctx, sF, "SENKRON"))) return void (log("Uygula iptal edildi — timeline değişmedi (rapor duruyor).", "warn"), opEnd("cancel", "Uygulanmadı; timeline değişmedi."));
  // Dağıt düzeni: taşınacak her dosyanın track'lerinde YALNIZ o dosyanın klipleri (timeline'daki BÜTÜN kliplere bakılır: okunamayan /
  // sınıflandırılamayan klipler de); her dosyanın klipleri aynı medya başlangıcında
  const mine = new Set(files.map((f) => f.id));
  const byTrack = new Map<string, Set<string>>(); // "A3" (kullanıcının gördüğü track adı) → dosyalar
  for (const c of s0.clips) {
    const k = trackLabel(c.kind, c.track);
    byTrack.set(k, new Set([...(byTrack.get(k) ?? []), c.projId]));
  }
  const shared = [...byTrack].filter(([, ids]) => ids.size > 1 && [...ids].some((id) => mine.has(id))).map(([t]) => t);
  if (shared.length) throw new SpreadStop(`Uygula yalnız Dağıt düzeninde çalışır (her dosya kendi track'inde); şu track'lerde birden çok dosya var: ${shared.join(", ")}. Önce Dağıt.`);
  const bad = files.filter((f) => mediaStart(f) === null);
  if (bad.length) throw new SpreadStop("Aynı dosyanın klipleri farklı senkron konumunda; Uygula başlamadı.", bad.map((f) => f.name));
  const r = out.result;
  const byId = new Map(files.map((f) => [f.id, f]));
  // ses akışının başlangıcı bilinmeyen dosya (ffprobe okuyamadı / > 5 sn): sesi doğru eşleşse de dosya başının yeri belirsiz → taşınmaz
  const noLead = new Set(out.files.filter((f) => f.leadOk === false).map((f) => f.id));
  const frame = fr && fr > 0n ? fr : null;
  const gap = ceilTo(secToTicks(getGapSec()), frame);
  // hedef medya başlangıçları (tick): gruplar sırayla; kameralar kareye yuvarlanır
  const target = new Map<string, bigint>();
  const rounding: string[] = [];
  let cursor = 0n;
  // saatli gruplar saat sırasıyla (Grup 1'den ÖNCE olan da olabilir: clockFrom1 < 0), saatsizler sonra
  const groups = r.groups.slice().sort((a, b) => (a.clockFrom1 ?? 1e9 + a.n) - (b.clockFrom1 ?? 1e9 + b.n));
  let zero: bigint | null = null; // saat ipucu koordinatında Grup 1'in başı (ilk saatli grubun yerinden)
  for (const g of groups) {
    const mem = r.placed.filter((p) => p.status === "ok" && p.group === g.n && !noLead.has(p.id));
    const clock = g.clockFrom1 !== null && zero !== null ? zero + secToTicks(g.clockFrom1) : null;
    const origin = ceilTo(clock !== null && clock >= cursor ? clock : cursor, frame);
    if (zero === null && g.clockFrom1 !== null) zero = origin - secToTicks(g.clockFrom1);
    let end = origin;
    for (const p of mem) {
      const f = byId.get(p.id)!;
      let t = origin + secToTicks(p.pos!);
      if (f.kind === "camera" && frame) {
        const q = ((t + frame / 2n) / frame) * frame;
        if (q !== t) rounding.push(`"${f.name}" kareye yuvarlandı: ${((Number(q - t) / TPS) * 1000).toFixed(2)} ms`);
        t = q;
      }
      target.set(f.id, t);
      for (const c of f.clips) end = end > t + (big(c.end) - big(c.start)) + big(c.inPt) ? end : t + (big(c.end) - big(c.start)) + big(c.inPt);
    }
    cursor = ceilTo(end + gap, frame);
  }
  // emin değil: sona, tek tek
  const unsure = files.filter((f) => !target.has(f.id));
  for (const f of unsure.filter((x) => noLead.has(x.id) && r.placed.some((p) => p.id === x.id && p.status === "ok")))
    log(`  "${f.name}": sesi eşleşti ama ses akışının dosya başına göre yeri bilinmiyor → taşınmaz, en sona.`, "warn");
  for (const f of unsure) {
    target.set(f.id, cursor);
    const len = f.clips.reduce((m, c) => (big(c.end) - big(c.start) + big(c.inPt) > m ? big(c.end) - big(c.start) + big(c.inPt) : m), 0n);
    cursor = ceilTo(cursor + len + gap, frame);
  }
  const moves: Move[] = [];
  for (const f of files) {
    const d = target.get(f.id)! - (big(f.clips[0].start) - big(f.clips[0].inPt));
    if (d !== 0n) for (const c of f.clips) moves.push({ c, delta: d, file: f });
  }
  if (!moves.length) return void opEnd("ok", "SENKRON: timeline zaten bulunan yerlerde; yapılacak bir şey yok.");
  const nFiles = new Set(moves.map((m) => m.file.id)).size;
  const ans = await askUser(
    `SENKRON UYGULA (deneysel) — ${nFiles} dosyanın ${moves.length} klibi YALNIZ ZAMANDA taşınacak (track'ler aynı): ${r.groups.length} grup sırayla` +
      `${unsure.length ? `; emin olunmayan ${unsure.length} dosya en sona, tek tek` : ""}. Kamera klipleri kareye yuvarlanır. Önce yedek sequence alınır; ` +
      "ilk dosya tek başına taşınıp ölçülür, her adım tick düzeyinde doğrulanır. Devam?",
    [
      `${nFiles} dosya zamanda taşınacak (${r.groups.length} grup${unsure.length ? `, ${unsure.length} emin değil → en sona` : ""}).`,
      "Track'ler değişmez; önce yedek sequence alınır.",
      "Deneysel özellik: sonucu gözle kontrol et. Devam?",
    ],
    { title: "SENKRON uygulansın mı?", yes: "Uygula", no: "Vazgeç" }
  );
  if (ans !== "Evet") return void (log("Uygula iptal edildi — timeline değişmedi (rapor duruyor).", "warn"), opEnd("cancel", "Uygulanmadı; timeline değişmedi."));
  for (const l of rounding) log(`  ${l}`, "dim");
  if (!sameTimeline(s0, await snapshot(ctx))) throw new SpreadStop("Onay beklerken timeline değişti. Güvenlik için durduruldu (hiçbir şey yapılmadı).");
  progress(0.1, "Yedek sequence alınıyor…");
  const backup = await makeBackup(ctx, "SENKRON");
  setBackup(backup.name);
  let prev = await snapshot(ctx);
  if (!sameTimeline(s0, prev)) throw new SpreadStop("Yedek alınırken asıl sequence'ın klipleri değişti. Durduruldu.");
  let beforeLast: Snapshot | null = null;
  const lastEnd = s0.clips.reduce((m, c) => (big(c.end) > m ? big(c.end) : m), 0n);
  const pb = await parkBase(ctx, prev);
  const P = ceilTo((pb > cursor + PARK_GAP ? pb : cursor + PARK_GAP) > lastEnd ? (pb > cursor + PARK_GAP ? pb : cursor + PARK_GAP) : lastEnd + PARK_GAP, frame);
  const parked = new Set<ClipInfo>();
  const placed = new Set<ClipInfo>();
  const expected = (): Exp[] =>
    s0.clips.map((c) => {
      const m = moves.find((x) => x.c === c);
      if (!m) return expOf(c);
      if (placed.has(c)) return expOf(c, { start: big(c.start) + m.delta, end: big(c.end) + m.delta });
      if (parked.has(c)) return expOf(c, { start: big(c.start) + P, end: big(c.end) + P });
      return expOf(c);
    });
  // ölçüm: önce kareye oturmayan (harici ses) bir dosya varsa o — tick düzeyinde yerleşip yerleşmediği ölçülsün
  const firstFile = (moves.find((m) => m.file.kind === "audio") ?? moves[0]).file;
  const measure = moves.filter((m) => m.file === firstFile);
  const rest = moves.filter((m) => m.file !== firstFile);
  const step = async (list: Move[], label: string, phase: "park" | "place", isMeasure: boolean) => {
    await expectState(ctx, prev, beforeLast, executed);
    const taken = new Set<ClipInfo>();
    const srcs = list.map((m) => {
      const e = phase === "park" ? expOf(m.c) : expOf(m.c, { start: big(m.c.start) + P, end: big(m.c.end) + P });
      const f = findExp(prev, e, taken);
      if (!f) throw new SpreadStop(`klip yeniden bulunamadı: ${fmtClip(m.c)}`);
      taken.add(f);
      return { m, f };
    });
    const so = await selectClips(ctx, srcs.map((x) => x.f));
    const fresh = srcs.map(({ m, f }) => {
      const g = relocate(so.snap, f);
      if (!g) throw new SpreadStop(`klip yeniden bulunamadı: ${fmtClip(f)}`);
      return { m, g };
    });
    log(`${label}: ${fresh.length} klip aynı track'te ${phase === "park" ? `${secOf(P)} sn ileri` : "yerine (Δ − park)"} kopyalanıyor → ${so.readCount} klip siliniyor (ripple=false).`);
    await runTx(ctx, executed, label, `SENKRON: ${label}`, (ops) => {
      for (const { m, g } of fresh) ops.clone(g, ticks(phase === "park" ? P : m.delta - P), 0, 0);
      ops.remove(so.sel);
    });
    await settle();
    const s = await snapshot(ctx);
    for (const m of list) (phase === "park" ? parked : placed).add(m.c);
    const probs = compareLayout(expected(), s);
    if (probs.length) throw new SpreadStop(isMeasure ? `İLK TAŞIMA TUTMADI (${label}): klip beklenen tick'e gitmedi.` : `"${label}" doğrulaması tutmadı.`, probs);
    log(`✓ ${label} doğrulandı (${list.length} klip, tick düzeyinde).`, "ok");
    trail.note(s, executed.length);
    beforeLast = prev;
    prev = s;
  };
  progress(0.3, `"${firstFile.name}" park alanına (ölçüm)…`);
  await step(measure, "ilk park (ölçüm)", "park", true);
  if (rest.length) {
    progress(0.45, "Kalan dosyalar park alanına…");
    await step(rest, "park", "park", false);
  }
  progress(0.6, `"${firstFile.name}" yerine (ölçüm)…`);
  await step(measure, "ilk yerleştirme (ölçüm)", "place", true);
  if (rest.length) {
    progress(0.8, "Kalan dosyalar yerine…");
    await step(rest, "yerleştir", "place", false);
  }
  const fin = [...compareLayout(expected(), prev), ...snapshotOverlaps(prev)];
  if (fin.length) throw new SpreadStop("SENKRON doğrulaması tutmadı.", fin);
  forgetStopped(ctx.guid);
  log(`✓ SENKRON UYGULANDI: ${nFiles} dosya zamanda taşındı (${executed.length} adım: ${executed.join(", ")}).`, "ok");
  log(`Beğenmezsen: timeline'a tıkla, Ctrl+Z'ye ${executed.length} kez bas — ya da yedek sequence "${backup.name}"i kullan.`, "dim");
  opEnd("ok", `SENKRON uygulandı: ${nFiles} dosya zamanda taşındı.`, `Timeline'ı gözle kontrol et, sonra Topla. Beğenmezsen Ctrl+Z × ${executed.length} ya da yedek sequence "${backup.name}".`);
}

/** Seçim (TOPLA ile aynı kalıp: tam olarak bu klipler, geri okumayla doğrulanır; birebir değilse taşıma yok). */
async function selectClips(ctx: SeqContext, clips: ClipInfo[]) {
  const so = await selectExactly(ctx, clips);
  for (const n of so.notes) log(`   ${n}`, "dim");
  if (!so.exact) throw new SpreadStop("Taşınacak klipler birebir seçilemedi — güvenlik için taşıma yapılmadı.");
  return so;
}
