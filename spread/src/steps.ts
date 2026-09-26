// Adım göstergesi (v1.0.0) — YALNIZ görünüm: hangi adım tamam (✓ + kısa sonuç), sıradaki hangisi (vurgulu). Hiçbir işlemi
// engellemez ya da başlatmaz. Kaynaklar: bu panelin sequence başına hatırladığı son sonuçlar (localStorage) + TOPLA / BAĞLA kaydı.
// Timeline okunmaz (her saniye sequence okumak Premiere'i yorar); kullanıcı işlemi el ile geri aldıysa ✓ eski kalabilir — işlemler
// yine kendi kayıt / düzen denetimlerini yapar.

import { loadRecord } from "./settings";
import type { StepId, StepView } from "./ui";

const KEY = "spread.steps.v1";

type Saved = Partial<Record<StepId, { kind: "ok" | "warn"; text: string; at: string }>>;

function all(): Record<string, Saved> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const j: unknown = raw ? JSON.parse(raw) : {};
    return j && typeof j === "object" ? (j as Record<string, Saved>) : {};
  } catch {
    return {};
  }
}

/** Başarılı / uyarılı bitişi hatırla; önceki adım yeniden yapılınca sonrakilerin ✓'ü silinir. */
export function rememberStep(guid: string | null, step: StepId, kind: "ok" | "warn", text: string): void {
  if (!guid) return;
  try {
    const a = all();
    const s: Saved = { ...(a[guid] ?? {}) };
    s[step] = { kind, text, at: new Date().toISOString() };
    if (step === "spread") {
      delete s.topla;
      delete s.bagla;
    }
    if (step === "topla") delete s.bagla;
    a[guid] = s;
    window.localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* hatırlanamazsa yalnız bu oturumda görünmez */
  }
}

export function stepViews(guid: string | null): { steps: Record<StepId, StepView>; next: StepId | null } {
  const s: Saved = guid ? (all()[guid] ?? {}) : {};
  const rec = guid ? loadRecord(guid) : null;
  const v = (id: StepId, fallback: StepView | null): StepView => {
    const x = s[id];
    if (x) return { state: x.kind === "ok" ? "done" : "warn", text: x.text };
    return fallback ?? { state: "todo", text: "" };
  };
  const topla = v("topla", rec ? { state: "done", text: `toplandı (${rec.at.slice(0, 10)})` } : null);
  const bagla = v(
    "bagla",
    rec?.bind ? (rec.bind.stage === "linked" ? { state: "done", text: "bağlandı" } : { state: "warn", text: "kesildi; bağlanmayı bekliyor" }) : null
  );
  const spread = v("spread", topla.state !== "todo" ? { state: "done", text: "" } : null);
  const next: StepId | null = bagla.state === "done" ? null : topla.state === "done" ? "bagla" : spread.state === "done" ? "topla" : "spread";
  return { steps: { spread, topla, bagla }, next };
}
