// Premiere Pro UXP API girişi (Spread).
// KURAL: Buradaki her tip ve metot yalnızca node_modules/@adobe/premierepro/src/premierepro.d.ts (26.5.0) dosyasından gelir.
// Çağrı yerlerinde "d.ts:L<satır> Tip.üye" yorumu o dosyadaki satırı gösterir; `npm run check:api` doğrular.

import type { premierepro, AudioClipTrackItem, VideoClipTrackItem } from "@adobe/premierepro";

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
