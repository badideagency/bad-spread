// Premiere Pro UXP API girişi.
// KURAL: Buradaki her tip ve metot yalnızca
// node_modules/@adobe/premierepro/src/premierepro.d.ts (v26.5.0) dosyasından gelir.
// Çağrı yerlerinde "d.ts:L<satır> Tip.metot" yorumu o dosyadaki satırı gösterir;
// `npm run check:api` bu yorumları d.ts'e karşı doğrular.

import type {
  premierepro,
  AudioClipTrackItem,
  VideoClipTrackItem,
} from "@adobe/premierepro";

export type {
  Action,
  AudioClipTrackItem,
  CompoundAction,
  Project,
  ProjectItem,
  Sequence,
  TickTime,
  TrackItemSelection,
  VideoClipTrackItem,
} from "@adobe/premierepro";

// d.ts:L14 premierepro (modülün kök tipi)
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const ppro = require("premierepro") as premierepro;

export type TrackItem = VideoClipTrackItem | AudioClipTrackItem;
