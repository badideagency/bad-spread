// Rapor metni + karar önerisi ("UXP yeterli / UXP + workaround / CEP'e geç").

import { ppro } from "./ppro";
import { TESTS, type TestResult } from "./tests";

export const PANEL_VERSION = "0.1.0";
export const TYPINGS_VERSION = "@adobe/premierepro 26.5.0";

export interface Env {
  premiere: string;
  uxp: string;
  host: string;
}

export async function readEnv(): Promise<Env> {
  const env: Env = { premiere: "?", uxp: "?", host: "?" };
  try {
    env.premiere = String(await ppro.Application.version); // d.ts:L379 Application.version
  } catch (e) {
    env.premiere = `okunamadı (${String(e)})`;
  }
  try {
    // UXP çekirdek modülü (Premiere API değil; tipi @adobe/cc-ext-uxp-types içinde "uxp" modülü)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const uxp = require("uxp") as {
      versions?: { uxp?: unknown };
      host?: { name?: unknown; version?: unknown };
    };
    env.uxp = String(uxp.versions?.uxp ?? "?");
    env.host = `${String(uxp.host?.name ?? "?")} ${String(uxp.host?.version ?? "")}`.trim();
  } catch (e) {
    env.uxp = `okunamadı (${String(e)})`;
  }
  return env;
}

interface Decision {
  verdict: string;
  reasons: string[];
  workarounds: string[];
  blockers: string[];
  missing: string[];
}

const f = (r: TestResult | undefined, k: string): unknown => (r ? r.facts[k] : undefined);

/** Testin ilk hata satırı (yakalanan istisna) ya da genel not. */
function firstError(r: TestResult): string {
  const l = r.lines.find((x) => x.startsWith("HATA") || x.includes("HATA verdi"));
  return l ? l.trim() : "ayrıntıya bak";
}

export function decide(results: Map<string, TestResult>): Decision {
  const reasons: string[] = [];
  const workarounds: string[] = [];
  const blockers: string[] = [];
  const missing: string[] = [];
  const get = (id: string) => results.get(id);
  const need = (id: string) => {
    const r = get(id);
    if (!r) missing.push(`${id} çalıştırılmadı`);
    else if (r.status === "BELİRSİZ") missing.push(`${id} BELİRSİZ`);
    return r;
  };
  /** Özel kurallar bir şey eklemediyse FAIL'i genel madde olarak yaz (ör. istisna ile düşen test). */
  const fallback = (r: TestResult | undefined, before: number, core: boolean) => {
    if (!r || r.status !== "FAIL" || blockers.length + workarounds.length > before) return;
    if (core) blockers.push(`${r.id}: FAIL — ${firstError(r)}`);
    else workarounds.push(`${r.id}: FAIL — ${firstError(r)} (engel değil; elle yapılabilir)`);
  };
  let n: number;

  // T2 — track açma (SPREAD için zorunlu)
  const t2 = need("T2");
  n = blockers.length + workarounds.length;
  if (t2) {
    if (f(t2, "openedV") === true && f(t2, "openedA") === true) {
      reasons.push("T2: createCloneTrackItemAction, track sayısını aşan ofsetle yeni V ve A track açıyor.");
    } else if (t2.status === "PASS") {
      workarounds.push(
        "T2: Clone ofseti track açmıyor → önce createInsertProjectItemAction (index = track sayısı) ile boş track aç, eklenen klibi sil, sonra clone et."
      );
    } else if (t2.status === "FAIL" && f(t2, "fallbackRan") === true) {
      blockers.push(
        "T2: UXP ile yeni track açılamadı (clone ve insert yolları). Tek UXP çaresi: kullanıcı yeterli boş track'i elle ekler (Sequence > Add Tracks)."
      );
    }
  }
  fallback(t2, n, true);

  // T4 — sadakat (zorunlu: senkron zamanlara bağlı)
  const t4 = need("T4");
  n = blockers.length + workarounds.length;
  if (t4) {
    const mm = (f(t4, "mismatchFields") as string[] | undefined) ?? [];
    if (t4.status === "PASS") reasons.push("T4: Kopyanın start/end/in/out/speed/disabled/name değerleri tick düzeyinde birebir aynı.");
    else if (t4.status === "FAIL" && mm.length) {
      if (mm.some((m) => m.endsWith(":speed") || m.endsWith(":kopya-yok"))) {
        blockers.push(`T4: Kopya aslıyla aynı değil ve UXP'de düzeltilemez (hız ayarı yok / kopya oluşmuyor): ${mm.join(", ")}`);
      } else {
        workarounds.push(
          `T4: Kopyada fark var (${mm.join(", ")}) → kopya sonrası createSetStartAction/createSetEndAction/createSetInPointAction/createSetOutPointAction/createSetDisabledAction/createSetNameAction ile aslının değerlerine geri yaz.`
        );
      }
    }
  }
  fallback(t4, n, true);

  // T7 — ripple (zorunlu: senkron bozulmamalı)
  const t7 = need("T7");
  n = blockers.length + workarounds.length;
  if (t7) {
    if (t7.status === "PASS") reasons.push("T7: ripple=false silme diğer klipleri kaydırmıyor.");
    else if (t7.status === "FAIL") {
      if (f(t7, "targetRemoved") === false) blockers.push("T7: createRemoveItemsAction klibi silemedi.");
      if (Number(f(t7, "shifted") ?? 0) > 0 || Number(f(t7, "missing") ?? 0) > 0)
        blockers.push("T7: ripple=false olsa bile silme başka klipleri kaydırıyor/siliyor → zaman konumu korunamaz.");
    }
  }
  fallback(t7, n, true);

  // T5 — seçim (SPREAD sonunda seçili bırakmak için; elle seçim mümkün olduğundan engel değil)
  const t5 = need("T5");
  n = blockers.length + workarounds.length;
  if (t5) {
    if (t5.status === "PASS") reasons.push("T5: Programla çoklu seçim yapılabiliyor ve timeline'da görünüyor.");
    else if (t5.status === "FAIL")
      workarounds.push("T5: Programla seçim timeline'a yansımıyor → SPREAD sonrası kullanıcı klipleri elle seçip Synchronize çalıştırır.");
  }
  fallback(t5, n, false);

  // T3 — bağlı çift stratejisi (bilgi; asıl silinemiyorsa engel)
  const t3 = need("T3");
  n = blockers.length + workarounds.length;
  if (t3) {
    const came = f(t3, "linkedAudioCame");
    const linked = f(t3, "copyLinked");
    const orphan = f(t3, "orphanAudio");
    if (t3.status === "FAIL" && f(t3, "camVRemoved") === false) blockers.push("T3: Asıl video createRemoveItemsAction ile silinemedi.");
    if (came === true)
      reasons.push(
        `T3: Video kopyalanınca bağlı sesi de geliyor (kopya bağlı: ${String(linked)}) → SPREAD kamera klibini tek clone ile V+A olarak taşıyabilir.`
      );
    else if (came === false)
      reasons.push("T3: Video kopyalanınca bağlı ses gelmiyor → SPREAD video ve sesi ayrı ayrı clone etmeli.");
    // Not: ölçüm yalnız "seçimde sadece video + mediaType=VIDEO" çağrısı için geçerli.
    if (orphan === true)
      reasons.push("T3: Seçimde yalnız video varken (mediaType=VIDEO) silinince asıl ses yetim kalıyor → SPREAD bu çağrıyla sildiğinde asıl sesi ayrıca silmeli.");
    else if (orphan === false)
      reasons.push("T3: Seçimde yalnız video varken (mediaType=VIDEO) silinince bağlı ses de gidiyor → SPREAD sesi ayrıca silmemeli (çift silme).");
  }
  fallback(t3, n, true);

  // T6 — geri alma (UX; engel değil)
  const t6 = need("T6");
  n = blockers.length + workarounds.length;
  if (!t6) {
    /* need() eksik olarak yazdı */
  } else if (t6.status === "PASS") reasons.push("T6: Tek transaction tek Ctrl+Z ile tamamen geri alınıyor.");
  else if (t6.status === "FAIL" && f(t6, "restored") === false)
    workarounds.push("T6: Tek Ctrl+Z hepsini geri almıyor → SPREAD öncesi T1 yöntemiyle otomatik sequence yedeği al.");
  fallback(t6, n, false);

  // T1 — yedek (UX; engel değil)
  const t1 = need("T1");
  n = blockers.length + workarounds.length;
  if (!t1) {
    /* need() eksik olarak yazdı */
  } else if (t1.status === "PASS") reasons.push(`T1: createCloneAction yedek sequence oluşturuyor ("${String(f(t1, "cloneName"))}").`);
  else if (t1.status === "FAIL") workarounds.push(`T1: Otomatik yedek yok (${firstError(t1)}) → kullanıcı SPREAD öncesi sequence'ı elle Duplicate eder.`);
  fallback(t1, n, false);

  let verdict: string;
  if (blockers.length) verdict = "CEP'e geç (ya da ilgili adımı elle yaptır) — UXP'de aşılamayan engel var.";
  else if (workarounds.length) verdict = "UXP + workaround (aşağıdaki maddeler).";
  else verdict = "UXP yeterli.";
  if (missing.length && !blockers.length) verdict = `GEÇİCİ: ${verdict} (eksik/belirsiz test var; kesin karar için tamamla)`;
  return { verdict, reasons, workarounds, blockers, missing };
}

export function buildReport(results: Map<string, TestResult>, env: Env | null, setup: string[]): string {
  const L: string[] = [];
  L.push("================================================");
  L.push(`SPREAD PROBE RAPORU — panel v${PANEL_VERSION}`);
  L.push("================================================");
  L.push(`Tarih: ${new Date().toISOString()}`);
  if (env) L.push(`Premiere: ${env.premiere} | UXP: ${env.uxp} | host: ${env.host} | tipler: ${TYPINGS_VERSION}`);
  if (setup.length) {
    L.push("");
    L.push("KURULUM TARAMASI (testlerden önce)");
    for (const s of setup) L.push(`  ${s}`);
  }
  L.push("");
  L.push("ÖZET");
  for (const t of TESTS) {
    const r = results.get(t.id);
    L.push(`  ${t.id} ${t.title.padEnd(52, ".")} ${r ? r.status : "ÇALIŞMADI"}`);
  }
  L.push("");
  L.push("AYRINTI");
  for (const t of TESTS) {
    const r = results.get(t.id);
    L.push("");
    L.push(`[${t.id}] ${t.title} — ${r ? r.status : "ÇALIŞMADI"}${r ? `  (${r.ranAt})` : ""}`);
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
  if (d.blockers.length) {
    L.push("Engeller:");
    for (const b of d.blockers) L.push(`  ✗ ${b}`);
  }
  if (d.workarounds.length) {
    L.push("Workaround'lar:");
    for (const w of d.workarounds) L.push(`  ~ ${w}`);
  }
  if (d.reasons.length) {
    L.push("Gerekçe (ölçülenler):");
    for (const x of d.reasons) L.push(`  ✓ ${x}`);
  }
  if (d.missing.length) {
    L.push("Eksik / belirsiz:");
    for (const m of d.missing) L.push(`  ? ${m}`);
  }
  return L.join("\n");
}
