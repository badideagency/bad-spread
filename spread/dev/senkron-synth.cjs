// SENKRON sınamaları için sentetik ses (senkron-smoke.cjs ve smoke.cjs ortak). Gerçek ses YOK: bilinen ofsetlerle üretilmiş "konuşma"
// sahnesi (hece dizisi, 8 kHz); her mikrofonun kendi kazancı, rengi, gürültüsü, kısa yankısı.
"use strict";
const SR = 8000;
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
/** "konuşma": 80–330 ms heceler (3 bileşenli ton + gürültü, yarım sinüs zarf), 40–390 ms aralar, ara sıra uzun sus. */
function scene(seconds, seed) {
  const r = rng(seed);
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  let t = Math.round(0.3 * SR);
  while (t < n) {
    const len = Math.round((0.08 + 0.25 * r()) * SR);
    const amp = 0.05 + 0.4 * r();
    const f = [150 + 150 * r(), 500 + 900 * r(), 1500 + 1500 * r()];
    const ph = [r() * 6.28, r() * 6.28, r() * 6.28];
    for (let i = 0; i < len && t + i < n; i++) {
      const w = Math.sin((Math.PI * i) / len);
      const tt = (t + i) / SR;
      x[t + i] +=
        amp * w * (0.6 * Math.sin(6.283 * f[0] * tt + ph[0]) + 0.3 * Math.sin(6.283 * f[1] * tt + ph[1]) + 0.2 * Math.sin(6.283 * f[2] * tt + ph[2]) + 0.3 * (r() * 2 - 1));
    }
    t += len + Math.round((0.04 + (r() < 0.1 ? 1.5 * r() : 0.35 * r())) * SR);
  }
  return x;
}
/** Sahnenin [start, start+dur) kaydı (kesirli başlangıç: doğrusal ara değer), mikrofon rengi + gürültü + yankı → Int16. */
function record(M, start, dur, mic, seed) {
  const r = rng(seed);
  const n = Math.round(dur * SR);
  const y = new Int16Array(n);
  const s0 = start * SR;
  let lp = 0;
  let prev = 0;
  const echo = Math.round((0.01 + 0.02 * r()) * SR);
  const eg = 0.2 + 0.2 * r();
  const at = (k, fr) => (k >= 0 && k + 1 < M.length ? M[k] * (1 - fr) + M[k + 1] * fr : 0);
  for (let i = 0; i < n; i++) {
    const p = s0 + i;
    const k = Math.floor(p);
    const fr = p - k;
    const v = at(k, fr) + eg * at(k - echo, fr);
    lp += mic.lp * (v - lp);
    const hp = lp - prev * mic.hp;
    prev = lp;
    y[i] = Math.max(-32768, Math.min(32767, Math.round((mic.gain * hp + mic.noise * (r() * 2 - 1)) * 32767)));
  }
  return y;
}
const MIC = {
  cam: { gain: 0.6, lp: 0.6, hp: 0.9, noise: 0.02 },
  cam2: { gain: 0.4, lp: 0.5, hp: 0.7, noise: 0.03 },
  lav1: { gain: 1.2, lp: 0.9, hp: 0.5, noise: 0.004 },
  lav2: { gain: 0.5, lp: 0.8, hp: 0.7, noise: 0.006 },
  lav3: { gain: 0.9, lp: 0.95, hp: 0.3, noise: 0.01 },
  zoom1: { gain: 1, lp: 0.9, hp: 0.5, noise: 0.004 },
  zoom2: { gain: 0.6, lp: 0.7, hp: 0.8, noise: 0.006 },
};

module.exports = { SR, rng, scene, record, MIC };
