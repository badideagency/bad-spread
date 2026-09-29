#!/usr/bin/env node
// SENKRON (v1.4.0) sentetik sınama — motor (spread/src/senkron.ts → yardımcıya derlenen cep-helper/js/spread-core.js) ve yardımcı
// modülü (cep-helper/js/senkron.js: istek denetimi, ffmpeg indirme / sha256, çözme + önbellek, iş / ilerleme / iptal).
// Gerçek ses YOK: bilinen ofsetlerle üretilmiş "konuşma" sahnesi (hece dizisi, 8 kHz); her mikrofonun kendi kazancı, rengi, gürültüsü,
// kısa yankısı. ffmpeg yerine sahte ikililer (dev/fake-ffmpeg.cjs): -i yolunun yanındaki .pcm'i basar / ffprobe JSON'u.
// Kullanım: node spread/dev/senkron-smoke.cjs [senaryo,…|all]
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

const fails = [];
const ok = (m) => console.log("  ✓ " + m);
const fail = (m) => {
  fails.push(m);
  console.log("  ✗ " + m);
};

const { SR, scene, record, MIC } = require("./senkron-synth.cjs");

/** Sonuç denetimi: her grup tek çekimden; grup içinde göreli konumlar gerçeğe ≤ 1 ms; beklenen "emin değil"ler. */
function judge(res, truth, expectUnsure) {
  let wrong = 0;
  let maxErr = 0;
  const groups = new Map();
  for (const p of res.placed) {
    if (p.status !== "ok") continue;
    if (!truth[p.id] || truth[p.id].shot === null) {
      wrong++;
      fail(`YANLIŞ YERLEŞİM: ${p.name} gerçekte hiçbir kayıtla örtüşmüyor ama yerleşti`);
      continue;
    }
    groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  }
  for (const [g, list] of groups) {
    const shots = new Set(list.map((p) => truth[p.id].shot));
    if (shots.size > 1) {
      wrong += list.length;
      fail(`grup ${g} iki çekimi karıştırıyor`);
      continue;
    }
    const ref = list[0];
    for (const p of list) {
      const e = Math.abs(p.pos - ref.pos - (truth[p.id].start - truth[ref.id].start)) * 1000;
      maxErr = Math.max(maxErr, e);
      if (e > 1) {
        wrong++;
        fail(`${p.name}: ${e.toFixed(3)} ms hata (> 1 ms)`);
      }
    }
  }
  const unsure = res.placed.filter((p) => p.status !== "ok").map((p) => p.name).sort();
  const want = expectUnsure.slice().sort();
  if (unsure.join() !== want.join()) fail(`"emin değil": ${unsure.join(", ") || "yok"} (beklenen: ${want.join(", ") || "yok"})`);
  return { wrong, maxErr, unsure, groups: groups.size, placed: res.placed.length - unsure.length };
}

const input = (id, kind, device, recording, certain, order, pcm, clock = null) => ({ id, name: id, kind, device, recording, certain, order, pcm, clock });

const scenarios = {};

scenarios.motor_1kamera_3mik = async () => {
  // 1 kamera (A043) + 3 eşzamanlı DJI (biri bölünmüş dosya), kesirli ofsetler; kayıt dışı klip ve sessiz klip "emin değil" olmalı
  const M = scene(900, 7);
  const truth = {};
  const files = [];
  const add = (id, kind, device, certain, order, start, dur, mic, seed) => {
    truth[id] = { shot: 1, start };
    files.push(input(id, kind, device, id.replace(/\..*$/, ""), certain, order, record(M, start, dur, mic, seed), CORE.senkronClock(id)));
  };
  add("DJI_01_20260925_101000.WAV", "audio", "DJI", false, null, 0, 500, MIC.lav1, 11);
  add("DJI_01_20260925_101830.WAV", "audio", "DJI", false, null, 510, 360, MIC.lav1, 12);
  add("DJI_02_20260925_101002.WAV", "audio", "DJI", false, null, 2.0137, 700, MIC.lav2, 13);
  add("DJI_03_20260925_101005.WAV", "audio", "DJI", false, null, 5.4321, 820, MIC.lav3, 14);
  [[40.12345, 60], [130.5, 45], [260.0071, 90], [420.25, 30], [600.9, 75], [780.333, 40]].forEach(([st, du], i) =>
    add(`A043C00${i + 1}_260925XX.MP4`, "camera", "A", true, [43, i + 1], st, du, MIC.cam, 100 + i)
  );
  truth["A043C007_260925XX.MP4"] = { shot: null };
  files.push(input("A043C007_260925XX.MP4", "camera", "A", "A043C007", true, [43, 7], record(scene(60, 99), 1, 50, MIC.cam, 7)));
  truth["A043C008_260925XX.MP4"] = { shot: null };
  files.push(input("A043C008_260925XX.MP4", "camera", "A", "A043C008", true, [43, 8], new Int16Array(40 * SR)));
  const t0 = Date.now();
  const res = await CORE.senkronSolve(files, { frameSec: 1001 / 30000 });
  const j = judge(res, truth, ["A043C007_260925XX.MP4", "A043C008_260925XX.MP4"]);
  if (!j.wrong && j.placed === 10 && j.groups === 1)
    ok(`1 kamera + 3 eşzamanlı mikrofon: 10/10 yerleşti, tek grup, en büyük hata ${j.maxErr.toFixed(3)} ms (${((Date.now() - t0) / 1000).toFixed(1)} sn)`);
  else fail(`1 kamera + 3 mikrofon: yerleşen ${j.placed}, grup ${j.groups}, yanlış ${j.wrong}`);
  const c7 = res.placed.find((p) => p.name === "A043C007_260925XX.MP4");
  const c8 = res.placed.find((p) => p.name === "A043C008_260925XX.MP4");
  if (/güvenli eşleşme yok/.test(c7.why) && /sessiz/.test(c8.why)) ok(`kayıt dışı klip → "emin değil" (${c7.why}); sessiz klip → "emin değil" (${c8.why})`);
  else fail(`emin değil gerekçeleri: C007 "${c7.why}", C008 "${c8.why}"`);
  const d = res.placed.find((p) => p.name === "DJI_03_20260925_101005.WAV");
  if (d.hintDiff !== null && Math.abs(d.hintDiff - 0.4321) < 0.02) ok(`saat ipucu raporu: DJI_03 dosya adındaki saate göre ${d.hintDiff.toFixed(3)} sn farklı (gerçek 0.432)`);
  else fail(`saat ipucu farkı: ${d.hintDiff}`);
};

scenarios.motor_12eylul = async () => {
  // 12 Eylül şekli: A sinema + Sony + Zoom (Tr1 / Tr2 aynı kaydın kanalları), iki ayrı çekim (iki grup); ~128 dk ses
  const M1 = scene(1500, 21);
  const M2 = scene(1500, 22);
  const truth = {};
  const files = [];
  let seed = 1;
  const add = (id, kind, device, recording, order, M, shot, start, dur, mic) => {
    truth[id] = { shot, start };
    files.push(input(id, kind, device, recording, true, order, record(M, start, dur, mic, seed++), CORE.senkronClock(id)));
  };
  add("260912_101512_Tr1.WAV", "audio", "Zoom", "260912_101512", [260912, 101512], M1, 1, 0, 1400, MIC.zoom1);
  add("260912_101512_Tr2.WAV", "audio", "Zoom", "260912_101512", [260912, 101512], M1, 1, 0, 1400, MIC.zoom2);
  [[30.5, 120], [200.123, 150], [420, 90], [600.777, 200], [900.25, 160], [1150, 200]].forEach(([s, d], i) =>
    add(`A038C00${i + 1}_260912BD.MOV`, "camera", "A", `A038C00${i + 1}`, [38, i + 1], M1, 1, s, d, MIC.cam)
  );
  [[35.1, 140], [240.9, 180], [700.4, 300], [1100.6, 250]].forEach(([s, d], i) => add(`C014${i}.MP4`, "camera", "Sony", `C014${i}`, [140 + i], M1, 1, s, d, MIC.cam2));
  add("260912_133224_Tr1.WAV", "audio", "Zoom", "260912_133224", [260912, 133224], M2, 2, 0, 900, MIC.zoom1);
  add("260912_133224_Tr2.WAV", "audio", "Zoom", "260912_133224", [260912, 133224], M2, 2, 0, 900, MIC.zoom2);
  [[20, 200], [300.3, 250], [650, 200]].forEach(([s, d], i) => add(`A038C01${i}_260912BD.MOV`, "camera", "A", `A038C01${i}`, [38, 10 + i], M2, 2, s, d, MIC.cam));
  [[25.5, 300], [500.05, 350]].forEach(([s, d], i) => add(`C015${i}.MP4`, "camera", "Sony", `C015${i}`, [150 + i], M2, 2, s, d, MIC.cam2));
  const minutes = files.reduce((s, f) => s + f.pcm.length / SR, 0) / 60;
  const t0 = Date.now();
  const res = await CORE.senkronSolve(files, { frameSec: 1 / 25 });
  const secs = (Date.now() - t0) / 1000;
  const j = judge(res, truth, []);
  if (!j.wrong && j.placed === 19 && j.groups === 2) ok(`2 kamera + Zoom, iki çekim: 19/19 yerleşti, 2 grup, en büyük hata ${j.maxErr.toFixed(3)} ms`);
  else fail(`12 Eylül şekli: yerleşen ${j.placed}, grup ${j.groups}, yanlış ${j.wrong}`);
  const g2 = res.groups.find((g) => g.n === 2);
  if (g2 && g2.clockFrom1 === 11832) ok("ikinci çekim birinciden Zoom saatine göre 11832 sn (3 sa 17 dk 12 sn) sonra — gruplar arası mesafe saat ipucundan");
  else fail(`gruplar arası saat: ${g2 && g2.clockFrom1}`);
  if (minutes >= 90 && secs < 180) ok(`performans: ${minutes.toFixed(0)} dk ses ${secs.toFixed(1)} sn'de eşleşti (çözme hariç)`);
  else fail(`performans: ${minutes.toFixed(0)} dk ses ${secs.toFixed(1)} sn`);
};

scenarios.motor_kisa_iliskisiz = async () => {
  // yanlış yerleşim olmamalı: uzun kayda karşı 5–20 sn'lik İLİŞKİSİZ klipler (zarf benzerliği yüksek çıkabilir) → hepsi "emin değil"
  const M = scene(1200, 3);
  const files = [input("DJI_01_20260925_120000.WAV", "audio", "DJI", "DJI_01_20260925_120000", false, null, record(M, 0, 1200, MIC.lav1, 1))];
  const truth = { "DJI_01_20260925_120000.WAV": { shot: 1, start: 0 } };
  // uzun kayıt da tek başına kalır → hiçbir grupta değil ("emin değil": eşleşecek kimse yok)
  const unsure = ["DJI_01_20260925_120000.WAV"];
  for (let t = 0; t < 12; t++) {
    const id = `A050C0${String(t + 10)}_260925XX.MP4`;
    truth[id] = { shot: null };
    unsure.push(id);
    files.push(input(id, "camera", "A", id, true, [50, t + 10], record(scene(30, 700 + t), 1, [5, 8, 12, 20][t % 4], MIC.cam, 900 + t)));
  }
  const res = await CORE.senkronSolve(files, { frameSec: 1 / 25 });
  const j = judge(res, truth, unsure);
  if (!j.wrong && j.unsure.length === 13) ok("uzun kayda karşı 12 kısa (5–20 sn) ilişkisiz klip: hepsi \"emin değil\", yanlış yerleşim 0");
  else fail(`kısa ilişkisiz klipler: yanlış ${j.wrong}, emin değil ${j.unsure.length}`);
};

scenarios.motor_tekrar = async () => {
  // inceleme #15: tekrarlayan içerik (müzik döngüsü, aynı jingle, tekrar eden bölüm) yanlış yerleşimin ana kaynağı → hiçbiri yanlış yerleşmez
  const quiet = { yieldNow: () => Promise.resolve() };
  const rows = [];
  let wrong = 0;
  // (a) B2: iki farklı kamera, 20 sn klipler, 8 sn'lik birebir müzik döngüsü; gerçekte 200 sn ayrı; harici ses yok
  {
    const Sp = scene(900, 41);
    const loop = scene(8, 99);
    const M = new Float32Array(Sp.length);
    for (let i = 0; i < M.length; i++) M[i] = 0.1 * Sp[i] + loop[i % loop.length];
    const r = await CORE.senkronSolve(
      [input("C1", "camera", "A", "C1", true, null, record(M, 300.123, 20, MIC.cam, 1)), input("C2", "camera", "B", "C2", true, null, record(M, 500.777, 20, MIC.cam2, 2))],
      { frameSec: 1 / 25 },
      quiet
    );
    const n = r.placed.filter((p) => p.status === "ok").length;
    wrong += n;
    rows.push(`döngü: ${n ? "YERLEŞTİ" : "emin değil"}`);
  }
  // (b) B2: aynı 3 sn jingle 400 sn arayla, 6 / 7 sn'lik iki klip (farklı kameralar)
  {
    const M = scene(900, 61);
    const ring = scene(3, 5);
    for (const t of [200, 600]) for (let i = 0; i < ring.length; i++) M[t * SR + i] += 2 * ring[i];
    const r = await CORE.senkronSolve(
      [input("CamA", "camera", "A", "CamA", true, null, record(M, 199, 6, MIC.cam, 3)), input("CamB", "camera", "B", "CamB", true, null, record(M, 598.5, 7, MIC.cam2, 4))],
      { frameSec: 1 / 25 },
      quiet
    );
    const n = r.placed.filter((p) => p.status === "ok").length;
    wrong += n;
    rows.push(`jingle: ${n ? "YERLEŞTİ" : "emin değil"}`);
  }
  // (c) B3: 20 sn'lik bölüm iki kez; X ve Y grup 1'de çelişkili → sahte ikinci grup kurmaz
  {
    const M = scene(900, 71);
    for (let i = 0; i < 20 * SR; i++) M[700 * SR + i] = M[100 * SR + i];
    const r = await CORE.senkronSolve(
      [
        input("R1", "audio", "Zoom", "R1", true, null, record(M, 0, 500, MIC.zoom1, 5)),
        input("R2", "audio", "DJI", "R2", false, null, record(M, 400, 495, MIC.lav1, 6)),
        input("X", "camera", "A", "X", true, null, record(M, 102, 8, MIC.cam, 7)),
        input("Y", "camera", "B", "Y", true, null, record(M, 101, 12, MIC.cam2, 8)),
      ],
      { frameSec: 1 / 25 },
      quiet
    );
    const xy = r.placed.filter((p) => (p.name === "X" || p.name === "Y") && p.status === "ok").length;
    wrong += xy + (r.groups.length > 1 ? 1 : 0);
    rows.push(`çelişen: X/Y ${xy ? "YERLEŞTİ" : "emin değil"}, ${r.groups.length} grup`);
  }
  // (d) B4: aynı müzik iki kez çalıyor, kayıtçı yalnız ikincisinde; kamera klibi birincisinde → saatle 600 sn çelişki → emin değil
  {
    const M = scene(1200, 9);
    const song = scene(20, 77);
    for (const t of [100, 700]) for (let i = 0; i < song.length; i++) M[t * SR + i] += 1.5 * song[i];
    const r = await CORE.senkronSolve(
      [
        input("ZOOM", "audio", "Zoom", "ZOOM", true, [1], record(M, 500, 690, MIC.zoom1, 9), 500),
        input("A1", "camera", "A", "A1", true, [1], record(M, 600, 60, MIC.cam, 10), 603),
        input("A2", "camera", "A", "A2", true, [3], record(M, 900, 60, MIC.cam, 11), 903),
        input("A3", "camera", "A", "A3", true, [2], record(M, 105, 6, MIC.cam, 12), 108),
        input("A4", "camera", "A", "A4", true, [4], record(M, 1000, 40, MIC.cam, 13), 1003),
      ],
      { frameSec: 1 / 25 },
      quiet
    );
    const a3 = r.placed.find((p) => p.name === "A3");
    wrong += a3.status === "ok" ? 1 : 0;
    rows.push(`saat çelişkisi: A3 ${a3.status === "ok" ? "YERLEŞTİ" : `emin değil (${a3.why.slice(0, 40)}…)`}`);
  }
  // (e) B1: saat ipucu turu doğru yöne bakar (8 sn'lik bölüm 50 sn önce tekrarlanıyor; 5 sn'lik klip)
  {
    const M = scene(900, 5);
    for (let i = 0; i < 8 * SR; i++) M[349 * SR + i] = M[399 * SR + i];
    const r = await CORE.senkronSolve(
      [
        input("E1", "audio", "Zoom", "E1", true, [1], record(M, 0, 890, MIC.zoom1, 14)),
        input("E2", "audio", "DJI", "E2", false, null, record(M, 340, 300, MIC.lav1, 15)),
        input("A1", "camera", "A", "A1", true, [1], record(M, 100, 60, MIC.cam, 16), 5100),
        input("A2", "camera", "A", "A2", true, [3], record(M, 600, 60, MIC.cam, 17), 5600),
        input("A3", "camera", "A", "A3", true, [2], record(M, 400, 5, MIC.cam, 18), 5400),
      ],
      { frameSec: 1 / 25 },
      quiet
    );
    const e1 = r.placed.find((p) => p.name === "E1");
    const a3 = r.placed.find((p) => p.name === "A3");
    const bad = a3.status === "ok" && Math.abs(a3.pos - e1.pos - 400) > 0.001;
    wrong += bad ? 1 : 0;
    rows.push(`tekrar eden bölüm: A3 ${a3.status === "ok" ? `${(a3.pos - e1.pos).toFixed(3)} sn (gerçek 400)` : "emin değil"}`);
  }
  // (f) DC kayması olan kamera sesi yine yerleşir
  {
    const M = scene(900, 55);
    const dc = record(M, 200.3, 40, MIC.cam, 19).map((v) => Math.min(32767, v + 9830));
    const r = await CORE.senkronSolve([input("ZOOM", "audio", "Zoom", "ZOOM", true, null, record(M, 100, 700, MIC.zoom1, 20)), input("DC", "camera", "A", "DC", true, null, dc)], { frameSec: 1 / 25 }, quiet);
    const z = r.placed.find((p) => p.name === "ZOOM");
    const d = r.placed.find((p) => p.name === "DC");
    const ok1 = d.status === "ok" && Math.abs(d.pos - z.pos - 100.3) < 0.001;
    if (!ok1) wrong += d.status === "ok" ? 1 : 0;
    rows.push(`DC kaymalı klip: ${ok1 ? "doğru yerde" : d.status}`);
  }
  if (!wrong) ok(`tekrarlayan içerik — yanlış yerleşim 0: ${rows.join("; ")}`);
  else fail(`tekrarlayan içerikte ${wrong} yanlış yerleşim: ${rows.join("; ")}`);
};

scenarios.motor_iptal = async () => {
  const M = scene(300, 5);
  const files = [
    input("DJI_01_20260925_130000.WAV", "audio", "DJI", "a", false, null, record(M, 0, 300, MIC.lav1, 1)),
    input("A051C001_260925XX.MP4", "camera", "A", "b", true, [51, 1], record(M, 50, 60, MIC.cam, 2)),
  ];
  let n = 0;
  let err = null;
  try {
    await CORE.senkronSolve(files, {}, { cancelled: () => ++n > 2 });
  } catch (e) {
    err = e;
  }
  if (err && /iptal/.test(err.message)) ok("İptal: motor bir sonraki adımda durur (iptal edildi)");
  else fail("iptal çalışmadı: " + (err && err.message));
};

// ------------------------------------------------------------------ yardımcı modülü (cep-helper/js/senkron.js)

scenarios.yardimci_istek = async () => {
  const P = path;
  const bad = [
    [{ files: [] }, /boş/],
    [{ files: [{ id: "a", path: "göreli/yol.wav", name: "x", kind: "audio", device: "D", recording: "x" }] }, /mutlak değil/],
    [{ files: [{ id: "a", path: "-y", name: "x", kind: "audio", device: "D", recording: "x" }] }, /mutlak değil/],
    [{ files: [{ id: "a", path: "/a.wav", name: "x", kind: "video", device: "D", recording: "x" }] }, /tür/],
    [{ files: [{ id: "a", path: "/a.wav", name: "x", kind: "audio", device: "D", recording: "x" }, { id: "a", path: "/b.wav", name: "y", kind: "audio", device: "D", recording: "y" }] }, /tekrar/],
    [{ files: new Array(401).fill(0).map((_, i) => ({ id: "f" + i, path: "/x" + i + ".wav", name: "x", kind: "audio", device: "D", recording: "x" })) }, /çok fazla/],
  ];
  const msgs = [];
  for (const [b, re] of bad) {
    try {
      SK.cleanStart(b, P, "linux");
      msgs.push("GEÇTİ (beklenmedik)");
    } catch (e) {
      msgs.push(re.test(e.message) ? "ok" : e.message);
    }
  }
  const good = SK.cleanStart({ files: [{ id: "a", path: "C:\\Çekim\\A043C001.MP4", name: "A043C001.MP4", kind: "camera", device: "A", recording: "A043C001", certain: true, order: [43, 1] }], opts: { frameSec: 0.04 } }, P, "win32");
  if (msgs.every((m) => m === "ok") && good.files[0].certain && good.opts.frameSec === 0.04) ok("istek denetimi: boş liste, göreli yol, '-' ile başlayan yol, bilinmeyen tür, id tekrarı, > 400 dosya reddedildi; Windows mutlak yolu (Türkçe karakterli) kabul");
  else fail("istek denetimi: " + msgs.join(" | "));
};

function mkZip(entries) {
  // stored + deflate kayıtlı küçük zip (merkezi dizin + EOCD)
  const locals = [];
  const central = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = e.method === 8 ? zlib.deflateRawSync(e.data) : e.data;
    const crc = SK.crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(e.method, 8);
    lh.writeUInt32LE(e.badCrc ? (crc ^ 1) >>> 0 : crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(e.method, 10);
    ch.writeUInt32LE(e.badCrc ? (crc ^ 1) >>> 0 : crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

scenarios.yardimci_zip = async () => {
  const big = crypto.randomBytes(3 * 1024 * 1024);
  const z = mkZip([
    { name: "x/bin/ffmpeg.exe", data: big, method: 8 },
    { name: "x/LICENSE", data: Buffer.from("GPL"), method: 0 },
    { name: "x/doc/a.html", data: Buffer.from("<p>"), method: 8 },
  ]);
  const got = SK.extractEntries(zlib, z, ["x/bin/ffmpeg.exe", "x/LICENSE"]);
  let e1 = null;
  try {
    SK.extractEntries(zlib, mkZip([{ name: "x/bin/ffmpeg.exe", data: big, method: 8, badCrc: true }]), ["x/bin/ffmpeg.exe"]);
  } catch (e) {
    e1 = e.message;
  }
  let e2 = null;
  try {
    SK.extractEntries(zlib, z, ["x/bin/ffprobe.exe"]);
  } catch (e) {
    e2 = e.message;
  }
  if (got["x/bin/ffmpeg.exe"].equals(big) && String(got["x/LICENSE"]) === "GPL" && !got["x/doc/a.html"] && /CRC/.test(e1) && /yok/.test(e2))
    ok("zip: yalnız istenen kayıtlar çıkarıldı (deflate + stored, CRC denetimli); bozuk CRC ve eksik kayıt reddedildi");
  else fail(`zip: ${e1} / ${e2}`);
};

scenarios.yardimci_ffmpeg = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "senkron-"));
  const mk = (extra) =>
    SK.createSenkron({ fs, path, os, https: require("https"), crypto, zlib, childProcess: cp, core: CORE, log: () => {}, dataDir: dir, platform: "win32", ...extra });
  let e1 = null;
  try {
    await mk({ download: () => Promise.resolve(Buffer.from("bozuk zip")) }).ensureFfmpeg(() => {});
  } catch (e) {
    e1 = e.message;
  }
  const wrote = fs.existsSync(path.join(dir, "ffmpeg", "ffmpeg.exe"));
  let e2 = null;
  try {
    await mk({ download: () => Promise.reject(new Error("ENOTFOUND github.com")) }).ensureFfmpeg(() => {});
  } catch (e) {
    e2 = e.message;
  }
  let e3 = null;
  try {
    await SK.createSenkron({ fs, path, os, crypto, zlib, childProcess: cp, core: CORE, dataDir: dir, platform: "darwin" }).ensureFfmpeg(() => {});
  } catch (e) {
    e3 = e.message;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  if (/sha256'sı tutmuyor .*hiçbir şey yazılmadı/.test(e1) && !wrote && /ffmpeg indirilemedi: .*ENOTFOUND.*başka bir yoldan indirip/.test(e2) && /yalnız Windows/.test(e3))
    ok("ffmpeg: sha256 tutmayan zip → hiçbir şey yazılmadı; indirilemezse açık hata + elle koyma yolu; Windows dışında açık hata");
  else fail(`ffmpeg hataları: ${e1} | ${wrote} | ${e2} | ${e3}`);
  if (SK.FFMPEG.url === "https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip" && /^[0-9a-f]{64}$/.test(SK.FFMPEG.sha256))
    ok(`sabit ffmpeg: ${SK.FFMPEG.version}, zip sha256 ${SK.FFMPEG.sha256.slice(0, 16)}…`);
  else fail("sabit ffmpeg tanımı");
};

scenarios.yardimci_is = async () => {
  // iş: sahte ffmpeg / ffprobe (dev/fake-ffmpeg.cjs) → PCM dosyadan; ilerleme, sonuç, önbellek (ikinci iş önbellekten), iptal
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "senkron-"));
  const media = path.join(dir, "medya");
  fs.mkdirSync(media);
  const M = scene(400, 31);
  const specs = [
    ["DJI_01_20260925_140000.WAV", "audio", "DJI", false, null, 0, 380, MIC.lav1],
    ["DJI_02_20260925_140003.WAV", "audio", "DJI", false, null, 3.25, 370, MIC.lav2],
    ["A060C001_260925XX.MP4", "camera", "A", true, [60, 1], 20.5, 60, MIC.cam],
    ["A060C002_260925XX.MP4", "camera", "A", true, [60, 2], 150.125, 80, MIC.cam],
  ];
  const files = specs.map(([name, kind, device, certain, order, st, du, mic], i) => {
    const p = path.join(media, name);
    fs.writeFileSync(p, "sahte medya " + name);
    const pcm = record(M, st, du, mic, 40 + i);
    fs.writeFileSync(p + ".pcm", Buffer.from(pcm.buffer));
    return { id: "p" + i, path: p, name, kind, device, recording: name.replace(/\..*$/, ""), certain, order };
  });
  const fake = path.join(__dirname, "fake-ffmpeg.cjs");
  const tools = { ffmpeg: path.join(dir, "ffmpeg"), ffprobe: path.join(dir, "ffprobe") };
  for (const [k, mode] of [["ffmpeg", "ffmpeg"], ["ffprobe", "ffprobe"]]) {
    fs.writeFileSync(tools[k], `#!/bin/sh\nexec "${process.execPath}" "${fake}" ${mode} "$@"\n`);
    fs.chmodSync(tools[k], 0o755);
  }
  const mk = () => SK.createSenkron({ fs, path, os, crypto, zlib, childProcess: cp, core: CORE, log: () => {}, dataDir: dir, platform: "linux", tools });
  const run = async (sk) => {
    const st = sk.start({ files, opts: { frameSec: 1001 / 30000 } });
    const seen = new Set();
    for (let i = 0; i < 600; i++) {
      const s = sk.status();
      if (s.progress) seen.add(s.progress.text.replace(/\d+\/\d+.*$/, "#"));
      if (s.state !== "running") return { s, seen, st };
      await new Promise((r) => setTimeout(r, 50));
    }
    return { s: sk.status(), seen, st };
  };
  const a = await run(mk());
  const out = a.s.out;
  const pos = (n) => out && out.result.placed.find((p) => p.name === n).pos;
  const good = out && Math.abs(pos("A060C002_260925XX.MP4") - pos("A060C001_260925XX.MP4") - (150.125 - 20.5)) < 0.001 && Math.abs(pos("DJI_02_20260925_140003.WAV") - pos("DJI_01_20260925_140000.WAV") - 3.25) < 0.001;
  if (a.s.state === "done" && good && [...a.seen].some((t) => /ses okunuyor/.test(t)) && out.files.every((f) => f.ok && !f.cached))
    ok(`iş: 4 dosya sahte ffmpeg'le çözüldü (ilerleme: ${[...a.seen].slice(0, 3).join(" → ")} …), konumlar ≤ 1 ms`);
  else fail(`iş: ${a.s.state} ${a.s.error || ""} ${JSON.stringify(out && out.files)}`);
  const b = await run(mk());
  if (b.s.state === "done" && b.s.out.files.every((f) => f.cached)) ok("ikinci iş: 4 dosya önbellekten (yol + boyut + değişme zamanı), ffmpeg çalışmadı");
  else fail("önbellek kullanılmadı: " + JSON.stringify(b.s.out && b.s.out.files));
  // aynı anda ikinci iş reddi + iptal
  const sk = mk();
  fs.rmSync(path.join(dir, "senkron-cache"), { recursive: true, force: true });
  sk.start({ files });
  let busy = null;
  try {
    sk.start({ files });
  } catch (e) {
    busy = e.message;
  }
  sk.cancel();
  let s = sk.status();
  for (let i = 0; i < 200 && s.state === "running"; i++) {
    await new Promise((r) => setTimeout(r, 25));
    s = sk.status();
  }
  if (/zaten çalışıyor/.test(busy) && s.state === "cancelled") ok("aynı anda ikinci iş reddedildi; İptal → iş 'cancelled' (çalışan ffmpeg öldürüldü)");
  else fail(`meşgul / iptal: ${busy} / ${s.state}`);
  fs.rmSync(dir, { recursive: true, force: true });
};

(async () => {
  const which = process.argv[2] && process.argv[2] !== "all" ? process.argv[2].split(",") : Object.keys(scenarios);
  for (const name of which) {
    console.log(`▶ ${name}`);
    try {
      await scenarios[name]();
    } catch (e) {
      fail(`${name}: ${e && e.stack ? e.stack : e}`);
    }
  }
  if (fails.length) {
    console.error(`\nSENKRON SMOKE FAIL (${fails.length})`);
    process.exit(1);
  }
  console.log(`\nSENKRON SMOKE OK (${which.length} senaryo)`);
})();
