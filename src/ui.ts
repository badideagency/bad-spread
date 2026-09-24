// Panel arayüzü: log alanı, Evet/Hayır soruları. Kullanıcının konsolu yok; her şey panelde görünmeli.

type Tone = "info" | "ok" | "warn" | "err" | "head" | "dim";

const COLORS: Record<Tone, string> = {
  info: "",
  ok: "#4cc27a",
  warn: "#e8b04a",
  err: "#ff6b6b",
  head: "#8fb8ff",
  dim: "#9a9a9a",
};

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Panel öğesi bulunamadı: #${id}`);
  return e;
}

export function log(msg: string, tone: Tone = "info"): void {
  try {
    const box = el("log");
    const line = document.createElement("div");
    line.textContent = msg;
    if (COLORS[tone]) line.style.color = COLORS[tone];
    if (tone === "head") line.style.fontWeight = "bold";
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  } catch {
    // log alanı yoksa yapacak bir şey yok
  }
}

export function clearLog(): void {
  el("log").innerHTML = "";
}

export function setReportText(text: string): void {
  const ta = el("report") as HTMLTextAreaElement;
  ta.value = text;
}

export type Answer = "Evet" | "Hayır" | "Atla";

let pendingResolve: ((a: Answer) => void) | null = null;

/** Panelde soru gösterir, kullanıcı Evet/Hayır/Atla'ya basana kadar bekler. */
export function ask(question: string): Promise<Answer> {
  const box = el("ask");
  el("ask-text").textContent = question;
  box.style.display = "block";
  log(`❓ SORU: ${question}`, "warn");
  try {
    box.scrollIntoView();
  } catch {
    /* UXP'de yoksa sorun değil */
  }
  return new Promise<Answer>((resolve) => {
    pendingResolve = (a: Answer) => {
      box.style.display = "none";
      pendingResolve = null;
      log(`   → Cevap: ${a}`, "warn");
      resolve(a);
    };
  });
}

export function answer(a: Answer): void {
  if (pendingResolve) pendingResolve(a);
}

export function isAsking(): boolean {
  return pendingResolve !== null;
}

export function byId(id: string): HTMLElement {
  return el(id);
}
