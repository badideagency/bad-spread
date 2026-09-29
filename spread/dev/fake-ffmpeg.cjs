#!/usr/bin/env node
// SENKRON sınaması için sahte ffmpeg / ffprobe (spread/dev/senkron-smoke.cjs). Gerçek ffmpeg'in bayrak düzenini bekler:
//   ffmpeg  … -i <yol> … pipe:1  → <yol>.pcm dosyasını (s16le, 8 kHz, mono) stdout'a basar; yoksa çıkış 1 + stderr
//   ffprobe … <yol>              → { format: { duration, start_time, tags }, streams: [{ codec_type, start_time }] } (yol.meta.json varsa ondan)
"use strict";
const fs = require("fs");
const [mode, ...args] = process.argv.slice(2);
if (mode === "ffprobe") {
  const file = args[args.length - 1];
  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(file + ".meta.json", "utf8"));
  } catch {
    /* yok */
  }
  let dur = 0;
  try {
    dur = fs.statSync(file + ".pcm").size / 16000;
  } catch {
    /* yok */
  }
  // ilk ses karesi sorgusu (-read_intervals): meta.audioFrame ?? meta.audioStart ?? 0 (AAC ön-dolgusu atıldıktan sonraki zaman)
  if (args.includes("-read_intervals")) {
    const t = meta.audioFrame ?? meta.audioStart ?? 0;
    process.stdout.write(JSON.stringify({ frames: meta.noAudio ? [] : [{ pts_time: t.toFixed(6), best_effort_timestamp_time: t.toFixed(6) }] }));
    process.exit(0);
  }
  // meta.videoStart / meta.audioStart (sn) → akışların start_time'ı (ses akışının dosya başına göre kayması: yardımcı "lead")
  const st = (v) => (typeof v === "number" ? v.toFixed(6) : undefined);
  const streams = [];
  if (typeof meta.videoStart === "number") streams.push({ codec_type: "video", start_time: st(meta.videoStart) });
  streams.push(meta.noAudio ? { codec_type: "video" } : { codec_type: "audio", start_time: st(meta.audioStart) });
  process.stdout.write(JSON.stringify({ format: { duration: String(dur), start_time: st(meta.formatStart ?? 0), tags: meta.tags || {} }, streams }));
  process.exit(0);
}
const i = args.indexOf("-i");
const file = i >= 0 ? args[i + 1] : null;
if (!file || !fs.existsSync(file + ".pcm")) {
  process.stderr.write(`${file}: Invalid data found when processing input\n`);
  process.exit(1);
}
const slow = Number(process.env.FAKE_FFMPEG_SLOW_MS || 0);
const out = () => {
  process.stdout.write(fs.readFileSync(file + ".pcm"));
};
if (slow) setTimeout(out, slow);
else out();
