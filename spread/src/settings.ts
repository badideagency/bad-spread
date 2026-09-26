// Panel ayarları (localStorage; her erişim try/catch — okunamazsa varsayılan, yazılamazsa yalnız bu oturumda geçerli):
//   - KAYNAK EŞLEME: sequence'ta algılanan her harici kaynak ("Zoom Tr1", "Zoom TrLR", "DJI"…) → A track ya da "sil".
//     Kaynak anahtarıyla hatırlanır. (v0.3.0'daki "Tutulacak kanallar"ın yerine geçer.)
//   - GÜÇLÜ BAĞ EŞİĞİ: çakışma / kısa olan kaydın süresi (varsayılan %90)
//   - OTURUM ARASI BOŞLUK: TOPLA'da oturum blokları arasında (varsayılan 2 sn, kareye hizalanır)

import { log } from "./ui";

export type Target = number | "sil";

const MAP_KEY = "spread.sourceMap.v1";
const THR_KEY = "spread.threshold.v1";
const GAP_KEY = "spread.gapSec.v1";
const memory = new Map<string, string>(); // localStorage yazılamazsa bu oturumun değerleri

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
    memory.delete(key);
  } catch (e) {
    memory.set(key, value);
    log(`Ayar kaydedilemedi (yalnız bu oturumda geçerli): ${e instanceof Error ? e.message : String(e)}`, "warn");
  }
}

function savedMap(): Record<string, Target> {
  try {
    const raw = read(MAP_KEY);
    const j: unknown = raw ? JSON.parse(raw) : {};
    const out: Record<string, Target> = {};
    if (j && typeof j === "object")
      for (const [k, v] of Object.entries(j as Record<string, unknown>))
        if (v === "sil" || (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 64)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/**
 * Kaynak → hedef. Kayıtlı olmayan kaynak: kayıtlıların kullanmadığı en küçük A track'i (kaynak sırasıyla).
 * @param sources sıralı kaynak listesi (sourcesOf)
 */
export function mappingFor(sources: string[]): Map<string, Target> {
  const saved = savedMap();
  const out = new Map<string, Target>();
  const used = new Set<number>();
  for (const s of sources)
    if (s in saved) {
      out.set(s, saved[s]);
      if (typeof saved[s] === "number") used.add(saved[s]);
    }
  let next = 0;
  for (const s of sources) {
    if (out.has(s)) continue;
    while (used.has(next)) next++;
    out.set(s, next);
    used.add(next);
  }
  return out;
}

export function setTarget(source: string, t: Target): void {
  const m = savedMap();
  m[source] = t;
  write(MAP_KEY, JSON.stringify(m));
}

export function getThreshold(): number {
  const v = Number(read(THR_KEY));
  return Number.isFinite(v) && v >= 50 && v <= 100 ? v / 100 : 0.9;
}

export function setThresholdPct(pct: number): void {
  if (Number.isFinite(pct) && pct >= 50 && pct <= 100) write(THR_KEY, String(pct));
}

export function getGapSec(): number {
  const v = Number(read(GAP_KEY) ?? "2");
  return Number.isFinite(v) && v >= 0 && v <= 600 ? v : 2;
}

export function setGapSec(sec: number): void {
  if (Number.isFinite(sec) && sec >= 0 && sec <= 600) write(GAP_KEY, String(sec));
}

// ------------------------------------------------------------------ arayüz

function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
  try {
    return document.getElementById(id) as T | null;
  } catch {
    return null;
  }
}

/** Kaynak eşleme paneli: her kaynak için A1…An / Sil seçimi. */
export function renderMapping(sources: { key: string; count: number }[]): void {
  try {
    const box = el("mapping");
    if (!box) return;
    box.innerHTML = "";
    if (!sources.length) {
      const d = document.createElement("div");
      d.textContent = "(aktif sequence'ta harici ses kaynağı bulunamadı — kamera sesleri asıl ses sayılır)";
      box.appendChild(d);
      return;
    }
    const map = mappingFor(sources.map((s) => s.key));
    const n = Math.max(sources.length, ...[...map.values()].map((v) => (typeof v === "number" ? v + 1 : 0)));
    for (const s of sources) {
      const row = document.createElement("div");
      row.className = "map-row";
      const label = document.createElement("span");
      label.textContent = `${s.key} (${s.count} klip) → `;
      const sel = document.createElement("select") as HTMLSelectElement;
      sel.id = `map-${s.key}`;
      for (let i = 0; i < n; i++) {
        const o = document.createElement("option") as HTMLOptionElement;
        o.value = String(i);
        o.textContent = `A${i + 1}`;
        sel.appendChild(o);
      }
      const del = document.createElement("option") as HTMLOptionElement;
      del.value = "sil";
      del.textContent = "Sil (BAĞLA'da)";
      sel.appendChild(del);
      const cur = map.get(s.key)!;
      sel.value = String(cur);
      sel.addEventListener("change", () => {
        const v = sel.value === "sil" ? "sil" : Number(sel.value);
        setTarget(s.key, v);
        log(`Kaynak ${s.key} → ${v === "sil" ? "BAĞLA'da silinecek" : `A${v + 1}`}`, "dim");
      });
      row.appendChild(label);
      row.appendChild(sel);
      box.appendChild(row);
    }
  } catch (e) {
    log(`Kaynak eşleme paneli çizilemedi: ${e instanceof Error ? e.message : String(e)}`, "warn");
  }
}

/** Eşik (%) ve oturum arası boşluk (sn) alanları. */
export function bindSettingInputs(): void {
  try {
    const thr = el<HTMLInputElement>("set-threshold");
    const gap = el<HTMLInputElement>("set-gap");
    if (thr) {
      thr.value = String(Math.round(getThreshold() * 100));
      thr.addEventListener("change", () => {
        const v = Number(thr.value);
        if (Number.isFinite(v) && v >= 50 && v <= 100) {
          setThresholdPct(v);
          log(`Güçlü bağ eşiği: %${v}`, "dim");
        } else {
          thr.value = String(Math.round(getThreshold() * 100));
          log("Eşik 50–100 arası olmalı", "warn");
        }
      });
    }
    if (gap) {
      gap.value = String(getGapSec());
      gap.addEventListener("change", () => {
        const v = Number(gap.value);
        if (Number.isFinite(v) && v >= 0 && v <= 600) {
          setGapSec(v);
          log(`Oturum arası boşluk: ${v} sn`, "dim");
        } else {
          gap.value = String(getGapSec());
          log("Boşluk 0–600 sn olmalı", "warn");
        }
      });
    }
  } catch (e) {
    log(`Ayar alanları bağlanamadı: ${e instanceof Error ? e.message : String(e)}`, "warn");
  }
}

// ------------------------------------------------------------------ TOPLA kaydı (sequence başına)
// TOPLA başarıyla bitince: kullandığı track çerçevesi, kaynak eşlemesi, eşik ve PARK ettiği kliplerin anahtarları saklanır.
// BAĞLA ve sonraki TOPLA'lar park'ı track sırasından TAHMİN ETMEZ, bu kayda bakar (sahipsiz bir klip yeni düzende bir oturumun uzun
// kaydının altına düşse de oturuma karışmaz; kılavuz sesler silinince çerçeve kaymaz).
// BAĞLA kesme/silmeyi doğrulayınca bağlama gruplarını (öğe değerleriyle) ve kesimin YARATTIĞI parçaları kayda ekler: kesimden sonra
// harici sesler çapalara bölündüğü için senkron kanıtı (tam kayıtlar) artık yoktur → yeniden analiz yapılmaz, kayıt kullanılır.

export interface CollectRecord {
  v: 1;
  guid: string;
  frame: {
    devTrack: [string, number][];
    srcTrack: [string, number][];
    silTrack: [string, number][];
    guideBase: [string, number][];
    guideCh: [string, number][];
    mappedCount: number;
    guideCount: number;
    vPark: number;
    aPark: number;
  };
  mapping: [string, Target][];
  thresholdPct: number;
  parked: string[];
  /** BAĞLA'nın kesme/silmesi doğrulandıysa (null: BAĞLA'dan geçmedi) */
  bind: BindRecord | null;
  at: string;
}

/** Yardımcının aradığı öğe (bind.LinkTarget ile aynı biçim). */
export interface LinkItemRec {
  kind: "V" | "A";
  track: number;
  start: string;
  end: string;
  name: string;
}

export interface BindRecord {
  /** "cut": kesme/silme doğrulandı, bağlama bitmedi; "linked": bağlama da yapıldı */
  stage: "cut" | "linked";
  groups: { id: string; label: string; items: LinkItemRec[] }[];
  /** kesimin yarattığı (TOPLA düzeninde olmayan) ses parçaları */
  created: LinkItemRec[];
  at: string;
}

const REC_KEY = "spread.collectRecord.v1";

function allRecords(): Record<string, CollectRecord> {
  try {
    const raw = read(REC_KEY);
    const j: unknown = raw ? JSON.parse(raw) : {};
    return j && typeof j === "object" ? (j as Record<string, CollectRecord>) : {};
  } catch {
    return {};
  }
}

export function loadRecord(guid: string): CollectRecord | null {
  const r = allRecords()[guid];
  if (!r || r.v !== 1 || r.guid !== guid || !Array.isArray(r.parked) || !r.frame || !Array.isArray(r.mapping)) return null;
  const b = r.bind;
  const bindOk = !b || (Array.isArray(b.groups) && Array.isArray(b.created) && (b.stage === "cut" || b.stage === "linked"));
  return { ...r, bind: bindOk ? (b ?? null) : null };
}

export function saveRecord(rec: CollectRecord): void {
  const all = allRecords();
  all[rec.guid] = rec;
  write(REC_KEY, JSON.stringify(all));
}

/** BAĞLA aşamasını kayda yazar (null: temizle). Kayıt yoksa bir şey yapmaz. */
export function saveBindRecord(guid: string, bind: BindRecord | null): void {
  const r = loadRecord(guid);
  if (r) saveRecord({ ...r, bind });
}

/** TOPLA'nın kullandığı eşlemeyi (varsayılanlar dahil) kalıcı yapar: sonradan yeni kaynak gelince varsayılanlar kaymaz. */
export function saveMapping(mapping: Map<string, Target>): void {
  const m = savedMap();
  for (const [k, v] of mapping) m[k] = v;
  write(MAP_KEY, JSON.stringify(m));
}

/** Kayıttaki eşleme / eşik bugünküyle aynı mı (değilse satırlar). */
export function recordDrift(rec: CollectRecord, mapping: Map<string, Target>, thresholdPct: number): string[] {
  const out: string[] = [];
  const was = new Map(rec.mapping);
  const show = (t: Target | undefined) => (t === undefined ? "yok" : t === "sil" ? "sil" : `A${t + 1}`);
  for (const k of new Set([...was.keys(), ...mapping.keys()]))
    if (was.get(k) !== mapping.get(k)) out.push(`kaynak eşlemesi: ${k} TOPLA'da ${show(was.get(k))}, şimdi ${show(mapping.get(k))}`);
  if (rec.thresholdPct !== thresholdPct) out.push(`güçlü bağ eşiği: TOPLA'da %${rec.thresholdPct}, şimdi %${thresholdPct}`);
  return out;
}
