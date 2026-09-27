// Güncelleme denetimi (v1.2.0) — YALNIZ okuma: panel açılışta ve 6 saatte bir latest.json'u okur, yeni sürüm varsa üstte ince bir
// şerit gösterir. İndirme / doğrulama / kurulum / yeniden başlatma Spread Helper'da (cep-helper/js/updater.js; CEP'in Node'u var,
// UXP'nin yok). İnternet yoksa sessizce geçer (yalnız günlüğe soluk bir satır). Kaynak: sabit adres (manifest'teki ağ izni yalnız bu
// alan adı: https://raw.githubusercontent.com).

import { hostVersion } from "./calibrate";
import { SPREAD_VERSION } from "./version";

export const LATEST_URL = "https://raw.githubusercontent.com/badideagency/bad-spread-updates/main/latest.json";
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 15000;

export interface Latest {
  version: string;
  date: string;
  notes: string[];
  zip_url: string;
  sha256: string;
  min_premiere: string;
}

/** "1.10.0" > "1.9.2" (yalnız sayısal x.y.z). a < b → -1, eşit → 0, a > b → 1. Yardımcıdaki cmpVersion ile aynı. */
export function cmpVersion(a: string, b: string): number {
  const x = a.split(".");
  const y = b.split(".");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = Number(x[i] ?? 0);
    const q = Number(y[i] ?? 0);
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** latest.json'un panelin kullandığı alanları (asıl doğrulama yardımcıda: zip adresi, sha256, paket içeriği). */
export function parseLatest(o: unknown): Latest | null {
  if (!o || typeof o !== "object") return null;
  const j = o as Record<string, unknown>;
  const str = (k: string) => (typeof j[k] === "string" ? (j[k] as string) : null);
  const version = str("version");
  const min = str("min_premiere");
  const notes = Array.isArray(j.notes) ? j.notes.filter((n): n is string => typeof n === "string" && n.trim() !== "").slice(0, 3) : [];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !min || !/^\d+(\.\d+){0,2}$/.test(min) || !notes.length) return null;
  return { version, date: str("date") ?? "", notes, zip_url: str("zip_url") ?? "", sha256: str("sha256") ?? "", min_premiere: min };
}

export type UpdateCheck =
  | { kind: "new"; latest: Latest }
  | { kind: "none"; latest: Latest }
  | { kind: "premiere-old"; latest: Latest; host: string }
  | { kind: "offline"; detail: string };

/** latest.json'u okur ve karar verir; hiçbir şey kurmaz. Hata (internet yok, dosya yok, bozuk) → "offline" (sessiz). */
export async function checkForUpdate(fetchFn: typeof fetch = fetch): Promise<UpdateCheck> {
  let text: string;
  try {
    const res = await new Promise<Response>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${TIMEOUT_MS / 1000} sn içinde yanıt yok`)), TIMEOUT_MS);
      fetchFn(`${LATEST_URL}?t=${Date.now()}`, { method: "GET", headers: { "Cache-Control": "no-cache" } }).then(
        (r) => (clearTimeout(t), resolve(r)),
        (e: unknown) => (clearTimeout(t), reject(e instanceof Error ? e : new Error(String(e))))
      );
    });
    if (!res.ok) return { kind: "offline", detail: `HTTP ${res.status}` };
    text = await res.text();
  } catch (e) {
    return { kind: "offline", detail: e instanceof Error ? e.message : String(e) };
  }
  let latest: Latest | null = null;
  try {
    latest = parseLatest(JSON.parse(text));
  } catch {
    latest = null;
  }
  if (!latest) return { kind: "offline", detail: "latest.json okunamadı (biçim)" };
  if (cmpVersion(latest.version, SPREAD_VERSION) <= 0) return { kind: "none", latest };
  const host = hostVersion();
  if (/^\d+(\.\d+)*$/.test(host) && cmpVersion(host, latest.min_premiere) < 0) return { kind: "premiere-old", latest, host };
  return { kind: "new", latest };
}
