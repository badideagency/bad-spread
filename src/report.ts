// Rapor metni + karar önerisi ("UXP yeterli / UXP + workaround / CEP'e geç").
// v0.1.1 kuralı: yakalanan bir istisna tek başına "API yok" demek DEĞİL. Her FAIL sınıflıdır:
//   api      → taze referans + Adobe kalıbıyla denendi, API eksik ya da davranış yok (yalnız bu CEP gerekçesi olabilir)
//   kod      → bizim kullanımımız (bayat referans, geçersiz nesne) → panel düzeltilir, karar "GEÇİCİ" kalır
//   belirsiz → sınıflanamadı → karar "GEÇİCİ" kalır

import { TESTS, type TestResult } from "./tests";
import { FAIL_LABEL } from "./timeline";

export const PANEL_VERSION = "0.1.1";
export const TYPINGS_VERSION = "@adobe/premierepro 26.5.0";

export interface Env {
  premiere: string;
  uxp: string;
}

/** Premiere sürümü UXP host bilgisinden okunur (v0.1.0'da Application.version "undefined" döndü). */
export async function readEnv(): Promise<Env> {
  const env: Env = { premiere: "?", uxp: "?" };
  try {
    // UXP çekirdek modülü (Premiere API değil; tipi @adobe/cc-ext-uxp-types içinde "uxp" modülü)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const uxp = require("uxp") as {
      versions?: { uxp?: unknown };
      host?: { name?: unknown; version?: unknown };
    };
    const hv = uxp.host?.version;
    env.premiere = hv !== undefined && hv !== null && String(hv) !== "" ? `${String(hv)} (${String(uxp.host?.name ?? "host")})` : "?";
    env.uxp = String(uxp.versions?.uxp ?? "?");
  } catch (e) {
    env.premiere = `okunamadı (${String(e)})`;
  }
  return env;
}

interface Decision {
  verdict: string;
  reasons: string[];
  workarounds: string[];
  blockers: string[];
  codeBugs: string[];
  unclear: string[];
  missing: string[];
}

const f = (r: TestResult | undefined, k: string): unknown => (r ? r.facts[k] : undefined);
const CORE = new Set(["T2", "T3", "T4", "T7"]);

export function decide(results: Map<string, TestResult>): Decision {
  const reasons: string[] = [];
  const workarounds: string[] = [];
  const blockers: string[] = [];
  const codeBugs: string[] = [];
  const unclear: string[] = [];
  const missing: string[] = [];
  const get = (id: string) => results.get(id);
  const pass = (id: string) => get(id)?.status === "PASS";

  for (const t of TESTS) {
    const r = get(t.id);
    if (!r) {
      missing.push(`${t.id} çalıştırılmadı`);
      continue;
    }
    if (r.status === "BELİRSİZ") {
      missing.push(`${t.id} BELİRSİZ${r.lockError ? " (kilit)" : ""}`);
      continue;
    }
    if (r.status !== "FAIL") continue;
    const cls = r.failClass ?? "belirsiz";
    const why = r.failWhy ?? "ayrıntıya bak";
    if (cls === "kod") {
      codeBugs.push(`${t.id}: ${why}`);
      continue;
    }
    if (cls === "belirsiz") {
      unclear.push(`${t.id}: ${why}`);
      continue;
    }
    // cls === "api": taze referans + Adobe kalıbıyla ölçülmüş davranış
    const mm = (f(r, "mismatchFields") as string[] | undefined) ?? [];
    const onlyTimeFields = mm.length > 0 && mm.every((m) => /:(start|end|inPoint|outPoint)$/.test(m));
    switch (t.id) {
      case "T2":
        blockers.push(`T2: yeni track açılamadı (clone ve insert yolları) — ${why}. Tek UXP çaresi: kullanıcı boş track'leri elle ekler.`);
        break;
      case "T3":
        if (onlyTimeFields && pass("T8"))
          workarounds.push(`T3: kopya zamanları farklı (${mm.join(", ")}) → T8'de çalışan set In/Out/Start/End action'larıyla düzelt.`);
        else if (onlyTimeFields)
          unclear.push(`T3: kopya zamanları farklı (${mm.join(", ")}); set* ile düzeltilebilirliği T8'de kanıtlanmadı`);
        else if (pass("T4") && pass("T7") && mm.length === 0 && Number(f(r, "collateral") ?? 0) === 0)
          workarounds.push(`T3: tek transaction'da taşıma olmadı (${why}) ama clone (T4) ve silme (T7) ayrı ayrı çalışıyor → taşımayı iki adımda yap (tek Ctrl+Z olmaz; önce T1 yedeği).`);
        else blockers.push(`T3: ${why}`);
        break;
      case "T4":
        if (onlyTimeFields && pass("T8"))
          workarounds.push(`T4: kopya zamanları farklı (${mm.join(", ")}) → set In/Out/Start/End action'larıyla aslının değerlerine geri yaz (T8'de çalıştı).`);
        else if (onlyTimeFields)
          unclear.push(`T4: kopya zamanları farklı (${mm.join(", ")}); set* ile düzeltilebilirliği T8'de kanıtlanmadı`);
        else blockers.push(`T4: ${why}`);
        break;
      case "T7":
        blockers.push(`T7: ${why} → zaman konumu korunamaz.`);
        break;
      case "T1":
        workarounds.push(`T1: otomatik yedek yok (${why}) → kullanıcı SPREAD öncesi sequence'ı elle Duplicate eder.`);
        break;
      case "T5":
        workarounds.push(`T5: programla seçim timeline'a yansımıyor (${why}) → SPREAD sonrası kullanıcı klipleri elle seçip Synchronize çalıştırır.`);
        break;
      case "T6":
        workarounds.push(`T6: tek Ctrl+Z hepsini geri almıyor (${why}) → SPREAD öncesi T1 yöntemiyle otomatik sequence yedeği al.`);
        break;
      case "T8":
        workarounds.push(`T8: ${why} → taşınan video+ses bağsız kalabilir; gerekirse kullanıcı Clip > Link ile bağlar.`);
        break;
      default:
        (CORE.has(t.id) ? blockers : workarounds).push(`${t.id}: ${why}`);
    }
  }

  if (pass("T1")) reasons.push(`T1: createCloneAction yedek sequence oluşturuyor ("${String(f(get("T1"), "cloneName"))}").`);
  if (pass("T2")) {
    const t2 = get("T2");
    reasons.push(
      f(t2, "openedV") === true && f(t2, "openedA") === true
        ? "T2: createCloneTrackItemAction, track sayısını aşan ofsetle yeni V ve A track açıyor."
        : "T2: clone track açmıyor ama insert+sil yedek yoluyla boş track açılabiliyor."
    );
    if (!(f(t2, "openedV") === true && f(t2, "openedA") === true))
      workarounds.push("T2: SPREAD önce createInsertProjectItemAction (index = track sayısı) + sil ile boş track açmalı, sonra clone.");
  }
  if (pass("T3")) reasons.push("T3: TEK transaction'da V+A clone + asılları silme çalışıyor; kopyalar tick düzeyinde birebir.");
  const t3 = get("T3");
  if (t3 && f(t3, "linkedAnswer") === "Hayır")
    workarounds.push("T3: clone ile taşınan video+ses kopyaları birbirine BAĞLI değil → bağ gerekiyorsa T8 yolu (overwrite) kullanılmalı.");
  else if (t3 && f(t3, "linkedAnswer") === "Evet") reasons.push("T3: clone ile taşınan video+ses kopyaları bağlı kalıyor.");
  if (pass("T4")) reasons.push("T4: clone kopyası start/end/in/out/speed/disabled/name olarak aslıyla birebir.");
  if (pass("T5")) reasons.push("T5: Adobe kalıbıyla (getSelection+addItem+setSelection) çoklu seçim yapılıyor ve timeline'da görünüyor.");
  if (pass("T6")) reasons.push("T6: T3'ün tek transaction'ı tek Ctrl+Z ile tamamen geri alınıyor.");
  if (pass("T7")) reasons.push("T7: ripple=false silme başka hiçbir klibi kaydırmıyor.");
  const mtf = f(get("T7"), "mediaTypeFilters");
  if (mtf === true)
    reasons.push("T7: createRemoveItemsAction'ın mediaType'ı FİLTRE gibi davranıyor (VIDEO ses klibini silmedi) → video+ses silerken V için VIDEO, A için AUDIO ayrı action.");
  else if (mtf === false)
    reasons.push("T7: mediaType filtre değil (VIDEO ses klibini de sildi) → video+ses tek seçimle tek action'da silinebilir.");
  if (pass("T8")) reasons.push("T8: createOverwriteItemAction V+A'yı bağlı doğuruyor; set In/Out/Start/End ile aslına birebir eşitleniyor.");
  reasons.push("Genel bulgu: TrackItem referansları transaction sonrası geçersiz → SPREAD/RE-STACK tüm taşımaları TEK transaction'da yapmalı; aradaki her adımda sequence yeniden okunmalı.");

  let verdict: string;
  if (blockers.length)
    verdict = "CEP'e geç — aşağıdaki engeller taze referans + Adobe kalıbıyla denenip yine başarısız olan API'ler için.";
  else if (workarounds.length) verdict = "UXP + workaround (aşağıdaki maddeler).";
  else verdict = "UXP yeterli.";
  if (!blockers.length && (codeBugs.length || unclear.length || missing.length))
    verdict = `GEÇİCİ: ${verdict} (kod hatası / belirsiz / eksik test var; kesin karar için düzeltip tekrar çalıştır)`;
  return { verdict, reasons, workarounds, blockers, codeBugs, unclear, missing };
}

export function buildReport(results: Map<string, TestResult>, env: Env | null, setup: string[]): string {
  const L: string[] = [];
  L.push("================================================");
  L.push(`SPREAD PROBE RAPORU — panel v${PANEL_VERSION}`);
  L.push("================================================");
  L.push(`Tarih: ${new Date().toISOString()}`);
  if (env) L.push(`Premiere: ${env.premiere} | UXP: ${env.uxp} | tipler: ${TYPINGS_VERSION}`);
  if (setup.length) {
    L.push("");
    L.push("KURULUM TARAMASI (testlerden önce)");
    for (const s of setup) L.push(`  ${s}`);
  }
  L.push("");
  L.push("ÖZET  (FAIL sınıfı: [API] = API eksik/davranış yok, [KOD] = bizim kullanım hatamız, [BELİRSİZ])");
  for (const t of TESTS) {
    const r = results.get(t.id);
    const st = r ? `${r.status}${r.failClass ? ` [${FAIL_LABEL[r.failClass]}]` : ""}` : "ÇALIŞMADI";
    L.push(`  ${t.id} ${t.title.padEnd(54, ".")} ${st}`);
  }
  L.push("");
  L.push("AYRINTI");
  for (const t of TESTS) {
    const r = results.get(t.id);
    L.push("");
    L.push(`[${t.id}] ${t.title} — ${r ? r.status : "ÇALIŞMADI"}${r?.failClass ? ` [${FAIL_LABEL[r.failClass]}]` : ""}${r ? `  (${r.ranAt})` : ""}`);
    if (!r) continue;
    for (const line of r.lines) L.push(`  ${line}`);
    L.push(`  facts: ${JSON.stringify(r.facts)}`);
  }
  const d = decide(results);
  L.push("");
  L.push("================================================");
  L.push("KARAR ÖNERİSİ");
  L.push("================================================");
  L.push(`Öneri: ${d.verdict}`);
  const section = (title: string, items: string[], mark: string) => {
    if (!items.length) return;
    L.push(title);
    for (const x of items) L.push(`  ${mark} ${x}`);
  };
  section("Engeller (API — CEP gerekçesi):", d.blockers, "✗");
  section("Workaround'lar:", d.workarounds, "~");
  section("Kod/kullanım hataları (panel düzeltilecek; API hakkında karar verdirmez):", d.codeBugs, "!");
  section("Sınıflanamayan hatalar:", d.unclear, "?");
  section("Gerekçe (ölçülenler):", d.reasons, "✓");
  section("Eksik / belirsiz:", d.missing, "?");
  return L.join("\n");
}
