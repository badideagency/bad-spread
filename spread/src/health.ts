// SENKRON SAĞLIĞI (v1.3.0) — SAF. Premiere Synchronize'ın bıraktığı İMKÂNSIZ durumları bulur ve hangi kaydın yanlış yerde olduğunu
// seçer (sessions.ts → analyze bunu kullanır; TOPLA, BAĞLA, Durum raporu ve yardımcı panel aynı sonucu görür).
//
// İmkânsız durumlar (yalnız cihaz kimliği KESİN olan cihazlarda — `certainDevice`: kameralar ve Zoom tarih_saat):
//   (a) aynı cihazın iki farklı kaydı zamanda ≥ 1 kare çakışıyor (tek cihaz aynı anda iki kayıt alamaz);
//   (b) aynı cihazda dosya sayacı sırası ile zaman sırası ters (ör. C002, C001'den önce başlıyor) — yalnız sayaç güvenle
//       çözülebiliyorsa (sinema A043C001 / Sony C0001 / Zoom tarih_saat; cihazdaki bütün kayıtlar aynı desende, sayaçlar tekil);
//   (c) ses cihazında (a)/(b) — yalnız Zoom (aynı kaydın kanalları tek kayıt).
// DJI_01 / DJI_02 … farklı mikrofonlar da olabilir, aynı mikrofonun bölünmüş dosyaları da → kimlik KESİN DEĞİL: kural uygulanmaz,
// VETO da uygulanmaz (`vetoDevice`; eşzamanlı mikrofonların çakışması normaldir). Bilinmeyen adlandırmalı seslerde (ZOOM0001_Tr1 …)
// veto 1.2.1'deki gibi SÜRER (üst üste konmuş ilişkisiz grupları ayırır) ama klip seçimi yapılmaz (ayrılamazsa eskisi gibi sorulur).
//
// KAPSAM: Premiere İLİŞKİSİZ grupları üst üste koyabiliyor (12 Eylül, kanıt) — bu bir klibin değil grubun yanlış yerde olmasıdır ve
// veto (en zayıf bağları kesip ayırma) bunu çözer. Sağlık seçimi YALNIZ vetonun tek anlamlı ayıramadığı ve çakışanı TEK (kesin) cihaz
// olan bileşende ve bir oturumun İÇİNDE (sıra bozukluğu) çalışır; 12 Eylül gibi ayrılabilen üst üste gruplar eskisi gibi ayrılır.
// Seçim CİHAZ bazında, o cihazın tetiklendiği BÜTÜN bileşenlerin birleşimi üzerinde yapılır (sessions.ts): yanlış yere düşen klip
// başka bir bileşene (ör. sonraki DJI grubunun altına) düşmüş olabilir; tek bileşende sayaç sırasının yarısı görünmez.
//
// Seçim (chainSelect): cihazın kayıtları sayaç sırasında (sayaç yoksa zaman sırasında) dizilir.
//   DÜZ kural (kullanıcının kuralı): zaman sırası sayaç sırasına uyan ve ardışıkları < 1 kare çakışan EN UZUN alt dizi.
//   SIĞMA (yalnız sayaç varken): tek cihaz sırayla kaydeder → zincir dışındakiler sayaçlarının düştüğü aralığa (zincirde önceki ile
//   sonraki arası; ilkinden önce / sonuncudan sonra: tetiklenen bileşenlerin kapsadığı zamanın başı / sonu) toplam süreleriyle sığmalı.
//   Karar — TAHMİN YOK:
//     - cihazın sayacı güvenle okunamıyorsa (GoPro GX…, Canon MVI_…) → SORULUR (sıra / sığma bilinmez);
//     - hiçbir zincir sığmıyorsa (tek cihazın sırayla kaydı olamaz: iki gövde aynı adla / gruplar üst üste) → SORULUR (eskisi gibi);
//     - sığan en uzun zincir düz kuralınki kadar uzunsa sığma yalnız EŞİT uzun zincirler arasında ayırt eder;
//     - daha kısaysa iki kural ayrışıyor (ör. bir klip bütün harici seslerden sonra kaydedilmiş olabilir) → yalnız İKİSİNDE de dışarıda
//       kalan "şüpheli", ikisinde de içeride olan doğru, gerisi "belirsiz";
//     - birden çok eşit zincir: yalnız HEPSİNDE olan doğru, bazılarında olan "belirsiz"; doğru sayılan kalmazsa → SORULUR.
//   Şüpheli ve belirsiz kayıtlar oturum kurmaz, güçlü bağ üretmez, park track'ine gider (zamanı aynı, silinmez).

import { cmpOrder, type Identity } from "./identity";

/** 23.976 fps'in kare süresi (tick; 254016000000 × 1001 / 24000) — sequence timebase okunamazsa. */
export const HEALTH_DEFAULT_FRAME = 10594584000n;

/** Sağlık kuralları (klip seçimi) bu cihazda uygulanır mı: kameralar ve Zoom tarih_saat. */
export function certainDevice(kind: "camera" | "audio", ident: Identity): boolean {
  return kind === "camera" || ident.pattern === "zoom";
}

/** Veto (aynı cihazın iki kaydı aynı oturumda olamaz) bu cihazda uygulanır mı: DJI hariç hepsi (1.2.1'deki gibi). */
export function vetoDevice(kind: "camera" | "audio", ident: Identity): boolean {
  return !(kind === "audio" && ident.pattern === "dji");
}

/** Sayaç güvenle çözülebiliyor mu: hepsi aynı (sayaçlı) desende ve sıra anahtarları tekil. */
export function counterUsable(idents: Identity[]): boolean {
  if (!idents.length) return false;
  const p = idents[0].pattern;
  if (p !== "cinema" && p !== "sony" && p !== "zoom") return false;
  if (idents.some((i) => i.pattern !== p)) return false;
  const keys = new Set(idents.map((i) => i.order.join(".")));
  return keys.size === idents.length;
}

export interface ChainUnit {
  start: bigint;
  end: bigint;
  /** sayaç (sıra anahtarı); sayaç kullanılmıyorsa null */
  order: number[] | null;
}

export const overlapOf = (a: ChainUnit, b: ChainUnit): bigint => {
  const s = a.start > b.start ? a.start : b.start;
  const e = a.end < b.end ? a.end : b.end;
  return e > s ? e - s : 0n;
};

/** İki kaydın bir arada olması imkânsız mı (≥ 1 kare çakışma ya da sayaç/zaman sırası ters). */
export function conflict<U extends ChainUnit>(a: U, b: U, frame: bigint, useOrder: boolean): "overlap" | "order" | null {
  if (overlapOf(a, b) >= frame) return "overlap";
  if (useOrder && a.order && b.order) {
    const o = cmpOrder(a.order, b.order);
    if ((o < 0 && a.start > b.start) || (o > 0 && b.start > a.start)) return "order";
  }
  return null;
}

export interface ChainChoice<U> {
  keep: U[];
  ambiguous: U[];
  suspect: U[];
  /** düz kurala göre bir en uzun zincirde olabilirken sığma yüzünden dışarıda kalanlar — metinde "sığmıyor" */
  fitOut: Set<U>;
  /** null: seçim yapıldı; metin: tek anlamlı seçim yok → kullanıcıya sorulur */
  ask: string | null;
  /** düz kuralın ve sığan en uzun zincirin uzunluğu (sığan yoksa 0; sayaçsızda null) */
  L: number;
  Lfit: number | null;
}

/**
 * En uzun tutarlı zincir(ler) — karar kuralı dosya başındaki açıklamada. Zincirde ardışık u → v: (sayaç kullanılıyorsa
 * u.order < v.order) VE u.start ≤ v.start VE çakışma < 1 kare. Zaman sırasına göre dizili ve ardışıkları < 1 kare çakışan kayıtların
 * ardışık olmayanları da < 1 kare çakışır → zincirin her çifti tutarlı. SIĞMA, sayaç sırasında dizili zincirde ARDIŞIK çifte bağlıdır
 * (u ile v arasındaki dışarıdakiler tam olarak sayacı u ile v arasında olanlar) → en uzun yol DP'si (numaralandırma yok, O(n²));
 * yol sayıları BigInt.
 */
export function chainSelect<U extends ChainUnit>(units: U[], frame: bigint, useOrder: boolean, span?: { start: bigint; end: bigint }): ChainChoice<U> {
  const seq = units.slice().sort((a, b) => (useOrder && a.order && b.order ? cmpOrder(a.order, b.order) : a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const n = seq.length;
  const ok = (i: number, j: number) => {
    const a = seq[i];
    const b = seq[j];
    if (a.start > b.start) return false;
    if (overlapOf(a, b) >= frame) return false;
    return !(useOrder && a.order && b.order && cmpOrder(a.order, b.order) >= 0);
  };
  const pre = [0n];
  for (const u of seq) pre.push(pre[pre.length - 1] + (u.end - u.start));
  const room = (from: bigint, to: bigint) => (to > from ? to - from : 0n) + frame;
  const canFit = useOrder && !!span && seq.every((u) => !!u.order);
  /** @returns en uzun zincir uzunluğu, sayısı ve her kaydın geçtiği en uzun zincir sayısı; zincir yoksa null */
  const solve = (fit: boolean) => {
    const edge = (i: number, j: number) => ok(i, j) && (!fit || pre[j] - pre[i + 1] <= room(seq[i].end, seq[j].start));
    const first = (i: number) => !fit || pre[i] <= room(span!.start, seq[i].start);
    const last = (i: number) => !fit || pre[n] - pre[i + 1] <= room(seq[i].end, span!.end);
    // f: S'den i'ye en uzun (0 = ulaşılamaz), g: i'den T'ye; cf / cg: o uzunlukta kaç yol
    const f = new Array<number>(n).fill(0);
    const cf = new Array<bigint>(n).fill(0n);
    for (let j = 0; j < n; j++) {
      if (first(j)) {
        f[j] = 1;
        cf[j] = 1n;
      }
      for (let i = 0; i < j; i++)
        if (f[i] && edge(i, j)) {
          if (f[i] + 1 > f[j]) {
            f[j] = f[i] + 1;
            cf[j] = cf[i];
          } else if (f[i] + 1 === f[j]) cf[j] += cf[i];
        }
    }
    const g = new Array<number>(n).fill(0);
    const cg = new Array<bigint>(n).fill(0n);
    for (let i = n - 1; i >= 0; i--) {
      if (last(i)) {
        g[i] = 1;
        cg[i] = 1n;
      }
      for (let j = i + 1; j < n; j++)
        if (g[j] && edge(i, j)) {
          if (g[j] + 1 > g[i]) {
            g[i] = g[j] + 1;
            cg[i] = cg[j];
          } else if (g[j] + 1 === g[i]) cg[i] += cg[j];
        }
    }
    let L = 0;
    for (let i = 0; i < n; i++) if (f[i] && g[i] && f[i] + g[i] - 1 > L) L = f[i] + g[i] - 1;
    if (!L) return null;
    // en uzun zincirin ilk üyesinde f = 1 ve g = L (öncesi uzatılabilseydi en uzun olmazdı)
    let total = 0n;
    for (let i = 0; i < n; i++) if (f[i] === 1 && g[i] === L) total += cg[i];
    const through = seq.map((_, i) => (f[i] && g[i] && f[i] + g[i] - 1 === L ? cf[i] * cg[i] : 0n));
    return { L, total, through };
  };
  type R = NonNullable<ReturnType<typeof solve>>;
  type Cls = "keep" | "amb" | "sus";
  const cls = (r: R, i: number): Cls => (r.through[i] === r.total ? "keep" : r.through[i] > 0n ? "amb" : "sus");
  const out: ChainChoice<U> = { keep: [], ambiguous: [], suspect: [], fitOut: new Set(), ask: null, L: 0, Lfit: null };
  if (!n) return out;
  const plain = solve(false)!;
  out.L = plain.L;
  let label: Cls[];
  if (!canFit) {
    // sayaç yok (GoPro GX…, Canon MVI_… / bilinmeyen adlandırma) → sıra ve sığma bilinmez; iki gövde / üst üste gruplar tek klip
    // hatasından ayırt edilemez → seçim yok, SORULUR (inceleme #14 doğrulaması B1)
    out.ask = useOrder
      ? "sığma denetlenemiyor (aralık yok) → hangi klibin yanlış yerde olduğu çıkarılamaz → tahmin edilmedi"
      : "cihazın dosya sayacı güvenle okunamıyor → hangi klibin yanlış yerde olduğu çıkarılamaz → tahmin edilmedi";
    label = seq.map((_, i) => cls(plain, i));
    seq.forEach((u, i) => (label[i] === "keep" ? out.keep : label[i] === "amb" ? out.ambiguous : out.suspect).push(u));
    return out;
  } else {
    const fitted = solve(true);
    out.Lfit = fitted ? fitted.L : 0;
    if (!fitted) {
      out.ask =
        "cihazın kayıtları tek bir sıralı çekim olarak yerleşemiyor (hiçbir sıra dışarıda kalanları aralarına sığdırmıyor) — iki ayrı " +
        "cihaz aynı adlandırmayı kullanıyor ya da ilişkisiz gruplar üst üste konmuş olabilir → tahmin edilmedi";
      return out;
    }
    if (fitted.L === plain.L) label = seq.map((_, i) => cls(fitted, i));
    else
      label = seq.map((_, i) => {
        const a = cls(plain, i);
        const b = cls(fitted, i);
        return a === "keep" && b === "keep" ? "keep" : a === "sus" && b === "sus" ? "sus" : "amb";
      });
    seq.forEach((u, i) => label[i] !== "keep" && cls(plain, i) !== "sus" && out.fitOut.add(u));
  }
  seq.forEach((u, i) => (label[i] === "keep" ? out.keep : label[i] === "amb" ? out.ambiguous : out.suspect).push(u));
  if (!out.keep.length) out.ask = "doğru sayılabilecek tek bir klip dizisi yok (birden çok eşit olasılık) → tahmin edilmedi";
  return out;
}

/**
 * Kısa etiketler: sinema A043C002_260925XX → "C002" (listedeki bütün sinema kayıtları aynı cihaz + makaradaysa; değilse tam ad);
 * Sony C0142 → "C0142"; diğerleri kayıt adı. Ardışık sayaçlar (aynı cihaz + makara) aralığa sıkıştırılır: "C002…C004".
 */
export function compressLabels(idents: Identity[]): string {
  const list = idents.slice().sort((a, b) => (a.device < b.device ? -1 : a.device > b.device ? 1 : cmpOrder(a.order, b.order)));
  const cin = list.filter((i) => i.pattern === "cinema");
  const oneReel = new Set(cin.map((i) => `${i.device}.${i.order[0]}`)).size <= 1;
  const label = (i: Identity) => (i.pattern === "cinema" && oneReel ? `C${String(i.order[1]).padStart(3, "0")}` : i.recording);
  const out: string[] = [];
  let i = 0;
  while (i < list.length) {
    let j = i;
    const numeric = list[i].pattern === "cinema" || list[i].pattern === "sony";
    while (
      numeric &&
      j + 1 < list.length &&
      list[j + 1].pattern === list[i].pattern &&
      list[j + 1].device === list[i].device &&
      list[j + 1].order.length === list[j].order.length &&
      list[j + 1].order.slice(0, -1).join(".") === list[j].order.slice(0, -1).join(".") &&
      list[j + 1].order[list[j].order.length - 1] === list[j].order[list[j].order.length - 1] + 1
    )
      j++;
    out.push(j - i >= 2 ? `${label(list[i])}…${label(list[j])}` : list.slice(i, j + 1).map(label).join(", "));
    i = j + 1;
  }
  return out.join(", ");
}
