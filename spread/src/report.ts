// "Sorun bildir" (v1.0.0) — tek metin paketi: sürümler, yardımcı durumu, son hata + ayrıntısı, kalibrasyon sonucu, son SPREAD / TOPLA /
// BAĞLA günlükleri, aktif sequence Durum raporu, ayrıntılı günlüğün sonu. Panoya kopyalanır ve masaüstüne SpreadRapor_<tarih>.txt
// olarak kaydedilmeye çalışılır (olmazsa Spread'in veri klasörüne). Salt okuma: timeline'a dokunmaz.

import { hostVersion } from "./calibrate";
import { snapshotJournal, spreadDataPath } from "./journal";
import { getLinker } from "./linker";
import { errText } from "./model";
import { requireActive } from "./session";
import { loadTrimCal } from "./settings";
import { buildStatusReport } from "./status";
import { describeCal } from "./trimcal";
import { SPREAD_VERSION } from "./version";

interface UxpFs {
  writeFileSync(path: string, data: string, options: { encoding?: string }): number;
  mkdir(path: string, options: { recursive?: boolean }): Promise<number>;
}
interface UxpOs {
  platform(): string;
  homedir(): string;
}

function uxpVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const uxp = require("uxp") as { versions?: { uxp?: unknown } };
    return String(uxp.versions?.uxp ?? "?"); // uxp.d.ts:L9543 Versions.uxp
  } catch {
    return "?";
  }
}

const tail = (ls: string[], n: number) => (ls.length > n ? [`… (${ls.length - n} satır önce)`, ...ls.slice(-n)] : ls);

/** @param allowRead false → işlem sürerken: sequence okunmaz (Durum raporu atlanır) */
export async function buildIssueReport(allowRead: boolean): Promise<string> {
  const L: string[] = [];
  const host = hostVersion();
  L.push("==================== SPREAD SORUN RAPORU ====================");
  L.push(`Tarih: ${new Date().toISOString()}`);
  const ping = await getLinker()
    .ping()
    .catch((e: unknown) => ({ ok: false, detail: errText(e) }));
  L.push(`Sürümler: Spread ${SPREAD_VERSION} · Premiere ${host} · UXP ${uxpVersion()} · yardımcı: ${ping.ok ? ping.detail : "bağlı değil"}`);
  L.push(`Yardımcı durumu: ${ping.ok ? "bağlı" : "BAĞLI DEĞİL"} — ${ping.detail}`);
  const j = snapshotJournal();
  L.push(`Arka plan günlük dosyası: ${j.file ?? "yok"}`);
  L.push("");
  L.push("---- SON HATA ----");
  if (j.lastError) {
    L.push(`${j.lastError.at} ${j.lastError.op}: ${j.lastError.headline}`);
    for (const d of tail(j.lastError.details, 250)) L.push(`  ${d}`);
  } else L.push("(bu oturumda hata yok)");
  L.push("");
  L.push("---- KALİBRASYON SONUCU ----");
  let guid: string | null = null;
  let seqName = "?";
  try {
    const ctx = await requireActive();
    guid = ctx.guid;
    seqName = ctx.name;
  } catch (e) {
    L.push(`(aktif sequence okunamadı: ${errText(e)})`);
  }
  const cal = guid ? loadTrimCal(guid, host) : null;
  if (cal) {
    L.push(`sequence "${seqName}", ölçüm ${cal.at}, Premiere ${cal.host}, δ = ${cal.delta} tick`);
    for (const l of describeCal(cal)) L.push(`  ${l}`);
  } else L.push("(bu sequence için saklı ölçüm yok)");
  const calLog = j.lines.filter((l) => /KALİBRASYON|tek başına \(|BİRLİKTE/.test(l));
  if (calLog.length) {
    L.push("günlükteki kalibrasyon satırları:");
    for (const l of tail(calLog, 40)) L.push(`  ${l}`);
  }
  for (const op of ["SPREAD", "TOPLA", "BAĞLA"]) {
    const o = j.ops.find((x) => x.label === op);
    L.push("");
    L.push(`---- SON ${op} GÜNLÜĞÜ ${o ? `(${o.at})` : ""} ----`);
    if (o) for (const l of tail(o.lines, 400)) L.push(l);
    else L.push("(bu oturumda çalışmadı)");
  }
  L.push("");
  L.push("---- DURUM RAPORU (aktif sequence) ----");
  if (!allowRead) L.push("(bir işlem sürüyordu — sequence okunmadı)");
  else
    try {
      L.push(await buildStatusReport());
    } catch (e) {
      L.push(`(okunamadı: ${errText(e)})`);
    }
  L.push("");
  L.push("---- AYRINTILI GÜNLÜK (son satırlar) ----");
  for (const l of tail(j.lines, 600)) L.push(l);
  return L.join("\n");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Masaüstüne (olmazsa veri klasörüne) kaydeder. */
export async function saveIssueReport(text: string): Promise<{ ok: boolean; path: string; detail: string }> {
  const d = new Date();
  const name = `SpreadRapor_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.txt`;
  const errs: string[] = [];
  let fs: UxpFs;
  let os: UxpOs;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fs = require("fs") as UxpFs;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    os = require("os") as UxpOs;
  } catch (e) {
    return { ok: false, path: "?", detail: errText(e) };
  }
  const platform = os.platform(); // uxp.d.ts:L9198 OS.platform
  const home = os.homedir().replace(/\\/g, "/").replace(/\/+$/, ""); // uxp.d.ts:L9232 OS.homedir
  const win = /^win/i.test(platform);
  // ayraç "/" (Adobe'nin UXP dosya örneği gibi); OneDrive masaüstü yönlendirmesi de denenir
  const targets = [
    `${home}/Desktop/${name}`,
    ...(win ? [`${home}/OneDrive/Desktop/${name}`, `${home}/OneDrive/Masaüstü/${name}`] : []),
    spreadDataPath(platform, home, name),
  ];
  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    try {
      if (i === targets.length - 1) {
        try {
          await fs.mkdir(p.replace(/[\\/][^\\/]+$/, ""), { recursive: true }); // uxp.d.ts:L9159 fs.mkdir
        } catch {
          /* zaten var */
        }
      }
      fs.writeFileSync(p, text, { encoding: "utf-8" }); // uxp.d.ts:L9022 fs.writeFileSync
      return { ok: true, path: p, detail: errs.join(" | ") };
    } catch (e) {
      errs.push(`${p}: ${errText(e)}`);
    }
  }
  return { ok: false, path: targets[0], detail: errs.join(" | ") };
}
