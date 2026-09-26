// BAĞLAMA MODÜLÜ — tek ve izole. BAĞLA yalnız buradaki `Linker` arayüzünü görür.
//
// Neden ayrı: Premiere UXP'de link/unlink API'si YOK (Probe v0.1.1). Bu sürümde bağlama, görünmez CEP yardımcısının
// (cep-helper/) ExtendScript `Sequence.linkSelection()` çağrısıyla yapılır. CEP/ExtendScript Adobe tarafından emekliye
// ayrılıyor; ileride XML yolu ya da bir UXP link API'si geldiğinde YALNIZ bu dosya değişir.
//
// Güvenlik: yardımcı yalnız 127.0.0.1:HELPER_PORT'u dinler; her açılışta ürettiği rastgele token'ı kullanıcının kendi
// klasöründeki küçük bir dosyaya yazar (Windows: %USERPROFILE%\AppData\Roaming\BadIdeaAgency\SpreadHelper\helper.json,
// macOS: ~/Library/Application Support/BadIdeaAgency/SpreadHelper/helper.json). Panel token'ı oradan okur ve her istekte
// "X-Spread-Token" başlığıyla gönderir. Tarayıcıdaki bir sayfa bu dosyayı okuyamaz ve özel başlıklı istek gönderemez.
// UXP API'leri: @adobe/cc-ext-uxp-types (uxp.d.ts) — satırlar `npm run check:api` ile doğrulanır.

export const HELPER_PORT = 47731;
export const HELPER_VERSION = "0.3.0";
const PING_TIMEOUT_MS = 3000;
/** Bağlama grupları yardımcıya parti parti gönderilir (uzun çekimlerde tek istek zaman aşımına uğramasın). */
const LINK_BATCH = 8;
const LINK_TIMEOUT_MS = 90000;
/** Yardımcının (cep-helper/js/helper.js) kabul ettiği sınırlar — iki dosyada AYNI olmalı. BAĞLA planı kesmeden ÖNCE denetler. */
export const LINK_LIMITS = { groupItems: 256, groupsPerRequest: 64, name: 1024, sequenceName: 512 };

export interface LinkItem {
  kind: "V" | "A";
  track: number;
  start: string;
  end: string;
  /** kaynak (proje öğesi) adı */
  name: string;
}

export interface LinkGroup {
  id: string;
  items: LinkItem[];
}

export interface LinkGroupResult {
  id: string;
  total: number;
  found: number;
  missing: string[];
  linked: boolean;
  /** getLinkedItems ile doğrulandı mı; null = doğrulanamadı (API yok / hata) */
  verified: boolean | null;
  detail: string;
}

export interface PingResult {
  ok: boolean;
  helper?: string;
  premiere?: string;
  sequence?: string;
  detail: string;
}

export interface LinkOutcome {
  ok: boolean;
  sequence: string;
  results: LinkGroupResult[];
  detail: string;
}

export interface Linker {
  readonly name: string;
  ping(): Promise<PingResult>;
  /** @param sequenceName aktif olması beklenen sequence (yardımcı başka sequence'ta hiçbir şey yapmaz) */
  link(sequenceName: string, groups: LinkGroup[]): Promise<LinkOutcome>;
  /** Yardımcı yoksa kullanıcıya gösterilecek kurulum talimatı. */
  installHint(): string[];
}

// ------------------------------------------------------------------ CEP yardımcısı (HTTP, yalnız localhost)

interface UxpOs {
  platform(): string;
  homedir(): string;
}
interface UxpFs {
  readFileSync(path: string, options: { encoding?: string }): string | ArrayBuffer;
}

/** Token dosyasının yolu (yardımcıyla AYNI kural: ev klasörü + sabit alt yol). */
export function helperInfoPath(platform: string, home: string): string {
  if (/^win/i.test(platform)) return `${home.replace(/[\\/]+$/, "")}\\AppData\\Roaming\\BadIdeaAgency\\SpreadHelper\\helper.json`;
  return `${home.replace(/\/+$/, "")}/Library/Application Support/BadIdeaAgency/SpreadHelper/helper.json`;
}

interface HelperInfo {
  port: number;
  token: string;
  version: string;
}

async function readHelperInfo(): Promise<HelperInfo> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os") as UxpOs;
  const path = helperInfoPath(os.platform(), os.homedir()); // uxp.d.ts:L9198 OS.platform, uxp.d.ts:L9232 OS.homedir
  let text: string | null = null;
  const errs: string[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as UxpFs;
    const r = fs.readFileSync(path, { encoding: "utf-8" }); // uxp.d.ts:L8985 fs.readFileSync
    if (typeof r === "string") text = r;
  } catch (e) {
    errs.push(`fs: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (text === null) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const uxp = require("uxp") as { storage: { localFileSystem: { getEntryWithUrl(u: string): Promise<{ read(o?: object): Promise<unknown> }> } } };
      const fwd = path.replace(/\\/g, "/");
      // Adobe dosya sistemi tarifi: Windows'ta "file:/C:/Users/…", macOS'ta "file:/Users/…"
      const entry = await uxp.storage.localFileSystem.getEntryWithUrl(fwd.startsWith("/") ? "file:" + fwd : "file:/" + fwd); // uxp.d.ts:L516 FileSystemProvider.getEntryWithUrl
      const r = await entry.read(); // uxp.d.ts:L345 File.read
      if (typeof r === "string") text = r;
    } catch (e) {
      errs.push(`localFileSystem: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (text === null) throw new Error(`yardımcı bilgi dosyası okunamadı (${path}) — ${errs.join(" | ")}`);
  const j = JSON.parse(text) as Partial<HelperInfo>;
  if (typeof j.token !== "string" || j.token.length < 32) throw new Error("yardımcı bilgi dosyasında token yok");
  if (j.port !== HELPER_PORT) throw new Error(`yardımcı başka bir portta (${String(j.port)}), panel ${HELPER_PORT} bekliyor`);
  return { port: j.port, token: j.token, version: String(j.version ?? "?") };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: ${ms / 1000} sn içinde yanıt yok`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e: unknown) => (clearTimeout(t), reject(e instanceof Error ? e : new Error(String(e))))
    );
  });
}

async function post(path: string, body: unknown, ms: number): Promise<Record<string, unknown>> {
  const info = await readHelperInfo();
  const res = await withTimeout(
    fetch(`http://127.0.0.1:${HELPER_PORT}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Spread-Token": info.token },
      body: JSON.stringify(body),
    }),
    ms,
    path
  );
  const text = await res.text();
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${path}: yanıt JSON değil (HTTP ${res.status})`);
  }
  if (!res.ok || j.ok !== true) throw new Error(`${path}: ${String(j.error ?? `HTTP ${res.status}`)}`);
  return j;
}

class CepLinker implements Linker {
  readonly name = "CEP yardımcısı (ExtendScript linkSelection)";

  async ping(): Promise<PingResult> {
    try {
      const j = await post("/v1/ping", {}, PING_TIMEOUT_MS);
      const helper = String(j.helper ?? "?");
      const premiere = String(j.premiere ?? "?");
      const sequence = typeof j.sequence === "string" ? j.sequence : undefined;
      if (helper !== HELPER_VERSION)
        return { ok: false, helper, premiere, sequence, detail: `yardımcı sürümü ${helper}, panel ${HELPER_VERSION} bekliyor — yardımcıyı güncelle` };
      return { ok: true, helper, premiere, sequence, detail: `bağlı (yardımcı ${helper}, Premiere ${premiere})` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async link(sequenceName: string, groups: LinkGroup[]): Promise<LinkOutcome> {
    const results: LinkGroupResult[] = [];
    let sequence = "?";
    for (let i = 0; i < groups.length; i += LINK_BATCH) {
      const batch = groups.slice(i, i + LINK_BATCH);
      try {
        const j = await post("/v1/link", { sequence: sequenceName, groups: batch }, LINK_TIMEOUT_MS);
        sequence = String(j.sequence ?? sequence);
        if (Array.isArray(j.results)) results.push(...(j.results as LinkGroupResult[]));
      } catch (e) {
        // bu parti ve sonrakiler gönderilmedi / yanıt yok → sonuçsuz kalır (BAĞLA hangi grupların bağlanmadığını raporlar)
        const why = e instanceof Error ? e.message : String(e);
        return { ok: false, sequence, results, detail: `${i / LINK_BATCH + 1}. parti (${batch.map((g) => g.id).join(", ")}) başarısız: ${why}` };
      }
    }
    return { ok: true, sequence, results, detail: "" };
  }

  installHint(): string[] {
    return [
      "Yardımcı (Spread Helper, görünmez CEP eklentisi) kurulu değil ya da çalışmıyor.",
      "Kurulum: KURULUM_TR.md → \"Yardımcıyı kur\" (release/spread-helper paketi). Kurduktan sonra Premiere'i kapatıp aç.",
      `Kuruluysa: Premiere'i yeniden başlat; panelde "Yardımcıyı kontrol et"e bas. (127.0.0.1:${HELPER_PORT} başka bir programca kullanılıyor olabilir.)`,
    ];
  }
}

let current: Linker | null = null;

export function getLinker(): Linker {
  return (current ??= new CepLinker());
}
