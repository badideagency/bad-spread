// KİMLİK — dosya adından (cihaz, kayıt, kanal, sıra anahtarı). SAF.
// Adlandırma YALNIZ cihaz kimliği ve kronolojik SIRA için kullanılır; gruplama (oturum) senkron sonucundan yapılır (sessions.ts).
//
// Bilinen desenler (uzantısız ad):
//   sinema : ^[A-Z]\d{3}C\d{3}_\d{6}\w{2}$   A038C001_260912BD → cihaz "A", sıra [makara 038, klip 001]
//   Sony   : ^C\d{4}$                          C0142            → cihaz "Sony", sıra [0142]
//   DJI    : ^DJI_\d+_\d{8}_\d{6}$             DJI_02_20260923_175336 → cihaz "DJI", sıra [tarih, saat, sayaç]
//   Zoom   : ^\d{6}_\d{6}_(Tr\w+)$             260912_133224_Tr1 → cihaz "Zoom", kayıt "260912_133224", kanal "Tr1", sıra [tarih, saat]
//            (aynı Zoom saati = TEK kayıt; kanallar o kaydın parçaları)
//   bilinmeyen: rakam grupları atılmış ad = cihaz, son rakam grubu = sayaç (her dosya kendi kaydı; sondaki kanal eki _Tr1/_LR/_MS
//            ayrılır → ZOOM0001_Tr1 ve ZOOM0001_Tr2 aynı kaydın kanalları)
// Kamera iç saati ve dosya tarihi (mtime) KULLANILMAZ.

export type Pattern = "cinema" | "sony" | "dji" | "zoom" | "generic";

export interface Identity {
  pattern: Pattern;
  /** cihaz anahtarı (aynı cihazın iki kaydı zamanda çakışamaz — veto) */
  device: string;
  /** cihaz içinde kayıt anahtarı (Zoom: tarih_saat; diğerleri: dosya adı) */
  recording: string;
  /** Zoom kanalı ("Tr1", "TrLR"…); diğerlerinde null */
  channel: string | null;
  /** cihaz içi kronolojik sıra anahtarı (sözlük sırasıyla karşılaştırılır) */
  order: number[];
}

export function baseName(name: string): string {
  return name.trim().replace(/\.[A-Za-z0-9]{1,5}$/, "");
}

export function identify(fileName: string): Identity {
  const b = baseName(fileName);
  let m = /^([A-Z])(\d{3})C(\d{3})_(\d{6})(\w{2})$/.exec(b);
  if (m) return { pattern: "cinema", device: m[1], recording: b, channel: null, order: [Number(m[2]), Number(m[3])] };
  m = /^C(\d{4})$/.exec(b);
  if (m) return { pattern: "sony", device: "Sony", recording: b, channel: null, order: [Number(m[1])] };
  m = /^DJI_(\d+)_(\d{8})_(\d{6})$/.exec(b);
  if (m) return { pattern: "dji", device: "DJI", recording: b, channel: null, order: [Number(m[2]), Number(m[3]), Number(m[1])] };
  m = /^(\d{6})_(\d{6})_(Tr\w+)$/i.exec(b);
  if (m) return { pattern: "zoom", device: "Zoom", recording: `${m[1]}_${m[2]}`, channel: "Tr" + m[3].slice(2).toUpperCase(), order: [Number(m[1]), Number(m[2])] };
  // bilinmeyen desen: sondaki kanal eki (…_Tr1, …_LR, …_MS) ayrılır → aynı kaydın kanalları aynı kayıt (ör. ZOOM0001_Tr1 / _Tr2)
  const ch = /^(.*?)[_-](tr(?:\d+|lr|ms|mix|l|r)|lr|ms)$/i.exec(b); // "_trim" kanal DEĞİL
  const rest = ch && ch[1] ? ch[1] : b;
  const channel = ch && ch[1] ? (/^tr/i.test(ch[2]) ? "Tr" + ch[2].slice(2).toUpperCase() : ch[2].toUpperCase()) : null;
  const groups = rest.match(/\d+/g) ?? [];
  const device = rest.replace(/\d+/g, "").replace(/[\s._-]+/g, "_").replace(/^_+|_+$/g, "") || "#";
  return { pattern: "generic", device, recording: rest, channel, order: [groups.length ? Number(groups[groups.length - 1]) : 0] };
}

/** Harici ses kaynağının anahtarı (kaynak eşleme paneli): "Zoom Tr1", "Zoom TrLR", "DJI", … */
export function sourceKey(id: Identity): string {
  return id.channel ? `${id.device} ${id.channel}` : id.device;
}

export function cmpOrder(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Kaynak sırası: Zoom kanalları (Tr sayısal → diğerleri alfabetik) önce, sonra diğer cihazlar alfabetik. */
export function sourceCompare(a: string, b: string): number {
  const zr = (s: string) => (s.startsWith("Zoom ") ? 0 : 1);
  if (zr(a) !== zr(b)) return zr(a) - zr(b);
  const ta = /^Zoom Tr(\d+)$/.exec(a);
  const tb = /^Zoom Tr(\d+)$/.exec(b);
  if (ta && tb) return Number(ta[1]) - Number(tb[1]);
  if (ta) return -1;
  if (tb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function recordingLabel(id: Identity): string {
  return id.pattern === "zoom" ? `Zoom ${id.recording}` : id.recording;
}
