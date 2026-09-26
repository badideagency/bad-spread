// SPREAD SMOKE TEST — Premiere OLMADAN, sahte ("mock") premierepro ile spread/dist/'i Node'da uçtan uca çalıştırır.
// Mock, Probe'un Premiere 26.5.1'de KANITLADIĞI davranışları uygular; kanıtlanmamış olanlarda HATA verir
// (böylece Spread'in kanıtlanmamış bir davranışa dayanmadığı da sınanır):
//   ✓ createCloneTrackItemAction: hedef = mevcut track sayısı ise yeni track açar; kopya TEK öğe (bağlı partner gelmez), zamanlar birebir
//   ✗ hedef > track sayısı ("atlamalı" açma) → HATA (kanıtlanmadı)
//   ✓ createOverwriteItemAction: video + ses(ler) BAĞLI doğar, [time, time+medya süresi], in=0
//   ✗ overwrite olmayan track'e → HATA (kanıtlanmadı)
//   ✓ createRemoveItemsAction(ripple=false): başka klip kaymaz; mediaType filtre değil
//   ✓ tek transaction = tek undo; işlenen transaction eski TrackItem/seçim nesnelerini GEÇERSİZ kılar
//   ✓ setSelection programla çalışır (görünürlük mock'ta yok)
//   ? set In/Out/Start/End anlamı (tahmin): in/out değişince start sabit; start/end değişince karşı kenar sabit
//   ? set In/Out/Start/End anlamı ÖLÇÜLMEDİ → M.setSem: "trim" (varsayılan, yukarıdaki), "move" (start klibi taşır), "noop" (hiçbir şey)
// v0.3.0 (TOPLA / BAĞLA): cep-helper/js/helper.js GERÇEK sunucusu 127.0.0.1:47731'de başlatılır; ExtendScript tarafı
// (cep-helper/jsx/host.jsx) Node vm'inde, mock timeline'ın üstünde kurulmuş sahte bir Premiere DOM'u (app.project.activeSequence…)
// ile çalışır. Panel → HTTP → yardımcı → host.jsx → sahte DOM zinciri uçtan uca sınanır.
// Kullanım: npm run build:spread && node spread/dev/smoke.cjs all   (ya da tek senaryo adı)

/* eslint-disable */
const Module = require("module");
const path = require("path");

const TPS = 254016000000n;
const FRAME25 = TPS / 25n;
const sec = (s) => BigInt(Math.round(s * 1000)) * (TPS / 1000n);
const frames = (n) => BigInt(n) * FRAME25;
const secOf = (t) => (Number(t) / Number(TPS)).toFixed(3);

// ------------------------------------------------------------ mock ayarları (senaryo başına)
const M0 = { broken: false, nonseq: false, nobackup: false, backupActive: false, falseTx: null, badBackup: false, noType: false, undoAfterTx: null, setSem: "trim", linkFailName: null, linkedSemantics: "link", cloneTimeBroken: false };
const M = { ...M0 };
let pendingUndo = 0;
const hooks = { onCloneSeq: null, onGetActive: null, beforeRemoveApply: null };
const counters = { setActions: new Map(), overwrites: 0, clones: 0, txNames: [], cloneOffsets: [] };

// ------------------------------------------------------------ model
let nextId = 1;
let mockGen = 0;
const STALE = "The script object is no longer valid";
const stale = (w) => {
  if (w.__gen !== mockGen) throw new Error(STALE);
};
const mkTT = (t) => ({ ticks: t.toString(), seconds: Number(t) / Number(TPS), ticksNumber: Number(t) });
const mkGuid = (s) => ({ toString: () => s });
const projItems = {};
function pi(name, dur, { channels = 1, video = true } = {}) {
  const p = { name, dur, channels, hasVideo: video, type: 1, getId: () => "pi-" + name, __gen: -1 };
  projItems[name] = p;
  return p;
}
function mkClip(kind, p, start, end, linkId = null, inPt = 0n) {
  return { id: nextId++, kind, pi: p, start, end, inPt, outPt: inPt + (end - start), speed: 1, disabled: false, name: p.name, linkId };
}
const mkSequence = (name, guid, nv = 3, na = 3) => ({
  name,
  guid,
  v: Array.from({ length: nv }, () => []),
  a: Array.from({ length: na }, () => []),
  sel: new Set(),
});

const state = { sequences: [], activeGuid: null };
const undoStack = [];
const repl = (k, v) => (typeof v === "bigint" ? { __b: v.toString() } : v instanceof Set ? { __s: [...v] } : k === "pi" ? v.name : v);
const rev = (k, v) => {
  if (v && typeof v === "object" && "__b" in v) return BigInt(v.__b);
  if (v && typeof v === "object" && "__s" in v) return new Set(v.__s);
  if (k === "pi") return projItems[v];
  return v;
};
const deepCopy = () => JSON.parse(JSON.stringify(state, repl));
function restore(snap) {
  const s = JSON.parse(JSON.stringify(snap), rev);
  state.sequences = s.sequences;
  state.activeGuid = s.activeGuid;
}
function undo() {
  const s = undoStack.pop();
  if (s) restore(s);
  mockGen++;
}
/** Karşılaştırma için kararlı dizgi: id'ler hariç, BigInt → string, kaynak → ad. */
const ser = (x) =>
  JSON.stringify(x, (k, v) => (k === "id" ? undefined : typeof v === "bigint" ? v.toString() : k === "pi" && v && typeof v === "object" ? v.name : v));
const seqByGuid = (g) => state.sequences.find((s) => s.guid === g);
function findClip(id) {
  for (const s of state.sequences)
    for (const grp of [s.v, s.a])
      for (let t = 0; t < grp.length; t++) {
        const c = grp[t].find((x) => x.id === id);
        if (c) return { s, grp, t, c };
      }
  return null;
}
function need(id) {
  const f = findClip(id);
  if (!f) throw new Error(STALE);
  return f;
}
function place(grp, idx, clip) {
  grp[idx] = grp[idx].filter((x) => x.end <= clip.start || x.start >= clip.end); // overwrite
  grp[idx].push(clip);
}
let frozen = null; // nonseq: compound başındaki track sayıları
function cloneTarget(grp, idx, kind) {
  if (idx < 0) throw new Error("mock: negatif track index");
  if (idx < grp.length) return idx;
  const len = M.nonseq && frozen ? frozen[kind] : grp.length;
  if (idx === len && idx === grp.length) {
    grp.push([]);
    return idx;
  }
  throw new Error(`mock: clone hedefi ${kind}${idx + 1} > track sayısı ${len} (atlamalı track açma KANITLANMADI)`);
}

function wrapItem(id) {
  const w = { __id: id, __gen: mockGen };
  const g = (fn) => async () => (stale(w), fn(need(id)));
  const act = (name, fn) => (t) => {
    stale(w);
    need(id);
    counters.setActions.set(id, [...(counters.setActions.get(id) ?? []), name]);
    return {
      apply: () => {
        const f = need(id);
        fn(f, BigInt(t.ticks));
        // en kötü durum: set sonrası aynı track'te çakışan klip EZİLİR (Premiere'in davranışı ölçülmedi)
        f.grp[f.t] = f.grp[f.t].filter((x) => x.id === id || x.end <= f.c.start || x.start >= f.c.end);
      },
    };
  };
  Object.assign(w, {
    getStartTime: g((f) => mkTT(f.c.start)),
    getEndTime: g((f) => mkTT(f.c.end)),
    getInPoint: g((f) => mkTT(f.c.inPt)),
    getOutPoint: g((f) => mkTT(f.c.outPt)),
    getSpeed: g((f) => f.c.speed),
    isDisabled: g((f) => f.c.disabled),
    isAdjustmentLayer: g(() => false),
    getName: g((f) => f.c.name),
    getTrackIndex: g((f) => f.t),
    getIsSelected: g((f) => f.s.sel.has(id)),
    getProjectItem: g((f) => f.c.pi),
    createSetInPointAction: act("in", ({ c }, t) => M.setSem !== "noop" && ((c.inPt = t), (c.end = c.start + (c.outPt - c.inPt)))),
    createSetOutPointAction: act("out", ({ c }, t) => M.setSem !== "noop" && ((c.outPt = t), (c.end = c.start + (c.outPt - c.inPt)))),
    createSetStartAction: act("start", ({ c }, t) => {
      if (M.setSem === "noop") return;
      if (M.setSem === "move") {
        const d = c.end - c.start; // "start taşır" anlamı: süre ve in/out aynı, klip kayar
        c.start = t;
        c.end = t + d;
      } else (c.inPt += t - c.start), (c.start = t); // "baş kırpma" anlamı
    }),
    createSetEndAction: act("end", ({ c }, t) => {
      if (M.setSem === "noop") return;
      if (M.setSem === "endmove") {
        const d = c.end - c.start; // "end taşır" anlamı: süre ve in/out aynı, klip sola/sağa kayar
        c.end = t;
        c.start = t - d;
      } else (c.outPt += t - c.end), (c.end = t); // "son kırpma" anlamı
    }),
  });
  return w;
}
function wrapSelection(ids) {
  const set = new Set(ids);
  const w = { __ids: set, __gen: mockGen };
  Object.assign(w, {
    addItem: (it) => (stale(w), stale(it), set.add(it.__id), true),
    removeItem: (it) => (stale(w), set.delete(it.__id)),
    getTrackItems: async () => (stale(w), [...set].filter((i) => findClip(i)).map(wrapItem)),
  });
  return w;
}
const wrapTrack = (guid, kind, idx) => ({
  getTrackItems: () => ((kind === "V" ? seqByGuid(guid).v : seqByGuid(guid).a)[idx] ?? []).map((c) => wrapItem(c.id)),
});
function wrapSequence(guid) {
  const s = () => seqByGuid(guid);
  return {
    get name() {
      return s().name;
    },
    guid: mkGuid(guid),
    getVideoTrackCount: async () => {
      if (pendingUndo > 0 && --pendingUndo === 0) undo(); // kullanıcı adımlar arasında Ctrl+Z basıyor
      return s().v.length;
    },
    getAudioTrackCount: async () => s().a.length,
    getTimebase: async () => String(FRAME25), // kare başına tick (25 fps)
    getVideoTrack: async (i) => wrapTrack(guid, "V", i),
    getAudioTrack: async (i) => wrapTrack(guid, "A", i),
    getEndTime: async () => {
      let m = 0n;
      for (const grp of [s().v, s().a]) for (const tr of grp) for (const c of tr) if (c.end > m) m = c.end;
      return mkTT(m);
    },
    clearSelection: async () => ((s().sel = new Set()), true),
    getSelection: async () => wrapSelection([...s().sel]),
    setSelection: (sel) => (stale(sel), (s().sel = new Set(sel.__ids)), true),
    createCloneAction: () => ({
      apply() {
        if (M.nobackup) return; // sessizce yedek oluşmaz
        const seq = JSON.parse(JSON.stringify(s(), repl), rev);
        seq.name = s().name + " Copy";
        seq.guid = "guid-" + nextId++;
        seq.sel = new Set();
        for (const grp of [seq.v, seq.a]) for (const tr of grp) for (const c of tr) c.id = nextId++;
        if (M.badBackup) seq.a[1] = []; // bozuk yedek: bir track eksik kopyalanmış
        state.sequences.push(seq);
        if (M.backupActive) state.activeGuid = seq.guid;
        if (hooks.onCloneSeq) hooks.onCloneSeq(seq.guid);
      },
    }),
  };
}
const editorFor = (seqW) => {
  const guid = seqW.guid.toString();
  const seq = () => seqByGuid(guid);
  return {
    createCloneTrackItemAction: (item, off, vOff, aOff, align, isInsert) => {
      stale(item);
      return {
        apply() {
          const f = need(item.__id);
          const grp = f.c.kind === "V" ? seq().v : seq().a;
          const t = cloneTarget(grp, f.t + (f.c.kind === "V" ? vOff : aOff), f.c.kind);
          const o = BigInt(off.ticks) + (M.cloneTimeBroken && BigInt(off.ticks) !== 0n ? FRAME25 : 0n); // bozuk: sıfır dışı ofset 1 kare kayar
          counters.cloneOffsets.push(BigInt(off.ticks));
          place(grp, t, { ...f.c, id: nextId++, start: f.c.start + o, end: f.c.end + o, linkId: null });
          counters.clones++;
        },
      };
    },
    createRemoveItemsAction: (sel, ripple, mt) => {
      stale(sel);
      const ids = [...sel.__ids];
      return {
        apply() {
          if (hooks.beforeRemoveApply) hooks.beforeRemoveApply();
          for (const id of ids) {
            const f = findClip(id);
            if (!f || f.s !== seq()) throw new Error(STALE);
            f.grp[f.t] = f.grp[f.t].filter((x) => x.id !== id);
            f.s.sel.delete(id); // silinen klip seçili kalmaz
          }
        },
      };
    },
    createOverwriteItemAction: (p, time, vIdx, aIdx) => ({
      apply() {
        const S = seq();
        const k = p.channels;
        if ((p.hasVideo && vIdx >= S.v.length) || (k && aIdx + k - 1 >= S.a.length))
          throw new Error(`mock: overwrite olmayan track'e (V${vIdx + 1}/A${aIdx + 1}) — KANITLANMADI`);
        const st = BigInt(time.ticks);
        const L = "L" + nextId++;
        if (p.hasVideo) {
          const vs = M.broken ? st + FRAME25 : st; // bozuk overwrite: video 1 kare kayık
          place(S.v, vIdx, mkClip("V", p, vs, vs + p.dur, L));
        }
        for (let c = 0; c < k; c++) place(S.a, aIdx + c, mkClip("A", p, st, st + p.dur, L));
        counters.overwrites++;
      },
    }),
    createInsertProjectItemAction: () => {
      throw new Error("Spread insert kullanmamalı");
    },
  };
};
let projectW;
const ppro = {
  Constants: { TrackItemType: { EMPTY: 0, CLIP: 1, TRANSITION: 2, PREVIEW: 3, FEEDBACK: 4 }, MediaType: { ANY: 0, DATA: 1, VIDEO: 2, AUDIO: 3 } },
  ProjectItem: { get TYPE_CLIP() { return M.noType ? undefined : 1; } },
  ClipProjectItem: {
    cast: (p) => {
      if (M.noType) throw new Error("mock: ClipProjectItem.cast yok");
      return { getMedia: async () => ({ getDuration: () => mkTT(p.dur) }) };
    },
  },
  TickTime: { TIME_ZERO: mkTT(0n), createWithTicks: (t) => mkTT(BigInt(t)) },
  TrackItemSelection: {
    createEmptySelection: () => {
      throw new Error("createEmptySelection KULLANILMAMALI");
    },
  },
  SequenceEditor: { getEditor: (s) => editorFor(s) },
  Project: { getActiveProject: async () => projectW },
};
projectW = {
  getActiveSequence: async () => {
    if (hooks.onGetActive) hooks.onGetActive();
    return state.activeGuid ? wrapSequence(state.activeGuid) : null;
  },
  getSequences: async () => state.sequences.map((s) => wrapSequence(s.guid)),
  lockedAccess: (cb) => cb(),
  setActiveSequence: async (seqW) => ((state.activeGuid = seqW.guid.toString()), true),
  executeTransaction: (cb, name) => {
    const acts = [];
    cb({ addAction: (a) => (acts.push(a), true), get empty() { return acts.length === 0; } });
    if (M.falseTx === name) return false; // uygulanmadı, undo kaydı yok
    const snap = deepCopy();
    const S = seqByGuid(state.activeGuid);
    frozen = S ? { V: S.v.length, A: S.a.length } : null;
    try {
      for (const a of acts) a.apply();
    } catch (e) {
      restore(snap); // atomik
      mockGen++;
      frozen = null;
      throw e;
    }
    frozen = null;
    undoStack.push(snap);
    counters.txNames.push(name);
    mockGen++; // KESİN: işlenen transaction eski referansları geçersiz kılar
    if (M.undoAfterTx === name) pendingUndo = 2; // doğrulama okumasından sonraki okumada kullanıcı Ctrl+Z basar
    return true;
  },
};

// ------------------------------------------------------------ sahte DOM
const els = {};
function mkEl(id) {
  const listeners = [];
  const attrs = {};
  const el = {
    id, children: [], style: {}, textContent: "", value: "", scrollTop: 0, scrollHeight: 0, checked: false, className: "",
    set innerHTML(v) { el.children = []; },
    get innerHTML() { return ""; },
    appendChild: (c) => el.children.push(c),
    setAttribute: (k, v) => (attrs[k] = v),
    getAttribute: (k) => attrs[k],
    removeAttribute: (k) => delete attrs[k],
    hasAttribute: (k) => k in attrs,
    addEventListener: (ev, fn) => listeners.push({ ev, fn }),
    fire: (ev) => listeners.filter((l) => l.ev === ev).forEach((l) => l.fn()),
    click: () => listeners.filter((l) => l.ev === "click").forEach((l) => l.fn()),
    scrollIntoView: () => {},
  };
  return el;
}
global.document = { getElementById: (id) => (els[id] ??= mkEl(id)), createElement: () => mkEl(null) };
// localStorage (UXP'de var; mock'ta bozulabilir → try/catch sınanır)
const lsStore = new Map();
let lsBroken = false;
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => {
    if (lsBroken) throw new Error("mock: localStorage erişilemez");
    return lsStore.has(k) ? lsStore.get(k) : null;
  },
  setItem: (k, v) => {
    if (lsBroken) throw new Error("mock: localStorage erişilemez");
    lsStore.set(k, String(v));
  },
  removeItem: (k) => lsStore.delete(k),
};
let copied = null;
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { setContent: async (d) => (copied = d["text/plain"]) } }, configurable: true });
const fsReal = require("fs");
const osReal = require("os");
const TMPHOME = fsReal.mkdtempSync(path.join(osReal.tmpdir(), "spread-home-"));
const DIST = path.join(__dirname, "..", "dist");
Module._load = ((orig) =>
  function (request, parent) {
    if (request === "premierepro") return ppro;
    if (request === "uxp") return { versions: { uxp: "uxp-MOCK" }, host: { name: "premierepro", version: "26.5.1" } };
    // panelin os'u: ev klasörü geçici dizin (yardımcının token dosyası oraya yazılır), platform macOS yolu (Linux'ta çalışsın)
    if (request === "os" && parent && parent.filename && parent.filename.startsWith(DIST)) return { platform: () => "darwin", homedir: () => TMPHOME };
    return orig.apply(this, arguments);
  })(Module._load);

// ------------------------------------------------------------ kurulumlar
/**
 * Kullanıcının gerçek düzeni: V1'de iki kameranın klipleri arka arkaya (A038C0xx_260912*.MP4 ve C01xx.MP4, her biri A1'de
 * kendi sesiyle bağlı), harici sesler A2/A3'te arka arkaya (260912_HHMMSS_Tr1/Tr2/TrLR.WAV). 22 kamera + 12 WAV.
 * NOT: Probe raporunun tam tick değerleri bu oturumda yok; adlar, sayılar ve düzen gerçek, süreler 25 fps kare-hizalı üretildi.
 */
function setupReal({ trimmed = [], channelsOf = {}, nCams = 22, nWavSessions = 4, extraChannelOf = [], audioOffByTick = [] } = {}) {
  for (const k of Object.keys(projItems)) delete projItems[k];
  const s = mkSequence("Ana Kurgu", "guid-main-edit");
  let t = 0n;
  let aCount = 1, cCount = 1;
  const durs = [37, 82, 145, 21, 63, 190, 48, 111, 29, 75, 158, 44, 96, 33, 127, 58, 205, 26, 88, 141, 52, 69];
  for (let i = 0; i < nCams; i++) {
    const isA = i % 2 === 0;
    const name = isA ? `A038C0${String(aCount++).padStart(2, "0")}_260912${String(10 + i).padStart(2, "0")}.MP4` : `C01${String(cCount++).padStart(2, "0")}.MP4`;
    const d = frames(durs[i % durs.length] * 25 + (i % 7));
    const trim = trimmed.includes(i);
    const media = trim ? d + frames(125) : d; // kırpılmış: medya 5 sn daha uzun
    const inPt = trim ? frames(50) : 0n; // 2 sn baştan kırpık
    const p = pi(name, media, { channels: (channelsOf[i] ?? 1) + (extraChannelOf.includes(i) ? 1 : 0) });
    const L = "Lcam" + i;
    s.v[0].push(mkClip("V", p, t, t + d, L, inPt));
    const onTimeline = channelsOf[i] ?? 1; // extraChannelOf: proje öğesinde 1 kanal fazla, timeline'da yok
    for (let c = 0; c < onTimeline; c++) {
      const a = mkClip("A", p, t, t + d, L, inPt);
      if (audioOffByTick.includes(i)) (a.end -= 1n), (a.outPt -= 1n); // ses videodan 1 tick kısa
      s.a[c].push(a);
    }
    t += d;
  }
  const sessions = ["101512", "104233", "111845", "120510", "133224"].slice(0, nWavSessions);
  let a2 = 0n, a3 = 0n;
  const hasMulti = Object.values(channelsOf).some((c) => c > 1);
  const trkA2 = hasMulti ? 2 : 1, trkA3 = hasMulti ? 3 : 2;
  while (s.a.length <= trkA3) s.a.push([]);
  sessions.forEach((ss, i) => {
    for (const tr of ["Tr1", "TrLR"]) {
      const p = pi(`260912_${ss}_${tr}.WAV`, sec(300 + i * 47 + (tr === "TrLR" ? 13 : 0)), { video: false });
      s.a[trkA2].push(mkClip("A", p, a2, a2 + p.dur));
      a2 += p.dur;
    }
    const p = pi(`260912_${ss}_Tr2.WAV`, sec(300 + i * 47 + 5), { video: false });
    s.a[trkA3].push(mkClip("A", p, a3, a3 + p.dur));
    a3 += p.dur;
  });
  const other = mkSequence("Müşteri Kurgusu", "guid-other");
  other.v[0].push(mkClip("V", pi("OTHER.MP4", sec(20)), 0n, sec(20), "Lo"));
  state.sequences = [s, other];
  state.activeGuid = s.guid;
  undoStack.length = 0;
  counters.setActions.clear();
  counters.overwrites = 0;
  counters.clones = 0;
  counters.txNames = [];
  Object.assign(M, M0);
  pendingUndo = 0;
  hooks.onCloneSeq = hooks.onGetActive = hooks.beforeRemoveApply = null;
  mockGen++;
  return s;
}

// ------------------------------------------------------------ yardımcılar
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const fail = (m) => {
  console.error("  ✗ " + m);
  fails.push(m);
};
const ok = (m) => console.log("  ✓ " + m);
let logMark = 0;
const markLog = () => (logMark = (els.log?.children ?? []).length);
const newLog = () => (els.log?.children ?? []).slice(logMark).map((c) => c.textContent).join("\n");

async function clickAndWait(btn, answerer, done = /✓ SPREAD tamam|✗ SPREAD DURDU|İptal edildi|Zaten dağıtılmış|Durum raporu hazır/) {
  markLog();
  els[btn].click();
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    await sleep(20);
    if (els.ask?.style.display === "block") {
      const q = els["ask-text"].textContent;
      await answerer(q);
    }
    if (done.test(newLog())) {
      await sleep(80);
      return newLog();
    }
  }
  fail("zaman aşımı");
  return newLog();
}
const yes = async () => (els["ask-yes"].click(), sleep(20));
const no = async () => (els["ask-no"].click(), sleep(20));

/** Başlangıç düzeninden beklenen son düzeni BAĞIMSIZ hesaplar (plan.js kullanmadan). */
function expectedLayout(seq) {
  const vids = seq.v.flatMap((tr, t) => tr.map((c) => ({ c, t })));
  const auds = seq.a.flatMap((tr, t) => tr.map((c) => ({ c, t })));
  const cmp = (x, y) => (x.c.start < y.c.start ? -1 : x.c.start > y.c.start ? 1 : x.t - y.t || (x.c.name < y.c.name ? -1 : 1));
  vids.sort(cmp);
  const used = new Set();
  const exp = []; // {kind, track, name, start, end, inPt, outPt, linkedTo}
  let aIdx = 0;
  vids.forEach((v, i) => {
    exp.push({ kind: "V", track: i, ...pick(v.c) });
    const ch = auds.filter((a) => !used.has(a) && a.c.pi === v.c.pi && a.c.start === v.c.start && a.c.end === v.c.end && a.c.inPt === v.c.inPt).sort((x, y) => x.t - y.t);
    for (const a of ch) {
      used.add(a);
      exp.push({ kind: "A", track: aIdx++, ...pick(a.c), cam: v.c.name });
    }
  });
  auds.filter((a) => !used.has(a)).sort(cmp).forEach((a) => exp.push({ kind: "A", track: aIdx++, ...pick(a.c) }));
  return exp;
}
const pick = (c) => ({ name: c.name, start: c.start, end: c.end, inPt: c.inPt, outPt: c.outPt });

function checkLayout(seq, exp, label) {
  const all = [...seq.v.flatMap((tr, t) => tr.map((c) => ({ kind: "V", t, c }))), ...seq.a.flatMap((tr, t) => tr.map((c) => ({ kind: "A", t, c })))];
  let bad = 0;
  if (all.length !== exp.length) (bad++, fail(`${label}: klip sayısı ${all.length}, beklenen ${exp.length}`));
  for (const grp of [seq.v, seq.a]) grp.forEach((tr, t) => tr.length > 1 && (bad++, fail(`${label}: track ${t + 1}'de ${tr.length} klip`)));
  for (const e of exp) {
    const tr = (e.kind === "V" ? seq.v : seq.a)[e.track] ?? [];
    const c = tr[0];
    if (!c || c.name !== e.name) {
      bad++;
      fail(`${label}: ${e.kind}${e.track + 1} beklenen "${e.name}", bulunan ${c ? `"${c.name}"` : "boş"}`);
      continue;
    }
    for (const f of ["start", "end", "inPt", "outPt"]) if (c[f] !== e[f]) (bad++, fail(`${label}: "${e.name}" ${f} ${c[f]} ≠ ${e[f]}`));
  }
  // kamera birimleri bağlı mı (aynı linkId), WAV'lar bağsız mı
  for (const v of seq.v.flat()) {
    const partners = seq.a.flat().filter((a) => a.linkId && a.linkId === v.linkId);
    const wantCh = v.pi.channels;
    if (partners.length !== wantCh) (bad++, fail(`${label}: kamera "${v.name}" ${partners.length} bağlı sese sahip (beklenen ${wantCh})`));
  }
  if (!bad) ok(`${label}: ${exp.length} klip beklenen track'lerde, zamanlar tick düzeyinde aynı, her track'te 1 klip, kameralar bağlı`);
  return bad === 0;
}

// ------------------------------------------------------------ senaryolar
const scenarios = {};

scenarios.real = async () => {
  const s = setupReal();
  const beforeV = ser(s.v), beforeA = ser(s.a);
  const exp = expectedLayout(s);
  const otherBefore = JSON.stringify(seqByGuid("guid-other"), repl);
  let question = "";
  const out = await clickAndWait("btn-spread", async (q) => ((question = q), yes()));
  if (!/22 kamera, 12 ses bulundu, 50 track açılacak \(V 19, A 31\)/.test(question)) fail(`onay metni beklenenden farklı: ${question}`);
  else ok(`onay: "${question.slice(0, 90)}…"`);
  if (!/✓ SPREAD tamam/.test(out)) fail("SPREAD tamamlanmadı:\n" + out.split("\n").filter((l) => /DURDU|•|HATA/.test(l)).join("\n"));
  const S = seqByGuid("guid-main-edit");
  checkLayout(S, exp, "gerçek düzen (22 kamera + 12 WAV)");
  if (counters.txNames.join(",") !== "Spread: yedek sequence,Spread: track hazırlığı,Spread: dağıt")
    fail(`transaction'lar: ${counters.txNames.join(", ")}`);
  else ok("transaction'lar: yedek → track hazırlığı → dağıt (kırpılmış klip yok → eşitleme adımı yok)");
  if (counters.setActions.size) fail(`kırpılmamış kliplere set action çalıştı: ${counters.setActions.size}`);
  else ok("kırpılmamış kliplere hiç set action çalışmadı");
  const backup = state.sequences.find((x) => x.name === "Ana Kurgu Copy");
  if (!backup || ser(backup.v) !== beforeV || ser(backup.a) !== beforeA) fail("yedek sequence aslının kopyası değil");
  else ok("yedek sequence 'Ana Kurgu Copy' aslıyla aynı");
  if (JSON.stringify(seqByGuid("guid-other"), repl) !== otherBefore) fail("başka sequence değişti!");
  if (S.sel.size !== exp.length) fail(`son seçim ${S.sel.size}/${exp.length}`);
  else ok(`son adımda ${S.sel.size} klip programla seçildi`);
  if (!/Clip > Synchronize/.test(out)) fail("Synchronize talimatı yok");
  // Ctrl+Z × 2 (dağıt + track hazırlığı) → asıl düzene döner
  undo();
  undo();
  const back = seqByGuid("guid-main-edit");
  if (ser(back.v) === beforeV && ser(back.a) === beforeA) ok("Ctrl+Z × 2 → asıl düzen birebir geri geldi");
  else fail("Ctrl+Z × 2 aslına döndürmedi");
};

scenarios.trim = async () => {
  const s = setupReal({ nCams: 6, nWavSessions: 2, trimmed: [1, 4] });
  const exp = expectedLayout(s);
  const out = await clickAndWait("btn-spread", yes);
  if (!/✓ SPREAD tamam/.test(out)) fail("SPREAD tamamlanmadı:\n" + out);
  checkLayout(seqByGuid("guid-main-edit"), exp, "kırpılmış 2 kamera");
  if (!counters.txNames.includes("Spread: kırpma eşitlemesi")) fail("kırpma eşitlemesi adımı çalışmadı");
  const touched = [...counters.setActions.keys()].length;
  if (touched !== 4) fail(`set action'lar ${touched} klibe uygulandı (beklenen 4: 2 kamera × video+ses)`);
  else ok("set In/Out/Start/End yalnız kırpılmış 2 kameranın 4 klibine uygulandı");
};

scenarios.broken = async () => {
  const s = setupReal({ nCams: 6, nWavSessions: 2 });
  M.broken = true;
  const out = await clickAndWait("btn-spread", yes);
  if (!/✗ SPREAD DURDU: Taşıma doğrulaması tutmadı/.test(out)) fail("bozuk overwrite yakalanmadı:\n" + out);
  else ok("bozuk overwrite (video 1 kare kayık) doğrulamada yakalandı → DURDU");
  if (!/start: asıl=\d+ şimdi=\d+ \(fark 10160640000 tick\)/.test(out)) fail("fark tick olarak raporlanmadı");
  else ok("fark raporda: 10160640000 tick (1 kare)");
  if (counters.txNames.includes("Spread: kırpma eşitlemesi") || counters.setActions.size) fail("panel kendi başına düzeltmeye çalıştı (set action)!");
  else ok("panel kendi başına düzeltme yapmadı");
  if (!/Ctrl\+Z'ye 2 kez bas — ya da yedek sequence "Ana Kurgu Copy"/.test(out)) fail("geri alma talimatı eksik");
  else ok("talimat: Ctrl+Z × 2 ya da yedek sequence");
};

scenarios.nonseq = async () => {
  const s = setupReal({ nCams: 6, nWavSessions: 2 });
  const before = JSON.stringify(s, repl);
  M.nonseq = true;
  const out = await clickAndWait("btn-spread", yes);
  if (!/✗ SPREAD DURDU/.test(out)) fail("tek transaction'da ardışık track açılamazken durmadı");
  else ok("tek transaction'da ardışık track açma çalışmayınca TX-A'da DURDU");
  if (JSON.stringify(seqByGuid("guid-main-edit"), repl) !== before) fail("asıl sequence değişti!");
  else ok("asıl sequence'a hiç dokunulmadı");
  if (!/Timeline'da değişiklik yapılmadı/.test(out)) fail("'değişiklik yapılmadı' denmedi:\n" + out);
};

scenarios.nobackup = async () => {
  const s = setupReal({ nCams: 4, nWavSessions: 1 });
  const before = JSON.stringify(s, repl);
  M.nobackup = true;
  const out = await clickAndWait("btn-spread", yes);
  if (!/Yedek sequence oluşmadı.*Spread BAŞLAMADI/.test(out)) fail("yedek oluşmadan Spread başladı ya da mesaj yok:\n" + out);
  else ok("yedek oluşmayınca Spread BAŞLAMADI");
  if (JSON.stringify(seqByGuid("guid-main-edit"), repl) !== before || counters.txNames.length > 1) fail("yedek olmadan timeline'a dokunuldu!");
  else ok("timeline'a dokunulmadı");
};

scenarios.backupactive = async () => {
  const s = setupReal({ nCams: 6, nWavSessions: 2 });
  const exp = expectedLayout(s);
  M.backupActive = true;
  const out = await clickAndWait("btn-spread", yes);
  if (!/Yedek aktif oldu → asıl sequence'a dönülüyor/.test(out) || !/✓ SPREAD tamam/.test(out)) fail("yedek aktif olunca asla dönüp devam etmedi:\n" + out);
  else ok("yedek aktif oldu → asıl sequence'a dönüldü → Spread aslında tamamlandı");
  checkLayout(seqByGuid("guid-main-edit"), exp, "yedek-aktif senaryosu");
  const backup = state.sequences.find((x) => x.name === "Ana Kurgu Copy");
  if (!backup || backup.v[0].length !== 6) fail("yedeğe dokunuldu");
  else ok("yedeğe dokunulmadı");
};

scenarios.cancel = async () => {
  const s = setupReal({ nCams: 4, nWavSessions: 1 });
  const before = JSON.stringify(state.sequences, repl);
  const out = await clickAndWait("btn-spread", no);
  if (!/İptal edildi/.test(out) || JSON.stringify(state.sequences, repl) !== before) fail("iptalde bir şey değişti");
  else ok("onayda 'Hayır' → hiçbir şey değişmedi, yedek de alınmadı");
};

scenarios.switch = async () => {
  setupReal({ nCams: 6, nWavSessions: 2 });
  const otherBefore = JSON.stringify(seqByGuid("guid-other"), repl);
  // yedekten sonra, silme seçimi kurulurken kullanıcı başka sequence'a geçer
  hooks.onCloneSeq = () => {
    hooks.onCloneSeq = null;
    let n = 0;
    hooks.onGetActive = () => {
      if (++n === 4) {
        state.activeGuid = "guid-other";
        hooks.onGetActive = null;
      }
    };
  };
  const out = await clickAndWait("btn-spread", yes);
  if (!/✗ SPREAD DURDU: İşlem sırasında aktif sequence değişti/.test(out)) fail("sequence değişimi yakalanmadı:\n" + out);
  else ok("işlem ortasında sequence değişince DURDU");
  if (JSON.stringify(seqByGuid("guid-other"), repl) !== otherBefore) fail("diğer sequence değişti!");
  else ok("diğer sequence'a dokunulmadı");
};

scenarios.multichannel = async () => {
  const s = setupReal({ nCams: 5, nWavSessions: 1, channelsOf: { 2: 2 } });
  const exp = expectedLayout(s);
  const out = await clickAndWait("btn-spread", yes);
  if (!/✓ SPREAD tamam/.test(out)) fail("SPREAD tamamlanmadı:\n" + out);
  checkLayout(seqByGuid("guid-main-edit"), exp, "2 kanallı kamera");
};

scenarios.already = async () => {
  setupReal({ nCams: 4, nWavSessions: 1 });
  await clickAndWait("btn-spread", yes);
  const n = counters.txNames.length;
  const out = await clickAndWait("btn-spread", yes);
  if (!/Zaten dağıtılmış/.test(out) || counters.txNames.length !== n) fail("dağıtılmış sequence'ta tekrar işlem yaptı");
  else ok("ikinci SPREAD: 'Zaten dağıtılmış' — hiçbir işlem yapılmadı");
};

scenarios.status = async () => {
  setupReal({ nCams: 4, nWavSessions: 1 });
  await clickAndWait("btn-spread", yes);
  // Synchronize'ı taklit et: her WAV'ı bir kameranın içine kaydır
  const S = seqByGuid("guid-main-edit");
  const cams = S.v.flat().sort((a, b) => (a.start < b.start ? -1 : 1));
  const wavs = S.a.flat().filter((c) => !c.linkId);
  wavs.forEach((w, i) => {
    const cam = cams[i % cams.length];
    const d = w.end - w.start;
    w.start = cam.start + sec(1);
    w.end = w.start + d;
  });
  mockGen++;
  const out = await clickAndWait("btn-status", yes);
  const rep = els.report.value;
  if (!/SPREAD DURUM RAPORU/.test(rep) || !/TRACK DÖKÜMÜ/.test(rep)) fail("durum raporu başlıkları yok");
  const w0 = wavs[0], c0 = cams[0];
  const ov = (c0.end < w0.end ? c0.end : w0.end) - w0.start;
  const line = `OVERLAP;${w0.name};`;
  const row = rep.split("\n").find((l) => l.startsWith(line) && l.includes(`;${c0.name};`));
  if (!row || !row.includes(`;${ov};`)) fail(`OVERLAP satırı yanlış/eksik: ${row}`);
  else ok(`durum raporu: "${w0.name}" ↔ "${c0.name}" çakışması ${ov} tick doğru`);
  const clipRows = rep.split("\n").filter((l) => l.startsWith("CLIP;")).length; // başlık "# CLIP;" ile başlar
  if (clipRows !== S.v.flat().length + S.a.flat().length) fail(`CLIP satırı sayısı ${clipRows}`);
  else ok(`durum raporu: ${clipRows} CLIP satırı (tick + saniye + kaynak)`);
  els["btn-copy"].click();
  await sleep(30);
  if (!copied || !copied.includes("SPREAD DURUM RAPORU")) fail("rapor panoya kopyalanmadı");
  else ok("rapor panoya kopyalandı");
};

scenarios.falsetx = async () => {
  setupReal({ nCams: 6, nWavSessions: 2 });
  M.falseTx = "Spread: dağıt";
  const out = await clickAndWait("btn-spread", yes);
  if (!/✗ SPREAD DURDU: "dağıt" adımı başarısız \(executeTransaction → false\) — timeline değişmedi/.test(out)) fail("false dönen transaction doğru raporlanmadı:\n" + out);
  else ok("executeTransaction false → DURDU, timeline değişmedi olarak ölçüldü");
  if (!/Ctrl\+Z'ye 1 kez bas/.test(out) || undoStack.length !== 2) fail(`Ctrl+Z sayısı yanlış (undo kayıtları: ${undoStack.length})`);
  else ok("Ctrl+Z sayısı gerçek undo kayıtlarıyla aynı (1: yalnız track hazırlığı; yedeğe dokunulmaz)");
};

scenarios.subframe = async () => {
  const s = setupReal({ nCams: 6, nWavSessions: 2, audioOffByTick: [2] });
  const before = JSON.stringify(state.sequences, repl);
  const out = await clickAndWait("btn-spread", yes);
  if (!/Plan kurulamadı/.test(out) || !/birebir değil \(bağı korunamaz\).*end fark -1 tick/.test(out)) fail("1 tick'lik kamera sesi farkı plan hatası olmadı:\n" + out);
  else ok("kamera sesi videodan 1 tick kısa → plan hatası (bağ korunamazdı), Spread BAŞLAMADI");
  if (JSON.stringify(state.sequences, repl) !== before) fail("plan hatasında bir şey değişti");
};

scenarios.badbackup = async () => {
  const s = setupReal({ nCams: 6, nWavSessions: 2 });
  const before = JSON.stringify(seqByGuid("guid-main-edit"), repl);
  M.badBackup = true;
  const out = await clickAndWait("btn-spread", yes);
  if (!/içeriği aslıyla aynı değil.*Spread BAŞLAMADI/.test(out)) fail("eksik yedek yakalanmadı:\n" + out);
  else ok("yedek eksik kopyalanmış → Spread BAŞLAMADI");
  if (JSON.stringify(seqByGuid("guid-main-edit"), repl) !== before || counters.txNames.length !== 1) fail("eksik yedekle timeline'a dokunuldu");
  else ok("asıl sequence'a dokunulmadı");
};

scenarios.undobetween = async () => {
  const s = setupReal({ nCams: 6, nWavSessions: 2 });
  const before = JSON.stringify(seqByGuid("guid-main-edit"), repl);
  M.undoAfterTx = "Spread: track hazırlığı";
  const out = await clickAndWait("btn-spread", yes);
  if (!/"track hazırlığı" adımı geri alınmış görünüyor/.test(out)) fail("adımlar arası Ctrl+Z yakalanmadı:\n" + out);
  else ok("kullanıcı TX-A'dan sonra Ctrl+Z bastı → DURDU, adım 'yapılanlar'dan düşüldü");
  if (!/Timeline'da değişiklik yapılmadı/.test(out)) fail("Ctrl+Z sayısı düzeltilmedi");
  if (JSON.stringify(seqByGuid("guid-main-edit"), repl) !== before) fail("asıl sequence değişmiş kaldı");
  else ok("asıl sequence aslında; ek Ctrl+Z istenmedi");
};

scenarios.notype = async () => {
  const s = setupReal({ nCams: 6, nWavSessions: 2 });
  const exp = expectedLayout(s);
  M.noType = true; // TYPE_CLIP undefined, ClipProjectItem.cast hata (Probe'da sınanmamış API'ler)
  const out = await clickAndWait("btn-spread", yes);
  if (!/✓ SPREAD tamam/.test(out)) fail("sınanmamış isteğe bağlı API'ler yokken SPREAD engellendi:\n" + out);
  else ok("TYPE_CLIP / ClipProjectItem.cast yokken de (kırpılmamış klipler) SPREAD tamamlandı");
  checkLayout(seqByGuid("guid-main-edit"), exp, "isteğe bağlı API'ler yok");
};

scenarios.extrach = async () => {
  setupReal({ nCams: 6, nWavSessions: 2, extraChannelOf: [3] });
  const out = await clickAndWait("btn-spread", yes);
  if (!/✗ SPREAD DURDU: Taşıma doğrulaması tutmadı/.test(out) || !/2 klip var/.test(out)) fail("proje öğesinin fazla kanalı yakalanmadı:\n" + out);
  else ok("overwrite fazladan ses kanalı üretti → doğrulama '2 klip var' ile DURDU");
};

// ============================================================ v0.3.0: TOPLA / BAĞLA
// ------------------------------------------------------------ sahte ExtendScript DOM (host.jsx bunun üstünde çalışır)
const vm = require("vm");
const http = require("http");
const cryptoReal = require("crypto");
const hostile = { quit: false };
const byStart = (a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
const esColl = (arr, countKey) => {
  const a = arr.slice(); // Adobe örnekleri gibi 0 tabanlı
  a[countKey] = arr.length;
  return a;
};
function esItem(seq, c) {
  const T = (t) => ({ ticks: String(t), seconds: Number(t) / Number(TPS) });
  const it = {
    get nodeId() { return "n" + c.id; },
    get name() { return c.name; },
    get start() { return T(c.start); },
    get end() { return T(c.end); },
    get inPoint() { return T(c.inPt); },
    get outPoint() { return T(c.outPt); },
    get projectItem() { return { name: c.pi.name }; },
    mediaType: c.kind === "V" ? "Video" : "Audio",
    setSelected(on) {
      if (!findClip(c.id)) throw new Error("mock ES: klip yok");
      if (on) seq.sel.add(c.id);
      else seq.sel.delete(c.id);
      return 0;
    },
    isSelected: () => seq.sel.has(c.id),
  };
  if (M.linkedSemantics !== "none")
    it.getLinkedItems = () => {
      const all = [...seq.v.flat(), ...seq.a.flat()];
      const arr = M.linkedSemantics === "source" ? all.filter((x) => x.pi === c.pi && x.id !== c.id) : c.linkId ? all.filter((x) => x.linkId === c.linkId && x.id !== c.id) : [];
      return esColl(arr.map((x) => esItem(seq, x)), "numItems");
    };
  return it;
}
function esSeq(seq) {
  const tracks = (grp) => esColl(grp.map((tr) => ({ clips: esColl(tr.slice().sort(byStart).map((c) => esItem(seq, c)), "numItems") })), "numTracks");
  return {
    get name() { return seq.name; },
    sequenceID: seq.guid,
    get videoTracks() { return tracks(seq.v); },
    get audioTracks() { return tracks(seq.a); },
    getSelection: () => [...seq.v.flat(), ...seq.a.flat()].filter((c) => seq.sel.has(c.id)).sort(byStart).map((c) => esItem(seq, c)),
    linkSelection() {
      const clips = [...seq.sel].map((id) => findClip(id)).filter(Boolean).map((f) => f.c);
      if (!clips.length) return false;
      if (M.linkFailName && clips.some((c) => c.name === M.linkFailName)) return false;
      const L = "X" + nextId++;
      for (const c of clips) c.linkId = L;
      counters.links++;
      return true;
    },
  };
}
const fakeApp = {
  version: "26.5.1",
  project: {
    get activeSequence() {
      const s = seqByGuid(state.activeGuid);
      return s ? esSeq(s) : 0;
    },
  },
  quit() {
    hostile.quit = true;
  },
};
counters.links = 0;

// ------------------------------------------------------------ gerçek yardımcı (cep-helper/js/helper.js) + host.jsx (vm)
const HELPER = require(path.join(__dirname, "..", "..", "cep-helper", "js", "helper.js"));
const HOST_SRC = fsReal.readFileSync(path.join(__dirname, "..", "..", "cep-helper", "jsx", "host.jsx"), "utf8");
let helper = null;
const helperLog = [];
async function startHelper() {
  if (helper) return helper;
  const ctx = vm.createContext({ app: fakeApp });
  vm.runInContext(HOST_SRC, ctx);
  const evalScript = (script, cb) =>
    setTimeout(() => {
      let r;
      try {
        r = vm.runInContext(script, ctx, { timeout: 5000 });
      } catch (e) {
        r = "EvalScript error.";
      }
      cb(String(r));
    }, 1);
  helper = HELPER.createHelper({ http, crypto: cryptoReal, fs: fsReal, path, os: osReal, evalScript, home: TMPHOME, platform: "darwin", log: (l) => helperLog.push(l) });
  await helper.start();
  return helper;
}
async function stopHelper() {
  if (helper) await helper.stop();
  helper = null;
}

// ------------------------------------------------------------ senkron sonrası düzen
function setupSync(spec) {
  setupReal({ nCams: 1, nWavSessions: 0 }); // sıfırlama (sayaçlar, bayraklar, yedek yok)
  for (const k of Object.keys(projItems)) delete projItems[k];
  const s = mkSequence("Ana Kurgu", "guid-main-edit", 0, 0);
  const others = spec.others ?? [];
  const vids = [...others.map((o) => ({ ...o, other: true })), ...spec.cams].sort(byStart);
  vids.forEach((x, i) => {
    s.v.push([]);
    x.p = pi(x.name, x.media ?? x.dur + (x.inPt ?? 0n), { channels: x.other ? 0 : x.channels ?? 1 });
    x.L = x.other ? null : "Lc" + i;
    s.v[i].push(mkClip("V", x.p, x.start, x.start + x.dur, x.L, x.inPt ?? 0n));
  });
  let a = 0;
  for (const x of vids)
    if (!x.other)
      for (let ch = 0; ch < (x.channels ?? 1); ch++) {
        s.a.push([]);
        s.a[a++].push(mkClip("A", x.p, x.start, x.start + x.dur, x.L, x.inPt ?? 0n));
      }
  for (const w of spec.wavs.slice().sort(byStart)) {
    s.a.push([]);
    const p = pi(w.name, w.media ?? w.dur + (w.inPt ?? 0n), { video: false });
    s.a[a++].push(mkClip("A", p, w.start, w.start + w.dur, null, w.inPt ?? 0n));
  }
  if (!s.v.length) s.v.push([]);
  const other = mkSequence("Müşteri Kurgusu", "guid-other");
  other.v[0].push(mkClip("V", pi("OTHER.MP4", sec(20)), 0n, sec(20), "Lo"));
  state.sequences = [s, other];
  state.activeGuid = s.guid;
  undoStack.length = 0;
  counters.txNames = [];
  counters.links = 0;
  counters.cloneOffsets = [];
  counters.setActions.clear();
  hostile.quit = false;
  lsStore.clear();
  lsBroken = false;
  mockGen++;
  return s;
}

/**
 * SENTETİK "gerçek senkron sonucu" (kullanıcının durum raporu bu oturuma gelmedi — adlar ve sayılar gerçek düzenden:
 * 22 kamera = 11 çekim × (A038C0xx_*.MP4 A kamera + C01xx.MP4 B kamera), 12 WAV = 4 kayıt × Tr1/Tr2/TrLR, V1'de "YAĞ…" grafiği).
 * Kayıtlar birden çok çekimi kapsar (ses akarken video kesilip yeniden başlıyor); WAV'ların başı/sonu ve çekim araları çapa dışında.
 * Kamera start'ları 25 fps kare hizalı, WAV start'ları kare-altı (senkron sample hassasiyetinde bırakır).
 */

/** Durum raporunun CLIP satırlarından timeline kurar (skip: atlanacak track etiketleri, ör. çift kopyalar). */
function setupFromReport(text, skip = []) {
  setupSync({ cams: [], wavs: [], others: [] });
  for (const k of Object.keys(projItems)) delete projItems[k];
  const s = mkSequence("Ana Kurgu", "guid-main-edit", 0, 0);
  const rows = text.split(/\r?\n/).filter((l) => l.startsWith("CLIP;")).map((l) => l.split(";")).filter((r) => !skip.includes(r[2]));
  const media = {};
  for (const r of rows) media[r[8]] = (media[r[8]] ?? 0n) > BigInt(r[6]) ? media[r[8]] : BigInt(r[6]);
  const hasV = new Set(rows.filter((r) => r[1] === "V").map((r) => r[8]));
  for (const r of rows) {
    const [, kind, label, st, en, inP, , , projName, name] = r;
    const t = Number(label.slice(1)) - 1;
    const grp = kind === "V" ? s.v : s.a;
    while (grp.length <= t) grp.push([]);
    const p = projItems[projName] ?? pi(projName, media[projName], { video: hasV.has(projName), channels: 1 });
    const c = mkClip(kind, p, BigInt(st), BigInt(en), null, BigInt(inP));
    c.name = name;
    grp[t].push(c);
  }
  for (const v of s.v.flat()) for (const a of s.a.flat()) if (a.pi === v.pi && a.start === v.start && a.end === v.end) a.linkId = v.linkId = v.linkId ?? "Lr" + v.id;
  state.sequences = [s, state.sequences.find((x) => x.guid === "guid-other")];
  state.activeGuid = s.guid;
  mockGen++;
  return s;
}

/**
 * SENTETİK senkron sonucu (v0.3.0'dan): 11 çekim × (A038C0xx + C01xx), 12 WAV (4 kayıt × Tr1/Tr2/TrLR; her kayıt birden çok çekimi
 * kapsar), grafik "YAĞ SIVISI" en sonda (kendi track'inde; yeni düzene değmez). Kayıtlar sırayla (senkron bu örnekte karıştırmadı).
 */
function syncDataset({ takes = 11, sessions = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10]] } = {}) {
  const A = [612, 455, 880, 377, 1025, 540, 733, 298, 950, 410, 667];
  const B = [540, 470, 760, 300, 990, 505, 610, 260, 900, 450, 600];
  const D = [37, -12, 60, 25, 18, 40, -30, 22, 45, 10, 33];
  const cams = [];
  let t = frames(10 * 25);
  for (let g = 0; g < takes; g++) {
    const aS = t;
    const bS = t + frames(D[g]);
    cams.push({ name: `A038C0${String(g + 1).padStart(2, "0")}_2609121${String(g).padStart(2, "0")}.MP4`, start: aS, dur: frames(A[g]), take: g });
    cams.push({ name: `C01${String(g + 1).padStart(2, "0")}.MP4`, start: bS, dur: frames(B[g]), take: g });
    t = [aS + frames(A[g]), bS + frames(B[g])].reduce((m, x) => (x > m ? x : m)) + frames(8 * 25);
  }
  const tEnd = (g) => cams.filter((c) => c.take === g).reduce((m, c) => (c.start + c.dur > m ? c.start + c.dur : m), 0n);
  const tStart = (g) => cams.filter((c) => c.take === g).reduce((m, c) => (c.start < m ? c.start : m), 1n << 62n);
  const wavs = [];
  const ids = ["101512", "104233", "111845", "120510", "133224"];
  const members = [];
  sessions.forEach((gs, i) => {
    const ws = tStart(gs[0]) - sec(2.5) + 37n;
    const we = tEnd(gs[gs.length - 1]) + sec(3);
    const inPt = i === 1 ? sec(1.5) : 0n;
    for (const tr of ["Tr1", "Tr2", "TrLR"]) wavs.push({ name: `260912_${ids[i]}_${tr}.WAV`, start: ws, dur: we - ws, inPt });
    members.push([`260912_${ids[i]}`, ...cams.filter((c) => gs.includes(c.take)).map((c) => c.name.replace(/\.[^.]+$/, ""))]);
  });
  const others = [{ name: "YAĞ SIVISI", start: t + sec(60), dur: frames(100) }];
  return { cams, wavs, others, members };
}

// ------------------------------------------------------------ BAĞIMSIZ beklenti hesapları (plan kodunu kullanmaz)
const devOf = (n) => {
  const m = /^([A-Z])\d{3}C\d{3}_/.exec(n);
  if (m) return m[1];
  return /^C\d{4}\.[^.]+$/.test(n) ? "Sony" : null;
};
const srcOf = (n) => {
  const m = /^(\d{6})_(\d{6})_(Tr\w+)\.[^.]+$/i.exec(n);
  if (m) return "Zoom Tr" + m[3].slice(2).toUpperCase();
  if (/^DJI_\d+_\d{8}_\d{6}\./.test(n)) return "DJI";
  const b = n.replace(/\.[^.]+$/, "");
  return b.replace(/\d+/g, "").replace(/[\s._-]+/g, "_").replace(/^_+|_+$/g, "");
};
const recOf = (n) => {
  const m = /^(\d{6}_\d{6})_Tr/.exec(n);
  return m ? m[1] : n.replace(/\.[^.]+$/, "");
};
const ceilF = (x, f = FRAME25) => {
  const r = ((x % f) + f) % f;
  return r ? x + f - r : x;
};
function allClips(seq) {
  return [...seq.v.flatMap((tr, t) => tr.map((c) => ({ kind: "V", track: t, c }))), ...seq.a.flatMap((tr, t) => tr.map((c) => ({ kind: "A", track: t, c })))];
}
const entry = (x) => ({ kind: x.kind, track: x.track, name: x.c.name, start: x.c.start, end: x.c.end, inPt: x.c.inPt });

/**
 * TOPLA'nın beklenen sonucu: oturumlar (kayıt anahtarı listeleri, kronolojik sırada) sequence başından G boşlukla, blok başına tek
 * kare-katı ofset; cihaz → V; kaynak → A (srcTrack), kılavuz sesler (cihaz başına 1 kanal) onların altında, "sil" kaynakları altında,
 * sahipsizler park'ta (zaman aynı, çakışmayan ilk park track'i); diğerleri (grafik) yerinde.
 */
function expectTopla(seq, { sessions, devices, srcTrack, sil = [], gap = sec(2) }) {
  const clips = allClips(seq);
  const mapped = Math.max(-1, ...Object.values(srcTrack)) + 1;
  const aPark = mapped + devices.length + sil.length;
  const exp = [];
  const blocks = [];
  const used = new Set();
  let cursor = 0n;
  for (const keys of sessions) {
    const mem = clips.filter((x) => keys.includes(recOf(x.c.name)));
    mem.forEach((x) => used.add(x));
    const bs = mem.reduce((m, x) => (x.c.start < m ? x.c.start : m), 1n << 62n);
    const be = mem.reduce((m, x) => (x.c.end > m ? x.c.end : m), 0n);
    const d = ceilF(cursor - bs);
    blocks.push({ keys, delta: d, start: bs + d, end: be + d });
    cursor = ceilF(be + d + gap);
    for (const x of mem) {
      const n = x.c.name;
      let track;
      if (x.kind === "V") track = devices.indexOf(devOf(n));
      else if (devOf(n)) track = mapped + devices.indexOf(devOf(n));
      else track = sil.includes(srcOf(n)) ? mapped + devices.length + sil.indexOf(srcOf(n)) : srcTrack[srcOf(n)];
      exp.push({ ...entry(x), track, start: x.c.start + d, end: x.c.end + d });
    }
  }
  const occ = new Map();
  const add = (k, t, s, e) => occ.set(`${k}|${t}`, [...(occ.get(`${k}|${t}`) ?? []), [s, e]]);
  const rest = clips.filter((x) => !used.has(x));
  const known = (x) => (x.kind === "V" ? devOf(x.c.name) : devOf(x.c.name) || /\.WAV$/i.test(x.c.name));
  for (const e of exp) add(e.kind, e.track, e.start, e.end);
  for (const x of rest.filter((y) => !known(y))) {
    exp.push(entry(x));
    add(x.kind, x.track, x.c.start, x.c.end);
  }
  for (const x of rest.filter(known).sort((p, q) => (p.c.start < q.c.start ? -1 : 1))) {
    let t = x.kind === "V" ? devices.length : aPark;
    while ((occ.get(`${x.kind}|${t}`) ?? []).some(([s, e]) => x.c.start < e && s < x.c.end)) t++;
    add(x.kind, t, x.c.start, x.c.end);
    exp.push({ ...entry(x), track: t });
  }
  return { exp, blocks };
}

function checkExactly(seq, exp, label) {
  const key = (e) => [e.kind, e.track, e.name, e.start, e.end, e.inPt, e.inPt + (e.end - e.start)].join("|");
  const got = allClips(seq).map((x) => [x.kind, x.track, x.c.name, x.c.start, x.c.end, x.c.inPt, x.c.outPt].join("|")).sort();
  const want = exp.map(key).sort();
  const missing = want.filter((w) => !got.includes(w));
  const extra = got.filter((g) => !want.includes(g));
  if (missing.length || extra.length) {
    fail(`${label}: ${missing.length} eksik, ${extra.length} fazla\n     eksik: ${missing.slice(0, 4).join("\n            ")}\n     fazla: ${extra.slice(0, 4).join("\n            ")}`);
    return false;
  }
  ok(`${label}: ${exp.length} klip beklenen track'lerde, start/end/in/out tick düzeyinde doğru`);
  return true;
}

/** BAĞLA'nın beklenen sonucu — oturum İÇİNDE: grup = çakışan kameralar, çapa = en uzun (eşitlikte alt track), parça = ses ∩ çapa. */
function expectBagla(list, sessions, sil = []) {
  const exp = [];
  const groups = [];
  const used = new Set();
  for (const keys of sessions) {
    const mem = list.filter((e) => keys.includes(recOf(e.name)));
    mem.forEach((e) => used.add(e));
    const cams = mem.filter((e) => e.kind === "V").sort((p, q) => (p.start < q.start ? -1 : p.start > q.start ? 1 : p.track - q.track));
    const gs = [];
    for (const c of cams) {
      const g = gs[gs.length - 1];
      if (g && c.start < g.end) (g.cams.push(c), (g.end = g.end > c.end ? g.end : c.end));
      else gs.push({ keys, cams: [c], end: c.end, pieces: [], guides: [] });
    }
    for (const g of gs)
      g.anchor = g.cams.reduce((m, c) => {
        const lc = c.end - c.start;
        const lm = m.end - m.start;
        return lc > lm || (lc === lm && (c.track < m.track || (c.track === m.track && c.start < m.start))) ? c : m;
      });
    for (const w of mem.filter((e) => e.kind === "A" && !devOf(e.name))) {
      if (sil.includes(srcOf(w.name))) continue;
      for (const g of gs) {
        const ps = w.start > g.anchor.start ? w.start : g.anchor.start;
        const pe = w.end < g.anchor.end ? w.end : g.anchor.end;
        if (pe <= ps) continue;
        const p = { kind: "A", track: w.track, name: w.name, start: ps, end: pe, inPt: w.inPt + (ps - w.start) };
        g.pieces.push(p);
        exp.push(p);
      }
    }
    for (const g of gs) {
      exp.push(...g.cams);
      if (!g.pieces.length) {
        g.guides = mem.filter((e) => e.kind === "A" && devOf(e.name) && g.cams.some((c) => c.name === e.name && c.start === e.start));
        exp.push(...g.guides);
      }
    }
    groups.push(...gs);
  }
  exp.push(...list.filter((e) => !used.has(e)));
  return { exp, groups };
}

function checkLinks(seq, groups, label) {
  const clipOf = (e) => allClips(seq).find((x) => x.kind === e.kind && x.c.name === e.name && x.c.start === e.start)?.c;
  let bad = 0;
  for (const g of groups) {
    const members = [...g.cams, ...g.pieces, ...g.guides].map(clipOf);
    if (members.length < 2) continue;
    const L = members[0]?.linkId;
    if (!L || members.some((m) => !m || m.linkId !== L)) {
      bad++;
      fail(`${label}: grup (çapa "${g.anchor.name}") üyeleri aynı bağda değil`);
      continue;
    }
    const outsiders = allClips(seq).filter((x) => x.c.linkId === L && !members.includes(x.c));
    if (outsiders.length) (bad++, fail(`${label}: grup (çapa "${g.anchor.name}") bağına grup dışı ${outsiders.length} klip girmiş`));
  }
  if (!bad) ok(`${label}: ${groups.length} grup — her grubun kameraları + kendi oturumunun ses parçaları tek bağda, grup/oturum dışı bağ yok`);
}

const doneRe = /✓ SPREAD tamam|✗ SPREAD DURDU|✓ TOPLA tamam|✗ TOPLA DURDU|✓ BAĞLA tamam|⚠ BAĞLA bitti|✗ BAĞLA DURDU|İptal edildi|Zaten dağıtılmış|Zaten toplanmış|Durum raporu hazır/;
const txOf = (prefix) => counters.txNames.filter((n) => n.startsWith(prefix));
const TOPLA_TX = "TOPLA: yedek sequence,TOPLA: ilk park (ölçüm),TOPLA: park,TOPLA: ilk yerleştirme (ölçüm),TOPLA: yerleştir";
async function scan() {
  markLog();
  els["btn-channels"].click();
  const t0 = Date.now();
  while (Date.now() - t0 < 5000 && !/Harici kaynaklar:|Kaynaklar okunamadı/.test(newLog())) await sleep(20);
}
function selectOf(src) {
  for (const row of els.mapping?.children ?? []) {
    const sel = row.children?.[1];
    if (sel && sel.id === `map-${src}`) return sel;
  }
  return null;
}
async function setMap(src, v) {
  await scan();
  const sel = selectOf(src);
  if (!sel) return fail(`eşleme kutusu yok: ${src}`);
  sel.value = String(v);
  sel.fire("change");
}
const snapList = () => allClips(seqByGuid("guid-main-edit")).map(entry);
const mainTracks = () => ser(seqByGuid("guid-main-edit").v) + ser(seqByGuid("guid-main-edit").a);

// ------------------------------------------------------------ 12 Eylül — kullanıcının GERÇEK senkron sonucu
const R0912 = fsReal.readFileSync(path.join(__dirname, "fixtures", "senkron-raporu-260912.txt"), "utf8");
const S0912 = [
  ["260912_133224", "A038C001_260912BD", "C0142"],
  ["260912_141513", "A038C002_260912RQ", "C0143"],
  ["260912_144207", "A038C003_260912FY", "A038C004_260912QH", "A038C005_260912GP", "A038C006_260912AB", "A038C007_260912KW", "A038C008_260912DG", "A038C009_260912WH", "C0144", "C0145", "C0146", "C0147", "C0148", "C0149", "C0150"],
  ["260912_151555", "A038C010_260912NE", "A038C011_260912QW", "C0151", "C0152"],
];

scenarios.real0912dup = async () => {
  setupFromReport(R0912);
  const before = JSON.stringify(state.sequences, repl);
  const out = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✗ TOPLA DURDU: ÇİFT KOPYA var/.test(out) || !/A26 \/ A27: "260912_133224_Tr1\.WAV"/.test(out) || !/A29 \/ A30: "260912_133224_Tr2\.WAV"/.test(out))
    fail("gerçek raporda çift kopyalar DURDURMADI / listelenmedi:\n" + out.split("\n").slice(-8).join("\n"));
  else ok("12 Eylül (çiftler varken): TOPLA DURDU, A26/A27 ve A29/A30 listelendi");
  if (JSON.stringify(state.sequences, repl) !== before || counters.txNames.length) fail("çift kopya varken bir şey değişti");
  else ok("hiçbir şeye dokunulmadı (yedek bile alınmadı)");
};

scenarios.real0912 = async () => {
  setupFromReport(R0912, ["A27", "A30"]);
  await setMap("Zoom TrLR", "sil"); // kullanıcı TrLR'yi istemiyor
  let q = "";
  const out = await clickAndWait("btn-collect", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ TOPLA tamam/.test(out)) return fail("TOPLA tamamlanmadı:\n" + out.split("\n").filter((l) => /DURDU|•|HATA|ÇAKIŞMA|AYRIL|SIRA/.test(l)).join("\n"));
  const lines = q.split("\n").filter((l) => /^ {2}O\d/.test(l));
  const wantOrder = ["133224", "141513", "144207", "151555"];
  if (lines.length !== 4 || !lines.every((l, i) => l.includes(`Zoom 260912_${wantOrder[i]}`))) fail(`oturum listesi/sırası beklenenden farklı:\n${lines.join("\n")}`);
  else ok("4 oturum, sıra 133224 → 141513 → 144207 → 151555 (A sayaçları, Sony sayaçları ve Zoom saatleri aynı sırayı verdi)");
  if (!/O3 {2}Zoom 260912_144207 \+ A: A038C003_260912FY\.\.A038C009_260912WH \(7\) \+ Sony: C0144\.\.C0150 \(7\)/.test(q)) fail("O3 üyeleri beklenenden farklı:\n" + lines[2]);
  else ok("O3 = {144207 + A038C003..009 + C0144..0150}; A038C001 144207'ye KARIŞMADI (%9.1 çakışma = zayıf)");
  const S = seqByGuid("guid-main-edit");
  // beklenen düzen TOPLA ÖNCESİ kliplerden hesaplanır: undo yığınındaki ilk (TOPLA öncesi) hâl
  const pre = JSON.parse(JSON.stringify(undoStack[0]), rev).sequences.find((x) => x.guid === "guid-main-edit");
  const { exp, blocks } = expectTopla(pre, { sessions: S0912, devices: ["A", "Sony"], srcTrack: { "Zoom Tr1": 0, "Zoom Tr2": 1 }, sil: ["Zoom TrLR"] });
  checkExactly(S, exp, "12 Eylül TOPLA (oturumlar sırayla, blok içi ofset aynı, A → V1, Sony → V2, Tr1 → A1, Tr2 → A2, kılavuzlar A3–A4, TrLR → A5)");
  const disjoint = blocks.every((b, i) => i === 0 || b.start >= blocks[i - 1].end);
  if (!disjoint) fail("bloklar çakışıyor");
  else ok(`bloklar çakışmıyor: ${blocks.map((b) => `[${secOf(b.start)}–${secOf(b.end)}]`).join(" ")}`);
  if (txOf("TOPLA").join(",") !== TOPLA_TX) fail(`TOPLA transaction'ları: ${txOf("TOPLA").join(", ")}`);
  else ok("TOPLA: yedek → ilk park (ölçüm, yalnız O1) → park → ilk yerleştirme (ölçüm, yalnız O1) → yerleştir");

  const collected = snapList();
  await startHelper();
  const out2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(out2)) return fail("BAĞLA tamamlanmadı:\n" + out2.split("\n").filter((l) => /DURDU|•|HATA/.test(l)).join("\n"));
  const eb = expectBagla(collected, S0912, ["Zoom TrLR"]);
  checkExactly(S, eb.exp, "12 Eylül BAĞLA (kesim yalnız oturum içinde, TrLR ve kılavuzlar silindi)");
  checkLinks(S, eb.groups, "12 Eylül bağları");
  // A038C001'in bağında 144207'den bir parça OLMAMALI
  const a1 = S.v.flat().find((c) => c.name.startsWith("A038C001"));
  const wrong = allClips(S).filter((x) => x.c.linkId === a1.linkId && x.c.name.includes("144207"));
  if (wrong.length) fail(`A038C001'e 144207 sesi bağlandı (${wrong.length})`);
  else ok("A038C001'in bağında yalnız 133224 parçaları var (144207'den 176 sn kesilmedi)");
};

// ------------------------------------------------------------ 23 Eylül adlarıyla SENTETİK çekim (yalnız adlandırma/sıra fixture'ı)
function sep23() {
  const T = (m, s = 0) => sec(m * 60 + s); // 17:00'dan itibaren
  const cam = (a, c, s, e) => [{ name: `${a}.MP4`, start: s, dur: e - s }, ...(c ? [{ name: `${c}.MP4`, start: s, dur: e - s }] : [])];
  const zoom = (hms, chans, s, e) => chans.map((ch) => ({ name: `260923_${hms}_${ch}.WAV`, start: s, dur: e - s }));
  const dji = (n, hms, s, e) => [{ name: `DJI_${n}_20260923_${hms}.WAV`, start: s, dur: e - s }];
  const S = [
    { keys: ["A041C001_260923HE", "C0153"], cams: cam("A041C001_260923HE", "C0153", T(5), T(8)), wavs: [] }, // harici ses YOK
    {
      keys: ["260923_171315", "DJI_01_20260923_171450", "A041C002_260923KD", "C0154"],
      cams: cam("A041C002_260923KD", "C0154", T(15), T(22)),
      wavs: [...zoom("171315", ["TrLR"], T(13, 15), T(30)), ...dji("01", "171450", T(14, 50), T(34, 50))],
    },
    {
      keys: ["260923_175039", "260923_180910", "DJI_02_20260923_175336", "A041C003_260923MX", "C0155", "A041C004_260923PQ", "C0156"],
      cams: [...cam("A041C003_260923MX", "C0155", T(54), T(60)), ...cam("A041C004_260923PQ", "C0156", T(70), T(77))],
      wavs: [...zoom("175039", ["Tr1", "TrLR"], T(50, 39), T(67, 10)), ...zoom("180910", ["Tr1", "TrLR"], T(69, 10), T(78)), ...dji("02", "175336", T(53, 36), T(80, 36))],
    },
    {
      keys: ["260923_182722", "DJI_03_20260923_182724", "A041C006_260923RB", "C0157"],
      cams: cam("A041C006_260923RB", "C0157", T(89), T(95)),
      wavs: [...zoom("182722", ["Tr1", "TrLR"], T(87, 22), T(100)), ...dji("03", "182724", T(87, 24), T(103, 24))],
    },
    {
      keys: ["260923_191148", "A041C007_260923GF", "C0158", "A041C008_260923VN", "C0159"],
      cams: [...cam("A041C007_260923GF", "C0158", T(132), T(135)), ...cam("A041C008_260923VN", "C0159", T(135, 10), T(137))],
      wavs: zoom("191148", ["Tr1", "Tr2", "TrLR"], T(131, 48), T(137, 30)),
    },
    {
      keys: ["260923_191824", "A041C009_260923LM", "C0160", "A041C010_260923YC", "C0161", "A041C011_260923UW", "C0162"],
      cams: [...cam("A041C009_260923LM", "C0160", T(138, 40), T(141)), ...cam("A041C010_260923YC", "C0161", T(141, 10), T(143)), ...cam("A041C011_260923UW", "C0162", T(143, 10), T(144, 50))],
      wavs: zoom("191824", ["Tr1", "Tr2", "TrLR"], T(138, 24), T(145)),
    },
  ];
  // Synchronize'ın ilişkisiz grupları rastgele ve ÜST ÜSTE koyması: bloklar karışık sırada, her biri öncekinin son 30 sn'sine biner
  const order = [4, 2, 0, 5, 1, 3];
  const cams = [];
  const wavs = [];
  let at = sec(600);
  for (const i of order) {
    const s = S[i];
    const all = [...s.cams, ...s.wavs];
    const bs = all.reduce((m, x) => (x.start < m ? x.start : m), 1n << 62n);
    const be = all.reduce((m, x) => (x.start + x.dur > m ? x.start + x.dur : m), 0n);
    const off = at - bs;
    for (const c of s.cams) cams.push({ ...c, start: c.start + off });
    for (const w of s.wavs) wavs.push({ ...w, start: w.start + off });
    at = be + off - sec(30);
  }
  cams.push({ name: "A041C005_260923ZT.MP4", start: at + sec(400), dur: frames(25) }); // ~1 sn, eşi yok → sahipsiz
  return { cams, wavs, others: [], members: S.map((s) => s.keys) };
}

scenarios.sep23 = async () => {
  const spec = sep23();
  setupSync(spec);
  let q = "";
  const out = await clickAndWait("btn-collect", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ TOPLA tamam/.test(out)) return fail("TOPLA tamamlanmadı:\n" + out.split("\n").filter((l) => /DURDU|•|HATA|ÇAKIŞMA|AYRIL|SIRA/.test(l)).join("\n"));
  const lines = q.split("\n").filter((l) => /^ {2}O\d/.test(l));
  if (lines.length !== 6) fail(`6 oturum beklenirdi, ${lines.length}:\n${lines.join("\n")}`);
  else ok("6 oturum (senkronun karıştırdığı sıra düzeldi: A041C001 → … → A041C011)");
  if (!lines[2] || !/Zoom 260923_175039 \+ Zoom 260923_180910 \+ DJI_02_20260923_175336/.test(lines[2])) fail(`DJI_02 iki Zoom kaydını tek oturumda toplamadı: ${lines[2]}`);
  else ok("DJI_02 iki Zoom kaydını (175039, 180910) kapsıyor → TEK oturum");
  if (!/Park track'lerine .*A041C005_260923ZT/.test(q)) fail("A041C005 sahipsiz olarak raporlanmadı");
  else ok("A041C005 (~1 sn, eşsiz) sahipsiz → park + rapor");
  const pre = JSON.parse(JSON.stringify(undoStack[0]), rev).sequences.find((x) => x.guid === "guid-main-edit");
  const src = { "Zoom Tr1": 0, "Zoom Tr2": 1, "Zoom TrLR": 2, DJI: 3 };
  const { exp } = expectTopla(pre, { sessions: spec.members, devices: ["A", "Sony"], srcTrack: src });
  checkExactly(seqByGuid("guid-main-edit"), exp, "23 Eylül TOPLA (Tr2'siz oturumlar sorun değil; DJI → A4; A041C005 → V3 park, zamanı aynı)");
  const collected = snapList();
  await startHelper();
  const out2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(out2)) return fail("BAĞLA tamamlanmadı:\n" + out2.split("\n").filter((l) => /DURDU|•|HATA/.test(l)).join("\n"));
  const eb = expectBagla(collected, spec.members, []);
  checkExactly(seqByGuid("guid-main-edit"), eb.exp, "23 Eylül BAĞLA (DJI_02 iki grubun çapasına kesildi; harici sesi olmayan O1'de kamera sesi korundu)");
  checkLinks(seqByGuid("guid-main-edit"), eb.groups, "23 Eylül bağları (O1: kameralar + kendi sesleri)");
  const guides = allClips(seqByGuid("guid-main-edit")).filter((x) => x.kind === "A" && /^(A041C001|C0153)/.test(x.c.name));
  if (guides.length !== 2) fail(`harici sesi olmayan oturumun kamera sesi korunmadı (${guides.length})`);
  else ok("harici sesi olmayan oturum: kamera sesleri silinmedi, bağlandı");
  const park = allClips(seqByGuid("guid-main-edit")).filter((x) => /^A041C005/.test(x.c.name));
  if (park.some((x) => x.c.linkId && /^X/.test(x.c.linkId))) fail("sahipsiz A041C005 bağlandı");
  else ok("sahipsiz A041C005'e BAĞLA dokunmadı");
};

// ------------------------------------------------------------ adversaryal: ilişkisiz iki grup İÇ İÇE (veto, tek anlamlı çözüm yok)
function nestedSpec() {
  return {
    cams: [
      { name: "A038C001_260912AA.MP4", start: sec(100), dur: sec(300) },
      { name: "C0101.MP4", start: sec(100), dur: sec(300) },
      { name: "A038C002_260912BB.MP4", start: sec(200), dur: sec(50) },
      { name: "C0102.MP4", start: sec(200), dur: sec(50) },
      { name: "A038C003_260912CC.MP4", start: sec(1000), dur: sec(60) },
      { name: "C0103.MP4", start: sec(1000), dur: sec(60) },
    ],
    wavs: [
      { name: "260912_100000_Tr1.WAV", start: sec(95), dur: sec(310) },
      { name: "260912_110000_Tr1.WAV", start: sec(198), dur: sec(54) },
      { name: "260912_120000_Tr1.WAV", start: sec(995), dur: sec(70) },
    ],
    others: [],
  };
}

scenarios.nested = async () => {
  setupSync(nestedSpec());
  const before = JSON.stringify(state.sequences, repl);
  let q = "";
  const out = await clickAndWait("btn-collect", async (x) => ((q = x), no()), doneRe);
  if (!/AYRILAMAYAN OTURUM — tek anlamlı çözüm yok, TAHMİN EDİLMEDİ/.test(q) || !/A: A038C001_260912AA .* ↔ A038C002_260912BB/.test(q))
    fail("iç içe ilişkisiz gruplar için SORULMADI:\n" + q);
  else ok("iç içe ilişkisiz iki grup: veto ihlali, bütün bağlar %100 → tek anlamlı çözüm yok → SORULDU");
  if (!/İptal edildi/.test(out) || JSON.stringify(state.sequences, repl) !== before) fail("'Hayır' sonrası bir şey değişti");
  else ok("'Hayır' → hiçbir şey değişmedi");
  // 'Evet' → ayrılamayanlar park'a (zamanı aynı), üçüncü (ilişkisiz, ayrık) grup normal dizilir
  let qs = [];
  const out2 = await clickAndWait("btn-collect", async (x) => (qs.push(x), yes()), doneRe);
  if (!/✓ TOPLA tamam/.test(out2)) return fail("'Evet' sonrası TOPLA tamamlanmadı:\n" + out2);
  const S = seqByGuid("guid-main-edit");
  const parked = S.v.flatMap((tr, t) => tr.map((c) => ({ t, c }))).filter((x) => /A038C00[12]|C010[12]/.test(x.c.name));
  const timesSame = parked.every((x) => [sec(100), sec(200)].includes(x.c.start));
  if (parked.length !== 4 || !parked.every((x) => x.t >= 2) || !timesSame) fail(`ayrılamayanlar park'ta değil / zamanı değişti: ${parked.map((x) => `V${x.t + 1} ${x.c.name} ${secOf(x.c.start)}`).join(", ")}`);
  else ok("'Evet' → ayrılamayan 6 kayıt park track'lerinde, ZAMANI AYNI; diğer oturum başa dizildi");
};

scenarios.vetosplit = async () => {
  // Y grubu X'in 9 sn sonrasına binmiş: çapraz bağlar %91, iç bağlar %100 → en zayıf bağlar kesilir (tek anlamlı)
  setupSync({
    cams: [
      { name: "A038C001_260912AA.MP4", start: sec(100), dur: sec(100) },
      { name: "C0101.MP4", start: sec(100), dur: sec(100) },
      { name: "A038C002_260912BB.MP4", start: sec(109), dur: sec(100) },
      { name: "C0102.MP4", start: sec(109), dur: sec(100) },
    ],
    wavs: [
      { name: "260912_100000_Tr1.WAV", start: sec(100), dur: sec(100) },
      { name: "260912_110000_Tr1.WAV", start: sec(109), dur: sec(100) },
    ],
    others: [],
  });
  let q = "";
  const out = await clickAndWait("btn-collect", async (x) => ((q = x), yes()), doneRe);
  if (!/VETO: .*A038C001_260912AA .*↔ A038C002_260912BB .*en zayıf \d+ bağ \(≤ %91\.0; kalanların en zayıfı %100\.0\) kesildi/.test(q))
    fail("çözülebilir veto kararı onayda gösterilmedi:\n" + q);
  else ok("veto: çapraz %91 bağlar kesildi (kalanlar %100) — karar onay penceresinde");
  if (!/✓ TOPLA tamam: 2 oturum/.test(out)) fail("iki oturuma ayrılmadı:\n" + out.split("\n").slice(-5).join("\n"));
  else ok("iki ayrı oturum, sırayla dizildi");
};

scenarios.orderconflict = async () => {
  // A sayaçları Y<X, Zoom saatleri X<Y → çelişki → sor
  setupSync({
    cams: [
      { name: "A038C002_260912AA.MP4", start: sec(0), dur: sec(100) },
      { name: "C0101.MP4", start: sec(0), dur: sec(100) },
      { name: "A038C001_260912BB.MP4", start: sec(300), dur: sec(100) },
      { name: "C0102.MP4", start: sec(300), dur: sec(100) },
    ],
    wavs: [
      { name: "260912_100000_Tr1.WAV", start: sec(0), dur: sec(100) },
      { name: "260912_110000_Tr1.WAV", start: sec(300), dur: sec(100) },
    ],
    others: [],
  });
  const before = JSON.stringify(state.sequences, repl);
  let q = "";
  const out = await clickAndWait("btn-collect", async (x) => ((q = x), no()), doneRe);
  if (!/OTURUM SIRASI .*ÇELİŞKİLİ/.test(q) || !/cihaz A sırası: .*A038C001_260912BB.* < .*A038C002_260912AA/.test(q) || !/cihaz Zoom sırası: .*260912_100000.* < .*260912_110000/.test(q))
    fail("sıra çelişkisi sorulmadı:\n" + q);
  else ok("A sayaçları ile Zoom saatleri çelişiyor → SORULDU");
  if (JSON.stringify(state.sequences, repl) !== before || !/İptal edildi/.test(out)) fail("'Hayır' sonrası bir şey değişti");
  else ok("'Hayır' → hiçbir şey değişmedi");
};

scenarios.firstmove = async () => {
  // sıfırdan farklı zaman ofsetli clone 1 kare kayarsa → ilk oturumun park'ında DUR
  setupFromReport(R0912, ["A27", "A30"]);
  const before = mainTracks();
  M.cloneTimeBroken = true;
  const out = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✗ TOPLA DURDU: İLK TAŞIMA TUTMADI \(park, O1/.test(out) || !/fark 10160640000 tick/.test(out)) fail("ilk taşıma ölçümü yakalanmadı:\n" + out.split("\n").slice(-6).join("\n"));
  else ok("clone ofseti 1 kare kaydı → 'İLK TAŞIMA TUTMADI' (yalnız O1 taşınmıştı), fark tick olarak raporlandı");
  if (!/Ctrl\+Z'ye 1 kez bas/.test(out)) fail("Ctrl+Z sayısı yanlış");
  undo();
  if (mainTracks() !== before) fail("Ctrl+Z × 1 aslına döndürmedi");
  else ok("Ctrl+Z × 1 → asıl düzen birebir");
};

// ------------------------------------------------------------ v0.3.0'dan uyarlananlar (tek oturumlu küçük düzen)
function smallSpec(extra = {}) {
  const cams = [
    { name: "A038C001_260912AA.MP4", start: sec(10), dur: sec(30) },
    { name: "C0101.MP4", start: sec(12), dur: sec(20) },
    { name: "A038C002_260912BB.MP4", start: sec(60), dur: sec(20) },
    { name: "C0102.MP4", start: sec(58), dur: sec(26) },
  ];
  const wavs = [{ name: "260912_101512_Tr1.WAV", start: sec(8) + 12345n, dur: sec(80), inPt: sec(3) }];
  return { cams, wavs, others: [], ...extra };
}
const SMALL = [["260912_101512", "DJI_01_20260912_101600", "A038C001_260912AA", "C0101", "A038C002_260912BB", "C0102"]];

async function collectThen(spec) {
  setupSync(spec);
  const out = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✓ TOPLA tamam|Zaten toplanmış/.test(out)) fail("hazırlık TOPLA'sı tamamlanmadı:\n" + out.split("\n").slice(-6).join("\n"));
  return snapList();
}

scenarios.sync = async () => {
  const spec = syncDataset();
  setupSync(spec);
  const out = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✓ TOPLA tamam/.test(out)) return fail("TOPLA tamamlanmadı:\n" + out.split("\n").filter((l) => /DURDU|•|HATA|ÇAKIŞMA/.test(l)).join("\n"));
  const pre = JSON.parse(JSON.stringify(undoStack[0]), rev).sequences.find((x) => x.guid === "guid-main-edit");
  const { exp } = expectTopla(pre, { sessions: spec.members, devices: ["A", "Sony"], srcTrack: { "Zoom Tr1": 0, "Zoom Tr2": 1, "Zoom TrLR": 2 } });
  checkExactly(seqByGuid("guid-main-edit"), exp, "sentetik 22 kamera + 12 WAV (4 oturum) + grafik (yerinde)");
  const offs = counters.cloneOffsets.filter((o) => o !== 0n);
  if (offs.some((o) => o % FRAME25 !== 0n)) fail("ofsetler kare katı değil");
  else ok("bütün clone ofsetleri kare katı (park +P, yerleştirme Δ − P)");
  const collected = snapList();
  await setMap("Zoom TrLR", "sil");
  // eşleme TOPLA'dan SONRA değişti → BAĞLA "önce TOPLA" demeli
  await startHelper();
  const o1 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/düzen TOPLA düzeninde değil/.test(o1)) fail("eşleme değişince BAĞLA 'önce TOPLA' demedi");
  else ok("kaynak eşlemesi TOPLA'dan sonra değişti → BAĞLA 'önce TOPLA' (hiçbir şey değişmedi)");
  await setMap("Zoom TrLR", 2);
  const out2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(out2)) return fail("BAĞLA tamamlanmadı:\n" + out2.split("\n").filter((l) => /DURDU|•|HATA/.test(l)).join("\n"));
  const eb = expectBagla(collected, spec.members, []);
  checkExactly(seqByGuid("guid-main-edit"), eb.exp, "sentetik BAĞLA");
  checkLinks(seqByGuid("guid-main-edit"), eb.groups, "sentetik bağlar");
  const n = txOf("BAĞLA").length;
  for (let i = 0; i < 4; i++) undo();
  if (n !== 5) fail(`BAĞLA transaction sayısı ${n}`);
  const back = snapList().map((e) => [e.kind, e.track, e.name, e.start, e.end].join("|")).sort().join();
  if (back !== collected.map((e) => [e.kind, e.track, e.name, e.start, e.end].join("|")).sort().join()) fail("Ctrl+Z × 4 TOPLA sonrasına döndürmedi");
  else ok("Ctrl+Z × 4 → TOPLA sonrası düzen birebir");
};

scenarios.wav2groups = async () => {
  const collected = await collectThen(smallSpec());
  await startHelper();
  const out = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(out)) fail("BAĞLA tamamlanmadı:\n" + out);
  const eb = expectBagla(collected, SMALL);
  const w = allClips(seqByGuid("guid-main-edit")).filter((x) => x.c.name.endsWith(".WAV")).map((x) => x.c);
  const src = collected.find((e) => e.name.endsWith(".WAV"));
  if (w.length !== 2 || w.some((c) => c.inPt - c.start !== src.inPt - src.start)) fail(`iki grubu kapsayan WAV yanlış kesildi: ${w.length}`);
  else ok("iki grubu kapsayan WAV → 2 parça, in − start kaynağıyla aynı (tick)");
  checkExactly(seqByGuid("guid-main-edit"), eb.exp, "iki grup düzeni");
  checkLinks(seqByGuid("guid-main-edit"), eb.groups, "iki grup bağları");
};

scenarios.outside = async () => {
  const spec = smallSpec({
    wavs: [
      { name: "260912_101512_Tr1.WAV", start: sec(5), dur: sec(90) },
      { name: "DJI_01_20260912_101600.WAV", start: sec(62), dur: sec(10) }, // (başka cihaz) tamamen bir çapanın içinde → olduğu gibi
    ],
  });
  const collected = await collectThen(spec);
  await startHelper();
  const out = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(out)) fail("BAĞLA tamamlanmadı:\n" + out);
  const eb = expectBagla(collected, SMALL);
  checkExactly(seqByGuid("guid-main-edit"), eb.exp, "çapa dışı kısımlar düştü, tamamen içerideki ses olduğu gibi kaldı");
};

scenarios.graphic = async () => {
  // grafik V1'de, O1'in yeni yeri [0..] ile çakışacak yerde → DUR (grafiğe dokunulmaz)
  const spec = smallSpec({ others: [{ name: "YAĞ SIVISI", start: sec(5), dur: sec(4) }] });
  setupSync(spec);
  const before = JSON.stringify(state.sequences, repl);
  const out = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✗ TOPLA DURDU: Yeni düzende \d+ çakışma var/.test(out) || !/sınıflanamayan öğe \(video dosyası değil/.test(out)) fail("grafik çakışması TOPLA'yı durdurmadı:\n" + out);
  else ok("yeni düzende V1'deki 'YAĞ SIVISI' kamera klibiyle çakışacak → TOPLA DURDU, raporlandı");
  if (JSON.stringify(state.sequences, repl) !== before) fail("bir şey değişti");
  else ok("grafiğe ve hiçbir klibe dokunulmadı");
};

scenarios.helperoff = async () => {
  await collectThen(smallSpec());
  await stopHelper();
  const before = JSON.stringify(state.sequences, repl);
  const n = counters.txNames.length;
  const out = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✗ BAĞLA DURDU: Yardımcı bağlı değil/.test(out) || !/BAĞLA BAŞLAMADI, hiçbir şeye dokunulmadı/.test(out)) fail("yardımcı yokken BAĞLA durmadı:\n" + out);
  else ok("yardımcı kapalı → BAĞLA hiçbir şeye dokunmadan DURDU");
  if (!/KURULUM_TR\.md/.test(out)) fail("kurulum talimatı gösterilmedi");
  if (JSON.stringify(state.sequences, repl) !== before || counters.txNames.length !== n) fail("yardımcı yokken timeline'a dokunuldu");
  else ok("timeline aynı, yedek yok, transaction yok");
  if (!/bağlı değil/.test(els.helper?.textContent ?? "")) fail(`gösterge: ${els.helper?.textContent}`);
};

scenarios.setnoop = async () => {
  await collectThen(smallSpec());
  const afterCollect = mainTracks();
  await startHelper();
  M.setSem = "noop";
  const out = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✗ BAĞLA DURDU: İLK PARÇA TUTMADI/.test(out)) fail("set action'lar kırpmayınca ilk parçada durmadı:\n" + out);
  else ok("set action'lar kırpmadı → ilk parçada DURDU");
  if (txOf("BAĞLA").includes("BAĞLA: parçalar") || counters.links) fail("ilk parçadan sonra devam etti!");
  if (!/Ctrl\+Z'ye 2 kez bas/.test(out)) fail("geri alma talimatı yanlış");
  undo();
  undo();
  if (mainTracks() === afterCollect) ok("Ctrl+Z × 2 → TOPLA sonrası düzen birebir");
  else fail("Ctrl+Z × 2 geri getirmedi");
};

for (const sem of ["move", "endmove"])
  scenarios["set" + sem] = async () => {
    const spec = smallSpec({ wavs: [...smallSpec().wavs, { name: "260912_101512_Tr2.WAV", start: sec(9), dur: sec(79) }] });
    const collected = await collectThen(spec);
    await startHelper();
    M.setSem = sem;
    const out = await clickAndWait("btn-bind", yes, doneRe);
    if (!/✓ BAĞLA tamam/.test(out)) fail(`set anlamı '${sem}' iken BAĞLA tamamlanmadı:\n` + out.split("\n").filter((l) => /DURDU|•/.test(l)).join("\n"));
    checkExactly(seqByGuid("guid-main-edit"), expectBagla(collected, SMALL).exp, `set anlamı '${sem}' (+ set sonrası ezme) iken de parçalar doğru`);
  };

scenarios.linkfail = async () => {
  await collectThen(smallSpec());
  await startHelper();
  M.linkFailName = "C0102.MP4";
  const out = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✗ BAĞLA DURDU: 1\/2 grup bağlanamadı \(kesme\/silme doğru ve yerinde\)/.test(out) || !/linkSelection false döndü/.test(out)) fail("başarısız bağlama raporlanmadı:\n" + out);
  else ok("bir grubun linkSelection'ı false → hangi grup, neden");
};

scenarios.linksource = async () => {
  await collectThen(smallSpec());
  await startHelper();
  M.linkedSemantics = "source";
  const out = await clickAndWait("btn-bind", yes, doneRe);
  if (!/⚠ BAĞLA bitti ama 2\/2 grubun bağı DOĞRULANAMADI/.test(out) || /✓ BAĞLA tamam/.test(out)) fail("getLinkedItems belirsizken 'tamam' denmemeliydi:\n" + out);
  else ok("getLinkedItems bağlamayla değişmiyor → '⚠ DOĞRULANAMADI' + kontrol talimatı");
};

scenarios.rebind = async () => {
  await collectThen(smallSpec());
  await startHelper();
  await clickAndWait("btn-bind", yes, doneRe);
  const n = counters.txNames.length;
  let q = "";
  const out = await clickAndWait("btn-bind", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ BAĞLA tamam/.test(out) || counters.txNames.length !== n || !/yalnız bağlama \(yedek alınmaz\)/.test(q)) fail("ikinci BAĞLA düzenleme yaptı:\n" + out);
  else ok("ikinci BAĞLA: kesilecek/silinecek yok → yalnız bağlama");
};

scenarios.again = async () => {
  await collectThen(smallSpec());
  const n = counters.txNames.length;
  const out = await clickAndWait("btn-collect", yes, doneRe);
  if (!/Zaten toplanmış/.test(out) || counters.txNames.length !== n) fail("ikinci TOPLA işlem yaptı:\n" + out.split("\n").slice(-4).join("\n"));
  else ok("ikinci TOPLA: 'Zaten toplanmış'");
};

scenarios.mapping = async () => {
  setupSync(sep23());
  await scan();
  const ids = (els.mapping?.children ?? []).map((r) => r.children?.[1]?.id);
  if (ids.join(",") !== "map-Zoom Tr1,map-Zoom Tr2,map-Zoom TrLR,map-DJI") fail(`kaynaklar: ${ids}`);
  else ok("kaynak eşleme paneli: Zoom Tr1, Zoom Tr2, Zoom TrLR, DJI (varsayılan A1..A4)");
  await setMap("Zoom TrLR", "sil");
  if (!/"Zoom TrLR":"sil"/.test(lsStore.get("spread.sourceMap.v1") ?? "")) fail(`localStorage: ${lsStore.get("spread.sourceMap.v1")}`);
  else ok("'Zoom TrLR → Sil' localStorage'da hatırlandı");
  lsBroken = true;
  await setMap("DJI", 2);
  lsBroken = false;
  if (!/Ayar kaydedilemedi/.test(els.log.children.map((c) => c.textContent).join("\n"))) fail("localStorage hatası yakalanmadı");
  else ok("localStorage erişilemezse panel çökmez (ayar bu oturumda)");
  lsStore.clear();
};

scenarios.security = async () => {
  setupSync(smallSpec());
  const h = await startHelper();
  const info = JSON.parse(fsReal.readFileSync(h.infoFile, "utf8"));
  const mode = fsReal.statSync(h.infoFile).mode & 0o777;
  if (info.port !== 47731 || !/^[0-9a-f]{64}$/.test(info.token) || mode !== 0o600) fail(`bilgi dosyası: ${JSON.stringify({ port: info.port, mode: mode.toString(8) })}`);
  else ok("bilgi dosyası: port 47731, 256 bit token, izin 600");
  const req = (opts, body) =>
    new Promise((resolve) => {
      const r = http.request({ host: "127.0.0.1", port: 47731, method: "POST", path: "/v1/ping", headers: {}, ...opts }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
      });
      r.on("error", (e) => resolve({ status: 0, body: String(e) }));
      if (body) r.write(body);
      r.end();
    });
  const T = { "X-Spread-Token": info.token, "Content-Type": "application/json" };
  const cases = [
    ["token yok → 401", await req({}), 401],
    ["yanlış token → 401", await req({ headers: { "X-Spread-Token": "0".repeat(64) } }), 401],
    ["yabancı Host (DNS rebinding) → 403", await req({ headers: { ...T, Host: "evil.example:47731" } }), 403],
    ["GET → 405", await req({ method: "GET", headers: T }), 405],
    ["bilinmeyen komut → 404", await req({ path: "/v1/eval", headers: T }, "{}"), 404],
    ["bozuk JSON → 400", await req({ path: "/v1/link", headers: T }, "{nope"), 400],
    ["şema dışı (track -1) → 400", await req({ path: "/v1/link", headers: T }, JSON.stringify({ sequence: "Ana Kurgu", groups: [{ id: "G1", items: [{ kind: "V", track: -1, start: "0", end: "1", name: "x" }] }] })), 400],
    ["büyük gövde (>1 MB) → reddedildi", await req({ path: "/v1/link", headers: T }, "x".repeat(1100000)), 400],
    ["geçerli ping → 200", await req({ headers: T }, "{}"), 200],
  ];
  for (const [label, r, want] of cases) {
    if (r.status === want || (want === 400 && r.status === 0 && /büyük/.test(label))) ok(`güvenlik: ${label}`);
    else fail(`güvenlik: ${label} — HTTP ${r.status} ${r.body.slice(0, 80)}`);
    if (r.headers && r.headers["access-control-allow-origin"]) fail(`CORS başlığı verildi: ${label}`);
  }
  // enjeksiyon: ad alanında ExtendScript kodu → yalnız veri olarak gider
  const inj = await req(
    { path: "/v1/link", headers: T },
    JSON.stringify({ sequence: "Ana Kurgu", groups: [{ id: "G1", items: [{ kind: "V", track: 0, start: "1", end: "2", name: '"); app.quit(); ("' }, { kind: "A", track: 0, start: "1", end: "2", name: "\\\"+app.quit()+\" " }] }] })
  );
  if (hostile.quit) fail("ENJEKSİYON: app.quit() çalıştı!");
  else if (inj.status !== 200 || !/"found":0/.test(inj.body)) fail(`enjeksiyon isteği beklenmedik yanıt: ${inj.status} ${inj.body.slice(0, 120)}`);
  else ok("enjeksiyon: ad alanındaki kod ExtendScript'te ÇALIŞMADI (yalnız aranan ad oldu, 0 bulundu)");
  // başka sequence aktifken link → hiçbir şey yapılmaz
  const wrong = await req({ path: "/v1/link", headers: T }, JSON.stringify({ sequence: "Başka", groups: [{ id: "G1", items: [{ kind: "V", track: 0, start: "1", end: "2", name: "x" }] }] }));
  if (wrong.status !== 500 || !/hi\\u00e7bir \\u015fey yap\\u0131lmad\\u0131|hiçbir şey yapılmadı/.test(wrong.body)) fail(`yanlış sequence: ${wrong.status} ${wrong.body.slice(0, 120)}`);
  else ok("aktif sequence farklıysa yardımcı hiçbir şey yapmaz");
  const addr = h.address();
  if (!addr || addr.address !== "127.0.0.1") fail(`dinlenen adres: ${JSON.stringify(addr)}`);
  else ok("yardımcı yalnız 127.0.0.1'i dinliyor");
  await stopHelper();
  if (fsReal.existsSync(info && h.infoFile)) fail("durdurunca bilgi dosyası silinmedi");
  else ok("durdurunca token dosyası silindi");
};


scenarios.undomid = async () => {
  setupSync(smallSpec());
  const before = mainTracks();
  M.undoAfterTx = "TOPLA: ilk park (ölçüm)";
  const out = await clickAndWait("btn-collect", yes, doneRe);
  if (!/"ilk park \(ölçüm\)" adımı geri alınmış görünüyor/.test(out) || !/Timeline'da değişiklik yapılmadı/.test(out)) fail("adımlar arası Ctrl+Z yanlış sayıldı:\n" + out);
  else ok("kullanıcı ilk park'tan sonra Ctrl+Z bastı → DUR, adım düşüldü");
  if (mainTracks() !== before) fail("asıl düzen değişmiş kaldı");
};

scenarios.stale = async () => {
  await collectThen(smallSpec());
  const afterCollect = mainTracks();
  await startHelper();
  M.setSem = "noop";
  await clickAndWait("btn-bind", yes, doneRe);
  M.setSem = "trim";
  const n = counters.txNames.length;
  const out = await clickAndWait("btn-bind", yes, doneRe);
  if (!/YARIM hâlde/.test(out) || counters.txNames.length !== n) fail("yarım düzende BAĞLA yeniden başladı:\n" + out);
  else ok("geri alınmamış yarım düzende BAĞLA BAŞLAMADI");
  undo();
  undo();
  if (mainTracks() !== afterCollect) fail("Ctrl+Z × 2 geri getirmedi");
  const out2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(out2)) fail("geri aldıktan sonra BAĞLA çalışmadı:\n" + out2);
  else ok("Ctrl+Z × 2 sonrası BAĞLA normal çalıştı");
};

scenarios.notcollected = async () => {
  setupSync(smallSpec());
  await startHelper();
  const before = JSON.stringify(state.sequences, repl);
  const out = await clickAndWait("btn-bind", yes, doneRe);
  if (!/düzen TOPLA düzeninde değil/.test(out) || JSON.stringify(state.sequences, repl) !== before) fail("TOPLA'sız BAĞLA durmadı:\n" + out);
  else ok("TOPLA yapılmadan BAĞLA → 'önce TOPLA', hiçbir şey değişmedi");
};

scenarios.limits = async () => {
  const cams = [{ name: "A038C001_260912AA.MP4", start: sec(0), dur: sec(700) }];
  const wavs = Array.from({ length: 270 }, (_, i) => ({ name: `R${String(i).padStart(3, "0")}_Tr1.WAV`, start: sec(2 + 2 * i), dur: sec(1.5) }));
  setupSync({ cams, wavs, others: [] });
  const S = seqByGuid("guid-main-edit");
  const all = S.a.flat();
  S.a = [all.filter((c) => c.name.endsWith(".WAV")), all.filter((c) => !c.name.endsWith(".WAV"))];
  for (const c of S.a[1]) c.linkId = null;
  mockGen++;
  await startHelper();
  const before = JSON.stringify(state.sequences, repl);
  const out = await clickAndWait("btn-bind", yes, doneRe);
  if (!/bağlanacak 271 öğe var, yardımcı en çok 256 kabul ediyor/.test(out) || JSON.stringify(state.sequences, repl) !== before)
    fail("grup boyutu sınırı kesmeden önce yakalanmadı:\n" + out.split("\n").slice(-6).join("\n"));
  else ok("grup yardımcının sınırını aşıyor → kesmeden ÖNCE plan hatası");
};

scenarios.identity = async () => {
  const { identify, sourceKey } = require(path.join(__dirname, "..", "dist", "src", "identity.js"));
  const cases = [
    ["A038C001_260912BD.MP4", "cinema", "A", null, "38.1"],
    ["A041C011_260923UW.MP4", "cinema", "A", null, "41.11"],
    ["C0142.MP4", "sony", "Sony", null, "142"],
    ["DJI_02_20260923_175336.WAV", "dji", "DJI", null, "20260923.175336.2"],
    ["260912_133224_Tr1.WAV", "zoom", "Zoom", "Tr1", "260912.133224"],
    ["260923_171315_TrLR.WAV", "zoom", "Zoom", "TrLR", "260923.171315"],
    ["ZOOM0001_LR.WAV", "generic", "ZOOM_LR", null, "1"],
    ["MVI_1234.MOV", "generic", "MVI", null, "1234"],
  ];
  const bad = cases.filter(([n, p, d, ch, o]) => {
    const id = identify(n);
    return id.pattern !== p || id.device !== d || id.channel !== ch || id.order.join(".") !== o;
  });
  if (bad.length) fail(`kimlik: ${bad.map(([n]) => `${n} → ${JSON.stringify(identify(n))}`).join("; ")}`);
  else ok("kimlik: sinema (A, makara.klip), Sony (sayaç), DJI (tarih.saat.sayaç), Zoom (kayıt = tarih_saat, kanal), bilinmeyen (rakamsız ad, son sayı)");
  if (sourceKey(identify("260912_133224_TrLR.WAV")) !== "Zoom TrLR" || sourceKey(identify("DJI_01_20260923_171450.WAV")) !== "DJI") fail("kaynak anahtarı yanlış");
  else ok("kaynak anahtarı: 'Zoom TrLR', 'DJI'");
};

scenarios.status2 = async () => {
  setupFromReport(R0912);
  await clickAndWait("btn-status", yes, doneRe);
  const rep = els.report.value;
  if (!/OTURUMLAR \(güçlü bağ eşiği %90/.test(rep) || !/ÇİFT KOPYA: A26 \/ A27/.test(rep) || !/O3 \[.*\] Zoom 260912_144207/.test(rep) || !/A038C002_260912RQ ↔ Zoom 260912_141513: .*%98\.0/.test(rep))
    fail("durum raporunda oturumlar / çiftler / bağ oranları eksik:\n" + rep.split("\n").filter((l) => /OTURUM|ÇİFT|O\d|%9/.test(l)).slice(0, 12).join("\n"));
  else ok("durum raporu: çift kopyalar, güçlü bağlar (A038C002↔141513 %98.0), oturumlar ve grupları");
};

// Rapor okuyucunun kendi sınaması: sentetik düzenin durum raporunu üret → raporu geri oku → aynı düzen mi
scenarios.reportparse = async () => {
  const spec = syncDataset();
  setupSync(spec);
  const want = allClips(seqByGuid("guid-main-edit")).map((x) => [x.kind, x.track, x.c.name, x.c.start, x.c.end, x.c.inPt, x.c.outPt, !!x.c.linkId].join("|")).sort().join("\n");
  await clickAndWait("btn-status", yes, doneRe);
  const s = setupFromReport(els.report.value);
  const got = allClips(s).map((x) => [x.kind, x.track, x.c.name, x.c.start, x.c.end, x.c.inPt, x.c.outPt, !!x.c.linkId].join("|")).sort().join("\n");
  if (got !== want) fail("durum raporundan kurulan düzen aslıyla aynı değil");
  else ok("durum raporu → timeline okuyucusu birebir");
};

// --- plan birim testleri (saf fonksiyonlar)
scenarios.plan = async () => {
  const { makePlan } = require(path.join(__dirname, "..", "dist", "src", "plan.js"));
  const C = (kind, track, start, end, name, extra = {}) => ({
    kind, track, loopTrack: track, start: String(start), end: String(end), inPt: "0", outPt: String(end - start),
    startSec: Number(start) / Number(TPS), endSec: Number(end) / Number(TPS), speed: 1, disabled: false, adjustment: false,
    name, projId: "pi-" + name, projName: name, projType: 1, mediaDur: String(end - start), selected: false, ref: {}, projRef: {}, gen: 0, readErrors: [], ...extra,
  });
  const snap = (clips, v = 3, a = 3) => ({ vCount: v, aCount: a, clips, warnings: [], gen: 0 });
  // döngü: iki ses klibi birbirinin hedef track'inde ve zamanda çakışıyor
  let p = makePlan(snap([C("A", 1, 0n, sec(10), "X.WAV"), C("A", 0, 0n, sec(10), "Y.WAV")]), 1);
  // X(start0,track1) Y(start0,track0) → sıralama: Y (track0) → A1, X → A2: ikisi de yerinde → hareket yok
  if (p.clone.length !== 0) fail("yerinde olan sesler taşındı");
  p = makePlan(snap([C("A", 0, sec(1), sec(10), "X.WAV"), C("A", 1, 0n, sec(10), "Y.WAV")]), 1);
  if (!p.errors.some((e) => /güvenli sıra yok/.test(e) && /çakışan asıl/.test(e))) fail(`çakışma yakalanmadı: ${JSON.stringify(p.errors)}`);
  else ok("plan: birbirinin hedefinde çakışan iki ses → 'güvenli sıra yok' hatası, Spread başlamaz");
  // hız≠1 kamera → hata
  const v = C("V", 0, 0n, sec(5), "CAM.MP4", { speed: 2 });
  const a = C("A", 0, 0n, sec(5), "CAM.MP4", { speed: 2, projId: v.projId });
  p = makePlan(snap([v, a]), 1);
  if (!p.errors.some((e) => /hızı 2/.test(e))) fail("hız≠1 kamera yakalanmadı");
  else ok("plan: hızı değiştirilmiş kamera → hata (overwrite hızı korumaz)");
  // videoyla çakışan ama birebir olmayan kamera sesi → SERT hata (bağ korunamaz)
  const v2 = C("V", 0, 0n, sec(5), "CAM2.MP4");
  const a2 = C("A", 0, sec(1), sec(5), "CAM2.MP4", { projId: v2.projId });
  p = makePlan(snap([v2, a2]), 1);
  if (!p.errors.some((e) => /birebir değil \(bağı korunamaz\)/.test(e))) fail("birebir olmayan kamera sesi hata vermedi");
  else ok("plan: videoyla çakışan ama birebir olmayan kamera sesi → hata (bağ korunamaz), Spread başlamaz");
  // kamera kaynaklı ama hiçbir videoyla çakışmayan ses → uyarı + ayrı ses birimi
  const a3 = C("A", 1, sec(20), sec(25), "CAM2.MP4", { projId: v2.projId });
  p = makePlan(snap([v2, C("A", 0, 0n, sec(5), "CAM2.MP4", { projId: v2.projId }), a3]), 1);
  if (!p.warnings.some((w) => /çakışmayan ses/.test(w)) || p.counts.audio !== 1) fail("çakışmayan kamera kaynaklı ses yanlış sınıflandı");
  else ok("plan: kamera kaynaklı ama çakışmayan ses → uyarı + ayrı ses birimi");
  // WAV'ın hedef track'inde (A2) henüz silinmemiş bir KAMERA sesi var → güvenli sıra yok → hata
  const vX = C("V", 0, 0n, sec(10), "X.MP4");
  const aX = C("A", 1, 0n, sec(10), "X.MP4", { projId: vX.projId }); // kamera sesi A2'de
  const wW = C("A", 0, 0n, sec(10), "W.WAV"); // WAV A1'de → hedefi A2
  p = makePlan(snap([vX, aX, wW]), 1);
  if (!p.errors.some((e) => /güvenli sıra yok/.test(e) && /X\.MP4/.test(e))) fail(`kamera çakışması yakalanmadı: ${JSON.stringify(p.errors)}`);
  else ok("plan: WAV'ın hedefinde henüz silinmemiş kamera sesi → 'güvenli sıra yok' hatası, Spread başlamaz");
  // hiçbir şey taşınmayacak düzen → clone/overwrite yok
  const vA = C("V", 0, 0n, sec(10), "A.MP4");
  const aA = C("A", 0, 0n, sec(10), "A.MP4", { projId: vA.projId });
  const w = C("A", 1, 0n, sec(10), "W.WAV");
  p = makePlan(snap([vA, aA, w]), 1);
  if (p.clone.length || p.overwrite.length || p.errors.length) fail("zaten dağıtılmış düzende iş planlandı");
  else ok("plan: zaten dağıtılmış düzen → hiçbir taşıma planlanmadı");
};

// ------------------------------------------------------------ çalıştır
(async () => {
  setupReal({ nCams: 2, nWavSessions: 1 });
  require(path.join(__dirname, "..", "dist", "index.js"));
  await sleep(1700);
  const which = process.argv[2] && process.argv[2] !== "all" ? process.argv[2].split(",") : Object.keys(scenarios);
  for (const name of which) {
    console.log(`▶ ${name}`);
    try {
      await scenarios[name]();
    } catch (e) {
      fail(`${name}: ${e && e.stack ? e.stack : e}`);
    }
  }
  await stopHelper();
  try {
    fsReal.rmSync(TMPHOME, { recursive: true, force: true });
  } catch {}
  if (fails.length) {
    console.error(`\nSPREAD SMOKE FAIL (${fails.length})`);
    process.exit(1);
  }
  console.log(`\nSPREAD SMOKE OK (${which.length} senaryo)`);
  process.exit(0);
})();
