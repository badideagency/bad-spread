// Panel ayarları — "Tutulacak harici kanallar". localStorage'da KAPATILAN kanallar saklanır (yeni kanal varsayılan AÇIK).
// localStorage erişimi her zaman try/catch içinde: okunamazsa hepsi açık sayılır, yazılamazsa yalnız bu oturumda geçerli.

import { log } from "./ui";

const KEY = "spread.disabledChannels.v1";
let memory: Set<string> | null = null; // localStorage yazılamazsa bu oturumun değeri

function load(): Set<string> {
  if (memory) return new Set(memory);
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function save(s: Set<string>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...s].sort()));
    memory = null;
  } catch (e) {
    memory = new Set(s);
    log(`Ayar kaydedilemedi (yalnız bu oturumda geçerli): ${e instanceof Error ? e.message : String(e)}`, "warn");
  }
}

export function isKept(channel: string): boolean {
  return !load().has(channel);
}

export function setKept(channel: string, kept: boolean): void {
  const s = load();
  if (kept) s.delete(channel);
  else s.add(channel);
  save(s);
}

/** Kanal onay kutularını #channels içine çizer. counts: kanal → klip sayısı. */
export function renderChannels(channels: { key: string; count: number }[]): void {
  try {
    const box = document.getElementById("channels");
    if (!box) return;
    box.innerHTML = "";
    if (!channels.length) {
      const d = document.createElement("div");
      d.textContent = "(aktif sequence'ta harici ses kanalı bulunamadı)";
      box.appendChild(d);
      return;
    }
    for (const ch of channels) {
      const row = document.createElement("label");
      row.className = "chan";
      const cb = document.createElement("input");
      cb.setAttribute("type", "checkbox");
      cb.id = `chan-${ch.key}`;
      cb.checked = isKept(ch.key);
      cb.addEventListener("change", () => {
        setKept(ch.key, cb.checked);
        log(`Kanal ${ch.key}: ${cb.checked ? "tutulacak" : "BAĞLA'da silinecek"}`, "dim");
      });
      const txt = document.createElement("span");
      txt.textContent = ` ${ch.key} (${ch.count} klip)`;
      row.appendChild(cb);
      row.appendChild(txt);
      box.appendChild(row);
    }
  } catch (e) {
    log(`Kanal listesi çizilemedi: ${e instanceof Error ? e.message : String(e)}`, "warn");
  }
}
