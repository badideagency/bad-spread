// BAĞLAMA MODÜLÜ — tek ve izole. BAĞLA yalnız buradaki `Linker` arayüzünü görür.
//
// Neden ayrı: Premiere UXP'de link/unlink API'si YOK (Probe v0.1.1). Bu sürümde bağlama, CEP yardımcı panelinin (cep-helper/,
// Window > Extensions (Legacy) > Spread Helper) ExtendScript `Sequence.linkSelection()` çağrısıyla yapılır — köprüyle (HTTP, tek tık)
// ya da köprüsüz (KES planı dosyası → yardımcı paneldeki BAĞLA). CEP/ExtendScript Adobe tarafından emekliye
// ayrılıyor; ileride XML yolu ya da bir UXP link API'si geldiğinde YALNIZ bu dosya değişir.
//
// Adres: http://localhost:HELPER_PORT — UXP ağ izni IP yazılı alan adlarını ("http://127.0.0.1") kabul etmiyor (Premiere 26.5 Windows'ta
// "Permission denied … Manifest entry not found"; kaynaklar handoff.md'de). Yardımcı 127.0.0.1 ve ::1'i dinler.
// Güvenlik: yardımcı yalnız geri döngüyü (127.0.0.1 / ::1) dinler; her açılışta ürettiği rastgele token'ı kullanıcının kendi
// klasöründeki küçük bir dosyaya yazar (Windows: %USERPROFILE%\AppData\Roaming\BadIdeaAgency\SpreadHelper\helper.json,
// macOS: ~/Library/Application Support/BadIdeaAgency/SpreadHelper/helper.json). Panel token'ı oradan okur ve her istekte
// "X-Spread-Token" başlığıyla gönderir. Tarayıcıdaki bir sayfa bu dosyayı okuyamaz ve özel başlıklı istek gönderemez.
// UXP API'leri: @adobe/cc-ext-uxp-types (uxp.d.ts) — satırlar `npm run check:api` ile doğrulanır.

import { SPREAD_VERSION } from "./version";

export const HELPER_PORT = 47731;
/** manifest.json requiredPermissions.network.domains ile AYNI ad (IP değil). */
export const HELPER_URL = `http://localhost:${HELPER_PORT}`;
export const HELPER_VERSION = SPREAD_VERSION; // yardımcı ve panel aynı sürümle yayımlanır (v1.0.0)
const PING_TIMEOUT_MS = 3000;
/** Bağlama grupları yardımcıya parti parti gönderilir (uzun çekimlerde tek istek zaman aşımına uğramasın). */
const LINK_BATCH = 8;
// v1.1.0: yardımcı bir partiyi reddedilince bir kez daha dener (iki ExtendScript çağrısı, her biri en çok 170 sn) → istemci bekler
const LINK_TIMEOUT_MS = 360000;
/** v1.2.0: indirme (≤ 60 sn / istek) + Adobe kurucusu /install (≤ 5 dk) + /list all (≤ 1 dk) + pay */
const UPDATE_TIMEOUT_MS = 600000;
/** v1.2.0: projeleri kaydetme (yardımcı en çok 2 dk) */
const RESTART_TIMEOUT_MS = 180000;
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
  /**
   * v1.1.0: ilk linkSelection false döndü ve grupta kanal tipi farklı sesler vardı → yardımcı onları çıkarıp ikinci kez denedi.
   * linked / verified / detail ikinci denemenin sonucudur; firstDetail ilkinin.
   */
  retried?: boolean;
  firstDetail?: string;
  /** ikinci denemede bağ dışında bırakılan sesler ("A3 \"x.MP4\" [..] stereo") — SİLİNMEZ, yerinde kalır */
  excluded?: string[];
}

/** v1.1.0: ses klibinin kanal tipi (ExtendScript AudioChannelMapping.audioChannelsType; null = okunamadı) */
export interface ChannelsOutcome {
  ok: boolean;
  types: (number | null)[];
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

/** v1.2.0: yardımcının kurduğu güncelleme (paneli Adobe'nin kurucusu kuramadıysa "manual": .ccx Creative Cloud'da açıldı). */
export interface UpdateOutcome {
  version: string;
  panel: "installed" | "manual";
  backup: string;
  ccx?: string;
  why?: string;
}

export interface Linker {
  readonly name: string;
  ping(): Promise<PingResult>;
  /**
   * v1.2.0: güncellemeyi yardımcıya yaptırır — yardımcı latest.json'u kendisi okur, indirir, sha256'yı doğrular, yedekleyip kurar.
   * Gövdede yalnız beklenen sürüm ve panelin sürümü gider. Hata fırlatır (eski sürüm yerinde kalır).
   */
  update(version: string): Promise<UpdateOutcome>;
  /** v1.2.0: açık projeler kaydedilip doğrulanırsa Premiere'i yeniden başlatır; doğrulanamazsa hata fırlatır (Premiere kapanmaz). */
  restart(): Promise<{ project: string }>;
  /** v1.2.0 ↻: yardımcıya panelini yeniden yüklemesini söyler (sunucu kısa süre kapanır). Ulaşılamazsa false. */
  reloadHelper(): Promise<boolean>;
  /** @param sequenceName aktif olması beklenen sequence (yardımcı başka sequence'ta hiçbir şey yapmaz) */
  link(sequenceName: string, groups: LinkGroup[]): Promise<LinkOutcome>;
  /** v1.1.0: ses kliplerinin kanal tipleri (salt okuma; onaydaki "mono + stereo karışık" uyarısı için). Hata fırlatmaz. */
  channels(sequenceName: string, items: LinkItem[]): Promise<ChannelsOutcome>;
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
  writeFileSync(path: string, data: string, options: { encoding?: string }): number;
  mkdir(path: string, options: { recursive?: boolean }): Promise<number>;
  /** geri çağrısız → Promise (belge: "if not provided, this function will return Promise object") */
  unlink(path: string): Promise<number>;
}

/** Token dosyasının yolu (yardımcıyla AYNI kural: ev klasörü + sabit alt yol). */
export function helperInfoPath(platform: string, home: string): string {
  if (/^win/i.test(platform)) return `${home.replace(/[\\/]+$/, "")}\\AppData\\Roaming\\BadIdeaAgency\\SpreadHelper\\helper.json`;
  return `${home.replace(/\/+$/, "")}/Library/Application Support/BadIdeaAgency/SpreadHelper/helper.json`;
}

/** KES planı: bilgi dosyasıyla aynı klasörde (yardımcı: cep-helper/js/helper.js planPath ile AYNI kural). */
export function helperPlanPath(platform: string, home: string): string {
  return helperInfoPath(platform, home).replace(/helper\.json$/, "link-plan.json");
}

/** Yardımcı paneldeki BAĞLA'nın sonucu (yardımcı: resultPath ile AYNI kural). */
export function helperResultPath(platform: string, home: string): string {
  return helperInfoPath(platform, home).replace(/helper\.json$/, "link-result.json");
}

/** v1.2.0: yardımcının güncelleme günlüğü (updater.js update.log; bilgi dosyasıyla aynı klasör) — Sorun bildir raporu için. */
export function readUpdateLog(maxLines = 120): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("os") as UxpOs;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as UxpFs;
    const p = helperInfoPath(os.platform(), os.homedir()).replace(/helper\.json$/, "update.log"); // uxp.d.ts:L9198 OS.platform, uxp.d.ts:L9232 OS.homedir
    const r = fs.readFileSync(p, { encoding: "utf-8" }); // uxp.d.ts:L8985 fs.readFileSync
    const lines = (typeof r === "string" ? r : "").split(/\r?\n/).filter((l) => l.trim());
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

export interface PanelLinkResult {
  sequence: string;
  planCreatedAt: string | null;
  at: string;
  ok: boolean;
  summary: string;
}

/** Yardımcı paneldeki son BAĞLA'nın sonucu (yoksa / okunamazsa null — yalnız durum raporu için). */
export function readPanelLinkResult(): PanelLinkResult | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("os") as UxpOs;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as UxpFs;
    const r = fs.readFileSync(helperResultPath(os.platform(), os.homedir()), { encoding: "utf-8" }); // uxp.d.ts:L8985 fs.readFileSync, uxp.d.ts:L9198 OS.platform, uxp.d.ts:L9232 OS.homedir
    const j = JSON.parse(typeof r === "string" ? r : "") as Partial<PanelLinkResult> & { kind?: string };
    if (j.kind !== "spread-link-result" || typeof j.sequence !== "string" || typeof j.summary !== "string") return null;
    return { sequence: j.sequence, planCreatedAt: typeof j.planCreatedAt === "string" ? j.planCreatedAt : null, at: String(j.at ?? "?"), ok: j.ok === true, summary: j.summary };
  } catch {
    return null;
  }
}

interface HelperInfo {
  port: number;
  token: string;
  version: string;
  startedAt: string;
  pid: string;
}

/** Teşhis adımı: hangi aşamada koptu (panelde ve günlükte yazılır). */
class HelperError extends Error {
  constructor(
    readonly stage: "bilgi dosyası" | "bağlantı" | "yanıt",
    message: string
  ) {
    super(message);
  }
}

const raw = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

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
  if (text === null)
    throw new HelperError(
      "bilgi dosyası",
      `yardımcının bilgi dosyası okunamadı (${path}). Yardımcı hiç BAŞLAMAMIŞ olabilir: Premiere'de Window → Extensions (Legacy) → ` +
        `Spread Helper panelini aç (sunucu panel açıkken çalışır). Panel açık ve "dinliyor" diyorsa sorun UXP'nin dosya okuma izninde. ` +
        `Ham hata: ${errs.join(" | ")}`
    );
  let j: Partial<HelperInfo>;
  try {
    j = JSON.parse(text) as Partial<HelperInfo>;
  } catch (e) {
    throw new HelperError("bilgi dosyası", `bilgi dosyası JSON değil (${path}): ${raw(e)}`);
  }
  if (typeof j.token !== "string" || j.token.length < 32) throw new HelperError("bilgi dosyası", `bilgi dosyasında token yok (${path})`);
  if (j.port !== HELPER_PORT) throw new HelperError("bilgi dosyası", `yardımcı başka bir portta (${String(j.port)}), panel ${HELPER_PORT} bekliyor`);
  return { port: j.port, token: j.token, version: String(j.version ?? "?"), startedAt: String(j.startedAt ?? "?"), pid: String(j.pid ?? "?") };
}

/** fetch hatasını sınıflar: UXP izin reddi mi, sunucuya ulaşılamadı mı (ham hata HER ZAMAN yazılır). */
function fetchProblem(e: unknown, info: HelperInfo): string {
  const r = raw(e);
  if (/permission|not permitted|not allowed|denied|manifest|domain|blocked/i.test(r))
    return (
      `UXP İZİN REDDİ: Spread paneli ${HELPER_URL} adresine istek gönderemedi (manifest'teki ağ izni ` +
      `requiredPermissions.network.domains bu adresi kapsamıyor ya da UXP localhost'u engelliyor). Ham hata: ${r}`
    );
  return (
    `yardımcının bilgi dosyası var (başlama ${info.startedAt}, süreç ${info.pid}) ama UXP bağlanamadı. Ham hata: ${r}. ` +
    `Yardımcı paneldeki "son istek" bu anda DEĞİŞMEDİYSE istek sunucuya hiç ulaşmadı → UXP localhost'u engelliyor ya da yardımcı ` +
    `kapandı (paneli açık tut; panel kapanınca sunucu da durur).`
  );
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
  let res: Response;
  try {
    res = await withTimeout(
      fetch(`${HELPER_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Spread-Token": info.token },
        body: JSON.stringify(body),
      }),
      ms,
      path
    );
  } catch (e) {
    throw new HelperError("bağlantı", fetchProblem(e, info));
  }
  const text = await res.text();
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new HelperError("yanıt", `${path}: yanıt JSON değil (HTTP ${res.status})`);
  }
  if (!res.ok || j.ok !== true)
    throw new HelperError("yanıt", `${path}: ${String(j.error ?? `HTTP ${res.status}`)}${res.status === 401 ? " (token eski: yardımcı yeniden başlamış olabilir, tekrar dene)" : ""}`);
  return j;
}

/** v1.2.1: bu sequence'ın KES planının metni (dosya yoksa / başka sequence'ınsa null) — records.ts geri yükleme için saklar. */
export function readLinkPlanText(guid: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("os") as UxpOs;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as UxpFs;
    const r = fs.readFileSync(helperPlanPath(os.platform(), os.homedir()), { encoding: "utf-8" }); // uxp.d.ts:L8985 fs.readFileSync, uxp.d.ts:L9198 OS.platform, uxp.d.ts:L9232 OS.homedir
    const text = typeof r === "string" ? r : "";
    const plan = JSON.parse(text) as { kind?: string; sequence?: { guid?: string } };
    return plan.kind === "spread-link-plan" && plan.sequence?.guid === guid ? text : null;
  } catch {
    return null;
  }
}

/**
 * v1.2.1: bu sequence'ın ESKİ KES planını (link-plan.json) ve onun paneldeki bağlama sonucunu (link-result.json) siler — başka bir
 * sequence'ın planına dokunmaz. @param createdAt verilirse yalnız o plan. @returns silinen dosya sayısı (okunamazsa / yoksa 0)
 */
export async function dropLinkPlan(guid: string, createdAt?: string): Promise<number> {
  let n = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("os") as UxpOs;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as UxpFs;
    const planP = helperPlanPath(os.platform(), os.homedir()); // uxp.d.ts:L9198 OS.platform, uxp.d.ts:L9232 OS.homedir
    const r = fs.readFileSync(planP, { encoding: "utf-8" }); // uxp.d.ts:L8985 fs.readFileSync
    const plan = JSON.parse(typeof r === "string" ? r : "") as { kind?: string; sequence?: { guid?: string }; createdAt?: string };
    if (plan.kind !== "spread-link-plan" || plan.sequence?.guid !== guid || (createdAt !== undefined && plan.createdAt !== createdAt)) return 0;
    const res = readPanelLinkResult();
    await fs.unlink(planP); // uxp.d.ts:L9149 fs.unlink
    n++;
    if (res && res.planCreatedAt === plan.createdAt) {
      await fs.unlink(helperResultPath(os.platform(), os.homedir())); // uxp.d.ts:L9149 fs.unlink, uxp.d.ts:L9198 OS.platform, uxp.d.ts:L9232 OS.homedir
      n++;
    }
  } catch {
    /* plan yok / okunamıyor / silinemiyor → yardımcı paneli eski planı gösterir; Spread'in kaydı yine de silinmiştir */
  }
  return n;
}

/**
 * KES planını yardımcının okuyacağı dosyaya yazar (köprüsüz BAĞLA). Yazılamazsa hata metni döner; plan panelin rapor kutusuna da
 * konur (yardımcı panelde "Planı yapıştır").
 */
export async function writeLinkPlan(text: string): Promise<{ ok: boolean; path: string; detail: string }> {
  let path = "?";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("os") as UxpOs;
    path = helperPlanPath(os.platform(), os.homedir()); // uxp.d.ts:L9198 OS.platform, uxp.d.ts:L9232 OS.homedir
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as UxpFs;
    const dir = path.replace(/[\\/][^\\/]+$/, "");
    try {
      await fs.mkdir(dir, { recursive: true }); // uxp.d.ts:L9159 fs.mkdir
    } catch {
      /* klasör zaten var (yardımcı açıldıysa oluşturmuştur) — yazma hatası aşağıda yakalanır */
    }
    fs.writeFileSync(path, text, { encoding: "utf-8" }); // uxp.d.ts:L9022 fs.writeFileSync
    return { ok: true, path, detail: "" };
  } catch (e) {
    return { ok: false, path, detail: raw(e) };
  }
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
      return { ok: false, detail: e instanceof HelperError ? `[${e.stage}] ${e.message}` : raw(e) };
    }
  }

  async update(version: string): Promise<UpdateOutcome> {
    const j = await post("/v1/update", { version, panel: SPREAD_VERSION }, UPDATE_TIMEOUT_MS);
    return {
      version: String(j.version ?? version),
      panel: j.panel === "installed" ? "installed" : "manual",
      backup: String(j.backup ?? ""),
      ...(typeof j.ccx === "string" ? { ccx: j.ccx } : {}),
      ...(typeof j.why === "string" ? { why: j.why } : {}),
    };
  }

  async restart(): Promise<{ project: string }> {
    const j = await post("/v1/restart", {}, RESTART_TIMEOUT_MS);
    return { project: String(j.project ?? "") };
  }

  async reloadHelper(): Promise<boolean> {
    try {
      await post("/v1/reload", {}, PING_TIMEOUT_MS);
      return true;
    } catch {
      return false;
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

  async channels(sequenceName: string, items: LinkItem[]): Promise<ChannelsOutcome> {
    if (!items.length) return { ok: true, types: [], detail: "" };
    try {
      const types: (number | null)[] = [];
      for (let i = 0; i < items.length; i += LINK_LIMITS.groupItems) {
        const j = await post("/v1/channels", { sequence: sequenceName, items: items.slice(i, i + LINK_LIMITS.groupItems) }, LINK_TIMEOUT_MS);
        const t = Array.isArray(j.types) ? (j.types as unknown[]) : [];
        for (const x of t) types.push(typeof x === "number" && Number.isInteger(x) ? x : null);
      }
      if (types.length !== items.length) return { ok: false, types: items.map(() => null), detail: `yanıtta ${types.length}/${items.length} tip` };
      return { ok: true, types, detail: "" };
    } catch (e) {
      return { ok: false, types: items.map(() => null), detail: e instanceof HelperError ? `[${e.stage}] ${e.message}` : raw(e) };
    }
  }

  installHint(): string[] {
    return [
      "Yardımcı: Premiere'de Window → Extensions (Legacy) → Spread Helper panelini aç; sunucu panel açıkken çalışır (paneli çalışma alanında açık bırak).",
      `Menüde yoksa kurulu değil: Spread_Kurulum_v${SPREAD_VERSION}.zip → KUR.cmd (KURULUM_TR.md → "Kurulum"), Premiere'i kapatıp aç.`,
      `Panel açık ama kırmızı "Spread Helper çalışmıyor" diyorsa oradaki hatayı getir (ör. localhost:${HELPER_PORT} kullanımda). Köprü kurulamasa da yardımcı paneldeki BAĞLA çalışır.`,
    ];
  }
}

let current: Linker | null = null;

export function getLinker(): Linker {
  return (current ??= new CepLinker());
}
