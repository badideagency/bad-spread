#!/usr/bin/env node
// SENKRON uçtan uca (Wine): yardımcı modülü (cep-helper/js/senkron.js) GERÇEK sabit ffmpeg derlemesini indirir (sha256 + çıkarma),
// Wine altında GERÇEK ffmpeg.exe / ffprobe.exe ile WAV (48 kHz stereo) ve MP4 (H.264 + AAC, ffmpeg.exe'nin kendisiyle üretilir) /
// MOV (PCM) dosyalarını mono 8 kHz'e çözer, motor eşleştirir; bilinen ofsetler ≤ 1 ms bulunmalı.
// Kullanım: node spread/dev/senkron-wine.cjs <çalışma klasörü>  (scripts/test-senkron-wine.sh çağırır; WINE ortam değişkeni)
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const cp = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const CORE = new Function(fs.readFileSync(path.join(ROOT, "cep-helper", "js", "spread-core.js"), "utf8") + "\nreturn SpreadCore;")();
const SK = require(path.join(ROOT, "cep-helper", "js", "senkron.js"));
const WINE = process.env.WINE || "/usr/lib/wine/wine64";
const work = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "senkron-wine-"));
fs.mkdirSync(work, { recursive: true });
let fails = 0;
const ok = (m) => console.log("  ✓ " + m);
const fail = (m) => {
  fails++;
  console.log("  ✗ " + m);
};
const zpath = (p) => (p.startsWith("/") ? "Z:" + p.replace(/\//g, "\\") : p);
// Windows ikililerini Wine ile çalıştıran child_process (yalnız sınama): mutlak Unix yolları Z:\… olur
const wineCp = {
  spawn: (exe, args, opts) => cp.spawn(WINE, [exe, ...args.map(zpath)], { ...opts, env: { ...process.env, WINEDEBUG: "-all" } }),
};
const runWin = (exe, args) => cp.execFileSync(WINE, [exe, ...args.map(zpath)], { env: { ...process.env, WINEDEBUG: "-all" }, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 });

// 48 kHz sahne (hece dizisi) ve kayıt
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
function scene(seconds, seed, sr) {
  const r = rng(seed);
  const n = Math.round(seconds * sr);
  const x = new Float32Array(n);
  let t = Math.round(0.3 * sr);
  while (t < n) {
    const len = Math.round((0.08 + 0.25 * r()) * sr);
    const amp = 0.05 + 0.35 * r();
    const f = [150 + 150 * r(), 500 + 900 * r(), 1500 + 1500 * r()];
    for (let i = 0; i < len && t + i < n; i++) {
      const w = Math.sin((Math.PI * i) / len);
      const tt = (t + i) / sr;
      x[t + i] += amp * w * (0.6 * Math.sin(6.283 * f[0] * tt) + 0.3 * Math.sin(6.283 * f[1] * tt) + 0.2 * Math.sin(6.283 * f[2] * tt) + 0.3 * (r() * 2 - 1));
    }
    t += len + Math.round((0.04 + (r() < 0.1 ? 1.5 * r() : 0.35 * r())) * sr);
  }
  return x;
}
function wav(file, M, sr, start, dur, gain, noise, seed) {
  const r = rng(seed);
  const n = Math.round(dur * sr);
  const b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 4, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 4, 40);
  const s0 = Math.round(start * sr);
  for (let i = 0; i < n; i++) {
    const k = s0 + i;
    const v = (k >= 0 && k < M.length ? M[k] : 0) * gain;
    const l = Math.max(-32768, Math.min(32767, Math.round((v + noise * (r() * 2 - 1)) * 32767)));
    const rr = Math.max(-32768, Math.min(32767, Math.round((0.8 * v + noise * (r() * 2 - 1)) * 32767)));
    b.writeInt16LE(l, 44 + i * 4);
    b.writeInt16LE(rr, 46 + i * 4);
  }
  fs.writeFileSync(file, b);
}

(async () => {
  console.log("▶ senkron_wine");
  const data = path.join(work, "Spread");
  const sk = SK.createSenkron({ fs, path, os, https: require("https"), crypto, zlib, childProcess: wineCp, core: CORE, log: (l) => console.log("    " + l), dataDir: data, platform: "win32" });
  // elle konan zip (varsa, indirmeyi atla) — yine sha256 denetlenir
  if (process.env.FFMPEG_ZIP && fs.existsSync(process.env.FFMPEG_ZIP)) {
    fs.mkdirSync(path.join(data, "ffmpeg"), { recursive: true });
    fs.copyFileSync(process.env.FFMPEG_ZIP, path.join(data, "ffmpeg", SK.FFMPEG.zipName));
  }
  const t0 = Date.now();
  let tools;
  try {
    tools = await sk.ensureFfmpeg((t) => {});
  } catch (e) {
    fail("ffmpeg hazırlanamadı: " + e.message);
    process.exit(1);
  }
  const h = crypto.createHash("sha256").update(fs.readFileSync(tools.ffmpeg)).digest("hex");
  ok(`ffmpeg: ${tools.how} (${((Date.now() - t0) / 1000).toFixed(1)} sn); ffmpeg.exe sha256 ${h.slice(0, 16)}… = sabit değer: ${h === SK.FFMPEG.entries[0].sha256}`);
  const v = runWin(tools.ffmpeg, ["-hide_banner", "-version"]).toString().split(/\r?\n/)[0];
  ok(`Wine'da çalışıyor: ${v}`);
  // ikinci kez: kurulu ikililer sha256 ile doğrulanır, indirme yok
  const sk2 = SK.createSenkron({ fs, path, os, https: null, crypto, zlib, childProcess: wineCp, core: CORE, dataDir: data, platform: "win32" });
  const t2 = await sk2.ensureFfmpeg(() => {});
  if (/kurulu \(sha256 doğrulandı\)/.test(t2.how)) ok("ikinci açılış: kurulu ikililer sha256 ile doğrulandı, indirme yok");
  else fail("ikinci açılış: " + t2.how);

  // medya: 3 WAV (48 kHz stereo; biri 1 kHz'lik farklı hızda değil — hepsi 48 kHz), kamera: 2 MP4 (H.264 + AAC), 1 MOV (PCM)
  const SR = 48000;
  const M = scene(240, 77, SR);
  const media = path.join(work, "medya çekim");
  fs.mkdirSync(media, { recursive: true });
  const truth = {};
  const files = [];
  const addWav = (name, start, dur, gain, noise, seed) => {
    const p = path.join(media, name);
    wav(p, M, SR, start, dur, gain, noise, seed);
    truth[name] = start;
    files.push({ id: name, path: p, name, kind: "audio", device: "DJI", recording: name.replace(/\..*$/, ""), certain: false, order: null });
  };
  addWav("DJI_01_20260925_150000.WAV", 0, 230, 1, 0.003, 1);
  addWav("DJI_02_20260925_150002.WAV", 2.3456, 225, 0.5, 0.004, 2);
  const cam = (name, start, dur, codec, seed) => {
    const src = path.join(work, name + ".src.wav");
    wav(src, M, SR, start, dur, 0.4, 0.02, seed);
    const p = path.join(media, name);
    const ac = codec === "aac" ? ["-c:a", "aac", "-b:a", "192k"] : ["-c:a", "pcm_s16le"];
    runWin(tools.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc=size=160x120:rate=25:duration=${dur}`, "-i", src, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "ultrafast", ...ac, "-shortest", p]);
    truth[name] = start;
    files.push({ id: name, path: p, name, kind: "camera", device: "A", recording: name.replace(/\..*$/, ""), certain: true, order: [70, files.length] });
  };
  cam("A070C001_260925XX.MP4", 20.25, 40, "aac", 11);
  cam("A070C002_260925XX.MOV", 90.0625, 50, "pcm", 12);
  cam("A070C003_260925XX.MP4", 160.5, 45, "aac", 13);
  ok(`medya üretildi: 2 WAV (48 kHz stereo), 2 MP4 (H.264 + AAC), 1 MOV (PCM) — "${path.basename(media)}" (boşluklu klasör)`);
  sk2.start({ files, opts: { frameSec: 1 / 25 } });
  let s = sk2.status();
  for (let i = 0; i < 2400 && s.state === "running"; i++) {
    await new Promise((r) => setTimeout(r, 100));
    s = sk2.status();
  }
  if (s.state !== "done") {
    fail(`iş: ${s.state} ${s.error || ""}`);
    process.exit(1);
  }
  const placed = s.out.result.placed;
  const ref = placed.find((p) => p.name === "DJI_01_20260925_150000.WAV");
  let worst = 0;
  const rows = [];
  for (const p of placed) {
    if (p.status !== "ok") {
      fail(`${p.name}: emin değil (${p.why})`);
      continue;
    }
    const e = (p.pos - ref.pos - (truth[p.name] - truth[ref.name])) * 1000;
    worst = Math.max(worst, Math.abs(e));
    rows.push(`${p.name} ${e >= 0 ? "+" : ""}${e.toFixed(3)} ms`);
  }
  const probe = s.out.files.map((f) => `${f.name}: ${f.seconds && f.seconds.toFixed(3)} sn${f.clockSrc ? ` (saat: ${f.clockSrc})` : ""}`);
  console.log("    çözülen: " + probe.join("; "));
  console.log("    hata: " + rows.join("; "));
  if (worst <= 1) ok(`gerçek ffmpeg ile 5 dosya çözüldü ve eşleşti; en büyük hata ${worst.toFixed(3)} ms (≤ 1 ms; AAC'nin baştaki gecikmesi ffmpeg'in edit list'iyle düşülüyor)`);
  else fail(`en büyük hata ${worst.toFixed(3)} ms > 1 ms`);
  console.log(fails ? `\nSENKRON WINE FAIL (${fails})` : "\nSENKRON WINE OK");
  process.exit(fails ? 1 : 0);
})();
