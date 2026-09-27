// Ses kanal tipi (v1.1.0). Premiere API'si YOK — tipler yardımcıdan gelir (ExtendScript: TrackItem.projectItem →
// ProjectItem.getAudioChannelMapping.audioChannelsType — belgede özellik; cep-helper/jsx/host.jsx). UXP'de klip düzeyinde kanal tipi
// okuyan bir API yok (premierepro.d.ts 26.5: yalnız SequenceSettings.getAudioChannelType, sequence'ın kendisi için).
// Adobe (helpx "Link audio and video clips"): çok klipli bağda bütün ses klipleri AYNI kanal tipinde (mono / stereo / 5.1) olmalı.
// Gerçek Premiere 26.5.1 (v1.0.0 denemesi, handoff.md): mono (Zoom Tr1/Tr2) + stereo (Zoom TrLR, kamera sesi) karışık bağ grubunda
// Sequence.linkSelection() false döndü; stereo öğeler çıkarılınca bağlandı. Bu modül yalnız KARAR verir: hangi ses öğeleri grubun
// ana kanal tipine uymuyor. Hiçbir klibi silmez; bağ dışında bırakılacak adayları söyler.

/**
 * ExtendScript AudioChannelMapping.audioChannelsType değeri; null = okunamadı. Belge (docsforadobe premiere-scripting-guide,
 * other/audiochannelmapping.md): 0 mono, 1 stereo, 2 5.1; Adobe PProPanel örneği (Premiere.jsx): 3 multichannel, 4 4-channel,
 * 5 8-channel.
 */
export type ChannelType = number | null;

/** Kullanıcıya gösterilen ad (bilinmeyen değer sayıyla yazılır — tahmin yok). */
export function channelTypeName(t: ChannelType): string {
  if (t === null) return "bilinmiyor";
  return ({ 0: "mono", 1: "stereo", 2: "5.1", 3: "çok kanallı", 4: "4 kanal", 5: "8 kanal" } as Record<number, string>)[t] ?? `tip ${t}`;
}

export interface ChannelItem {
  kind: "V" | "A";
  track: number;
  type: ChannelType;
}

/**
 * Gruptaki ses öğelerinden grubun ANA kanal tipine uymayanların index'leri (bağ dışında bırakılacak adaylar).
 * Ana tip: en çok ses öğesinin tipi; eşitlikte en küçük A track'teki öğenin tipi (Spread'in track çerçevesinde eşlenen harici
 * kaynaklar en üstteki A track'lerde, korunan kamera sesi ve kılavuzlar onların altında).
 * Karar verilmez ([] döner): tek tip varsa; bir ses öğesinin tipi okunamadıysa (tahmin yok); ana tipe uyan ses öğesi kalmayacaksa.
 * Video öğeleri hiçbir zaman aday değildir.
 */
export function channelOutliers(items: ChannelItem[]): number[] {
  const audio = items.map((x, i) => ({ ...x, i })).filter((x) => x.kind === "A");
  if (audio.length < 2 || audio.some((x) => x.type === null)) return [];
  const count = new Map<number, number>();
  for (const x of audio) count.set(x.type!, (count.get(x.type!) ?? 0) + 1);
  if (count.size < 2) return [];
  const most = Math.max(...count.values());
  const top = audio
    .filter((x) => count.get(x.type!) === most)
    .sort((a, b) => a.track - b.track || a.i - b.i)[0];
  return audio.filter((x) => x.type !== top.type).map((x) => x.i);
}

/** Grubun ses öğelerinin tipleri karışık mı (onay uyarısı). Okunamayan tip varsa null (bilinmiyor). */
export function mixedChannels(items: ChannelItem[]): boolean | null {
  const audio = items.filter((x) => x.kind === "A");
  if (audio.some((x) => x.type === null)) return null;
  return new Set(audio.map((x) => x.type)).size > 1;
}
