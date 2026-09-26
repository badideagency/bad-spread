// Arka plan günlüğü (v1.0.0) — arayüzde gizli, her zaman tutulur: bellekte (son satırlar) + dosyada. Premiere API'si YOK.
// Dosya: Windows %USERPROFILE%\AppData\Roaming\BadIdeaAgency\Spread\spread-gunluk.txt,
//        macOS ~/Library/Application Support/BadIdeaAgency/Spread/spread-gunluk.txt (yardımcının klasörünün kardeşi).
// Dosya önceki panel oturumlarını da tutar (son PREV_KEEP satırı; her yeni oturum bir ayraç satırıyla eklenir) ve onların son satırları
// "Sorun bildir"e girer: Premiere çöktüyse / birkaç kez yeniden başladıysa da son TOPLA / BAĞLA günlüğü kaybolmaz.
// Dosyaya yazma gecikmeli ve toplu (UXP fs.writeFileSync); yazılamazsa sessizce bellekte kalır — günlük hiçbir işlemi durdurmaz.
// "Sorun bildir" buradan okur: son işlemlerin günlükleri (TOPLA / BAĞLA / SPREAD), son hata ve ayrıntısı.

interface UxpFs {
  readFileSync(path: string, options: { encoding?: string }): string | ArrayBuffer;
  writeFileSync(path: string, data: string, options: { encoding?: string }): number;
  mkdir(path: string, options: { recursive?: boolean }): Promise<number>;
}
interface UxpOs {
  platform(): string;
  homedir(): string;
}

const MAX_LINES = 4000;
const MAX_OP_LINES = 1500;
const PREV_KEEP = 4000; // dosyada tutulan önceki oturum satırları (en yenileri)
const lines: string[] = [];
const opLogs = new Map<string, { at: string; lines: string[] }>();
let current: { label: string; at: string; lines: string[] } | null = null;
let lastError: { at: string; op: string; headline: string; details: string[] } | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let filePath: string | null | undefined; // undefined: henüz hesaplanmadı; null: yazılamıyor
let loaded = false; // önceki oturumlar dosyadan okundu mu (ilk yazmadan ÖNCE, bir kez)
let flushing: Promise<void> | null = null; // aynı anda tek yazma (zamanlayıcı + "Sorun bildir" çakışmasın)
let again = false;
let previous: string[] = []; // önceki panel oturumlarının günlüğü (dosyadan, ilk yazmadan önce; en çok PREV_KEEP satır)

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);

/**
 * Spread'in veri klasöründeki bir dosyanın yolu (yardımcının klasörünün kardeşi, "Spread" alt klasörü). Windows'ta ayraç "\\"
 * (linker.ts'teki yardımcı dosyalarıyla aynı biçim).
 */
export function spreadDataPath(platform: string, home: string, name: string): string {
  if (/^win/i.test(platform)) return `${home.replace(/[\\/]+$/, "")}\\AppData\\Roaming\\BadIdeaAgency\\Spread\\${name}`;
  return `${home.replace(/\/+$/, "")}/Library/Application Support/BadIdeaAgency/Spread/${name}`;
}

function logFile(): string | null {
  if (filePath !== undefined) return filePath;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("os") as UxpOs;
    filePath = spreadDataPath(os.platform(), os.homedir(), "spread-gunluk.txt"); // uxp.d.ts:L9198 OS.platform, uxp.d.ts:L9232 OS.homedir
  } catch {
    filePath = null;
  }
  return filePath;
}

async function writeOnce(): Promise<void> {
  const p = logFile();
  if (!p) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as UxpFs;
    if (!loaded) {
      loaded = true; // await'ten ÖNCE: ikinci bir yazma eski dosyayı yeniden "önceki" sanmasın
      try {
        await fs.mkdir(p.replace(/[\\/][^\\/]+$/, ""), { recursive: true }); // uxp.d.ts:L9159 fs.mkdir
      } catch {
        /* zaten var */
      }
      // önceki oturumlar: dosyanın son PREV_KEEP satırı bellekte ("Sorun bildir" için) ve dosyada korunur
      try {
        const old = fs.readFileSync(p, { encoding: "utf-8" }); // uxp.d.ts:L8985 fs.readFileSync
        if (typeof old === "string" && old.trim()) previous = old.split(/\r?\n/).filter((l) => l.trim()).slice(-PREV_KEEP);
      } catch {
        /* önceki dosya yok */
      }
    }
    const sep = previous.length ? [...previous, `==== yeni panel oturumu (${lines.length ? lines[0].slice(0, 19) : stamp()}) ====`] : [];
    fs.writeFileSync(p, [...sep, ...lines].join("\n") + "\n", { encoding: "utf-8" }); // uxp.d.ts:L9022 fs.writeFileSync
  } catch {
    /* yazılamıyor → bellekte kalır */
  }
}

/** Tek yazma hattı: yazma sürerken gelen istek, o bitince bir kez daha yazdırır (son satırlar da girsin). */
async function flush(): Promise<void> {
  flushTimer = null;
  if (flushing) {
    again = true;
    return flushing;
  }
  flushing = (async () => {
    do {
      again = false;
      await writeOnce();
    } while (again);
  })();
  try {
    await flushing;
  } finally {
    flushing = null;
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  try {
    flushTimer = setTimeout(() => void flush(), 2000);
  } catch {
    flushTimer = null;
  }
}

/** Her günlük satırı (ui.log) buraya da düşer. */
export function record(msg: string): void {
  const line = `${stamp()} ${msg}`;
  lines.push(line);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  if (current) {
    current.lines.push(line);
    if (current.lines.length > MAX_OP_LINES) current.lines.splice(0, current.lines.length - MAX_OP_LINES);
  }
  scheduleFlush();
}

/** Bir işlem (SPREAD / TOPLA / BAĞLA / …) başladı: o işlemin satırları ayrıca saklanır. */
export function beginOp(label: string): void {
  current = { label, at: stamp(), lines: [] };
  opLogs.set(label, current);
}

export function endOp(): void {
  current = null;
  scheduleFlush();
}

/** Şu anki işlemin satırları (sonuç kutusundaki "Ayrıntı"). */
export function currentOpLines(): string[] {
  return current ? current.lines.slice() : [];
}

export function noteError(op: string, headline: string, details: string[]): void {
  lastError = { at: stamp(), op, headline, details: details.slice(0, 400) };
}

export function snapshotJournal(): {
  lines: string[];
  previous: string[];
  ops: { label: string; at: string; lines: string[] }[];
  lastError: typeof lastError;
  file: string | null;
} {
  return {
    lines: lines.slice(),
    previous: previous.slice(),
    ops: [...opLogs.entries()].map(([label, o]) => ({ label, at: o.at, lines: o.lines.slice() })),
    lastError,
    file: logFile(),
  };
}

/** "Sorun bildir"den önce: bekleyen satırları dosyaya yaz (önceki oturumlar da o an okunmuş olur). */
export async function flushNow(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  await flush();
}
