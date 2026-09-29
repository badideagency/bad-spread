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
//   ✓ (v0.3.4, gerçek Premiere BAĞLA raporu) tek transaction'daki set action'lar klibin İLK hâlinden (action ÜRETİLİRKEN okunan
//     değerden) hesaplanan FARK olarak uygulanır ve AYNI KENARDA BİRİKİR: End ile Out ikisi de kuyruğu kırpar → kuyruk farkı iki kez
//     (A038C001: out = 2×2.32 − 1552.80 = −1548.16 s). M.setSem "real" (varsayılan): End/Out = kuyruk kırpma (end ve out birlikte),
//     Start/In = baş kırpma (start ve in birlikte), fark üretim anındaki hâlden. In'in / Start'ın gerçek anlamı ölçülmedi → BAĞLA önce
//     KALİBRE eder; mock bunu diğer anlamlarla da sınar:
//   ? M.setSem "trim" (v0.3.3 tahmini; mutlak, sırayla): in/out değişince start sabit; start/end değişince karşı kenar sabit;
//     "move" (start klibi taşır), "endmove" (end klibi taşır), "noop" (hiçbir şey), "snap" (real + değer kareye yuvarlanır),
//     "lastwins" (real, ama aynı klibe tek transaction'da birden çok action gelirse yalnız sonuncusu uygulanır)
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
const M0 = { broken: false, nonseq: false, nobackup: false, backupActive: false, falseTx: null, badBackup: false, noType: false, undoAfterTx: null, setSem: "real", linkFailName: null, linkedSemantics: "link", cloneTimeBroken: false, planWriteFails: false, fetchError: null, hostVersion: "26.5.1", chType: null, linkRejectMixed: false, channelApi: true, timebase: FRAME25, noFootage: false, owMode: "clip", owShift: 0n, owShiftFor: null, owExtra: 0n, linkTrimFollow: false };
// v1.2.1 overwrite modları: M.owMode "clip" (varsayılan: proje öğesinin klip süresi = p.clipDur ?? p.dur → aslıyla birebir), "media"
// (kuyruk medya sonuna uzar: p.dur); M.owShift: video + ses start'ı bu kadar kayık (baş kayması); M.owExtra: kuyruk bu kadar uzun.
// M.linkTrimFollow: bağlı videoya SetOutPoint → bağlı sesler de aynı farkla değişir (gerçek Premiere'de ölçülmedi; SPREAD ölçer).
// M.timebase: sequence kare süresi (null → getTimebase hata); M.noFootage: getFootageInterpretation hata (p.fps yoksa 25 fps).
// v1.1.0 kanal tipi (ExtendScript AudioChannelMapping.audioChannelsType): M.chType(ad) → tip; null = hepsi mono (0) — eski senaryolar
// aynen. M.linkRejectMixed: gerçek Premiere 26.5.1'deki gibi mono + stereo karışık seçimde linkSelection() false döner.
const chTypeOf = (name) => (M.chType ? M.chType(name) : 0);
const M = { ...M0 };
let pendingUndo = 0;
const hooks = { onCloneSeq: null, onGetActive: null, beforeRemoveApply: null, beforeTx: null };
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
    const c0 = { ...need(id).c }; // "real": fark, action ÜRETİLİRKEN okunan hâlden
    counters.setActions.set(id, [...(counters.setActions.get(id) ?? []), name]);
    return {
      __set: id,
      apply: () => {
        const f = need(id);
        if (M.setSem === "real" || M.setSem === "snap" || M.setSem === "lastwins") {
          const v = M.setSem === "snap" ? (BigInt(t.ticks) / FRAME25) * FRAME25 : BigInt(t.ticks);
          const field = { in: "inPt", out: "outPt", start: "start", end: "end" }[name];
          const d = v - c0[field];
          if (name === "end" || name === "out") (f.c.end += d), (f.c.outPt += d); // kuyruk kenarı
          else (f.c.start += d), (f.c.inPt += d); // baş kenarı
          if ((typeof M.linkTrimFollow === "function" ? M.linkTrimFollow(f.c.name) : M.linkTrimFollow) && name === "out" && f.c.linkId) // bağlı partnerler aynı farkla (yalnız bu kipte)
            for (const grp of [f.s.v, f.s.a]) for (const tr of grp) for (const x of tr) if (x.id !== id && x.linkId === f.c.linkId) (x.end += d), (x.outPt += d);
        } else fn(f, BigInt(t.ticks));
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
    getTimebase: async () => {
      if (M.timebase === null) throw new Error("mock: getTimebase yok");
      return String(M.timebase); // kare başına tick (varsayılan 25 fps)
    },
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
          const ot = BigInt(off.ticks);
          const brk = M.cloneTimeBroken === "neg" ? ot < 0n : M.cloneTimeBroken && ot !== 0n; // bozuk: sıfır dışı (ya da yalnız negatif) ofset 1 kare kayar
          const o = ot + (brk ? FRAME25 : 0n);
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
        const st = BigInt(time.ticks) + (M.owShiftFor && !p.name.startsWith(M.owShiftFor) ? 0n : M.owShift);
        const len = (M.owMode === "media" ? p.dur : p.clipDur ?? p.dur) + M.owExtra;
        const L = "L" + nextId++;
        if (p.hasVideo) {
          const vs = M.broken ? st + FRAME25 : st; // bozuk overwrite: video 1 kare kayık
          place(S.v, vIdx, mkClip("V", p, vs, vs + len, L));
        }
        for (let c = 0; c < k; c++) place(S.a, aIdx + c, mkClip("A", p, st, st + len, L));
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
      return {
        getMediaFilePath: async () => p.mediaPath ?? "", // v1.4.0 SENKRON
        getMedia: async () => ({ getDuration: () => mkTT(p.dur) }),
        getFootageInterpretation: async () => {
          if (M.noFootage) throw new Error("mock: getFootageInterpretation yok");
          return { getFrameRate: () => p.fps ?? 25 };
        },
      };
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
    if (hooks.beforeTx) hooks.beforeTx(name);
    cb({ addAction: (a) => (acts.push(a), true), get empty() { return acts.length === 0; } });
    if (M.falseTx === name) return false; // uygulanmadı, undo kaydı yok
    const snap = deepCopy();
    const S = seqByGuid(state.activeGuid);
    frozen = S ? { V: S.v.length, A: S.a.length } : null;
    // "lastwins": aynı klibe tek transaction'da birden çok set action → yalnız SONUNCUSU uygulanır (tek başına her biri doğru)
    const run = M.setSem === "lastwins" ? acts.filter((a, i) => !a.__set || !acts.slice(i + 1).some((b) => b.__set === a.__set)) : acts;
    try {
      for (const a of run) a.apply();
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
// SPREAD_SCREENS=<klasör>: ekran görüntüsü kipi — sahte DOM yerine jsdom'la GERÇEK panel HTML'i (spread/public/index.html); "screens"
// senaryosu belirli anlarda panelin HTML'ini klasöre yazar (spread/dev/screens.mjs Chromium'da PNG'ye çevirir). Diğer senaryolar
// sahte DOM'la çalışır (değişmedi).
const SCREENS = process.env.SPREAD_SCREENS || null;
const els = SCREENS ? new Proxy({}, { get: (_, k) => (typeof k === "string" ? global.document.getElementById(k) : undefined) }) : {};
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
if (SCREENS) {
  const { JSDOM } = require("jsdom");
  const html = require("fs").readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8").replace(/<script[^>]*><\/script>/g, "");
  global.document = new JSDOM(html).window.document;
} else global.document = { getElementById: (id) => (els[id] ??= mkEl(id)), createElement: () => mkEl(null) };
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
// panelin fetch'i (Node'unki); M.fetchError → UXP'nin reddi gibi fırlatır (ör. manifest ağ izni)
const realFetch = globalThis.fetch;
// v1.2.0: latest.json (güncelleme denetimi) ağa HİÇ çıkmaz — upd.latest (nesne) / upd.latestOffline (bağlantı hatası) / yoksa 404
const LATEST_PREFIX = "https://raw.githubusercontent.com/badideagency/bad-spread-updates/";
const upd = { latest: null, latestOffline: false, latestFetches: 0 };
globalThis.fetch = (...args) => {
  if (String(args[0]).startsWith(LATEST_PREFIX)) {
    upd.latestFetches++;
    if (upd.latestOffline) return Promise.reject(new TypeError("Network request failed"));
    return Promise.resolve(upd.latest ? new Response(JSON.stringify(upd.latest), { status: 200 }) : new Response("404: Not Found", { status: 404 }));
  }
  return M.fetchError ? Promise.reject(new TypeError(M.fetchError)) : realFetch(...args);
};
let copied = null;
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { setContent: async (d) => (copied = d["text/plain"]) } }, configurable: true });
const fsReal = require("fs");
const osReal = require("os");
const TMPHOME = fsReal.mkdtempSync(path.join(osReal.tmpdir(), "spread-home-"));
// SPREAD_DIST: başka bir derlemeyi (ör. regresyon için eski sürüm) bu mock'la çalıştır
const DIST = process.env.SPREAD_DIST ? path.resolve(process.env.SPREAD_DIST) : path.join(__dirname, "..", "dist");
Module._load = ((orig) =>
  function (request, parent) {
    if (request === "premierepro") return ppro;
    if (request === "uxp") return { versions: { uxp: "uxp-MOCK" }, host: { name: "premierepro", get version() { return M.hostVersion; } } };
    // panelin os'u: ev klasörü geçici dizin (yardımcının token dosyası oraya yazılır), platform macOS yolu (Linux'ta çalışsın)
    if (request === "os" && parent && parent.filename && parent.filename.startsWith(DIST)) return { platform: () => "darwin", homedir: () => TMPHOME };
    // panelin fs'i: UXP biçimi (mkdir geri çağrısız → Promise); M.planWriteFails → yazma reddi (izin yok gibi)
    if (request === "fs" && parent && parent.filename && parent.filename.startsWith(DIST))
      return {
        readFileSync: (p, o) => fsReal.readFileSync(p, o),
        writeFileSync: (p, d, o) => {
          if (M.planWriteFails) throw new Error("mock UXP: Permission denied (write)");
          fsReal.writeFileSync(p, d, o);
          return String(d).length;
        },
        mkdir: (p, o) => fsReal.promises.mkdir(p, o),
        unlink: (p) => fsReal.promises.unlink(p).then(() => 0),
      };
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
  hooks.onCloneSeq = hooks.onGetActive = hooks.beforeRemoveApply = hooks.beforeTx = null;
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
const markLog = () => (logMark = Array.from(els.log?.children ?? []).length);
const newLog = () => Array.from(els.log?.children ?? []).slice(logMark).map((c) => c.textContent).join("\n");

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
  // v1.2.1: dağıt = clone + sil; kameralar ayrı: ilki tek başına (ölçüm), sonra kalanlar (hepsi birebir → SetOutPoint yok)
  if (counters.txNames.join(",") !== "Spread: yedek sequence,Spread: track hazırlığı,Spread: dağıt,Spread: ilk overwrite (ölçüm),Spread: overwrite")
    fail(`transaction'lar: ${counters.txNames.join(", ")}`);
  else ok("transaction'lar: yedek → track hazırlığı → dağıt → ilk overwrite (ölçüm) → overwrite (birebir → kuyruk düzeltme yok)");
  if (!/Ctrl\+Z'ye 4 kez bas/.test(out)) fail("geri alma talimatı Ctrl+Z × 4 değil");
  if (counters.setActions.size) fail(`kırpılmamış kliplere set action çalıştı: ${counters.setActions.size}`);
  else ok("kırpılmamış kliplere hiç set action çalışmadı");
  const backup = state.sequences.find((x) => x.name === "Ana Kurgu Copy");
  if (!backup || ser(backup.v) !== beforeV || ser(backup.a) !== beforeA) fail("yedek sequence aslının kopyası değil");
  else ok("yedek sequence 'Ana Kurgu Copy' aslıyla aynı");
  if (JSON.stringify(seqByGuid("guid-other"), repl) !== otherBefore) fail("başka sequence değişti!");
  if (S.sel.size !== exp.length) fail(`son seçim ${S.sel.size}/${exp.length}`);
  else ok(`son adımda ${S.sel.size} klip programla seçildi`);
  if (!/Clip > Synchronize/.test(out)) fail("Synchronize talimatı yok");
  // Ctrl+Z × 4 (overwrite + ilk overwrite + dağıt + track hazırlığı) → asıl düzene döner
  for (let i = 0; i < 4; i++) undo();
  const back = seqByGuid("guid-main-edit");
  if (ser(back.v) === beforeV && ser(back.a) === beforeA) ok("Ctrl+Z × 4 → asıl düzen birebir geri geldi");
  else fail("Ctrl+Z × 4 aslına döndürmedi");
};

scenarios.trim = async () => {
  // v0.3.4: kırpılmış kamera → SPREAD BAŞLAMAZ (eski "kırpma eşitlemesi" aynı kenara iki action üretiyordu; gerçek Premiere'de birikir)
  setupReal({ nCams: 6, nWavSessions: 2, trimmed: [1, 4] });
  const before = JSON.stringify(state.sequences, repl);
  const out = await clickAndWait("btn-spread", yes);
  if (!/✗ SPREAD DURDU: 2 kamera klibi kırpılmış .*Spread BAŞLAMADI/.test(out) || !/aynı kenarı İKİ KEZ kırpıyor/.test(out)) fail("kırpılmış kamerayla SPREAD durmadı:\n" + out);
  else ok("kırpılmış 2 kamera → SPREAD BAŞLAMADI (kırpma eşitlemesi kaldırıldı), nedeni ve yapılacak yazıldı");
  if (JSON.stringify(state.sequences, repl) !== before || counters.txNames.length || counters.setActions.size) fail("kırpılmış kamerayla bir şey değişti");
  else ok("hiçbir şeye dokunulmadı (yedek bile alınmadı), hiç set action yok");
  setupReal({ nCams: 6, nWavSessions: 2, trimmed: [1, 4] });
  M.noType = true; // medya süresi okunamıyor — başı kırpılmış (in ≠ 0) yine de bilinir
  const out2 = await clickAndWait("btn-spread", yes);
  if (!/✗ SPREAD DURDU: 2 kamera klibi kırpılmış/.test(out2) || counters.txNames.length) fail("medya süresi okunamazken başı kırpılmış kamera baştan reddedilmedi:\n" + out2.split("\n").slice(-4).join("\n"));
  else ok("medya süresi okunamasa da başı kırpılmış (in ≠ 0) kamera → SPREAD baştan BAŞLAMADI");
};

scenarios.broken = async () => {
  const s = setupReal({ nCams: 6, nWavSessions: 2 });
  M.broken = true;
  const out = await clickAndWait("btn-spread", yes);
  // v1.2.1: ilk kamera tek başına overwrite edilip ölçülür → bozukluk İLK overwrite'ta yakalanır, kalan kameralara dokunulmaz
  if (!/✗ SPREAD DURDU: İLK OVERWRITE TUTMADI \(ölçüm, "C0101\.MP4"\)/.test(out)) fail("bozuk overwrite yakalanmadı:\n" + out);
  else ok("bozuk overwrite (video 1 kare kayık) ilk overwrite ölçümünde yakalandı → DURDU");
  if (!/start: asıl=\d+ şimdi=\d+ \(fark 10160640000 tick\)/.test(out) || !/start \+10160640000 tick = \+40\.000 ms = \+1\.000 kare/.test(out)) fail("fark tick / ms / kare olarak raporlanmadı");
  else ok("fark raporda: 10160640000 tick = 40 ms = 1 kare");
  if (counters.txNames.includes("Spread: kırpma eşitlemesi") || counters.setActions.size) fail("panel kendi başına düzeltmeye çalıştı (set action)!");
  else ok("panel kendi başına düzeltme yapmadı");
  if (counters.overwrites !== 1) fail(`ölçüm tutmadıktan sonra ${counters.overwrites - 1} kamera daha overwrite edildi`);
  else ok("kalan kameralara dokunulmadı (yalnız ilk kamera overwrite edildi)");
  if (!/Ctrl\+Z'ye 3 kez bas — ya da yedek sequence "Ana Kurgu Copy"/.test(out)) fail("geri alma talimatı eksik");
  else ok("talimat: Ctrl+Z × 3 (track hazırlığı, dağıt, ilk overwrite) ya da yedek sequence");
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
    get projectItem() {
      const p = { name: c.pi.name, nodeId: "pn-" + c.pi.name };
      // belgedeki gibi ÖZELLİK (parantezsiz): ProjectItem.getAudioChannelMapping → AudioChannelMapping
      if (M.channelApi) p.getAudioChannelMapping = { audioChannelsType: chTypeOf(c.pi.name), audioClipsNumber: 1 };
      return p;
    },
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
      if (M.linkRejectMixed && new Set(clips.filter((c) => c.kind === "A").map((c) => chTypeOf(c.pi.name))).size > 1) {
        counters.rejectedLinks = (counters.rejectedLinks ?? 0) + 1;
        return false;
      }
      const L = "X" + nextId++;
      for (const c of clips) c.linkId = L;
      counters.links++;
      return true;
    },
  };
}
// v1.2.0 yeniden başlatma: açık projeler (docs: app.projects / Project.path / Project.save / app.quit). save() dosyayı gerçekten
// yazar (değişme zamanı ileri gider) — upd.saveWrites=false → yazmaz (doğrulama düşmeli); upd.saveReturns → dönüş değeri.
const mockProjects = [];
function esProject(p) {
  return {
    get name() { return p.name; },
    get path() { return p.path; },
    get documentID() { return p.id; },
    save() {
      counters.saves = (counters.saves ?? 0) + 1;
      if (upd.saveWrites !== false && p.path) {
        const t = new Date(Date.now() + 5000);
        fsReal.utimesSync(p.path, t, t);
      }
      return upd.saveReturns !== undefined ? upd.saveReturns : 0;
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
    get path() {
      return mockProjects[0] ? mockProjects[0].path : "";
    },
  },
  get projects() {
    const c = { numProjects: mockProjects.length };
    mockProjects.forEach((p, i) => (c[i] = esProject(p)));
    return c;
  },
  quit() {
    hostile.quit = true;
  },
  // v1.1.0: yardımcı panel görünmezken de bellekte kalsın (docs: app.setExtensionPersistent)
  setExtensionPersistent(id, v) {
    counters.persist = [String(id), v];
    return true;
  },
};
counters.links = 0;

// ------------------------------------------------------------ gerçek yardımcı (cep-helper/js/helper.js) + host.jsx (vm)
const HELPER = require(path.join(__dirname, "..", "..", "cep-helper", "js", "helper.js"));
// yardımcı panele derlenmiş TEK modül (Spread'in kendi kodu; `npm run check:core` güncel olduğunu denetler) — panelde <script> ile yüklenir
const CORE = new Function(fsReal.readFileSync(path.join(__dirname, "..", "..", "cep-helper", "js", "spread-core.js"), "utf8") + "\nreturn SpreadCore;")();
const HOST_SRC = fsReal.readFileSync(path.join(__dirname, "..", "..", "cep-helper", "jsx", "host.jsx"), "utf8");
let helper = null;
const helperLog = [];
/** yardımcının ExtendScript çağrısı (senaryolar araya girebilsin diye dolaylı) */
const helperEval = { fn: null };
/** v1.4.0 SENKRON: yardımcının ffmpeg'i yerine sahte ikililer (dev/fake-ffmpeg.cjs: <yol>.pcm'i basar) — ağ / gerçek ffmpeg yok */
const SENKRON_SK = require(path.join(__dirname, "..", "..", "cep-helper", "js", "senkron.js"));
function fakeTools() {
  const dir = path.join(TMPHOME, "fake-ffmpeg");
  fsReal.mkdirSync(dir, { recursive: true });
  const t = { ffmpeg: path.join(dir, "ffmpeg"), ffprobe: path.join(dir, "ffprobe") };
  for (const k of ["ffmpeg", "ffprobe"]) {
    fsReal.writeFileSync(t[k], `#!/bin/sh\nexec "${process.execPath}" "${path.join(__dirname, "fake-ffmpeg.cjs")}" ${k} "$@"\n`);
    fsReal.chmodSync(t[k], 0o755);
  }
  return t;
}
async function startHelper(extra = {}) {
  if (helper) return helper;
  const ctx = vm.createContext({ app: fakeApp });
  vm.runInContext(HOST_SRC, ctx);
  helperEval.fn = (script, cb) =>
    setTimeout(() => {
      let r;
      try {
        r = vm.runInContext(script, ctx, { timeout: 5000 });
      } catch (e) {
        r = "EvalScript error.";
      }
      cb(String(r));
    }, 1);
  const evalScript = (script, cb) => helperEval.fn(script, cb);
  helper = HELPER.createHelper({
    http,
    crypto: cryptoReal,
    fs: fsReal,
    path,
    os: osReal,
    evalScript,
    core: CORE,
    home: TMPHOME,
    platform: "darwin",
    log: (l) => helperLog.push(l),
    https: require("https"),
    zlib: require("zlib"),
    childProcess: require("child_process"),
    createSenkron: SENKRON_SK.createSenkron,
    senkronTools: fakeTools(),
    ...extra,
  });
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
  counters.rejectedLinks = 0;
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
 * kare-katı ofset; cihaz → V; kaynak → A (srcTrack), "korunan kamera sesi", "sil" kaynakları, en altta kılavuz sesler (cihaz başına 1 kanal) (v0.3.4),
 * sahipsizler park'ta (zaman aynı, çakışmayan ilk park track'i); diğerleri (grafik) yerinde.
 */
function expectTopla(seq, { sessions, devices, srcTrack, sil = [], gap = sec(2) }) {
  const clips = allClips(seq);
  const mapped = Math.max(-1, ...Object.values(srcTrack)) + 1;
  // v0.3.3: eşlenen kaynakların altında "korunan kamera sesi" track'i (kılavuz kanalı başına; testlerde kamera başına 1 kanal)
  const kept = mapped > 0 && clips.some((x) => x.kind === "A" && devOf(x.c.name)) ? 1 : 0; // eşlenen harici kaynak yoksa ayrılmaz
  const aPark = mapped + kept + devices.length + sil.length;
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
      else if (devOf(n)) track = mapped + kept + sil.length + devices.indexOf(devOf(n));
      else track = sil.includes(srcOf(n)) ? mapped + kept + sil.indexOf(srcOf(n)) : srcTrack[srcOf(n)];
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

/**
 * BAĞLA'nın beklenen sonucu — oturum İÇİNDE: grup = çakışan kameralar, çapa = en uzun (eşitlikte alt track), parça = ses ∩ çapa.
 * v0.3.3: harici sesli grupta, grup aralığının harici parçalarca kapsanmayan > 1 sn'lik boşluklarında kamera sesi korunur: boşluk kamera
 * sınırlarında bölünür, her dilim onu kapsayan kılavuzlu en iyi kameranın (en uzun, eşitlikte alt track, sonra erken start) kılavuz
 * sesinden kesilir ve "korunan kamera sesi" track'ine (v0.3.4: "sil" track'lerinin üstü; onların altında kılavuzlar) konur.
 */
function expectBagla(list, sessions, sil = []) {
  const exp = [];
  const groups = [];
  const used = new Set();
  const guideOf = (v) => list.filter((e) => e.kind === "A" && e.name === v.name && e.start === v.start && e.end === v.end);
  const guideTracks = list.filter((e) => e.kind === "A" && devOf(e.name)).map((e) => e.track);
  const keptTrack = guideTracks.length ? Math.min(...guideTracks) - 1 - sil.length : -1;
  const better = (c, m) => {
    const lc = c.end - c.start;
    const lm = m.end - m.start;
    return lc > lm || (lc === lm && (c.track < m.track || (c.track === m.track && c.start < m.start)));
  };
  for (const keys of sessions) {
    const mem = list.filter((e) => keys.includes(recOf(e.name)));
    mem.forEach((e) => used.add(e));
    const cams = mem.filter((e) => e.kind === "V").sort((p, q) => (p.start < q.start ? -1 : p.start > q.start ? 1 : p.track - q.track));
    if (!cams.length) {
      exp.push(...mem); // kamerasız oturum: sesleri olduğu gibi kalır
      continue;
    }
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
        continue;
      }
      // boşluklar: [grup başı, grup sonu) − harici parçalar
      const gStart = g.cams.reduce((m, c) => (c.start < m ? c.start : m), g.cams[0].start);
      let gaps = [[gStart, g.end]];
      for (const p of g.pieces) {
        const next = [];
        for (const [a, b] of gaps) {
          if (p.end <= a || p.start >= b) next.push([a, b]);
          else {
            if (p.start > a) next.push([a, p.start]);
            if (p.end < b) next.push([p.end, b]);
          }
        }
        gaps = next;
      }
      const cp = [];
      for (const [a, b] of gaps) {
        if (b - a <= sec(1)) continue;
        const pts = [...new Set([a, b, ...g.cams.flatMap((c) => [c.start, c.end]).filter((t) => t > a && t < b)])].sort((x, y) => (x < y ? -1 : 1));
        let cur = null;
        for (let i = 0; i + 1 < pts.length; i++) {
          const cands = g.cams.filter((c) => c.start <= pts[i] && c.end >= pts[i + 1] && guideOf(c).length);
          const best = cands.length ? cands.reduce((m, c) => (better(c, m) ? c : m)) : null;
          if (cur && cur.cam === best && cur.e === pts[i]) cur.e = pts[i + 1];
          else cp.push((cur = { s: pts[i], e: pts[i + 1], cam: best }));
        }
      }
      // v0.3.4: ≤ 1 kare kameralı dilim → komşusunun kamerası kapsıyorsa ona katılır, yoksa atlanır
      for (let i = 0; i < cp.length; i++) {
        const k = cp[i];
        if (!k.cam || k.e - k.s > FRAME25) continue;
        const cov = (n) => n && n.cam && n.cam.start <= k.s && n.cam.end >= k.e;
        if (cov(cp[i - 1]) && cp[i - 1].e === k.s) cp[i - 1].e = k.e;
        else if (cov(cp[i + 1]) && cp[i + 1].s === k.e) cp[i + 1].s = k.s;
        cp.splice(i--, 1);
      }
      for (let i = 1; i < cp.length; i++) if (cp[i - 1].cam === cp[i].cam && cp[i - 1].e === cp[i].s) (cp[i - 1].e = cp[i].e), cp.splice(i--, 1);
      for (const k of cp.filter((x) => x.cam)) {
        const gd = guideOf(k.cam)[0];
        const p = { kind: "A", track: keptTrack, name: gd.name, start: k.s, end: k.e, inPt: gd.inPt + (k.s - gd.start) };
        g.pieces.push(p);
        exp.push(p);
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

const doneRe = /✓ SPREAD tamam|✗ SPREAD DURDU|✓ TOPLA tamam|✗ TOPLA DURDU|✓ BAĞLA tamam|⚠ BAĞLA bitti|✗ BAĞLA DURDU|✓ KES tamam|İptal edildi|Zaten dağıtılmış|Zaten toplanmış|Durum raporu hazır|✓ SENKRON \(Dene\) bitti|✗ SENKRON DURDU/;
/** v1.4.0: Uygula dahil SENKRON bitişi */
const senkronDoneRe = /✓ SENKRON UYGULANDI|✗ SENKRON DURDU|Uygula iptal edildi|İptal edildi|SENKRON: timeline zaten/;
const txOf = (prefix) => counters.txNames.filter((n) => n.startsWith(prefix));
const TOPLA_TX = "TOPLA: yedek sequence,TOPLA: ilk park (ölçüm),TOPLA: park,TOPLA: ilk yerleştirme (ölçüm),TOPLA: yerleştir";
const CAL_TX = ["kopyaları", "SetOutPoint", "SetEnd", "SetInPoint", "SetStart", "baş+kuyruk birlikte", "kopyalarını sil"].map((x) => `BAĞLA: kalibrasyon ${x}`);
const CAL_TX_NORULE = CAL_TX.filter((x) => !/birlikte/.test(x)); // tek action'lardan kural çıkmazsa "birlikte" adımı yok
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
  // v0.3.4: ÇİFT KOPYA TOPLA'yı durdurmaz — A27 / A30 (A26 / A29'la aynı kaynak + aynı start/end/in/out) TOPLA'nın ilk adımında
  // silinir (ripple=false), en küçük numaralı track'teki kalır; sonuç çiftler hiç yokmuş gibi (el ile temizlenmiş veriyle birebir)
  setupFromReport(R0912, ["A27", "A30"]);
  await setMap("Zoom TrLR", "sil");
  const oc = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✓ TOPLA tamam/.test(oc)) return fail("temiz veride TOPLA tamamlanmadı:\n" + failLines(oc));
  const key = (e) => [e.kind, e.track, e.name, e.start, e.end, e.inPt].join("|");
  const clean = snapList().map(key).sort().join("\n");
  setupFromReport(R0912);
  await setMap("Zoom TrLR", "sil");
  let q = "";
  const out = await clickAndWait("btn-collect", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ TOPLA tamam/.test(out)) return fail("çiftler varken TOPLA tamamlanmadı:\n" + failLines(out));
  if (!/ÇİFT KOPYA — ilk adımda silinecek \(ripple=false; aynı kaynak \+ aynı start\/end\/in\/out, en küçük numaralı track'teki kalır\): A27 "260912_133224_Tr1\.WAV" \(A26 kalır\); A30 "260912_133224_Tr2\.WAV" \(A29 kalır\)/.test(q))
    fail("onayda çift kopya bilgi satırı yok / yanlış:\n" + q.split("\n").filter((l) => /ÇİFT/.test(l)).join("\n"));
  else ok("onayda bilgi satırı: A27 ve A30 silinecek, A26 / A29 kalır");
  const tx = txOf("TOPLA");
  if (tx[0] !== "TOPLA: yedek sequence" || tx[1] !== "TOPLA: çift kopyaları sil" || tx.slice(2).join(",") !== TOPLA_TX.split(",").slice(1).join(","))
    fail(`TOPLA transaction'ları: ${tx.join(", ")}`);
  else ok("TOPLA: yedek → ÇİFT KOPYALARI SİL (ilk adım) → ilk park (ölçüm) → park → ilk yerleştirme (ölçüm) → yerleştir");
  if (snapList().map(key).sort().join("\n") !== clean) fail("çiftler silinip toplanan düzen, temiz veriyle toplanan düzenle aynı değil");
  else ok("sonuç, çiftleri el ile silinmiş veriyle toplanan düzenle BİREBİR aynı");
  // aynı kaynağın FARKLI konumdaki kopyası çift değildir
  setupFromReport(R0912, ["A27", "A30"]);
  const S = seqByGuid("guid-main-edit");
  const w = S.a.flat().find((c) => c.name === "260912_151555_Tr1.WAV");
  const t = S.a.findIndex((tr) => tr.includes(w));
  S.a.push([{ ...w, id: nextId++, start: w.start + sec(7200), end: w.end + sec(7200), linkId: null }]);
  mockGen++;
  const o3 = await clickAndWait("btn-collect", yes, doneRe);
  if (/ÇİFT KOPYA/.test(o3)) fail("farklı konumdaki kopya çift sayıldı:\n" + o3.split("\n").filter((l) => /ÇİFT/.test(l)).join("\n"));
  else ok(`aynı kaynağın 2 saat sonraki kopyası (A${t + 1} → A${S.a.length}) çift SAYILMADI`);
};

scenarios.dup_only = async () => {
  // toplanmış düzende sonradan oluşan çift (aynı kaynak + aynı zamanlar, üst numaralı track'te) → TOPLA yalnız onu siler
  await collectThen(smallSpec());
  const key = (e) => [e.kind, e.track, e.name, e.start, e.end, e.inPt].join("|");
  const before = snapList().map(key).sort().join("\n");
  const S = seqByGuid("guid-main-edit");
  const w = S.a.flat().find((c) => /_Tr1\.WAV$/.test(c.name));
  S.a.push([{ ...w, id: nextId++, linkId: null }]);
  mockGen++;
  const n = txOf("TOPLA").length;
  let q = "";
  const out = await clickAndWait("btn-collect", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ TOPLA tamam: 1 çift kopya silindi; düzen zaten toplanmıştı/.test(out) || !/yalnız çift kopyalar silinecek/.test(q) || !/A\d+ "260912_101512_Tr1\.WAV" \(A1 kalır\)/.test(q))
    return fail("yalnız çift kopya varken TOPLA beklenen biçimde çalışmadı:\n" + failLines(out) + "\n" + q);
  if (txOf("TOPLA").slice(n).join(",") !== "TOPLA: yedek sequence,TOPLA: çift kopyaları sil" || snapList().map(key).sort().join("\n") !== before)
    fail(`beklenmeyen adımlar / düzen: ${txOf("TOPLA").slice(n).join(", ")}`);
  else ok("toplanmış düzende sonradan oluşan çift → yalnız 'çift kopyaları sil' (yedekten sonra), kalan düzen birebir aynı");
  await startHelper();
  const o2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(o2)) fail("çift silindikten sonra BAĞLA çalışmadı:\n" + failLines(o2));
  else ok("ardından BAĞLA normal çalıştı (TOPLA kaydı yenilendi)");
  // TX-0 fazlasını silerse (ör. bağlı partner) → doğrulama DURUR
  await collectThen(smallSpec());
  const S2 = seqByGuid("guid-main-edit");
  const w2 = S2.a.flat().find((c) => /_Tr1\.WAV$/.test(c.name));
  S2.a.push([{ ...w2, id: nextId++, linkId: null }]);
  mockGen++;
  hooks.beforeRemoveApply = () => {
    hooks.beforeRemoveApply = null;
    S2.v[0].pop(); // silme bir kamera klibini de götürdü
  };
  const m = txOf("TOPLA").length;
  const o3 = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✗ TOPLA DURDU: Çift kopya silme doğrulaması tutmadı/.test(o3) || !/Ctrl\+Z'ye 1 kez bas/.test(o3) || txOf("TOPLA").slice(m).includes("TOPLA: ilk park (ölçüm)"))
    fail("TX-0 fazladan silince TOPLA durmadı:\n" + o3.split("\n").slice(-6).join("\n"));
  else ok("TX-0 fazladan bir klip silerse → TOPLA DURDU (Ctrl+Z × 1), taşımaya geçmedi");
  // KAMERA klibi (video + sesi) yapıştırılarak çoğaltılmış → otomatik silinmez (kopyanın sesi ayırt edilemez), TOPLA başlamaz
  await collectThen(smallSpec());
  const S3 = seqByGuid("guid-main-edit");
  const v3 = S3.v.flat().find((c) => c.name.startsWith("A038C001"));
  const a3 = S3.a.flat().find((c) => c.name === v3.name && c.start === v3.start);
  S3.v.push([{ ...v3, id: nextId++, linkId: "Lpaste" }]);
  S3.a.push([{ ...a3, id: nextId++, linkId: "Lpaste" }]);
  mockGen++;
  const before3 = JSON.stringify(state.sequences, repl);
  const k3 = counters.txNames.length;
  const o4 = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✗ TOPLA DURDU: KAMERA klibinin çift kopyası var .*elle sil/.test(o4) || !/V1 \/ V\d+: "A038C001_260912AA\.MP4"/.test(o4) || JSON.stringify(state.sequences, repl) !== before3 || counters.txNames.length !== k3)
    fail("kamera çifti TOPLA'yı durdurmadı / bir şey değişti:\n" + failLines(o4));
  else ok("kamera klibi (video + sesi) çoğaltılmış → otomatik silinmedi, TOPLA BAŞLAMADI ('elle sil'), hiçbir şey değişmedi");
};

scenarios.calib_guard = async () => {
  // kalibrasyon adımı kendi kopyasından başka bir şeyi değiştirirse → DUR (kendi başına düzeltme yok, Ctrl+Z sayısı)
  await collectThen(smallSpec());
  await startHelper();
  hooks.beforeTx = (name) => {
    if (name !== "BAĞLA: kalibrasyon SetEnd") return;
    hooks.beforeTx = null;
    seqByGuid("guid-main-edit").v[0].pop();
  };
  const o = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✗ BAĞLA DURDU: Kalibrasyonda SetEnd beklenmeyen bir değişiklik yaptı/.test(o) || !/Ctrl\+Z'ye 3 kez bas/.test(o) || txOf("BAĞLA").includes("BAĞLA: kesim hazırlığı"))
    fail("kalibrasyonda beklenmeyen değişiklik DURDURMADI:\n" + failLines(o));
  else ok("kalibrasyon adımında başka bir klip değişti → DURDU (Ctrl+Z × 3), kesime geçmedi, kayıt yazılmadı");
  if (lsStore.get("spread.trimCal.v1")) fail("yarım kalibrasyon kaydedildi");
  // kullanıcı kalibrasyonun son adımını (kopyaları sil) TX-1'den önce geri alırsa → hangi adım geri alındı bilinir, sayı güvenilir
  await collectThen(smallSpec());
  await startHelper();
  M.undoAfterTx = "BAĞLA: kalibrasyon kopyalarını sil";
  const o2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/"kalibrasyon kopyalarını sil" adımı geri alınmış görünüyor/.test(o2) || /GÜVENİLİR DEĞİL/.test(o2) || !/Ctrl\+Z'ye 6 kez bas/.test(o2))
    fail("kalibrasyonun son adımı geri alınınca doğru adım/sayı bildirilmedi:\n" + o2.split("\n").slice(-5).join("\n"));
  else ok("kalibrasyonun 'kopyaları sil' adımı geri alındı → DURDU, adım düşüldü, Ctrl+Z × 6 (sayı güvenilir)");
};

scenarios.keepcam_tiny = async () => {
  // ≤ 1 kare dilimin en iyi kamerası B (çapa, en uzun) ama komşu dilimin kamerası A onu da kapsıyor → A'nın dilimine katılır
  const spec = {
    cams: [
      { name: "A038C001_260912AA.MP4", start: sec(10), dur: sec(30) },
      { name: "C0101.MP4", start: sec(11.96), dur: sec(50.04) },
    ],
    wavs: [{ name: "260912_101512_Tr1.WAV", start: sec(12), dur: sec(50) }],
    others: [],
  };
  const collected = await collectThen(spec);
  await startHelper();
  let q = "";
  const o = await clickAndWait("btn-bind", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ BAĞLA tamam/.test(o)) return fail("BAĞLA tamamlanmadı:\n" + failLines(o));
  if (!/uyarı: O1-G1: "C0101\.MP4" [\d.]+–[\d.]+ s \(0\.040 sn ≤ 1 kare\) → kamera sesi komşu dilime \("A038C001_260912AA\.MP4"\) katıldı/.test(o) || !/O1-G1: "A038C001_260912AA\.MP4" 0\.000–2\.000 s \(2\.000 sn/.test(q))
    fail("≤ 1 kare dilim komşuya katılmadı:\n" + o.split("\n").filter((l) => /kare|KORUNACAK/.test(l)).join("\n") + "\n" + q);
  else ok("≤ 1 kare dilim (en iyisi C0101) komşu kamera A038C001 kapsadığı için onun dilimine katıldı → tek parça 0.000–2.000 s");
  checkExactly(seqByGuid("guid-main-edit"), expectBagla(collected, [["260912_101512", "A038C001_260912AA", "C0101"]]).exp, "≤ 1 kare birleşik düzen");
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
  checkExactly(S, exp, "12 Eylül TOPLA (oturumlar sırayla, blok içi ofset aynı, A → V1, Sony → V2, Tr1 → A1, Tr2 → A2, korunan kamera sesi A3 (boş), TrLR → A4 (sil), kılavuzlar EN ALTTA A5–A6)");
  const disjoint = blocks.every((b, i) => i === 0 || b.start >= blocks[i - 1].end);
  if (!disjoint) fail("bloklar çakışıyor");
  else ok(`bloklar çakışmıyor: ${blocks.map((b) => `[${secOf(b.start)}–${secOf(b.end)}]`).join(" ")}`);
  if (txOf("TOPLA").join(",") !== TOPLA_TX) fail(`TOPLA transaction'ları: ${txOf("TOPLA").join(", ")}`);
  else ok("TOPLA: yedek → ilk park (ölçüm, yalnız O1) → park → ilk yerleştirme (ölçüm, yalnız O1) → yerleştir");

  const collected = snapList();
  await startHelper();
  let qB = "";
  const out2 = await clickAndWait("btn-bind", async (x) => ((qB = x), yes()), doneRe);
  if (!/✓ BAĞLA tamam/.test(out2)) return fail("BAĞLA tamamlanmadı:\n" + out2.split("\n").filter((l) => /DURDU|•|HATA/.test(l)).join("\n"));
  const silent = out2.split("\n").filter((l) => /SESSİZ KALACAK:/.test(l));
  const keptCam = out2.split("\n").filter((l) => /KAMERA SESİ KORUNACAK:/.test(l));
  if (process.env.SPREAD_SMOKE_VERBOSE) console.log([...keptCam, ...silent].join("\n"));
  const wantKept = [
    /O1-G1: "A038C001_260912BD\.MP4" 0\.000–2\.320 s \(2\.320 sn, çapa içinde harici ses yok\) → A3/,
    /O2-G1: "A038C002_260912RQ\.MP4" 2824\.320–2866\.160 s \(41\.840 sn, çapa içinde harici ses yok\) → A3/,
  ];
  const tiny = /uyarı: O2-G1: "C0143\.MP4" 2866\.160–2866\.200 s \(0\.040 sn ≤ 1 kare\) → korunan kamera sesi parçası OLUŞTURULMADI/;
  if (silent.length || keptCam.length !== 2 || !wantKept.every((re) => keptCam.some((l) => re.test(l))) || !/KAMERA SESİ KORUNACAK \(harici ses parçasının olmadığı aralıkta/.test(qB))
    fail(`12 Eylül korunan kamera sesi beklenenden farklı:\n${[...keptCam, ...silent].join("\n")}`);
  else ok("12 Eylül: KAMERA SESİ KORUNACAK onayda — A038C001 başı 2.320 sn, A038C002 sonu 41.840 sn → A3; sessiz kalan yer yok");
  if (!tiny.test(out2) || /C0143\.MP4" 2866\.160–2866\.200 s .*→ A3/.test(out2)) fail("C0143'ün 1 karelik (0.040 sn) parçası atlanıp günlüğe yazılmadı");
  else ok("C0143'ün çapadan taşan 0.040 sn'si (≤ 1 kare, komşu kamera kapsamıyor) → korunan parça OLUŞTURULMADI, günlükte uyarı");
  const eb = expectBagla(collected, S0912, ["Zoom TrLR"]);
  checkExactly(S, eb.exp, "12 Eylül BAĞLA (kesim yalnız oturum içinde, TrLR ve kılavuzlar silindi, harici sessiz aralıklarda kamera sesi A3'te)");
  checkLinks(S, eb.groups, "12 Eylül bağları");
  // A038C001'in bağında 144207'den bir parça OLMAMALI
  const a1 = S.v.flat().find((c) => c.name.startsWith("A038C001"));
  const wrong = allClips(S).filter((x) => x.c.linkId === a1.linkId && x.c.name.includes("144207"));
  if (wrong.length) fail(`A038C001'e 144207 sesi bağlandı (${wrong.length})`);
  else ok("A038C001'in bağında yalnız 133224 parçaları var (144207'den 176 sn kesilmedi)");
};

// v0.3.4 REGRESYON — gerçek Premiere'de BAĞLA'nın ilk parçası (A038C001 kılavuz sesi, 1552.80 sn → baştaki 2.32 sn) End → Start →
// In → Out tek transaction'da kırpılınca out = −393257410560000 (−1548.16 s) okundu. Mock artık gerçek anlamı uyguluyor (fark ilk
// hâlden, aynı kenarda birikir). SPREAD_REGRESS=old + SPREAD_DIST=<v0.3.3 derlemesi> → ESKİ kod aynı sayılarla düşmeli (scripts/
// regress-trim.sh); yeni kod aynı senaryoda geçmeli ve hiçbir klibin aynı kenarına iki action üretmemeli.
scenarios.regress_trim = async () => {
  const old = process.env.SPREAD_REGRESS === "old";
  // gerçek koşudaki gibi TrLR de eşlenmiş (A3) → A kamera kılavuzu A5'te (gerçek rapordaki satır)
  setupFromReport(R0912, ["A27", "A30"]);
  lsStore.set("spread.sourceMap.v1", JSON.stringify({ "Zoom TrLR": 2 })); // v1.1.0: TrLR varsayılanı "Sil" — bu senaryo TrLR'yi A3'e eşleyen kullanıcıyı sınar
  lsStore.set("spread.sourceMap.v11", "1"); // v1.1.0 geçişi yapılmış: kullanıcı TrLR'yi bilerek A3'e eşlemiş
  const out = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✓ TOPLA tamam/.test(out)) return fail("TOPLA tamamlanmadı:\n" + failLines(out));
  const collected = snapList();
  await startHelper();
  counters.setActions.clear();
  const out2 = await clickAndWait("btn-bind", yes, doneRe);
  if (old) {
    // gerçek raporun satırı: A5 "A038C001_260912BD.MP4" [6792.720s–6795.040s] in=0 out=589317120000; okunan out −393257410560000,
    // fark −393846727680000 (end de aynı farkla — gerçek raporda yalnız out verildi)
    const want =
      /✗ BAĞLA DURDU: İLK PARÇA TUTMADI[^\n]*\n\s*• A5 "A038C001_260912BD\.MP4" \[6792\.720s–6795\.040s\] in=0 out=589317120000 tutmadı → end: beklenen=\d+ okunan=\d+ \(fark -393846727680000 tick\); outPt: beklenen=589317120000 okunan=-393257410560000 \(fark -393846727680000 tick\)$/m;
    if (!want.test(out2)) return fail("ESKİ kod gerçek set anlamında beklenen sayılarla düşmedi:\n" + failLines(out2));
    ok("ESKİ kod (v0.3.3): ilk parça A5 \"A038C001_260912BD.MP4\" [6792.720s–6795.040s] in=0 — out beklenen 589317120000, okunan −393257410560000 (−1548.16 s), fark −393846727680000 → gerçek Premiere raporuyla BİREBİR (track, ad, park konumu, out)");
    if (!/executeTransaction → true; addAction 4\/4/.test(out2.split("TX-2")[1] ?? "")) fail("eski ilk parça transaction'ı 4 action değil");
    else ok("eski ilk parça: End → Start → In → Out tek transaction'da (addAction 4/4) — kuyruk farkı iki kez uygulandı");
    return;
  }
  if (!/✓ BAĞLA tamam/.test(out2)) return fail("YENİ kod gerçek set anlamında BAĞLA'yı tamamlamadı:\n" + failLines(out2));
  const calLines = out2.split("\n").filter((l) => /tek başına \((outPt|end|inPt|start) /.test(l) && /→ \(Δstart/.test(l));
  const want = [/SetOutPoint .*\(0, \+1, 0, \+1\)/, /SetEnd .*\(0, \+1, 0, \+1\)/, /SetInPoint .*\(\+1, 0, \+1, 0\)/, /SetStart .*\(\+1, 0, \+1, 0\)/];
  if (!want.every((re) => calLines.some((l) => re.test(l))) || !/seçilen kural: kuyruk = SetOutPoint, baş = SetInPoint/.test(out2) || !/SetInPoint \+ SetOutPoint BİRLİKTE .*hedefle birebir \(etkiler toplanıyor\)/.test(out2))
    fail("kalibrasyon ölçümü / kuralı beklenenden farklı:\n" + calLines.join("\n"));
  else ok("YENİ kod: KALİBRASYON Out/End = kuyruk (0,+1,0,+1), In/Start = baş (+1,0,+1,0) ölçtü → kural kuyruk = SetOutPoint, baş = SetInPoint; In + Out BİRLİKTE tek transaction'da da hedefle birebir");
  if (!/TX-2 \(ilk parça — ölçüm\): "A038C001_260912BD\.MP4" → \[0\.000s–2\.320s\]/.test(out2) || !/executeTransaction → true; addAction 1\/1/.test(out2.split("TX-2")[1] ?? ""))
    fail("yeni ilk parça beklenenden farklı (A038C001, tek action olmalı):\n" + out2.split("\n").filter((l) => /TX-2|addAction/.test(l)).join("\n"));
  else ok("YENİ kod: aynı ilk parça (A038C001'in baştaki 2.32 sn'si; park'ta [6792.720s–6795.040s]) TEK action'la (yalnız SetOutPoint; baş farkı 0 → action yok) doğru kırpıldı");
  let dbl = 0;
  for (const [, acts] of counters.setActions) {
    const tail = acts.filter((a) => a === "end" || a === "out").length;
    const head = acts.filter((a) => a === "start" || a === "in").length;
    if (tail > 1 || head > 1) dbl++;
  }
  const trimmed = [...counters.setActions.values()].length;
  if (dbl || !trimmed) fail(`aynı kenara iki action üretilen klip: ${dbl} (set action alan klip ${trimmed})`);
  else ok(`${trimmed} klibin hiçbirinde aynı kenara iki action yok (kalibrasyon kopyaları dahil)`);
  checkExactly(seqByGuid("guid-main-edit"), expectBagla(collected, S0912, []).exp, "12 Eylül BAĞLA gerçek set anlamında (TrLR eşlenmiş)");
};

// ============================================================ v1.1.0 BÖLÜM A — kanal tipi, ikinci deneme, yalnız bağla, yedek kopya
// Gerçek Premiere 26.5.1 (v1.0.0 denemesi): mono (Zoom Tr1/Tr2) + stereo (Zoom TrLR, kamera sesi) karışık grupta linkSelection() false;
// TrLR çıkarılınca bağlandı; korunan (stereo) kamera sesi parçası içeren grup bağlanmadı. Adobe helpx: çok klipli bağda bütün ses
// klipleri aynı kanal tipinde olmalı. Mock: M.chType (ad → tip), M.linkRejectMixed (karışık seçimde linkSelection() false).
const REAL_CH = (name) => (/TrLR\.WAV$/i.test(name) || /\.MP4$/i.test(name) ? 1 : 0); // TrLR ve kamera sesi stereo, Tr1/Tr2 mono
const askSummary = () => Array.from(els["ask-summary"]?.children ?? []).map((c) => c.textContent);

/** Grup üyeleri: ana tipteki (mono varsa mono) üyeler TEK bağda; farklı tipteki sesler bağ DIŞINDA ama YERİNDE (silinmemiş). */
function checkLinksExcluding(seq, groups, label) {
  const clipOf = (e) => allClips(seq).find((x) => x.kind === e.kind && x.c.name === e.name && x.c.start === e.start)?.c;
  let bad = 0;
  let nOut = 0;
  for (const g of groups) {
    const all = [...g.cams, ...g.pieces, ...g.guides].map((e) => ({ e, c: clipOf(e) }));
    if (all.some((x) => !x.c)) {
      bad++;
      fail(`${label}: grup "${g.anchor.name}" öğesi timeline'da yok (hiçbir klip silinmemeliydi)`);
      continue;
    }
    const aud = all.filter((x) => x.e.kind === "A");
    const hasMono = aud.some((x) => REAL_CH(x.c.name) === 0);
    const isOut = (x) => x.e.kind === "A" && hasMono && REAL_CH(x.c.name) === 1;
    const inn = all.filter((x) => !isOut(x));
    const out = all.filter(isOut);
    nOut += out.length;
    if (inn.length < 2) continue;
    const L = inn[0].c.linkId;
    if (!L || inn.some((x) => x.c.linkId !== L)) (bad++, fail(`${label}: grup "${g.anchor.name}" (aynı kanal tipindeki üyeler) tek bağda değil`));
    else if (out.some((x) => x.c.linkId === L)) (bad++, fail(`${label}: grup "${g.anchor.name}" — bağ dışında kalması gereken ses bağa girmiş`));
    else if (allClips(seq).some((x) => x.c.linkId === L && !inn.some((y) => y.c === x.c))) (bad++, fail(`${label}: grup "${g.anchor.name}" bağına grup dışı klip girmiş`));
  }
  if (!bad) ok(`${label}: ${groups.length} grup — aynı kanal tipindeki üyeler tek bağda; ${nOut} farklı tipteki ses bağ dışında ve YERİNDE (silinmedi)`);
  return nOut;
}

scenarios.mixed_channels = async () => {
  // A3 + A4: TrLR eşlenmiş (v1.0.0 gerçek denemesindeki gibi) → her Zoom grubunda mono + stereo → Premiere reddeder → ikinci deneme
  setupFromReport(R0912, ["A27", "A30"]);
  lsStore.set("spread.sourceMap.v1", JSON.stringify({ "Zoom TrLR": 2 }));
  lsStore.set("spread.sourceMap.v11", "1"); // v1.1.0 geçişi yapılmış: kullanıcı TrLR'yi bilerek A3'e eşlemiş
  M.chType = REAL_CH;
  M.linkRejectMixed = true;
  const out = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✓ TOPLA tamam/.test(out)) return fail("TOPLA tamamlanmadı:\n" + failLines(out));
  const collected = snapList();
  await startHelper();
  let qB = "";
  let sum = [];
  const out2 = await clickAndWait("btn-bind", async (x) => ((qB = x), (sum = askSummary()), yes()), doneRe);
  const nMixed = Number((out2.match(/KARIŞIK KANAL: (\d+) grupta mono \+ stereo ses var/) ?? [])[1] ?? 0);
  if (!nMixed || !sum.some((l) => /KARIŞIK KANAL: \d+ grupta mono \+ stereo/.test(l)) || !/KARIŞIK KANAL: \d+ grupta mono \+ stereo ses var; Premiere grubu reddederse/.test(qB))
    fail("onayda karışık kanal uyarısı yok:\n" + sum.join("\n"));
  else ok(`A3: BAĞLA onayında tek satır "KARIŞIK KANAL: ${nMixed} grupta mono + stereo…" (özet + tam metin; tipler yardımcıdan, salt okuma)`);
  if (!/✓ BAĞLA tamam/.test(out2) || !/⚠ \d+ ses bağ dışında kaldı \(\d+ grupta\): kanal tipi grubun geri kalanından farklı/.test(out2) || !counters.rejectedLinks)
    return fail("BAĞLA ikinci denemeyle tamamlanmadı:\n" + failLines(out2));
  ok(`A4: Premiere ${counters.rejectedLinks} karışık grubu reddetti (linkSelection false) → yardımcı stereo sesleri çıkarıp yeniden bağladı`);
  const S = seqByGuid("guid-main-edit");
  const eb = expectBagla(collected, S0912, []);
  checkExactly(S, eb.exp, "karışık kanal: düzen normal BAĞLA'yla birebir (bağ dışında kalanlar dahil HİÇBİR KLİP SİLİNMEDİ)");
  const nOut = checkLinksExcluding(S, eb.groups, "karışık kanal bağları");
  const reported = Number((out2.match(/⚠ (\d+) ses bağ dışında kaldı/) ?? [])[1] ?? -1);
  if (reported !== nOut) fail(`raporlanan bağ dışı ses ${reported}, düzende ${nOut}`);
  else ok(`bağ dışında kalan ${nOut} ses (TrLR parçaları + korunan stereo kamera sesi) raporda satır satır`);
};

scenarios.kept_stereo = async () => {
  // A2 + A5: TrLR için kullanıcı seçim yapmadı → varsayılan "Sil"; kalan tek karışıklık korunan (stereo) kamera sesi parçası
  setupFromReport(R0912, ["A27", "A30"]);
  M.chType = REAL_CH;
  M.linkRejectMixed = true;
  let qT = "";
  const out = await clickAndWait("btn-collect", async (x) => ((qT = x), yes()), doneRe);
  if (!/✓ TOPLA tamam/.test(out)) return fail("TOPLA tamamlanmadı:\n" + failLines(out));
  if (!/Zoom TrLR → A\d+ \(sil\)/.test(qT)) fail("TrLR varsayılan 'Sil' TOPLA'da görünmedi:\n" + qT.split("\n").filter((l) => /Track'ler/.test(l)).join("\n"));
  else ok("A2: TrLR için seçim yokken varsayılan 'Sil' (TOPLA: 'Zoom TrLR → A4 (sil)')");
  const pre = JSON.parse(JSON.stringify(undoStack[0]), rev).sequences.find((x) => x.guid === "guid-main-edit");
  checkExactly(seqByGuid("guid-main-edit"), expectTopla(pre, { sessions: S0912, devices: ["A", "Sony"], srcTrack: { "Zoom Tr1": 0, "Zoom Tr2": 1 }, sil: ["Zoom TrLR"] }).exp, "varsayılan 'Sil' = açıkça 'Sil' seçilmiş TOPLA düzeni");
  const collected = snapList();
  await startHelper();
  const out2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(out2)) return fail("BAĞLA tamamlanmadı:\n" + failLines(out2));
  if (counters.rejectedLinks !== 2 || !/KARIŞIK KANAL: 2 grupta mono \+ stereo ses var/.test(out2)) fail(`reddedilen grup ${counters.rejectedLinks} (beklenen 2: korunan kamera sesi içeren O1-G1, O2-G1)`);
  else ok("A5: yalnız korunan (stereo) kamera sesi parçası içeren 2 grup reddedildi (O1-G1, O2-G1); ikinci denemede onlarsız bağlandı");
  if (!/⚠ 2 ses bağ dışında kaldı \(2 grupta\)/.test(out2) || !/A3 "A038C001_260912BD\.MP4" \[0\.000s–2\.320s\] stereo/.test(out2))
    fail("korunan kamera sesi parçası bağ dışında olarak raporlanmadı:\n" + out2.split("\n").filter((l) => /bağ dışında|•/.test(l)).join("\n"));
  else ok('korunan parça raporda: A3 "A038C001_260912BD.MP4" [0.000s–2.320s] stereo — bağ dışında, yerinde (tek kanal kullanmak mümkün değil: handoff.md)');
  const S = seqByGuid("guid-main-edit");
  const eb = expectBagla(collected, S0912, ["Zoom TrLR"]);
  checkExactly(S, eb.exp, "korunan stereo kamera sesi: düzen normal BAĞLA'yla birebir (hiçbir klip silinmedi)");
  if (checkLinksExcluding(S, eb.groups, "korunan stereo kamera sesi bağları") !== 2) fail("bağ dışında kalan ses sayısı 2 değil");
};

scenarios.panel_mixed = async () => {
  // A4 yardımcı panel yolunda da: köprü yok → KES + plan; paneldeki BAĞLA aynı ikinci denemeyi yapar (ortak linkWithRetry)
  setupFromReport(R0912, ["A27", "A30"]);
  M.chType = REAL_CH;
  M.linkRejectMixed = true;
  const out = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✓ TOPLA tamam/.test(out)) return fail("TOPLA tamamlanmadı:\n" + failLines(out));
  const collected = snapList();
  await stopHelper();
  const o1 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ KES tamam/.test(o1)) return fail("köprüsüz KES tamamlanmadı:\n" + failLines(o1));
  const h = await startHelper();
  const r = await h.bindFromPlan({});
  const partial = r.rows.filter((x) => x.status === "kısmen");
  if (!r.ok || !/^⚠ 11 grup bağlandı ve doğrulandı; 2 ses bağ dışında kaldı \(kanal tipi farklı, silinmedi\)/.test(r.summary) || partial.length !== 2 || !partial.every((x) => /bağ dışında kaldı \(kanal tipi farklı, SİLİNMEDİ\): A3 ".*\.MP4" .* stereo/.test(x.detail)))
    fail(`panel yolunda ikinci deneme: ${r.summary}\n${r.rows.map((x) => `${x.status} ${x.label} ${x.detail}`).join("\n")}`);
  else ok(`yardımcı panel BAĞLA: 2 grup reddedildi → stereo korunan kamera sesi çıkarılıp bağlandı ("${r.summary}")`);
  const S = seqByGuid("guid-main-edit");
  const eb = expectBagla(collected, S0912, ["Zoom TrLR"]);
  checkExactly(S, eb.exp, "panel yolu: düzen normal BAĞLA'yla birebir (hiçbir klip silinmedi)");
  checkLinksExcluding(S, eb.groups, "panel yolu bağları");
};

scenarios.linkonly_mixed = async () => {
  // inceleme #9 M2: "yalnız bağla" yolunda da (kesme bitmiş, köprü sonradan açılmış) onayda KARIŞIK KANAL satırı + ikinci deneme
  setupFromReport(R0912, ["A27", "A30"]);
  lsStore.set("spread.sourceMap.v1", JSON.stringify({ "Zoom TrLR": 2 }));
  lsStore.set("spread.sourceMap.v11", "1");
  M.chType = REAL_CH;
  M.linkRejectMixed = true;
  const out = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✓ TOPLA tamam/.test(out)) return fail("TOPLA tamamlanmadı:\n" + failLines(out));
  await stopHelper();
  const o1 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ KES tamam/.test(o1)) return fail("köprüsüz KES tamamlanmadı:\n" + failLines(o1));
  await startHelper();
  let sum = [];
  const o2 = await clickAndWait("btn-bind", async () => ((sum = askSummary()), yes()), doneRe);
  if (!sum.some((l) => /KARIŞIK KANAL: 11 grupta mono \+ stereo/.test(l)) || !/KARIŞIK KANAL: 11 grupta mono \+ stereo ses var/.test(o2))
    fail("yalnız bağla onayında karışık kanal uyarısı yok:\n" + sum.join("\n"));
  else ok("yalnız bağla (kesim önceden) onayında da 'KARIŞIK KANAL: 11 grupta mono + stereo'");
  if (!/✓ BAĞLA tamam/.test(o2) || !/⚠ 13 ses bağ dışında kaldı/.test(o2)) fail("yalnız bağla ikinci denemeyle tamamlanmadı:\n" + failLines(o2));
  else ok("yalnız bağla: reddedilen gruplar ikinci denemede bağlandı, 13 ses bağ dışında (silinmedi)");
};

scenarios.retry_fails = async () => {
  // ikinci deneme de reddedilirse: hangi grup, neden — DUR (kesim yerinde; tekrar basmak yalnız bağlar)
  setupFromReport(R0912, ["A27", "A30"]);
  M.chType = REAL_CH;
  M.linkRejectMixed = true;
  const out = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✓ TOPLA tamam/.test(out)) return fail("TOPLA tamamlanmadı:\n" + failLines(out));
  await startHelper();
  M.linkFailName = "260912_133224_Tr1.WAV"; // O1'in Tr1 parçaları hiçbir seçimde bağlanmaz
  const out2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✗ BAĞLA DURDU: 1\/11 grup bağlanamadı \(kesme\/silme doğru ve yerinde\)/.test(out2) || !/kanal tipi farklı sesler çıkarılarak yapılan ikinci deneme de başarısız/.test(out2))
    fail("ikinci deneme de başarısızken rapor beklenenden farklı:\n" + failLines(out2));
  else ok("ikinci deneme de reddedilince BAĞLA DURDU: '1/11 grup bağlanamadı … ikinci deneme de başarısız' (kesim yerinde)");
  M.linkFailName = null;
};

scenarios.mixed_unknown = async () => {
  // kanal tipi OKUNAMAZSA ikinci deneme YOK (tahmin yok) — v1.0.0'daki gibi hangi grup, neden
  setupFromReport(R0912, ["A27", "A30"]);
  lsStore.set("spread.sourceMap.v1", JSON.stringify({ "Zoom TrLR": 2 }));
  lsStore.set("spread.sourceMap.v11", "1"); // v1.1.0 geçişi yapılmış: kullanıcı TrLR'yi bilerek A3'e eşlemiş
  M.chType = REAL_CH;
  M.linkRejectMixed = true;
  M.channelApi = false;
  const out = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✓ TOPLA tamam/.test(out)) return fail("TOPLA tamamlanmadı:\n" + failLines(out));
  await startHelper();
  const hl0 = helperLog.length;
  const out2 = await clickAndWait("btn-bind", yes, doneRe);
  const firstOnly = helperLog.slice(hl0).filter((l) => /yeniden deneniyor/.test(l)).length === 0;
  if (!/✗ BAĞLA DURDU: \d+\/11 grup bağlanamadı/.test(out2) || /KARIŞIK KANAL/.test(out2) || !/bazı seslerin kanal tipi okunamadı/.test(out2) || !firstOnly)
    fail("kanal tipi okunamazken davranış beklenenden farklı:\n" + failLines(out2));
  else ok("kanal tipi okunamayınca: onayda uyarı yok ('okunamadı' günlükte), ikinci deneme yok, BAĞLA hangi grupların bağlanmadığını yazıp DURDU");
};

scenarios.linkonly_thinned = async () => {
  // A6: kesme bitti, bağlama kaldı (köprü yoktu); kullanıcı bu arada bir parçayı elle sildi → durma, var olanları bağla, eksiği yaz
  await collectThen(smallSpec());
  await stopHelper();
  const o1 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ KES tamam/.test(o1)) return fail("köprüsüz KES tamamlanmadı:\n" + failLines(o1));
  const S = seqByGuid("guid-main-edit");
  const piece = S.a.flat().find((c) => c.name.endsWith(".WAV"));
  for (const tr of S.a) {
    const k = tr.indexOf(piece);
    if (k >= 0) tr.splice(k, 1);
  }
  mockGen++;
  const nClips = allClips(S).length;
  const nTx = txOf("BAĞLA").length;
  const nLinks = counters.links;
  await startHelper();
  let sum = [];
  const o2 = await clickAndWait("btn-bind", async () => ((sum = askSummary()), yes()), doneRe);
  if (
    !/kesimden sonra 1 öğe timeline'da yok \(elle silinmiş ya da taşınmış\) — var olanlar bağlanacak/.test(o2) ||
    !sum.some((l) => /^EKSİK: 1 öğe kesimden sonra silinmiş/.test(l)) ||
    !/✓ BAĞLA tamam: 2 grup bağlandı .* — 1 eksik öğe bağlanmadı/.test(o2) ||
    counters.links - nLinks !== 2 ||
    allClips(S).length !== nClips ||
    txOf("BAĞLA").length !== nTx
  )
    return fail("elle silinmiş parçayla yalnız bağla beklenenden farklı:\n" + failLines(o2) + "\n" + sum.join("\n"));
  ok("A6: kesimden sonra bir parça elle silindi → BAĞLA durmadı: onayda 'EKSİK: 1 öğe', 2 grup var olanlarla bağlandı, eksik yazıldı; kesme/silme / yedek yok, hiçbir klip silinmedi");
  // ikinci grubun çapa KAMERASI (en uzun: C0102) silinirse gruplar değişir (çapaya kesilmiş parça yeni çapaya sığmaz) → güvenle DUR
  const anchor = S.v.flat().find((c) => c.name === "C0102.MP4");
  for (const tr of S.v) {
    const k = tr.indexOf(anchor);
    if (k >= 0) tr.splice(k, 1);
  }
  mockGen++;
  const n2 = counters.links;
  const o3 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✗ BAĞLA DURDU: Kesimden sonra 2 öğe yok ve kalanlar yardımcıyla ortak kuralla aynı grupları vermiyor/.test(o3) || counters.links !== n2)
    fail("çapa kamerası silinince BAĞLA durmadı:\n" + failLines(o3));
  else ok("çapa kamerası da silinince gruplar değişiyor → BAĞLA hiçbir şey yapmadan DURDU (tahmin yok)");
};

scenarios.partial_undo = async () => {
  // inceleme #9 B1: kesimden sonra Ctrl+Z (parçaları TEK transaction yerleştirir → geri alınınca HEPSİ gider) "elle silinmiş" SAYILMAZ:
  // Spread de yardımcı panel de hiçbir şey bağlamamalı (×1 ve ×3). v1.2.1: BAĞLA kaydı bu düzenle tutmuyor → bayat: unutulur (eski KES
  // planı da silinir); BAĞLA planını canlı timeline'dan kurar → ön koşullar tutmaz → hiçbir şey değişmez; yardımcı panelde plan yok
  await collectThen(smallSpec());
  await stopHelper();
  const o1 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ KES tamam/.test(o1)) return fail("köprüsüz KES tamamlanmadı:\n" + failLines(o1));
  for (const k of [1, 3]) {
    const snap = deepCopy();
    const stack = undoStack.slice();
    const ls = new Map(lsStore); // v1.2.1: kayıtlar da her turda KES sonrası hâline döner (bayat kayıt her turda yeniden unutulur)
    const planFile = path.join(TMPHOME, "Library", "Application Support", "BadIdeaAgency", "SpreadHelper", "link-plan.json");
    const planText = fsReal.existsSync(planFile) ? fsReal.readFileSync(planFile, "utf8") : null;
    for (let i = 0; i < k; i++) undo();
    const h = await startHelper();
    const n0 = counters.links;
    const tx0 = counters.txNames.length;
    const o2 = await clickAndWait("btn-bind", yes, doneRe);
    const r = await h.bindFromPlan({});
    if (!/Timeline değişmiş \(geri alma\/elle düzenleme\) — önceki Bağla kaydı unutuldu/.test(o2) || !/✗ BAĞLA DURDU: Plan kurulamadı .*hiçbir şey değişmedi/.test(o2) || counters.links !== n0 || counters.txNames.length !== tx0)
      fail(`Ctrl+Z × ${k} sonrası Spread BAĞLA durmadı:\n${failLines(o2)}`);
    else ok(`Ctrl+Z × ${k} (kesim geri alındı) → bayat BAĞLA kaydı unutuldu; BAĞLA canlı timeline'dan plan kuramadı, hiçbir şey değişmedi`);
    if (r.ok || !/KES planı okunamadı/.test(r.summary) || counters.links !== n0) fail(`Ctrl+Z × ${k} sonrası yardımcı panel: ${r.summary}`);
    else ok(`Ctrl+Z × ${k} → eski KES planı silindi; yardımcı paneldeki Bağla planı bulamadı, hiçbir şey bağlanmadı`);
    // inceleme #13 M2: kısmen geri alınmış BAĞLA'dan sonra TOPLA sessizce çalışmamalı → SORU (Vazgeç → hiçbir şey)
    let tq = "";
    const ot = await clickAndWait("btn-collect", async (x) => ((tq = tq || x), no()), doneRe);
    if (!/^Bu sequence'ta önceki Bağla kısmen geri alınmış görünüyor/.test(tq) || counters.txNames.length !== tx0 || !/İptal edildi/.test(ot))
      fail(`Ctrl+Z × ${k} sonrası TOPLA sormadı:\n${tq}\n${failLines(ot)}`);
    else ok(`Ctrl+Z × ${k} → TOPLA 'Bağla kısmen geri alınmış görünüyor … yine de?' diye SORDU; Vazgeç → hiçbir şey`);
    await stopHelper();
    restore(snap);
    undoStack.length = 0;
    undoStack.push(...stack);
    lsStore.clear();
    for (const [key, v] of ls) lsStore.set(key, v);
    if (planText !== null) fsReal.writeFileSync(planFile, planText);
    mockGen++;
  }
};

scenarios.stop_per_guid = async () => {
  // inceleme #9 m1 (A7): "yarım iş" koruması sequence başına — yedekte başarılı işlem ASLIN yarım iş kaydını silmez
  await collectThen(smallSpec());
  await startHelper();
  hooks.beforeTx = (name) => name === "BAĞLA: kesim hazırlığı" && (M.setSem = "noop");
  const o1 = await clickAndWait("btn-bind", yes, doneRe);
  hooks.beforeTx = null;
  M.setSem = "real";
  if (!/✗ BAĞLA DURDU: İLK PARÇA TUTMADI/.test(o1)) return fail("asılda yarım iş oluşmadı:\n" + failLines(o1));
  const copies = state.sequences.filter((x) => x.name === "Ana Kurgu Copy");
  const copy = copies[copies.length - 1]; // BAĞLA'nın yedeği (TOPLA sonrası düzen)
  state.activeGuid = copy.guid;
  mockGen++;
  const o2 = await clickAndWait("btn-collect", yes, doneRe);
  const o3 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ TOPLA tamam|Zaten toplanmış/.test(o2) || !/✓ BAĞLA tamam/.test(o3)) return fail("yedekte TOPLA / BAĞLA tamamlanmadı:\n" + failLines(o2 + "\n" + o3));
  state.activeGuid = "guid-main-edit";
  mockGen++;
  const n = counters.txNames.length;
  // v1.2.1: yarım iş kaydı kilit değil SORU; Vazgeç → hiçbir şey
  let title = "";
  const o4 = await clickAndWait("btn-bind", async (x) => ((title = els["ask-title"].textContent), no()), doneRe);
  if (!/YARIM hâlde/.test(o4) || title !== "Bağla yine de çalıştırılsın mı?" || counters.txNames.length !== n) fail("yedekteki başarılı işlemler aslın yarım iş kaydını sildi:\n" + title + "\n" + failLines(o4));
  else ok("yedekte Topla + Bağla başarılı; asılda hâlâ 'YARIM hâlde' sorusu (kayıt sequence GUID'ine bağlı); Vazgeç → hiçbir şey");
};

scenarios.backup_copy = async () => {
  // A7: eklentinin kendi yedeği (createCloneAction kopyası) üzerinde çalışmak. Kayıtlar (TOPLA kaydı + park listesi + parmak izi,
  // kalibrasyon, adım işaretleri, yarım iş) sequence GUID'ine bağlı; yedek YENİ GUID alır (makeBackup yeni GUID'i şart koşar)
  await collectThen(smallSpec());
  const orig = seqByGuid("guid-main-edit");
  const copy = state.sequences.find((x) => x.name === "Ana Kurgu Copy");
  if (!copy || copy.guid === orig.guid) return fail("yedek yeni GUID almadı");
  const recs = () => JSON.parse(lsStore.get("spread.collectRecord.v1") ?? "{}");
  const origRec = JSON.stringify(recs()["guid-main-edit"]);
  if (Object.keys(recs()).join() !== "guid-main-edit") fail(`TOPLA kaydı anahtarları: ${Object.keys(recs())}`);
  else ok(`TOPLA kaydı yalnız aslın GUID'inde; yedek "${copy.name}" farklı GUID (${copy.guid})`);
  state.activeGuid = copy.guid;
  mockGen++;
  const copyBefore = ser(copy.v) + ser(copy.a);
  await startHelper();
  const o1 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/Önce TOPLA'ya bas: bu sequence için TOPLA kaydı yok/.test(o1) || ser(copy.v) + ser(copy.a) !== copyBefore) fail("yedekte BAĞLA aslın kaydını kullandı ya da yedeği değiştirdi:\n" + failLines(o1));
  else ok("yedekte BAĞLA: aslın TOPLA kaydını KULLANMADI ('Önce TOPLA'ya bas'), yedeğe dokunulmadı");
  const qs = [];
  const o2 = await clickAndWait("btn-collect", async (x) => (qs.push(x), yes()), doneRe);
  if (!/✓ TOPLA tamam/.test(o2) || qs.some((q) => /PARK KAYDI|BÖLÜNMÜŞ/.test(q)) || JSON.stringify(recs()["guid-main-edit"]) !== origRec || !recs()[copy.guid])
    fail("yedekte TOPLA aslın kaydıyla karıştı:\n" + failLines(o2));
  else ok("yedekte TOPLA: aslın park listesi / parmak izi sorulmadı, kendi kaydı yazıldı, aslın kaydı değişmedi");
  const calKeys = () => Object.keys(JSON.parse(lsStore.get("spread.trimCal.v1") ?? "{}")).sort().join();
  const tx0 = txOf("BAĞLA: kalibrasyon").length;
  const o3 = await clickAndWait("btn-bind", yes, doneRe);
  const tx1 = txOf("BAĞLA: kalibrasyon").length;
  if (!/✓ BAĞLA tamam/.test(o3) || tx1 - tx0 !== CAL_TX.length || calKeys() !== copy.guid) fail(`yedekte BAĞLA / kalibrasyon: ${calKeys()}\n${failLines(o3)}`);
  else ok("yedekte BAĞLA: kalibrasyon ölçüldü ve yalnız yedeğin GUID'ine yazıldı");
  state.activeGuid = orig.guid;
  mockGen++;
  const o4 = await clickAndWait("btn-bind", yes, doneRe);
  const tx2 = txOf("BAĞLA: kalibrasyon").length;
  if (!/✓ BAĞLA tamam/.test(o4) || tx2 - tx1 !== CAL_TX.length || calKeys() !== [copy.guid, orig.guid].sort().join()) fail(`asılda BAĞLA / kalibrasyon: ${calKeys()}\n${failLines(o4)}`);
  else ok("asılda BAĞLA: yedeğin kalibrasyonunu KULLANMADI, kendi ölçtü (kayıtlar GUID'e bağlı, adla karışmaz)");
};

scenarios.trlr_migration = async () => {
  // M1 (inceleme #9): v1.0.0'ın TOPLA'sı eşlemenin TAMAMINI kaydediyordu → yükseltmede kayıtlı "Zoom TrLR → A3" bir kez "Sil"e
  // çevrilir; kullanıcı sonra A3'ü seçerse o seçim kalır (yeniden çevrilmez)
  setupSync(sep23());
  lsStore.set("spread.sourceMap.v1", JSON.stringify({ "Zoom Tr1": 0, "Zoom Tr2": 1, "Zoom TrLR": 2, DJI: 3 }));
  await scan();
  if (selectOf("Zoom TrLR")?.value !== "sil" || lsStore.get("spread.sourceMap.v11") !== "1" || !/"Zoom TrLR":"sil"/.test(lsStore.get("spread.sourceMap.v1") ?? ""))
    fail(`geçiş: TrLR=${selectOf("Zoom TrLR")?.value}, bayrak=${lsStore.get("spread.sourceMap.v11")}, kayıt=${lsStore.get("spread.sourceMap.v1")}`);
  else ok("yükseltme: v1.0.0'dan kalan 'Zoom TrLR → A3' bir kez 'Sil'e çevrildi (günlükte not)");
  await setMap("Zoom TrLR", 2);
  await scan();
  if (selectOf("Zoom TrLR")?.value !== "2") fail(`geçişten sonra kullanıcı seçimi korunmadı: ${selectOf("Zoom TrLR")?.value}`);
  else ok("geçişten sonra kullanıcının 'Zoom TrLR → A3' seçimi kalıcı (yeniden çevrilmez)");
  lsStore.clear();
};

scenarios.helper_persist = async () => {
  // yardımcı arka sekmedeyken de bellekte kalsın: ExtendScript app.setExtensionPersistent(id, 1)
  setupSync(smallSpec());
  const h = await startHelper();
  const r = await h.persist("com.badideagency.spread.helper.panel");
  if (r !== true || h.state().persistent !== true || JSON.stringify(counters.persist) !== JSON.stringify(["com.badideagency.spread.helper.panel", 1]))
    fail(`persist: ${r} ${JSON.stringify(counters.persist)}`);
  else ok('yardımcı: app.setExtensionPersistent("com.badideagency.spread.helper.panel", 1) → state.persistent = true');
};

scenarios.trimcal_rules = async () => {
  // saf kalibrasyon kuralları (trimcal.ts) — gerçek raporun sayılarıyla
  const T = require(path.join(DIST, "src", "trimcal.js"));
  const L = 394436044800000n; // A038C001: 1552.80 sn
  const piece = 589317120000n; // 2.32 sn
  const q = 1724048880640000n;
  const f0 = { start: q, end: q + L, inPt: 0n, outPt: L };
  const target = { start: q, end: q + piece, inPt: 0n, outPt: piece };
  const REAL = { out: [0, 1, 0, 1], end: [0, 1, 0, 1], in: [1, 0, 1, 0], start: [1, 0, 1, 0] };
  // eski kodun 4 action'ı "fark ilk hâlden, toplanır" modelinde: out = L + 2 × (piece − L)
  let r = { ...f0 };
  for (const [a, v] of [["end", target.end], ["start", target.start], ["in", target.inPt], ["out", target.outPt]]) {
    const d = v - f0[T.FIELD[a]];
    ["start", "end", "inPt", "outPt"].forEach((f, i) => (r[f] += BigInt(REAL[a][i]) * d));
  }
  if (r.outPt !== -393257410560000n) fail(`model: eski 4 action → out ${r.outPt}`);
  else ok("model: End+Start+In+Out 'fark ilk hâlden, toplanır' → out = −393257410560000 (gerçek okuma)");
  const ch = T.chooseRule(REAL);
  if (!ch.rule || ch.rule.tail !== "out" || ch.rule.head.join("+") !== "in") fail(`gerçek etkiler → kural ${JSON.stringify(ch)}`);
  const p = T.planTrim(f0, target, ch.rule, REAL);
  if (p.problem || p.steps.length !== 1 || p.steps[0].act !== "out" || p.steps[0].value !== piece || p.result.outPt !== piece || p.result.end !== q + piece)
    fail(`planTrim(ilk parça) → ${JSON.stringify(p, (k, v) => (typeof v === "bigint" ? String(v) : v))}`);
  else ok("planTrim: ilk parça → tek adım SetOutPoint(2.32 s); baş farkı 0 → action yok; önceden hesaplanan sonuç = hedef");
  // orta parça: iki kenar, farklı alanlar → toplanır
  const mid = { start: q + 100n, end: q + 900n, inPt: 100n, outPt: 900n };
  const pm = T.planTrim(f0, mid, ch.rule, REAL);
  if (pm.problem || pm.steps.map((x) => x.act).join(",") !== "in,out") fail(`orta parça: ${pm.problem} ${pm.steps.map((x) => x.act)}`);
  else ok("planTrim: orta parça → SetInPoint + SetOutPoint (kenar başına bir), toplam etki = hedef");
  // kural çıkmayan / farklı durumlar
  const cases = [
    [{ out: [0, 0, 0, 0], end: [0, 0, 0, 0], in: [0, 0, 0, 0], start: [0, 0, 0, 0] }, null],
    [{ out: [0, 0, 0, 1], end: [0, 1, 0, 1], in: [0, -1, 1, 0], start: [1, 1, 0, 0] }, "end|in+start"],
    [{ out: [0, 1, 0, 1], end: [1, 1, 0, 0], in: [0, -1, 1, 0], start: [1, 0, 1, 0] }, "out|start"],
    [{ out: [0, 1, 0, 1], end: [0, 1, 0, 1], in: [1, 1, 1, 0], start: [1, 1, 0, 0] }, null],
  ];
  let bad = 0;
  for (const [vec, want] of cases) {
    const c = T.chooseRule(vec);
    const got = c.rule ? `${c.rule.tail}|${c.rule.head.join("+")}` : null;
    if (got !== want) (bad++, fail(`chooseRule(${JSON.stringify(vec)}) → ${got}, beklenen ${want}`));
  }
  if (!bad) ok("chooseRule: hiç etki yok → kural yok; End-yalnız kuyruk / In+Start baş / Start baş seçildi; uygunsuz etkiler → kural yok");
  const bad2 = T.planTrim(f0, target, { tail: "end", head: ["in"] }, { ...REAL, end: [0, 1, 0, 0] });
  if (!bad2.problem || !/toplam etki hedefi vermiyor/.test(bad2.problem)) fail(`planTrim tutmayan etkiyi yakalamadı: ${bad2.problem}`);
  else ok("planTrim: önceden hesaplanan sonuç hedefi vermiyorsa (ör. End yalnız end'i değiştiriyor) → sorun, transaction kurulmaz");
  const mv = T.measureVec({ start: 0n, end: 100n, inPt: 0n, outPt: 100n }, { start: 0n, end: 75n, inPt: 0n, outPt: 75n }, -25n);
  const mvBad = T.measureVec({ start: 0n, end: 100n, inPt: 0n, outPt: 100n }, { start: 0n, end: 76n, inPt: 0n, outPt: 75n }, -25n);
  if (!mv || mv.join() !== "0,1,0,1" || mvBad !== null) fail(`measureVec: ${mv} / ${mvBad}`);
  else ok("measureVec: tam kat → etki vektörü; tam kat olmayan fark (ör. kareye yuvarlama) → null");
  const TPS_ = 254016000000n;
  const frames_ = [24n, 25n, 30n, 48n, 50n, 60n, 120n].map((f) => TPS_ / f).concat([(TPS_ * 1001n) / 30000n, (TPS_ * 1001n) / 24000n, (TPS_ * 1001n) / 60000n]);
  let dBad = [];
  for (const len of [L, TPS_, TPS_ / 2n, TPS_ / 10n, 3n * TPS_ + 12345n]) {
    const d = T.calDelta(len, TPS_);
    if (d === null || d >= TPS_ || d > len / 4n || frames_.some((f) => d % f === 0n) || d % (TPS_ / 48000n) !== 0n || d % (TPS_ / 44100n) !== 0n) dBad.push(`${len}→${d}`);
  }
  if (dBad.length) fail(`calDelta: ${dBad.join(", ")}`);
  else ok("calDelta: < 1 sn, ≤ boy/4, 44.1/48 kHz örnek ızgarasında, hiçbir yaygın kare hızında (24…120, NTSC) kare sınırına düşmüyor");
};

scenarios.calib_cache = async () => {
  // kalibrasyon sequence başına bir kez; Premiere sürümü değişince yeniden
  const collected = await collectThen(smallSpec());
  await startHelper();
  const o1 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(o1) || !/KALİBRASYON SONUCU \(kanıtlanmış — Premiere 26\.5\.1/.test(o1)) return fail("ilk BAĞLA kalibre etmedi:\n" + failLines(o1));
  const rec = JSON.parse(lsStore.get("spread.trimCal.v1") ?? "{}")["guid-main-edit"];
  if (!rec || rec.host !== "26.5.1" || rec.rule.tail !== "out" || rec.rule.head.join() !== "in") fail(`kalibrasyon kaydı: ${JSON.stringify(rec)}`);
  else ok("kalibrasyon kaydı sequence başına saklandı (Premiere 26.5.1, kuyruk = Out, baş = In)");
  const n = txOf("BAĞLA").length;
  for (let i = 0; i < 4; i++) undo(); // BAĞLA'nın kesimlerini geri al (kalibrasyon adımları düzeni değiştirmemişti)
  let q = "";
  const o2 = await clickAndWait("btn-bind", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ BAĞLA tamam/.test(o2) || txOf("BAĞLA").slice(n).some((x) => /kalibrasyon/.test(x)) || !/Kırpma: bu sequence'ta ölçülmüş kural/.test(q))
    fail("ikinci BAĞLA kayıtlı kalibrasyonu kullanmadı:\n" + failLines(o2) + "\n" + txOf("BAĞLA").slice(n).join(", "));
  else ok("aynı sequence'ta ikinci BAĞLA: kayıtlı kural (onayda yazıyor), kalibrasyon adımı yok");
  for (let i = 0; i < 4; i++) undo();
  // bozuk kayıt (ölçümden aynı kural çıkmıyor) → kullanılmaz, yeniden ölçülür
  const all = JSON.parse(lsStore.get("spread.trimCal.v1"));
  all["guid-main-edit"].vec.out = [0, 0, 0, 1];
  lsStore.set("spread.trimCal.v1", JSON.stringify(all));
  const k = txOf("BAĞLA").length;
  const ob = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(ob) || !txOf("BAĞLA").slice(k).includes("BAĞLA: kalibrasyon kopyaları")) fail("bozuk kalibrasyon kaydı kullanıldı:\n" + failLines(ob));
  else ok("bozuk kalibrasyon kaydı (etkilerden aynı kural çıkmıyor) kullanılmadı → yeniden ölçüldü");
  for (let i = 0; i < 4; i++) undo();
  M.hostVersion = "26.6.0";
  const m = txOf("BAĞLA").length;
  const o3 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(o3) || !txOf("BAĞLA").slice(m).includes("BAĞLA: kalibrasyon kopyaları") || !/Premiere 26\.6\.0/.test(o3))
    fail("Premiere sürümü değişince yeniden ölçülmedi:\n" + failLines(o3));
  else ok("Premiere sürümü değişti (26.5.1 → 26.6.0) → yeniden kalibre edildi");
  for (let i = 0; i < 4; i++) undo();
  M.hostVersion = null; // sürüm okunamıyor → "?" → ölçüm saklanmaz, her BAĞLA'da yeniden
  lsStore.delete("spread.trimCal.v1");
  const h = txOf("BAĞLA").length;
  const o4 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(o4) || !txOf("BAĞLA").slice(h).includes("BAĞLA: kalibrasyon kopyaları") || !/SAKLANMADI, her BAĞLA'da yeniden ölçülür/.test(o4) || lsStore.get("spread.trimCal.v1"))
    fail("Premiere sürümü okunamazken kalibrasyon saklandı / ölçülmedi:\n" + failLines(o4));
  else ok("Premiere sürümü okunamıyor ('?') → ölçüldü ama SAKLANMADI (sürüm değişikliği fark edilemez)");
  checkExactly(seqByGuid("guid-main-edit"), expectBagla(collected, SMALL).exp, "üçüncü BAĞLA düzeni");
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
  lsStore.set("spread.sourceMap.v1", JSON.stringify({ "Zoom TrLR": 2 })); // v1.1.0: TrLR varsayılanı "Sil" — bu senaryo TrLR'yi A3'e eşleyen kullanıcıyı sınar
  lsStore.set("spread.sourceMap.v11", "1"); // v1.1.0 geçişi yapılmış: kullanıcı TrLR'yi bilerek A3'e eşlemiş
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
  // ses tarafı: ayrılamayanların WAV'ları ve kılavuz sesleri de A park track'lerinde (A1 Tr1, A2–A3 kılavuz → park A4+), zaman aynı
  const wantA = (n) => (n === "260912_100000_Tr1.WAV" ? sec(95) : n === "260912_110000_Tr1.WAV" ? sec(198) : /A038C001|C0101/.test(n) ? sec(100) : sec(200));
  const pa = S.a.flatMap((tr, t) => tr.map((c) => ({ t, c }))).filter((x) => /^260912_1[01]0000|A038C00[12]|C010[12]/.test(x.c.name));
  if (pa.length !== 6 || !pa.every((x) => x.t >= 3 && x.c.start === wantA(x.c.name))) fail(`ayrılamayanların sesleri park'ta değil / zamanı değişti: ${pa.map((x) => `A${x.t + 1} ${x.c.name} ${secOf(x.c.start)}`).join(", ")}`);
  else ok("ayrılamayanların 2 WAV'ı ve 4 kılavuz sesi de A park track'lerinde (A4+), ZAMANI AYNI");
  const o3 = S.v.flat().filter((c) => /A038C003|C0103/.test(c.name));
  if (o3.length !== 2 || o3.some((c) => c.start !== 0n && c.start !== ceilF(sec(5)))) fail(`ayrık oturum başa dizilmedi: ${o3.map((c) => secOf(c.start)).join(", ")}`);
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
  if (!/✓ TOPLA tamam: 2 oturum/.test(out)) return fail("iki oturuma ayrılmadı:\n" + out.split("\n").slice(-5).join("\n"));
  ok("iki ayrı oturum, sırayla dizildi");
  const pre = JSON.parse(JSON.stringify(undoStack[0]), rev).sequences.find((x) => x.guid === "guid-main-edit");
  const members = [["260912_100000", "A038C001_260912AA", "C0101"], ["260912_110000", "A038C002_260912BB", "C0102"]];
  checkExactly(seqByGuid("guid-main-edit"), expectTopla(pre, { sessions: members, devices: ["A", "Sony"], srcTrack: { "Zoom Tr1": 0 } }).exp, "veto ayrımı: üyeler {100000+C001+C0101}, {110000+C002+C0102}, bloklar ayrık");
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
  // 'Evet' → senkronun bıraktığı (timeline) sıra kullanılır, bloklar yine ayrık ve blok içi tick-exact
  const out2 = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✓ TOPLA tamam: 2 oturum/.test(out2)) return fail("'Evet' sonrası TOPLA tamamlanmadı:\n" + out2.split("\n").slice(-5).join("\n"));
  const pre = JSON.parse(JSON.stringify(undoStack[0]), rev).sequences.find((x) => x.guid === "guid-main-edit");
  const members = [["260912_100000", "A038C002_260912AA", "C0101"], ["260912_110000", "A038C001_260912BB", "C0102"]];
  checkExactly(seqByGuid("guid-main-edit"), expectTopla(pre, { sessions: members, devices: ["A", "Sony"], srcTrack: { "Zoom Tr1": 0 } }).exp, "sıra çelişkisinde 'Evet' → timeline sırası (onaydaki sıra)");
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
  lsStore.set("spread.sourceMap.v1", JSON.stringify({ "Zoom TrLR": 2 })); // v1.1.0: TrLR varsayılanı "Sil" — bu senaryo TrLR'yi A3'e eşleyen kullanıcıyı sınar
  lsStore.set("spread.sourceMap.v11", "1"); // v1.1.0 geçişi yapılmış: kullanıcı TrLR'yi bilerek A3'e eşlemiş
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
  if (!/Ayar TOPLA'dan sonra değişti — TOPLA'ya tekrar bas/.test(o1) || !/kaynak eşlemesi: Zoom TrLR TOPLA'da A3, şimdi sil/.test(o1) || txOf("BAĞLA").length)
    fail("eşleme değişince BAĞLA 'önce TOPLA' demedi:\n" + o1.split("\n").slice(-4).join("\n"));
  else ok("kaynak eşlemesi TOPLA'dan sonra değişti → BAĞLA 'TOPLA'ya tekrar bas' (TOPLA kaydıyla karşılaştırıldı; hiçbir şey değişmedi)");
  await setMap("Zoom TrLR", 2);
  const out2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(out2)) return fail("BAĞLA tamamlanmadı:\n" + out2.split("\n").filter((l) => /DURDU|•|HATA/.test(l)).join("\n"));
  const eb = expectBagla(collected, spec.members, []);
  checkExactly(seqByGuid("guid-main-edit"), eb.exp, "sentetik BAĞLA");
  checkLinks(seqByGuid("guid-main-edit"), eb.groups, "sentetik bağlar");
  const n = txOf("BAĞLA").length;
  for (let i = 0; i < 4; i++) undo();
  if (n !== 5 + CAL_TX.length || txOf("BAĞLA").slice(1, 1 + CAL_TX.length).join(",") !== CAL_TX.join(",")) fail(`BAĞLA transaction'ları: ${txOf("BAĞLA").join(", ")}`);
  else ok("BAĞLA: yedek → KALİBRASYON (kopyalar, 4 action ayrı ayrı, kopyaları sil) → kesim hazırlığı → ilk parça → parçalar → yerleştir");
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

scenarios.setnoop = async () => {
  await collectThen(smallSpec());
  const afterCollect = mainTracks();
  await startHelper();
  M.setSem = "noop";
  const out = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✗ BAĞLA DURDU: KALİBRASYON TUTARLI BİR KURAL VERMEDİ — hiçbir kesim yapılmadı/.test(out) || !/YEDEK PLAN \(Spread Helper'da QE razor\)/.test(out))
    fail("set action'lar hiçbir şey yapmayınca kalibrasyon yedek plana düşmedi:\n" + failLines(out));
  else ok("set action'lar hiçbir şey yapmadı → KALİBRASYON kural vermedi → YEDEK PLAN açıkça yazıldı, kesim yok");
  if (!/SetOutPoint tek başına .*okunan fark start \+0, end \+0, inPt \+0, outPt \+0/.test(out) || !/kuyruk: ne SetOutPoint ne SetEnd/.test(out))
    fail("ölçümler raporda yok:\n" + failLines(out));
  else ok("ölçümler raporda: her action'ın okunan farkı + neden kural çıkmadı");
  if (txOf("BAĞLA").join(",") !== ["BAĞLA: yedek sequence", ...CAL_TX_NORULE].join(",") || counters.links) fail(`kalibrasyondan sonra devam etti: ${txOf("BAĞLA").join(", ")}`);
  if (mainTracks() !== afterCollect) fail("kalibrasyon düzeni değiştirdi");
  else ok("kalibrasyon kopyaları silindi → düzen TOPLA sonrasıyla birebir (geri almaya gerek yok)");
  if (/Ctrl\+Z'ye \d+ kez bas/.test(out) || !/Yapılan adımlar \(6\): .*Bu adımlar düzeni DEĞİŞTİRMEDİ .*geri alman GEREKMEZ/s.test(out))
    fail("geri alma notu yanlış / çelişkili:\n" + out.split("\n").slice(-4).join("\n"));
  else ok("rapor çelişkisiz: 6 kalibrasyon adımı bildirildi, 'düzen değişmedi, geri alman GEREKMEZ' (Ctrl+Z talimatı yok)");
  const n = txOf("BAĞLA").length;
  M.setSem = "real";
  const out2 = await clickAndWait("btn-bind", yes, doneRe);
  if (/YARIM hâlde/.test(out2) || !/✓ BAĞLA tamam/.test(out2) || !txOf("BAĞLA").slice(n).includes("BAĞLA: kalibrasyon kopyaları"))
    fail("kalibrasyon yedek plana düştükten sonra tekrar basınca BAĞLA (yeniden ölçerek) çalışmadı:\n" + out2.split("\n").slice(-12).join("\n"));
  else ok("tekrar bas → 'yarım iş' sanılmadı, kalibrasyon kaydedilmediği için yeniden ölçüldü, BAĞLA tamam");
};

scenarios.setlastwins = async () => {
  // her action tek başına doğru ama aynı klibe iki action (baş + kuyruk) tek transaction'da toplanmıyor → kalibrasyonun "birlikte"
  // adımı yakalar → kural yok → YEDEK PLAN; gerçek parçalara hiç dokunulmaz
  await collectThen(smallSpec());
  const afterCollect = mainTracks();
  await startHelper();
  M.setSem = "lastwins";
  const out = await clickAndWait("btn-bind", yes, doneRe);
  if (!/KALİBRASYON TUTARLI BİR KURAL VERMEDİ/.test(out) || !/BİRLİKTE .*hedef TUTMADI/.test(out) || !/"etkiler toplanır" varsayımını tutmadı/.test(out) || mainTracks() !== afterCollect || txOf("BAĞLA").includes("BAĞLA: kesim hazırlığı"))
    fail("baş + kuyruk birlikte toplanmayınca kalibrasyon yakalamadı:\n" + failLines(out));
  else ok("tek başına her action doğru, ama baş + kuyruk birlikte toplanmıyor → kalibrasyonun 'birlikte' adımı yakaladı → YEDEK PLAN, kesim yok, düzen aynı");
};

scenarios.setsnap = async () => {
  // set değerleri kareye yuvarlanırsa (kare arasına düşen ses kenarları kesilemez) → kalibrasyon tam kat görmez → yedek plan
  await collectThen(smallSpec());
  const afterCollect = mainTracks();
  await startHelper();
  M.setSem = "snap";
  const out = await clickAndWait("btn-bind", yes, doneRe);
  if (!/KALİBRASYON TUTARLI BİR KURAL VERMEDİ/.test(out) || !/tam kat DEĞİL/.test(out) || mainTracks() !== afterCollect)
    fail("kareye yuvarlayan set action'lar kalibrasyonda yakalanmadı:\n" + failLines(out));
  else ok("set değerleri kareye yuvarlanıyor → kalibrasyon (δ kare arasına düşer) tam kat görmedi → YEDEK PLAN, düzen aynı");
};

// kalibrasyon hangi kuralı seçmeli (mock anlamına göre): real → Out + In; trim (v0.3.3 tahmini) → Out + Start; move → Out + In+Start
const SEM_RULE = { real: "kuyruk = SetOutPoint, baş = SetInPoint", trim: "kuyruk = SetOutPoint, baş = SetStart", move: "kuyruk = SetOutPoint, baş = SetInPoint \\+ SetStart", endmove: "kuyruk = SetOutPoint, baş = SetStart" };
for (const sem of ["trim", "move", "endmove"])
  scenarios["set" + sem] = async () => {
    // aynı Zoom kaydının ikinci kanalı: aynı senkron konumu (in − start aynı), farklı boy
    const spec = smallSpec({ wavs: [...smallSpec().wavs, { name: "260912_101512_Tr2.WAV", start: sec(8) + 12345n, dur: sec(79), inPt: sec(3) }] });
    const collected = await collectThen(spec);
    await startHelper();
    M.setSem = sem;
    const out = await clickAndWait("btn-bind", yes, doneRe);
    if (!/✓ BAĞLA tamam/.test(out)) fail(`set anlamı '${sem}' iken BAĞLA tamamlanmadı:\n` + out.split("\n").filter((l) => /DURDU|•/.test(l)).join("\n"));
    if (!new RegExp(`seçilen kural: ${SEM_RULE[sem]}`).test(out)) fail(`set anlamı '${sem}': kalibrasyon beklenen kuralı seçmedi:\n` + out.split("\n").filter((l) => /tek başına|kural/.test(l)).join("\n"));
    else ok(`set anlamı '${sem}': kalibrasyon → ${SEM_RULE[sem].replace("\\", "")}`);
    checkExactly(seqByGuid("guid-main-edit"), expectBagla(collected, SMALL).exp, `set anlamı '${sem}' (+ set sonrası ezme) iken de parçalar doğru`);
  };

scenarios.linkfail = async () => {
  const collected = await collectThen(smallSpec());
  await startHelper();
  M.linkFailName = "C0102.MP4";
  const out = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✗ BAĞLA DURDU: 1\/2 grup bağlanamadı \(kesme\/silme doğru ve yerinde\)/.test(out) || !/linkSelection false döndü/.test(out)) fail("başarısız bağlama raporlanmadı:\n" + out);
  else ok("bir grubun linkSelection'ı false → hangi grup, neden");
  // yardımcı düzelince tekrar bas → kesilmiş düzen yeniden ANALİZ EDİLMEZ, kayıttaki gruplarla yalnız bağlama
  M.linkFailName = null;
  const n = counters.txNames.length;
  let q = "";
  const out2 = await clickAndWait("btn-bind", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ BAĞLA tamam/.test(out2) || counters.txNames.length !== n || !/kayıttaki gruplar kullanılır/.test(q)) fail("tekrar basınca yalnız bağlama yapılmadı:\n" + out2.split("\n").slice(-5).join("\n"));
  else ok("tekrar bas → kayıttaki gruplarla YALNIZ bağlama (yeniden analiz / kesim / yedek yok)");
  checkLinks(seqByGuid("guid-main-edit"), expectBagla(collected, SMALL).groups, "tekrar basınca bağlar");
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

// ------------------------------------------------------------ inceleme #2 — adversaryal senaryolar
const preOf = () => JSON.parse(JSON.stringify(undoStack[0]), rev).sequences.find((x) => x.guid === "guid-main-edit");
const clipNamed = (re) => allClips(seqByGuid("guid-main-edit")).filter((x) => re.test(x.c.name));
const failLines = (out) => out.split("\n").filter((l) => /DURDU|•|HATA|ÇAKIŞMA|AYRIL|SIRA/.test(l)).join("\n");

scenarios.adv_camonly = async () => {
  // harici ses YOK, iki oturum timeline'da ters sırada; her kamera kendi track'inde (A038C001 V3'te = "park" sanılabilecek yer)
  const members = [["A038C001_260912AA", "C0101"], ["A038C002_260912BB", "C0102"]];
  setupSync({
    cams: [
      { name: "A038C002_260912BB.MP4", start: sec(0), dur: sec(40) },
      { name: "C0102.MP4", start: sec(1), dur: sec(38) },
      { name: "A038C001_260912AA.MP4", start: sec(100), dur: sec(40) },
      { name: "C0101.MP4", start: sec(101), dur: sec(38) },
    ],
    wavs: [],
    others: [],
  });
  let q = "";
  const out = await clickAndWait("btn-collect", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ TOPLA tamam: 2 oturum/.test(out)) return fail("kamera-yalnız iki oturum toplanmadı:\n" + failLines(out));
  const lines = q.split("\n").filter((l) => /^ {2}O\d/.test(l));
  if (lines.length !== 2 || !/A038C001/.test(lines[0]) || !/A038C002/.test(lines[1])) fail(`oturumlar/sıra yanlış:\n${lines.join("\n")}`);
  else ok("harici sessiz, ilk kez toplanan düzen: iki oturum da bulundu (hiçbiri park sanılmadı), sıra A038C001 → A038C002");
  checkExactly(seqByGuid("guid-main-edit"), expectTopla(preOf(), { sessions: members, devices: ["A", "Sony"], srcTrack: {} }).exp, "kamera-yalnız TOPLA");
  const collected = snapList();
  await startHelper();
  const out2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(out2)) return fail("BAĞLA tamamlanmadı:\n" + failLines(out2));
  const eb = expectBagla(collected, members);
  checkExactly(seqByGuid("guid-main-edit"), eb.exp, "kamera-yalnız BAĞLA (kamera sesleri korundu)");
  checkLinks(seqByGuid("guid-main-edit"), eb.groups, "kamera-yalnız bağlar");
};

scenarios.adv_after = async () => {
  // (a) KESİMLİ BAĞLA'dan sonra: TOPLA SORAR (v1.2.1: kilit değil; senkron kanıtı kesildi) → Vazgeç = hiçbir şey; BAĞLA geri
  //     alınınca her şey normal
  const collected = await collectThen(smallSpec());
  await startHelper();
  const o1 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(o1)) return fail("BAĞLA tamamlanmadı:\n" + failLines(o1));
  const bound = JSON.stringify(state.sequences, repl);
  const n = counters.txNames.length;
  let tq = "";
  const o2 = await clickAndWait("btn-collect", async (x) => ((tq = els["ask-title"].textContent + " | " + x), no()), doneRe);
  if (!/^Topla yine de çalıştırılsın mı\? \| Bu sequence'ta Bağla zaten yapılmış görünüyor: sesler kesildi/.test(tq) || !/İptal edildi/.test(o2) || JSON.stringify(state.sequences, repl) !== bound || counters.txNames.length !== n)
    fail("kesimli BAĞLA'dan sonra TOPLA sormadı / değiştirdi:\n" + tq + "\n" + o2.split("\n").slice(-4).join("\n"));
  else ok("kesimli BAĞLA'dan sonra TOPLA → kilit değil SORU ('Bağla zaten yapılmış görünüyor'); Vazgeç → hiçbir şey değişmedi");
  for (let i = 0; i < 4; i++) undo();
  const o3 = await clickAndWait("btn-collect", yes, doneRe);
  if (!/Zaten toplanmış/.test(o3)) fail("BAĞLA geri alınınca TOPLA 'zaten toplanmış' demedi:\n" + o3.split("\n").slice(-4).join("\n"));
  const o4 = await clickAndWait("btn-bind", yes, doneRe);
  // ikinci BAĞLA aynı sequence'ta: kalibrasyon kayıttan (yeniden ölçülmez) → 5 + 6 + 5
  if (!/✓ BAĞLA tamam/.test(o4) || txOf("BAĞLA").length !== 10 + CAL_TX.length || !/Kırpma kuralı \(bu sequence'ta .* ölçüldü/.test(o4))
    fail("geri alınan BAĞLA yeniden (kesimle, kayıtlı kalibrasyonla) yapılamadı:\n" + failLines(o4) + "\n" + txOf("BAĞLA").join(", "));
  else ok("BAĞLA Ctrl+Z ile tamamen geri alınınca: TOPLA 'zaten toplanmış', BAĞLA yeniden tam (kesimle) çalıştı");
  checkExactly(seqByGuid("guid-main-edit"), expectBagla(collected, SMALL).exp, "yeniden BAĞLA düzeni");

  // (b) KESİMSİZ BAĞLA (yalnız kılavuz silme + bağlama) sonrası TOPLA: çerçeve kayar (A cihazının kılavuzları silindi) → korunan
  //     kamera sesleri videolarıyla BİRLİKTE yeni track'e geçer (zaman aynı), onayda uyarı; sonra BAĞLA yeniden bağlar
  const members = [["260912_101512", "A038C001_260912AA", "C0101"], ["B001C001_260912XX", "C0102"]];
  setupSync({
    cams: [
      { name: "A038C001_260912AA.MP4", start: sec(10), dur: sec(30) },
      { name: "C0101.MP4", start: sec(12), dur: sec(20) },
      { name: "B001C001_260912XX.MP4", start: sec(100), dur: sec(30) },
      { name: "C0102.MP4", start: sec(101), dur: sec(28) },
    ],
    wavs: [{ name: "260912_101512_Tr1.WAV", start: sec(10), dur: sec(30) }], // çapayı birebir kapsar: kesim yok
    others: [],
  });
  const t1 = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✓ TOPLA tamam: 2 oturum/.test(t1)) return fail("(b) TOPLA tamamlanmadı:\n" + failLines(t1));
  const b1 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(b1) || txOf("BAĞLA").join(",") !== "BAĞLA: yedek sequence,BAĞLA: kesim hazırlığı") return fail("(b) kesimsiz BAĞLA beklenenden farklı:\n" + failLines(b1) + "\n" + txOf("BAĞLA"));
  let q = "";
  const t2 = await clickAndWait("btn-collect", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ TOPLA tamam/.test(t2) || !/DİKKAT: bu sequence BAĞLA'dan geçti \(kesimsiz\)/.test(q)) return fail("(b) kesimsiz BAĞLA sonrası TOPLA uyarısız / tamamlanmadı:\n" + q + "\n" + failLines(t2));
  const vid = clipNamed(/^B001C001/).find((x) => x.kind === "V");
  const gd = clipNamed(/^B001C001/).find((x) => x.kind === "A");
  // çerçeve: Sony V1 (48 sn), A V2 / B V3 (30 sn, alfabetik); Tr1 A1; korunan kamera sesi A2; kılavuzlar: Sony A3, A (0 kanal), B A4
  if (!vid || !gd || gd.c.start !== vid.c.start || gd.c.end !== vid.c.end || gd.track !== 3 || vid.track !== 2) fail(`korunan kamera sesi videosundan ayrı düştü: V${vid && vid.track + 1} ${vid && secOf(vid.c.start)} / A${gd && gd.track + 1} ${gd && secOf(gd.c.start)}`);
  else ok("kesimsiz BAĞLA sonrası TOPLA: onayda uyarı; B001C001'in korunan sesi A5 → A4, videosuyla aynı zamanda (kayma yok)");
  const collected2 = snapList();
  const b2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(b2)) return fail("(b) ikinci BAĞLA tamamlanmadı:\n" + failLines(b2));
  checkLinks(seqByGuid("guid-main-edit"), expectBagla(collected2, members).groups, "TOPLA'dan sonra yeniden bağlar");
};

scenarios.adv_remap = async () => {
  // sahipsiz DJI klibi (eşsiz, 2 sn) ilk TOPLA'da park'a gider (zamanı aynı: 20 sn). Oturum sequence başına taşınınca DJI'nin zamanı
  // oturumun Zoom kaydının ve A038C001'in İÇİNE düşer. Eşleme değişip TOPLA tekrar basılınca DJI oturuma KARIŞMAMALI (kayıttan park).
  const base = smallSpec();
  const shift = sec(300);
  setupSync({
    cams: base.cams.map((c) => ({ ...c, start: c.start + shift })),
    wavs: [...base.wavs.map((w) => ({ ...w, start: w.start + shift })), { name: "DJI_09_20260912_090000.WAV", start: sec(20), dur: sec(2) }],
    others: [],
  });
  let q = "";
  const o1 = await clickAndWait("btn-collect", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ TOPLA tamam: 1 oturum/.test(o1) || !/Park track'lerine .*DJI_09/.test(q)) return fail("ilk TOPLA: DJI sahipsiz park edilmedi:\n" + q + "\n" + failLines(o1));
  const d1 = clipNamed(/^DJI_09/)[0];
  if (d1.c.start !== sec(20) || d1.track < 4) return fail(`DJI park'ta değil: A${d1.track + 1} ${secOf(d1.c.start)}`);
  ok("ilk TOPLA: eşsiz DJI park track'inde (A5), zamanı aynı (20 sn) — artık oturumun Zoom kaydının içinde");
  await setMap("Zoom Tr1", 2); // Tr1 → A3: çerçeve büyür (park A6'ya kayar)
  const qs = [];
  const o2 = await clickAndWait("btn-collect", async (x) => (qs.push(x), yes()), doneRe);
  if (!/✓ TOPLA tamam: 1 oturum/.test(o2) || qs.some((x) => /ŞÜPHELİ|DJI_09.*↔|O1 .*DJI/.test(x))) return fail("eşleme değişince DJI oturuma karıştı / TOPLA tamamlanmadı:\n" + qs.join("\n---\n") + "\n" + failLines(o2));
  const d2 = clipNamed(/^DJI_09/)[0];
  if (d2.c.start !== sec(20) || d2.c.end !== sec(22) || d2.track < 5) fail(`DJI yeniden park edilmedi: A${d2.track + 1} ${secOf(d2.c.start)}`);
  else ok("eşleme değişti, TOPLA tekrar: DJI oturuma KARIŞMADI (TOPLA kaydından park), yeni park track'inde (A6), zamanı aynı");
  await startHelper();
  const o3 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(o3)) return fail("BAĞLA tamamlanmadı:\n" + failLines(o3));
  const d3 = clipNamed(/^DJI_09/);
  if (d3.length !== 1 || d3[0].track !== d2.track || d3[0].c.start !== d2.c.start || d3[0].c.end !== d2.c.end || d3[0].c.linkId) fail("BAĞLA park'taki DJI'ye dokundu");
  else ok("BAĞLA park'taki DJI'ye dokunmadı");
};

scenarios.adv_ambig = async () => {
  // X = A038C001 + Zoom 100000; Z = A038C005 + Zoom 110000 (A ve Zoom: X < Z); Y = C0101 + DJI_01 (kısıtsız). Timeline: Z, Y, X.
  // Sıra belirsiz (Y'nin yeri) → SORULUR; önerilen sıra bilinen kısıta (X < Z) UYMALI: Y, X, Z (belirsiz yerde timeline)
  setupSync({
    cams: [
      { name: "A038C005_260912EE.MP4", start: sec(0), dur: sec(40) },
      { name: "C0101.MP4", start: sec(200), dur: sec(60) },
      { name: "A038C001_260912AA.MP4", start: sec(400), dur: sec(50) },
    ],
    wavs: [
      { name: "260912_110000_Tr1.WAV", start: sec(0), dur: sec(41) },
      { name: "DJI_01_20260912_120000.WAV", start: sec(199), dur: sec(62) },
      { name: "260912_100000_Tr1.WAV", start: sec(399), dur: sec(52) },
    ],
    others: [],
  });
  const qs = [];
  const out = await clickAndWait("btn-collect", async (x) => (qs.push(x), yes()), doneRe);
  const oq = qs.find((x) => /OTURUM SIRASI/.test(x)) ?? "";
  const used = oq.split("\n").filter((l) => /^ {2}O\d/.test(l));
  if (!/BELİRLENEMEDİ/.test(oq) || used.length !== 3 || !/C0101/.test(used[0]) || !/A038C001/.test(used[1]) || !/A038C005/.test(used[2]))
    return fail("belirsiz sıra sorulmadı / önerilen sıra kısıtlara uymuyor:\n" + oq);
  ok("sıra belirsiz → SORULDU; önerilen sıra Y, X, Z — bilinen kısıt (A ve Zoom: X < Z) korundu, belirsiz yer timeline'dan");
  if (!/✓ TOPLA tamam: 3 oturum/.test(out)) return fail("TOPLA tamamlanmadı:\n" + failLines(out));
  const members = [["C0101", "DJI_01_20260912_120000"], ["260912_100000", "A038C001_260912AA"], ["260912_110000", "A038C005_260912EE"]];
  checkExactly(seqByGuid("guid-main-edit"), expectTopla(preOf(), { sessions: members, devices: ["A", "Sony"], srcTrack: { "Zoom Tr1": 0, DJI: 1 } }).exp, "belirsiz sırada 'Evet' → Y, X, Z");
};

scenarios.adv_thr = async () => {
  // eşik TOPLA'dan sonra değişti → BAĞLA hiçbir şeye dokunmadan durur (düzenlemeden SONRA değil, ÖNCE)
  await collectThen(smallSpec());
  await startHelper();
  const thr = els["set-threshold"];
  thr.value = "95";
  thr.fire("change");
  const before = JSON.stringify(state.sequences, repl);
  const n = counters.txNames.length;
  const o = await clickAndWait("btn-bind", yes, doneRe);
  if (!/Ayar TOPLA'dan sonra değişti/.test(o) || !/güçlü bağ eşiği: TOPLA'da %90, şimdi %95/.test(o) || JSON.stringify(state.sequences, repl) !== before || counters.txNames.length !== n)
    fail("eşik değişince BAĞLA durmadı / bir şey değişti:\n" + o.split("\n").slice(-4).join("\n"));
  else ok("eşik TOPLA'dan sonra değişti → BAĞLA başlamadan DURDU (yedek bile yok), 'TOPLA'ya tekrar bas'");
  thr.value = "90";
  thr.fire("change");
  const o2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(o2)) fail("eşik geri alınınca BAĞLA çalışmadı:\n" + failLines(o2));
  else ok("eşik TOPLA'dakine dönünce BAĞLA normal");
};

scenarios.adv_zoomgeneric = async () => {
  // bilinmeyen desenli çok kanallı kayıt: ZOOM0001_Tr1 / ZOOM0001_Tr2 aynı kaydın kanalları → veto YOK, tek oturum
  setupSync(smallSpec({ wavs: [{ name: "ZOOM0001_Tr1.WAV", start: sec(8), dur: sec(80) }, { name: "ZOOM0001_Tr2.WAV", start: sec(8), dur: sec(80) }] }));
  await scan();
  const ids = (els.mapping?.children ?? []).map((r) => r.children?.[1]?.id);
  if (ids.join(",") !== "map-ZOOM Tr1,map-ZOOM Tr2") fail(`kaynaklar: ${ids}`);
  else ok("kaynak eşleme: 'ZOOM Tr1', 'ZOOM Tr2' (sondaki kanal eki ayrıldı)");
  let q = "";
  const out = await clickAndWait("btn-collect", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ TOPLA tamam: 1 oturum/.test(out) || /VETO|AYRILAMAYAN/.test(q)) return fail("ZOOM0001 kanalları veto üretti / TOPLA tamamlanmadı:\n" + q + "\n" + failLines(out));
  ok("ZOOM0001_Tr1 + ZOOM0001_Tr2 = aynı kaydın kanalları → veto yok, tek oturum");
  await startHelper();
  const o2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(o2)) fail("BAĞLA tamamlanmadı:\n" + failLines(o2));
  else ok("BAĞLA: iki kanal da çapalara kesilip bağlandı");
};

scenarios.adv_oversplit = async () => {
  // X={A001,Zoom1} ile Y={A002,Zoom2} 91 sn üst üste (veto). {C0101, DJI_01} X'e %91 bağlı gerçek bir alt grup: en zayıf (%91) bağları
  // kesmek vetoyu çözer AMA {C0101, DJI_01}'i de X'ten koparır (gereksiz kesim) → tek anlamlı değil → SORULMALI (tahmin yok)
  setupSync({
    cams: [
      { name: "A038C001_260912AA.MP4", start: sec(100), dur: sec(100) },
      { name: "A038C002_260912BB.MP4", start: sec(109), dur: sec(100) },
      { name: "C0101.MP4", start: sec(91), dur: sec(100) },
    ],
    wavs: [
      { name: "260912_100000_Tr1.WAV", start: sec(100), dur: sec(100) },
      { name: "260912_110000_Tr1.WAV", start: sec(109), dur: sec(100) },
      { name: "DJI_01_20260912_100100.WAV", start: sec(91), dur: sec(100) },
    ],
    others: [],
  });
  const before = JSON.stringify(state.sequences, repl);
  let q = "";
  const out = await clickAndWait("btn-collect", async (x) => ((q = x), no()), doneRe);
  if (!/AYRILAMAYAN OTURUM — tek anlamlı çözüm yok, TAHMİN EDİLMEDİ/.test(q) || /VETO: /.test(q)) fail("gereksiz kesim gerektiren veto SORULMADI:\n" + q);
  else ok("veto yalnız gerçek bir alt grubu da koparan kesimle çözülüyor → tek anlamlı değil → SORULDU");
  if (!/İptal edildi/.test(out) || JSON.stringify(state.sequences, repl) !== before) fail("'Hayır' sonrası bir şey değişti");
  else ok("'Hayır' → hiçbir şey değişmedi");
};

scenarios.adv_suspicious = async () => {
  // eşsiz 1 sn'lik DJI klibi uzun kayıtların (Zoom 80 sn, A038C001 30 sn, C0101 20 sn) içine düşmüş: tek kanıt içerilme → SORULUR;
  // Evet → park (zamanı aynı), BAĞLA dokunmaz
  setupSync(smallSpec({ wavs: [...smallSpec().wavs, { name: "DJI_09_20260912_090000.WAV", start: sec(30), dur: sec(1) }] }));
  const qs = [];
  const out = await clickAndWait("btn-collect", async (x) => (qs.push(x), yes()), doneRe);
  const sq = qs.find((x) => /ŞÜPHELİ ÜYE/.test(x));
  if (!sq || !/DJI_09_20260912_090000/.test(sq)) return fail("şüpheli üye sorulmadı:\n" + qs.join("\n---\n"));
  ok("1 sn'lik DJI yalnız çok uzun kayıtların içine düştüğü için bağlı → SORULDU");
  if (!/✓ TOPLA tamam: 1 oturum/.test(out)) return fail("TOPLA tamamlanmadı:\n" + failLines(out));
  const d1 = clipNamed(/^DJI_09/)[0];
  if (d1.c.start !== sec(30) || d1.track < 4) return fail(`DJI park'ta değil: A${d1.track + 1} ${secOf(d1.c.start)}`);
  ok("'Evet' → DJI park track'inde (A5), ZAMANI AYNI (30 sn)");
  await startHelper();
  const o2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(o2)) return fail("BAĞLA tamamlanmadı:\n" + failLines(o2));
  const d2 = clipNamed(/^DJI_09/);
  if (d2.length !== 1 || d2[0].track !== d1.track || d2[0].c.start !== d1.c.start || d2[0].c.end !== d1.c.end || d2[0].c.inPt !== d1.c.inPt || d2[0].c.linkId)
    fail("BAĞLA park'taki DJI'ye dokundu");
  else ok("BAĞLA park'taki DJI'ye dokunmadı (kesilmedi, silinmedi, bağlanmadı)");
};

scenarios.firstplace = async () => {
  // yalnız NEGATİF ofsetli clone 1 kare kayarsa: park doğru, ilk YERLEŞTİRMEDE (yalnız O1) DUR
  setupFromReport(R0912, ["A27", "A30"]);
  const before = mainTracks();
  M.cloneTimeBroken = "neg";
  const out = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✗ TOPLA DURDU: İLK TAŞIMA TUTMADI \(yerleştirme, O1/.test(out) || txOf("TOPLA").includes("TOPLA: yerleştir"))
    return fail("ilk yerleştirme ölçümü yakalanmadı:\n" + out.split("\n").slice(-6).join("\n"));
  ok("negatif ofsetli clone 1 kare kaydı → 'İLK TAŞIMA TUTMADI (yerleştirme)'; kalan yerleştirme yapılmadı");
  const m = /Ctrl\+Z'ye (\d+) kez bas/.exec(out);
  if (!m) return fail("Ctrl+Z sayısı verilmedi");
  for (let i = 0; i < Number(m[1]); i++) undo();
  if (mainTracks() !== before) fail(`Ctrl+Z × ${m[1]} aslına döndürmedi`);
  else ok(`Ctrl+Z × ${m[1]} → asıl düzen birebir`);
};

// ------------------------------------------------------------ inceleme #3 — adversaryal senaryolar
scenarios.adv_cutfree_undo = async () => {
  // kesimsiz BAĞLA (Zoom tamamen çapanın içinde → yalnız kılavuzlar silinir) Ctrl+Z ile geri alınınca: kılavuzlar geri geldi →
  // BAĞLA "uygulanmış" SAYILMAMALI (yalnız bağlama yapıp kılavuzları bırakmamalı), yeniden TAM BAĞLA yapmalı
  const spec = {
    cams: [
      { name: "A038C001_260912AA.MP4", start: sec(10), dur: sec(30) },
      { name: "C0101.MP4", start: sec(12), dur: sec(20) },
    ],
    wavs: [{ name: "260912_101512_Tr1.WAV", start: sec(10), dur: sec(30) }], // çapayı birebir kapsar: kesim yok, korunacak boşluk yok
    others: [],
  };
  const collected = await collectThen(spec);
  await startHelper();
  const o1 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(o1) || txOf("BAĞLA").join(",") !== "BAĞLA: yedek sequence,BAĞLA: kesim hazırlığı") return fail("kesimsiz BAĞLA beklenenden farklı:\n" + failLines(o1));
  if (!/Ctrl\+Z'ye 1 kez bas|Ctrl\+Z/.test(o1)) fail("geri alma bilgisi yok");
  undo(); // kesim hazırlığı geri → kılavuzlar geri geldi
  const guidesBack = clipNamed(/^(A038C001|C0101)/).filter((x) => x.kind === "A").length;
  if (guidesBack !== 2) return fail(`mock: kılavuzlar geri gelmedi (${guidesBack})`);
  let q = "";
  const o2 = await clickAndWait("btn-bind", async (x) => ((q = x), yes()), doneRe);
  if (/kayıttaki gruplar kullanılır/.test(q) || !/✓ BAĞLA tamam/.test(o2) || txOf("BAĞLA").filter((n) => n === "BAĞLA: kesim hazırlığı").length !== 2)
    fail("geri alınmış kesimsiz BAĞLA 'uygulanmış' sanıldı:\n" + q + "\n" + failLines(o2));
  else ok("kesimsiz BAĞLA Ctrl+Z ile geri alındı → kılavuzlar geri geldi → BAĞLA yeniden TAM çalıştı (kılavuzları sildi, bağladı)");
  checkExactly(seqByGuid("guid-main-edit"), expectBagla(collected, [["260912_101512", "A038C001_260912AA", "C0101"]]).exp, "yeniden BAĞLA düzeni (kılavuz yok)");
  undo();
  const o3 = await clickAndWait("btn-collect", async (x) => ((q = x), yes()), doneRe);
  if (!/Zaten toplanmış/.test(o3)) fail("BAĞLA geri alınınca TOPLA 'zaten toplanmış' demedi:\n" + failLines(o3));
  else ok("BAĞLA geri alınınca TOPLA 'BAĞLA'dan geçti' SANMADI ('zaten toplanmış')");
};

scenarios.adv_undone_park = async () => {
  // DJI [80–90] Zoom ile %80 çakışıyor: eşik %90'da sahipsiz → park. TOPLA TAMAMEN geri alınır, eşik %80 yapılır, TOPLA:
  // park kaydı bırakılmalı (timeline TOPLA öncesi hâlinde) → DJI senkron sonucundan O1'e katılır
  setupSync(smallSpec({ wavs: [...smallSpec().wavs, { name: "DJI_09_20260912_090000.WAV", start: sec(80), dur: sec(10) }] }));
  const before = mainTracks();
  let q = "";
  const o1 = await clickAndWait("btn-collect", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ TOPLA tamam/.test(o1) || !/Park track'lerine .*DJI_09/.test(q)) return fail("ilk TOPLA: DJI park edilmedi:\n" + q);
  const m = /Ctrl\+Z'ye (\d+) kez bas/.exec(o1);
  for (let i = 0; i < Number(m ? m[1] : 0); i++) undo();
  if (mainTracks() !== before) return fail("TOPLA geri alınamadı (mock)");
  const thr = els["set-threshold"];
  thr.value = "80";
  thr.fire("change");
  const qs = [];
  const o2 = await clickAndWait("btn-collect", async (x) => (qs.push(x), yes()), doneRe);
  const conf = qs.find((x) => /^TOPLA — /.test(x)) ?? "";
  // v1.2.1: TOPLA tamamen geri alınınca kaydı (park listesi dahil) bayat → işlemden önce unutulur
  if (qs.some((x) => /PARK KAYDI/.test(x)) || !/Timeline değişmiş \(geri alma\/elle düzenleme\) — önceki Topla kaydı unutuldu/.test(o2) || !/O1 .*DJI_09/.test(conf) || !/✓ TOPLA tamam: 1 oturum/.test(o2))
    fail("TOPLA geri alınmışken eski park kaydı kullanıldı:\n" + qs.join("\n---\n") + "\n" + failLines(o2));
  else ok("TOPLA tamamen geri alındı → park kaydı bırakıldı (sorulmadan, kanıtla); %80 eşikte DJI senkron sonucundan O1'e katıldı");
  thr.value = "90";
  thr.fire("change");
  // TOPLA'dan sonra EL İLE değişen düzen → park kaydı SORULUR (Hayır = hiçbir şey)
  setupSync(smallSpec({ wavs: [...smallSpec().wavs, { name: "DJI_09_20260912_090000.WAV", start: sec(200), dur: sec(3) }] }));
  await clickAndWait("btn-collect", yes, doneRe);
  const S = seqByGuid("guid-main-edit");
  const cam = S.v.flat().find((c) => c.name.startsWith("C0102"));
  cam.start += FRAME25;
  cam.end += FRAME25; // kullanıcı bir kamerayı 1 kare kaydırdı
  mockGen++;
  const snap = JSON.stringify(state.sequences, repl);
  let q2 = "";
  const o3 = await clickAndWait("btn-collect", async (x) => ((q2 = x), no()), doneRe);
  if (!/PARK KAYDI — düzen son TOPLA'dan sonra değişmiş/.test(q2) || !/DJI_09/.test(q2) || !/İptal edildi/.test(o3) || JSON.stringify(state.sequences, repl) !== snap)
    fail("el ile değişen düzende park kaydı sorulmadı / bir şey değişti:\n" + q2);
  else ok("TOPLA'dan sonra el ile değişen düzen → park kaydı SORULDU; Hayır → hiçbir şey değişmedi");
};

scenarios.adv_splitrec = async () => {
  // (a) aynı Zoom kaydının kısa kanalı (Tr2 [85–88], aynı in − start) tek başına güçlü bağ kuramaz: kaydıyla TEK kayıt → Tr1 ile aynı
  //     ofsetle taşınır (kanallar birbirinden kaymaz)
  const tr1 = smallSpec().wavs[0];
  setupSync(smallSpec({ wavs: [tr1, { name: "260912_101512_Tr2.WAV", start: sec(85) + 12345n, dur: sec(3), inPt: sec(80) }] }));
  let q = "";
  const o1 = await clickAndWait("btn-collect", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ TOPLA tamam: 1 oturum/.test(o1) || /Park track'lerine/.test(q)) return fail("kısa kanal ayrı sahipsiz sayıldı:\n" + q + "\n" + failLines(o1));
  const w = clipNamed(/^260912_101512_Tr/).map((x) => x.c);
  const offs = new Set(w.map((c) => String(c.inPt - c.start)));
  if (w.length !== 2 || offs.size !== 1) fail(`kanallar birbirinden kaydı: ${w.map((c) => `${c.name} ${secOf(c.start)} in ${secOf(c.inPt)}`).join(", ")}`);
  else ok("aynı kaydın kısa kanalı (Tr2 3 sn) kaydıyla TEK kayıt → Tr1 ile aynı ofsetle taşındı (in − start aynı)");
  await startHelper();
  const b1 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(b1)) fail("BAĞLA tamamlanmadı:\n" + failLines(b1));

  // (b) park kaydındaki bir parça ile oturumdaki parçası aynı kayıt (parça sonradan eklendi) → TOPLA SORAR; BAĞLA durur
  setupSync(smallSpec({ wavs: [{ name: "DJI_01_20260912_101600.WAV", start: sec(8), dur: sec(80) }, { name: "260912_101512_Tr2.WAV", start: sec(200), dur: sec(3), inPt: sec(250) }] }));
  const t1 = await clickAndWait("btn-collect", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ TOPLA tamam: 1 oturum/.test(t1) || !/Park track'lerine .*260912_101512/.test(q)) return fail("(b) Tr2 park edilmedi:\n" + q);
  // kullanıcı aynı dosyanın (Tr2) başka bir bölümünü ekledi: aynı senkron konumunda (in − start aynı), oturumun kameralarının üstünde
  const S = seqByGuid("guid-main-edit");
  const t2 = S.a.flat().find((c) => c.name.startsWith("260912_101512_Tr2"));
  const off = t2.inPt - t2.start;
  const st = sec(0);
  S.a.push([mkClip("A", t2.pi, st, st + sec(80), null, st + off)]);
  mockGen++;
  const snap = JSON.stringify(state.sequences, repl);
  const b2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/aynı kaydın bir kısmı park'ta, bir kısmı O1 oturumunda/.test(b2) || JSON.stringify(state.sequences, repl) !== snap) fail("(b) BAĞLA bölünmüş kayıtta durmadı:\n" + b2.split("\n").filter((l) => /HATA|DURDU/.test(l)).join("\n"));
  else ok("(b) aynı kaydın bir parçası park'ta, başka parçası oturumda → BAĞLA düzenlemeden DURDU ('önce TOPLA')");
  let q3 = "";
  const t3 = await clickAndWait("btn-collect", async (x) => (/AYNI KAYIT BÖLÜNMÜŞ/.test(x) ? ((q3 = x), no()) : yes()), doneRe);
  if (!/AYNI KAYIT BÖLÜNMÜŞ/.test(q3) || !/İptal edildi/.test(t3) || JSON.stringify(state.sequences, repl) !== snap) fail("(b) TOPLA bölünmüş kaydı sormadı / Hayır'da bir şey değişti:\n" + q3);
  else ok("(b) TOPLA bölünmüş kaydı SORDU; Hayır → hiçbir şey değişmedi");
  const t4 = await clickAndWait("btn-collect", yes, doneRe);
  const w2 = clipNamed(/^260912_101512_Tr/).map((x) => x.c);
  const d = w2.length === 2 ? w2[0].inPt - w2[0].start - (w2[1].inPt - w2[1].start) : null;
  if (!/✓ TOPLA tamam/.test(t4) || d !== 0n) fail(`(b) Evet sonrası kanallar aynı ofsette değil / TOPLA tamamlanmadı:\n${failLines(t4)}`);
  else ok("(b) Evet → park'taki parça kaydıyla oturuma alındı, diğer parçayla aynı ofsetle taşındı (parçalar birbirinden kaymadı)");
};

scenarios.adv_nocam = async () => {
  // kamerasız oturum (Zoom + DJI birbirine %100 bağlı, kamera yok) + normal oturum: BAĞLA kamerasız oturumun seslerine DOKUNMAZ
  const members = [
    ["260912_101512", "A038C001_260912AA", "C0101", "A038C002_260912BB", "C0102"],
    ["260912_120000", "DJI_01_20260912_120100"],
  ];
  const collected = await collectThen(
    smallSpec({ wavs: [...smallSpec().wavs, { name: "260912_120000_Tr1.WAV", start: sec(300), dur: sec(60) }, { name: "DJI_01_20260912_120100.WAV", start: sec(301), dur: sec(58) }] })
  );
  await startHelper();
  let q = "";
  const out = await clickAndWait("btn-bind", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ BAĞLA tamam/.test(out) || !/1 kamerasız oturumun \(O2\) seslerine dokunulmayacak/.test(q)) return fail("kamerasız oturum bildirilmedi / BAĞLA tamamlanmadı:\n" + q + "\n" + failLines(out));
  const eb = expectBagla(collected, members);
  checkExactly(seqByGuid("guid-main-edit"), eb.exp, "kamerasız oturumun Zoom + DJI sesi olduğu gibi (silinmedi), diğer oturum bağlandı");
};

// ------------------------------------------------------------ v0.3.2 — köprüden bağımsız BAĞLA (KES + yardımcı paneldeki BAĞLA)
const PLAN_FILE = () => HELPER.planPath(path, "darwin", TMPHOME);
const INFO_FILE = () => HELPER.infoPath(path, "darwin", TMPHOME);
function linkPartition(seq) {
  const m = new Map();
  for (const x of allClips(seq)) if (x.c.linkId) m.set(x.c.linkId, [...(m.get(x.c.linkId) ?? []), [x.kind, x.track, x.c.name, x.c.start, x.c.end].join("|")]);
  return [...m.values()].map((l) => l.sort().join(",")).sort();
}
const finalState = () => ({
  clips: snapList().map((e) => [e.kind, e.track, e.name, e.start, e.end, e.inPt].join("|")).sort(),
  links: linkPartition(seqByGuid("guid-main-edit")),
});
const spec2ch = () => smallSpec({ wavs: [...smallSpec().wavs, { name: "260912_101512_Tr2.WAV", start: sec(8) + 12345n, dur: sec(79), inPt: sec(3) }] });

scenarios.bridgeoff = async () => {
  // (A) köprü AÇIK → tek tık (KES + bağla)
  await collectThen(spec2ch());
  await startHelper();
  const oA = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(oA)) return fail("(A) köprülü BAĞLA tamamlanmadı:\n" + failLines(oA));
  const A = finalState();
  ok(`köprü açık: tek tıkla KES + bağla (${A.links.length} bağ)`);
  // (B) köprü KAPALI → Spread yalnız KES yapar, planı yazar; kullanıcı Spread Helper panelini açıp BAĞLA'ya basar
  const collected = await collectThen(spec2ch());
  await stopHelper();
  fsReal.rmSync(PLAN_FILE(), { force: true });
  const nLinks = counters.links;
  let q = "";
  const oB = await clickAndWait("btn-bind", async (x) => ((q = x), yes()), doneRe);
  if (!/Yardımcıya köprü YOK → yalnız KES yapılacak/.test(q)) fail("onayda köprü yok bilgisi yok:\n" + q);
  if (!/✓ KES tamam: kesme\/silme tick düzeyinde doğrulandı/.test(oB) || !/Window → Extensions \(Legacy\) → Spread Helper panelini aç ve oradaki BAĞLA'ya bas/.test(oB) || counters.links !== nLinks)
    return fail("köprü kapalıyken KES + yönlendirme olmadı:\n" + oB.split("\n").slice(-8).join("\n"));
  ok("köprü kapalı: BAĞLA DURMADI — KES yapıldı (tick düzeyinde doğrulandı), bağlama yapılmadı, 'Spread Helper panelindeki BAĞLA'ya bas' dendi");
  checkExactly(seqByGuid("guid-main-edit"), expectBagla(collected, SMALL).exp, "köprüsüz KES düzeni");
  if (!/\[bilgi dosyası\].*Window → Extensions \(Legacy\) → Spread Helper/.test(els.helper.textContent)) fail(`gösterge gerçek hatayı yazmıyor: ${els.helper.textContent}`);
  else ok("panel göstergesi gerçek hatayı yazıyor: [bilgi dosyası] … (yardımcı hiç başlamamış → Window → Extensions (Legacy) → Spread Helper)");
  if (!fsReal.existsSync(PLAN_FILE())) return fail("KES planı dosyaya yazılmadı");
  const h = await startHelper(); // kullanıcı Spread Helper panelini açtı
  const r = await h.bindFromPlan({});
  if (!r.ok || !/^✓ 2 grup bağlandı ve doğrulandı/.test(r.summary)) return fail(`yardımcı paneldeki BAĞLA: ${r.summary}\n${r.lines.join("\n")}`);
  ok(`yardımcı paneldeki BAĞLA: ${r.summary} — ${r.rows.map((x) => x.label.split(" ")[0] + " " + x.status).join(", ")}`);
  const B = finalState();
  if (JSON.stringify(A) !== JSON.stringify(B)) fail(`iki yolun sonucu farklı:\nA ${JSON.stringify(A).slice(0, 300)}\nB ${JSON.stringify(B).slice(0, 300)}`);
  else ok("köprü kapalıyken KES + yardımcı paneldeki BAĞLA = köprülü tek tıkla AYNI son düzen (tick) ve AYNI bağlar");
  checkLinks(seqByGuid("guid-main-edit"), expectBagla(collected, SMALL).groups, "yardımcı panelden bağlar");
  if (!h.state().lastBind || !h.state().lastBind.ok) fail("panel durumu son BAĞLA'yı göstermiyor");
  await clickAndWait("btn-status", yes, doneRe);
  if (!/bağlama Spread Helper panelinden \(.*\): ✓ 2 grup bağlandı ve doğrulandı/.test(els.report.value)) fail("durum raporu paneldeki BAĞLA'yı göstermiyor:\n" + els.report.value.split("\n").filter((l) => /BAĞLA kaydı/.test(l)).join("\n"));
  else ok("Spread'in durum raporu yardımcı paneldeki BAĞLA'nın sonucunu gösteriyor (sonuç dosyası, bu plan için)");
  // Spread'de tekrar BAĞLA (köprü artık açık): kayıttaki gruplarla yalnız bağlama — düzen aynı kalır
  const n = counters.txNames.length;
  const oC = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(oC) || counters.txNames.length !== n || JSON.stringify(finalState()) !== JSON.stringify(B)) fail("köprü açılınca tekrar BAĞLA düzeni değiştirdi:\n" + failLines(oC));
  else ok("köprü açılınca Spread'de tekrar BAĞLA: yalnız bağlama, düzen ve bağlar aynı");
};

scenarios.bridgeoff_real = async () => {
  // iki yolun eşdeğerliği zengin veride: köprülü tek tık (A) ile köprüsüz KES + yardımcı paneldeki BAĞLA (B) AYNI son düzen ve bağlar
  const topla = async () => /✓ TOPLA tamam/.test(await clickAndWait("btn-collect", yes, doneRe));
  const cases = [
    ["12 Eylül (gerçek rapor, TrLR 'sil')", async () => (setupFromReport(R0912, ["A27", "A30"]), await setMap("Zoom TrLR", "sil"), topla())],
    ["23 Eylül (sentetik: DJI iki Zoom'u kapsıyor, harici sessiz oturumda kamera sesi korunur)", async () => (setupSync(sep23()), topla())],
    [
      "kamerasız oturum + 'sil' kaynağı (Zoom 120000 Tr1/Tr2 + DJI, Tr2 'sil')",
      async () => (
        setupSync(
          smallSpec({
            wavs: [
              ...smallSpec().wavs,
              { name: "260912_120000_Tr1.WAV", start: sec(300), dur: sec(60) },
              { name: "260912_120000_Tr2.WAV", start: sec(300), dur: sec(60) },
              { name: "DJI_01_20260912_120100.WAV", start: sec(301), dur: sec(58) },
            ],
          })
        ),
        await setMap("Zoom Tr2", "sil"),
        topla()
      ),
    ],
    [
      "kamerasız oturum (Zoom + DJI) + normal oturum",
      async () => (setupSync(smallSpec({ wavs: [...smallSpec().wavs, { name: "260912_120000_Tr1.WAV", start: sec(300), dur: sec(60) }, { name: "DJI_01_20260912_120100.WAV", start: sec(301), dur: sec(58) }] })), topla()),
    ],
  ];
  for (const [label, prep] of cases) {
    if (!(await prep())) {
      fail(`${label}: TOPLA tamamlanmadı`);
      continue;
    }
    await startHelper();
    const oA = await clickAndWait("btn-bind", yes, doneRe);
    if (!/✓ BAĞLA tamam/.test(oA)) {
      fail(`${label}: köprülü BAĞLA tamamlanmadı:\n${failLines(oA)}`);
      continue;
    }
    const A = finalState();
    await prep();
    await stopHelper();
    const oB = await clickAndWait("btn-bind", yes, doneRe);
    if (!/✓ KES tamam/.test(oB)) {
      fail(`${label}: köprüsüz KES tamamlanmadı:\n${failLines(oB)}`);
      continue;
    }
    const h = await startHelper();
    const r = await h.bindFromPlan({});
    const B = finalState();
    if (!r.ok || JSON.stringify(A) !== JSON.stringify(B)) fail(`${label}: iki yol farklı (${r.summary})\n${r.lines.slice(0, 5).join("\n")}`);
    else ok(`${label}: köprülü tek tık = KES + yardımcı paneldeki BAĞLA (${A.clips.length} klip tick düzeyinde, ${A.links.length} bağ aynı; ${r.summary})`);
  }
};

scenarios.bridgeoff_paste = async () => {
  // plan dosyası YAZILAMAZSA (UXP dosya izni): plan rapor kutusunda → yardımcı panelde yapıştır → BAĞLA
  const collected = await collectThen(smallSpec());
  await stopHelper();
  fsReal.rmSync(PLAN_FILE(), { force: true });
  M.planWriteFails = true;
  const o = await clickAndWait("btn-bind", yes, doneRe);
  M.planWriteFails = false;
  if (!/KES planı dosyaya YAZILAMADI .*Permission denied/.test(o) || !/'Raporu kopyala' → Spread Helper panelinde 'Planı yapıştır'/.test(o) || !/"kind": "spread-link-plan"/.test(els.report.value))
    return fail("plan yazılamayınca yapıştırma yolu gösterilmedi:\n" + o.split("\n").slice(-6).join("\n"));
  ok("plan dosyası yazılamadı (izin) → ham hata + plan rapor kutusunda + 'Planı yapıştır' talimatı");
  const h = await startHelper();
  const r0 = await h.bindFromPlan({});
  if (r0.ok || !/KES planı okunamadı/.test(r0.summary)) fail(`plan yokken panel BAĞLA: ${r0.summary}`);
  else ok("plan dosyası yokken paneldeki BAĞLA hiçbir şey yapmadan ne yapılacağını söyledi");
  const old = await h.bindFromPlan({ text: els.report.value.replace(`"panel": "${HELPER.VERSION}"`, '"panel": "0.3.2"') });
  if (old.ok || !/plan Spread 0\.3\.2 ile yazılmış, bu yardımcı .* aynı sürüme güncelle/.test(old.summary)) fail(`sürüm uyuşmazlığı: ${old.summary}`);
  else ok("plan başka sürümün Spread'iyle yazılmışsa panel hiçbir şey yapmadan 'ikisini aynı sürüme güncelle' der");
  const r = await h.bindFromPlan({ text: els.report.value });
  if (!r.ok) return fail(`yapıştırılan planla BAĞLA: ${r.summary}\n${r.lines.join("\n")}`);
  ok(`yapıştırılan planla paneldeki BAĞLA: ${r.summary}`);
  checkLinks(seqByGuid("guid-main-edit"), expectBagla(collected, SMALL).groups, "yapıştırılan planla bağlar");
};

scenarios.panel_guard = async () => {
  // paneldeki BAĞLA düzen KES planıyla BİREBİR değilse HİÇBİR ŞEY yapmaz
  await collectThen(smallSpec());
  await stopHelper();
  await clickAndWait("btn-bind", yes, doneRe);
  const h = await startHelper();
  const S = seqByGuid("guid-main-edit");
  const nLinks = counters.links;
  // (a) başka sequence aktif
  state.activeGuid = "guid-other";
  const r1 = await h.bindFromPlan({});
  state.activeGuid = "guid-main-edit";
  if (r1.ok || !/aktif sequence "Müşteri Kurgusu", plan "Ana Kurgu" için/.test(r1.summary) || counters.links !== nLinks) fail(`başka sequence'ta: ${r1.summary}`);
  else ok("başka sequence aktifken paneldeki BAĞLA hiçbir şey yapmadı");
  // (b) KES'ten sonra bir parça 1 kare kaydırıldı
  const w = S.a.flat().find((c) => c.name.endsWith(".WAV"));
  w.start += FRAME25;
  w.end += FRAME25;
  mockGen++;
  const r2 = await h.bindFromPlan({});
  if (r2.ok || !/uyuşmuyor|KES sonrası hâlinde değil/.test(r2.summary) || counters.links !== nLinks) fail(`kaymış parçayla: ${r2.summary}`);
  else ok(`KES'ten sonra 1 kare kayan parça → paneldeki BAĞLA DURDU (${r2.lines.length} satır fark), hiçbir şey bağlanmadı`);
  w.start -= FRAME25;
  w.end -= FRAME25;
  mockGen++;
  // (c0) v1.1.0 (A6): KES'ten sonra bir parça elle SİLİNDİ → DURMA: plan grupları var olan öğelere indirilir, yine ortak kuralla
  // birebir karşılaştırılır; var olanlar bağlanır, eksik öğe yazılır; hiçbir klip silinmez
  const snapBefore = deepCopy();
  const piece = S.a.flat().find((c) => c.name.endsWith(".WAV"));
  for (const tr of S.a) {
    const k = tr.indexOf(piece);
    if (k >= 0) tr.splice(k, 1);
  }
  mockGen++;
  const nClips0 = allClips(S).length;
  const r2b = await h.bindFromPlan({});
  if (
    !r2b.ok ||
    !/^⚠ 2 grup bağlandı ve doğrulandı; 1 öğe timeline'da yok \(elle silinmiş\) — bağlanmadı/.test(r2b.summary) ||
    r2b.notes.length !== 1 ||
    !r2b.notes[0].includes(piece.name) ||
    counters.links - nLinks !== 2 ||
    allClips(S).length !== nClips0
  )
    fail(`silinen parçayla: ${r2b.summary}\n${[...r2b.lines, ...(r2b.notes ?? [])].join("\n")}`);
  else ok(`KES'ten sonra bir parça elle silindi → paneldeki BAĞLA durmadı: 2 grup var olan öğeleriyle bağlandı, eksik öğe yazıldı ("${r2b.notes[0].slice(0, 60)}…"), hiçbir klip silinmedi`);
  restore(snapBefore);
  mockGen++;
  const nLinksC = counters.links;
  // (c) KES geri alındı (Ctrl+Z): kesilmemiş sesler kameralara değiyor / kılavuzlar duruyor → DUR
  for (let i = 0; i < 4; i++) undo();
  const r3 = await h.bindFromPlan({});
  if (r3.ok || !/KES sonrası hâlinde değil/.test(r3.summary) || !r3.lines.some((l) => /KES yapılmamış|KES kılavuzu silmemiş/.test(l)) || counters.links !== nLinksC)
    fail(`KES geri alınmışken: ${r3.summary}\n${r3.lines.join("\n")}`);
  else ok("KES geri alınmışken paneldeki BAĞLA DURDU (kesilmemiş ses / kılavuz ses duruyor), hiçbir şey bağlanmadı");
};

// ortak kuralın (yardımcıya SEVK EDİLEN derlenmiş modül: cep-helper/js/spread-core.js) dalları tek tek
scenarios.core_rules = async () => {
  const C = (kind, track, s0, e0, name, extra = {}) => ({ kind, track, start: String(sec(s0)), end: String(sec(e0)), inPt: "0", outPt: "0", speed: 1, adjustment: false, disabled: false, name, projName: name, projId: "p-" + name, ...extra });
  const run = (clips, frame = { vPark: 2, aPark: 4, silTracks: [3] }) => CORE.groupsFromLayout(CORE.classify({ clips }), frame);
  const camA = C("V", 0, 10, 40, "A038C001_260912AA.MP4");
  const camB = C("V", 1, 12, 32, "C0101.MP4");
  const guideA = C("A", 1, 10, 40, "A038C001_260912AA.MP4");
  const zoom = C("A", 0, 10, 40, "260912_101512_Tr1.WAV");
  const cases = [
    ["çapayı BİREBİR kapsayan parça + çakışan kamera → tek grup", run([camA, camB, zoom]), (r) => !r.errors.length && r.groups.length === 1 && r.groups[0].audio.length === 1 && r.groups[0].anchor === camA],
    ["çapanın İÇİNDE kısa parça → grubun", run([camA, camB, C("A", 0, 15, 30, "260912_101512_Tr1.WAV")]), (r) => !r.errors.length && r.groups[0].audio.length === 1],
    ["harici sesli grupta kılavuz ses → HATA (KES silmemiş)", run([camA, camB, zoom, guideA]), (r) => r.errors.some((e) => /KES kılavuzu silmemiş/.test(e))],
    ["harici sessiz grupta kılavuz ses → korunan kamera sesi (grubun)", run([camA, camB, guideA]), (r) => !r.errors.length && r.groups[0].audio.length === 1],
    ["çapa dışına taşan ama kameraya değen ses → HATA (KES yapılmamış)", run([camA, camB, C("A", 0, 5, 45, "260912_101512_Tr1.WAV")]), (r) => r.errors.some((e) => /KES yapılmamış/.test(e))],
    ["hiçbir kameraya değmeyen ses (kamerasız oturum) → dokunulmaz", run([camA, camB, zoom, C("A", 2, 100, 160, "260912_120000_Tr1.WAV")]), (r) => !r.errors.length && r.ignored.length === 1 && r.groups[0].audio.length === 1],
    ["'sil' track'inde, kameraya değen ses → HATA (KES silmemiş)", run([camA, camB, zoom, C("A", 3, 10, 40, "260912_101512_TrLR.WAV")]), (r) => r.errors.some((e) => /"sil" kaynağının track'inde/.test(e))],
    ["'sil' track'inde, hiçbir kameraya değmeyen ses (kamerasız oturum) → dokunulmaz", run([camA, camB, zoom, C("A", 3, 100, 160, "260912_120000_TrLR.WAV")]), (r) => !r.errors.length && r.ignored.length === 1],
    ["park track'indeki kamera ve ses (V ≥ vPark, A ≥ aPark) → gruplara girmez", run([camA, camB, zoom, C("V", 2, 20, 21, "A041C005_260923ZT.MP4"), C("A", 4, 20, 22, "DJI_09_20260912_090000.WAV")]), (r) => !r.errors.length && r.groups.length === 1 && r.groups[0].cams.length === 2 && r.groups[0].audio.length === 1],
  ];
  for (const [label, r, test] of cases) test(r) ? ok(`ortak kural: ${label}`) : fail(`ortak kural: ${label} → ${JSON.stringify({ e: r.errors, i: r.ignored, g: r.groups.map((g) => [g.cams.length, g.audio.length]) })}`);
  const lay = run([camA, camB, zoom]);
  const items = CORE.layoutGroupItems(lay.groups[0]);
  const same = CORE.compareLinkGroups([{ label: "G", items }], lay.groups);
  const diff = CORE.compareLinkGroups([{ label: "G", items: items.slice(1) }], lay.groups);
  if (same.length || diff.length !== 2) fail(`planla karşılaştırma: aynı → ${same.length}, farklı → ${diff.length}`);
  else ok("planla karşılaştırma: aynı grup → fark yok; bir öğesi eksik plan → 'planda var, düzende YOK' + 'düzende var, planda YOK'");
};

scenarios.panel_batchfail = async () => {
  // paneldeki BAĞLA'da ikinci parti (8'den sonrası) başarısız: bağlanan 8 grup ve başarısızlar grup grup raporlanır
  setupFromReport(R0912, ["A27", "A30"]);
  await setMap("Zoom TrLR", "sil");
  await clickAndWait("btn-collect", yes, doneRe);
  await stopHelper();
  await clickAndWait("btn-bind", yes, doneRe);
  const h = await startHelper();
  const origEval = helperEval.fn;
  let calls = 0;
  helperEval.fn = (script, cb) => (/^spreadHelper_link\(/.test(script) && ++calls === 2 ? setTimeout(() => cb("EvalScript error."), 1) : origEval(script, cb));
  const r = await h.bindFromPlan({});
  helperEval.fn = origEval;
  const okRows = r.rows.filter((x) => x.status === "tamam").length;
  const badRows = r.rows.filter((x) => x.status === "hata" && /bağlanmadı — bağlama isteği başarısız/.test(x.detail)).length;
  if (r.ok || okRows !== 8 || badRows !== 3 || !/yeniden basmak güvenli/.test(r.summary)) fail(`parti hatası: ${r.summary} (tamam ${okRows}, hata ${badRows})`);
  else ok(`paneldeki BAĞLA'da 2. parti düştü → 8 grup ✓ + 3 grup ✗ grup grup raporlandı ("${r.summary.slice(0, 60)}…")`);
  const r2 = await h.bindFromPlan({});
  if (!r2.ok) fail(`yeniden basınca: ${r2.summary}`);
  else ok(`yeniden bas → ${r2.summary}`);
};

scenarios.helper_second = async () => {
  // ikinci bir Spread Helper örneği (port dolu) çalışanın bilgi dosyasına DOKUNMAZ; köprü çalışmaya devam eder
  setupSync(smallSpec());
  await startHelper();
  const info = fsReal.readFileSync(INFO_FILE(), "utf8");
  const h2 = HELPER.createHelper({ http, crypto: cryptoReal, fs: fsReal, path, os: osReal, evalScript: (sc, cb) => cb('{"ok":true,"premiere":"x"}'), core: CORE, home: TMPHOME, platform: "darwin" });
  let err = null;
  try {
    await h2.start();
  } catch (e) {
    err = e;
  }
  const still = fsReal.existsSync(INFO_FILE()) && fsReal.readFileSync(INFO_FILE(), "utf8") === info;
  await h2.stop();
  const still2 = fsReal.existsSync(INFO_FILE()) && fsReal.readFileSync(INFO_FILE(), "utf8") === info;
  const o = await clickAndWait("btn-helper", yes, /✓ Yardımcı|✗ Yardımcı bağlı değil/);
  if (!err || !/EADDRINUSE/.test(h2.state().error || "") || !still || !still2 || !/✓ Yardımcı bağlı/.test(o))
    fail(`ikinci örnek: hata=${err && err.code} durum=${h2.state().error} dosya=${still}/${still2}\n${o}`);
  else ok("ikinci yardımcı örneği: 'EADDRINUSE … port kullanımda' gösterdi, çalışanın bilgi dosyasına dokunmadı (başlarken de kapanırken de); köprü çalışıyor");
};

// ------------------------------------------------------------ v0.3.3 — harici sesin olmadığı aralıkta kamera sesi korunur
scenarios.keepcam_multi = async () => {
  // iki kanallı A kamerası (çapa), Zoom çapanın ortasında: [10–15] ve [30–40] harici sessiz → A'nın İKİ kılavuz kanalı o aralıklara
  // kesilip iki "korunan kamera sesi" track'ine (A2, A3) konur; sync (in − start) korunur; köprülü ve köprüsüz yol aynı
  const spec = () => ({
    cams: [
      { name: "A038C001_260912AA.MP4", start: sec(10), dur: sec(30), channels: 2 },
      { name: "C0101.MP4", start: sec(12), dur: sec(20) },
    ],
    wavs: [{ name: "260912_101512_Tr1.WAV", start: sec(15), dur: sec(15), inPt: sec(4) }],
    others: [],
  });
  const topla = async () => /✓ TOPLA tamam/.test(await clickAndWait("btn-collect", yes, doneRe));
  setupSync(spec());
  if (!(await topla())) return fail("TOPLA tamamlanmadı");
  const S = seqByGuid("guid-main-edit");
  const g0 = allClips(S).filter((x) => x.kind === "A" && /^A038C001/.test(x.c.name)).map((x) => ({ track: x.track, off: x.c.inPt - x.c.start }));
  await startHelper();
  let q = "";
  const o = await clickAndWait("btn-bind", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ BAĞLA tamam/.test(o)) return fail("BAĞLA tamamlanmadı:\n" + failLines(o));
  const kept = allClips(S).filter((x) => x.kind === "A" && (x.track === 1 || x.track === 2) && /^A038C001/.test(x.c.name));
  const spans = kept.map((x) => `A${x.track + 1}:${secOf(x.c.start)}-${secOf(x.c.end)}`).sort().join(" ");
  const offOk = kept.every((x) => x.c.inPt - x.c.start === g0[0].off);
  const L = kept[0] && kept[0].c.linkId;
  const cam = S.v.flat().find((c) => c.name.startsWith("A038C001"));
  if (!/KAMERA SESİ KORUNACAK/.test(q) || !/→ A2\+A3/.test(q) || spans !== "A2:0.000-5.000 A2:20.000-30.000 A3:0.000-5.000 A3:20.000-30.000" || !offOk || !L || cam.linkId !== L || !kept.every((x) => x.c.linkId === L))
    fail(`iki kanallı korunan kamera sesi yanlış: ${spans} (sync ${offOk}, bağ ${!!L && cam.linkId === L})\n${q}`);
  else ok("iki kanallı kamera: harici sessiz [0–5] ve [20–30] aralıkları A'nın İKİ kanalından kesildi → A2 + A3, in − start kılavuzla aynı, hepsi grubun bağında");
  const A = finalState();
  setupSync(spec());
  await topla();
  await stopHelper();
  await clickAndWait("btn-bind", yes, doneRe);
  const h = await startHelper();
  const r = await h.bindFromPlan({});
  if (!r.ok || JSON.stringify(A) !== JSON.stringify(finalState())) fail(`iki kanallı: köprüsüz yol farklı (${r.summary})\n${r.lines.join("\n")}`);
  else ok(`iki kanallı: köprülü tek tık = KES + yardımcı paneldeki BAĞLA (${r.summary})`);
};

scenarios.keepcam_noguide = async () => {
  // çapa A038C001 [10–40] (sesli), Zoom çapayı birebir kapsıyor; sesi OLMAYAN (kanalsız) Sony C0101 [8–35] çapadan 2 sn önce başlıyor:
  // o 2 sn'yi kapsayan kılavuzlu kamera yok → SESSİZ KALACAK (1 satır), korunan parça yok
  await collectThen({
    cams: [
      { name: "A038C001_260912AA.MP4", start: sec(10), dur: sec(30) },
      { name: "C0101.MP4", start: sec(8), dur: sec(27), channels: 0 },
    ],
    wavs: [{ name: "260912_101512_Tr1.WAV", start: sec(10), dur: sec(30) }],
    others: [],
  });
  await startHelper();
  let q = "";
  const o = await clickAndWait("btn-bind", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ BAĞLA tamam/.test(o)) return fail("BAĞLA tamamlanmadı:\n" + failLines(o));
  const sil = (q.match(/SESSİZ KALACAK \(harici ses parçası yok ve kamera sesi korunamıyor\):\n((?:  • .*\n?)+)/) || [])[1] || "";
  if ((sil.match(/•/g) || []).length !== 1 || !/0\.000–2\.000 s \(2\.000 sn, çapa dışında: harici ses çapaya göre kesilir\); kılavuz sesi olan kamera yok/.test(sil) || /KAMERA SESİ KORUNACAK \(/.test(q))
    fail("kılavuzsuz kamera boşluğu SESSİZ KALACAK diye listelenmedi:\n" + q);
  else ok("sesi olmayan C0101'in çapadan önceki 2 sn'si: kılavuzlu kamera yok → 'SESSİZ KALACAK' (0.000–2.000 s), korunan parça yok");
};

scenarios.keepcam_oldrecord = async () => {
  // GERÇEK v0.3.2 düzeni: kılavuzlar eşlenen kaynakların hemen altında, kayıtta ayrılmış track yok. BAĞLA (korunacak kamera sesi
  // gerekli) hiçbir şeye dokunmadan "TOPLA'ya tekrar bas" der; TOPLA kılavuzları bir track aşağı taşır; sonra BAĞLA çalışır
  const spec = {
    cams: [
      { name: "A038C001_260912AA.MP4", start: sec(10), dur: sec(30) },
      { name: "C0101.MP4", start: sec(12), dur: sec(20) },
    ],
    wavs: [{ name: "260912_101512_Tr1.WAV", start: sec(15), dur: sec(15) }],
    others: [],
  };
  const collected = await collectThen(spec);
  // v0.3.3 düzeni: Tr1 A1, korunan A2 (boş), kılavuzlar A3–A4 → v0.3.2'ye çevir: boş A2'yi kaldır (her şey bir üste kayar)
  const S = seqByGuid("guid-main-edit");
  if (S.a[1].length) return fail("hazırlık: korunan track boş değil");
  S.a.splice(1, 1);
  const all = JSON.parse(lsStore.get("spread.collectRecord.v1"));
  const fr = all["guid-main-edit"].frame;
  fr.guideBase = fr.guideBase.map(([k, t]) => [k, t - fr.keptCount]);
  fr.silTrack = fr.silTrack.map(([k, t]) => [k, t - fr.keptCount]);
  fr.aPark -= fr.keptCount;
  delete fr.keptBase;
  delete fr.keptCount;
  all["guid-main-edit"].layout = { pre: [], post: [] };
  lsStore.set("spread.collectRecord.v1", JSON.stringify(all));
  mockGen++;
  await startHelper();
  const before = JSON.stringify(state.sequences, repl);
  const o = await clickAndWait("btn-bind", yes, doneRe);
  if (!/"korunan kamera sesi" track'i yok .*TOPLA'ya tekrar bas \(v0\.3\.3 track çerçevesi\)/.test(o) || JSON.stringify(state.sequences, repl) !== before)
    return fail("v0.3.2 düzeni + kaydıyla BAĞLA durmadı:\n" + o.split("\n").filter((l) => /HATA|DURDU/.test(l)).join("\n"));
  ok("gerçek v0.3.2 düzeni + kaydı (ayrılmış track yok) → BAĞLA BAŞLAMADI: '\"korunan kamera sesi\" track'i yok … TOPLA'ya tekrar bas'");
  const t = await clickAndWait("btn-collect", yes, doneRe);
  const gTracks = allClips(S).filter((x) => x.kind === "A" && devOf(x.c.name)).map((x) => x.track).sort().join(",");
  if (!/✓ TOPLA tamam/.test(t) || gTracks !== "2,3" || S.a[1].length) return fail(`TOPLA kılavuzları aşağı taşımadı: ${gTracks}\n${failLines(t)}`);
  ok("TOPLA (v0.3.3 çerçevesi): kılavuzlar A2–A3 → A3–A4, A2 korunan kamera sesi için boş");
  const o2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(o2)) return fail("TOPLA'dan sonra BAĞLA çalışmadı:\n" + failLines(o2));
  // TOPLA (v0.3.3) yükseltmeden sonra ilk TOPLA'nın düzenini birebir geri kurdu → beklenti aynı düzenden
  checkExactly(S, expectBagla(collected, [["260912_101512", "A038C001_260912AA", "C0101"]]).exp, "yükseltmeden sonra BAĞLA (korunan kamera sesi A2'de)");
};

scenarios.keepcam_guard = async () => {
  // (a) "korunan kamera sesi" track'inde (A2) duran başka bir klip → BAĞLA düzenlemeden ÖNCE durur (üstüne yazılmaz)
  const spec = {
    cams: [
      { name: "A038C001_260912AA.MP4", start: sec(10), dur: sec(30) },
      { name: "C0101.MP4", start: sec(12), dur: sec(20) },
    ],
    wavs: [{ name: "260912_101512_Tr1.WAV", start: sec(15), dur: sec(15) }],
    others: [],
  };
  await collectThen(spec);
  const S = seqByGuid("guid-main-edit");
  S.a[1].push(mkClip("A", pi("NOTE.aup3", sec(3), { video: false }), sec(1), sec(3), null, 0n));
  mockGen++;
  await startHelper();
  const before = JSON.stringify(state.sequences, repl);
  const n = counters.txNames.length;
  const o = await clickAndWait("btn-bind", yes, doneRe);
  if (!/KES'ten sonra üst üste binecek: .*NOTE\.aup3.* — o track'teki klibi başka bir track'e al/.test(o) || JSON.stringify(state.sequences, repl) !== before || counters.txNames.length !== n)
    fail("korunan track'teki klip BAĞLA'yı düzenlemeden önce durdurmadı:\n" + o.split("\n").filter((l) => /HATA|DURDU|üst üste/.test(l)).join("\n"));
  else ok("korunan kamera sesi track'inde başka klip (NOTE.aup3) → BAĞLA BAŞLAMADI (üstüne yazılmadı, yedek bile yok)");
  // (b) çapa içinde iki 0.8 sn'lik boşluk (üç ayrı Zoom kaydı arasında) → kamera sesi korunmaz ama TOPLAMI bildirilir
  await collectThen({
    cams: [{ name: "A038C001_260912AA.MP4", start: sec(10), dur: sec(30) }],
    wavs: [
      { name: "260912_100000_Tr1.WAV", start: sec(10), dur: sec(10) },
      { name: "260912_100100_Tr1.WAV", start: sec(20.8), dur: sec(9.2) },
      { name: "260912_100200_Tr1.WAV", start: sec(30.8), dur: sec(9.2) },
    ],
    others: [],
  });
  let q = "";
  const o2 = await clickAndWait("btn-bind", async (x) => ((q = x), yes()), doneRe);
  if (!/✓ BAĞLA tamam/.test(o2) || !/2 kısa boşluk \(her biri ≤ 1 sn\) toplam 1\.600 sn/.test(q) || /KAMERA SESİ KORUNACAK \(/.test(q))
    fail("kısa boşlukların toplamı bildirilmedi:\n" + q + "\n" + failLines(o2));
  else ok("çapa içinde iki 0.8 sn'lik boşluk: kamera sesi korunmadı (kenar payı) ama 'SESSİZ KALACAK: 2 kısa boşluk … toplam 1.600 sn' bildirildi");
};

scenarios.diag = async () => {
  // Spread paneli "bağlı değil" yerine GERÇEK hatayı ve adımı yazar
  setupSync(smallSpec());
  await stopHelper();
  fsReal.rmSync(INFO_FILE(), { force: true });
  const hre = /✓ Yardımcı|✗ Yardımcı bağlı değil/;
  const o1 = await clickAndWait("btn-helper", yes, hre);
  if (!/\[bilgi dosyası\] yardımcının bilgi dosyası okunamadı .*Yardımcı hiç BAŞLAMAMIŞ olabilir: Premiere'de Window → Extensions \(Legacy\) → Spread Helper panelini aç.*Ham hata: fs: /.test(o1))
    fail("bilgi dosyası yokken teşhis yetersiz:\n" + o1);
  else ok("yardımcı hiç başlamamış: '[bilgi dosyası] … okunamadı (yol) … Window → Extensions (Legacy) → Spread Helper … Ham hata: …'");
  fsReal.mkdirSync(path.dirname(INFO_FILE()), { recursive: true });
  fsReal.writeFileSync(INFO_FILE(), JSON.stringify({ port: 47731, token: "a".repeat(64), version: "0.3.2", pid: 4242, startedAt: "2026-09-26T10:00:00Z" }));
  const o2 = await clickAndWait("btn-helper", yes, hre);
  if (!/\[bağlantı\] yardımcının bilgi dosyası var \(başlama 2026-09-26T10:00:00Z, süreç 4242\) ama UXP bağlanamadı\. Ham hata: TypeError: /.test(o2)) fail("sunucu yokken teşhis yetersiz:\n" + o2);
  else ok("bilgi dosyası var ama sunucu yok: '[bağlantı] … UXP bağlanamadı. Ham hata: TypeError: …' + 'son istek' ipucu");
  fsReal.rmSync(INFO_FILE(), { force: true });
  const h = await startHelper();
  M.fetchError = "Permission denied: http://127.0.0.1:47731 is not allowed by the manifest network domains";
  const o3 = await clickAndWait("btn-helper", yes, hre);
  M.fetchError = null;
  if (!/\[bağlantı\] UXP İZİN REDDİ: .*Ham hata: TypeError: Permission denied/.test(o3) || h.state().requests !== 0) fail("izin reddi ayrı tespit edilmedi:\n" + o3);
  else ok("UXP izin reddi ayrı tespit edildi ('UXP İZİN REDDİ … Ham hata …'); yardımcıya istek ULAŞMADI (son istek yok)");
  const o4 = await clickAndWait("btn-helper", yes, hre);
  const lr = h.state().lastRequest;
  if (!o4.includes(`✓ Yardımcı bağlı (yardımcı ${HELPER.VERSION}`) || !lr || lr.url !== "/v1/ping" || lr.status !== 200) fail(`bağlıyken: ${o4} / ${JSON.stringify(lr)}`);
  else ok(`bağlı: 'yardımcı ${HELPER.VERSION}'; yardımcı panelinde son istek POST /v1/ping → 200 (${lr.ms} ms), Premiere ${h.state().premiere}`);
};

scenarios.mapping = async () => {
  setupSync(sep23());
  await scan();
  const ids = (els.mapping?.children ?? []).map((r) => r.children?.[1]?.id);
  if (ids.join(",") !== "map-Zoom Tr1,map-Zoom Tr2,map-Zoom TrLR,map-DJI") fail(`kaynaklar: ${ids}`);
  else ok("kaynak eşleme paneli: Zoom Tr1, Zoom Tr2, Zoom TrLR, DJI");
  if (selectOf("Zoom TrLR")?.value !== "sil" || selectOf("Zoom Tr1")?.value !== "0" || selectOf("Zoom Tr2")?.value !== "1" || selectOf("DJI")?.value !== "2")
    fail(`varsayılan eşleme: ${["Zoom Tr1", "Zoom Tr2", "Zoom TrLR", "DJI"].map((k) => `${k}=${selectOf(k)?.value}`).join(", ")}`);
  else ok("v1.1.0 varsayılan eşleme: Zoom TrLR → Sil (track almaz), Tr1 → A1, Tr2 → A2, DJI → A3");
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
  // kalibrasyon tutarlı bir kural verir, ama asıl parçalarda set action'lar hiçbir şey yapmaz → ilk parçada DUR (yarım düzen)
  hooks.beforeTx = (name) => name === "BAĞLA: kesim hazırlığı" && (M.setSem = "noop");
  const o1 = await clickAndWait("btn-bind", yes, doneRe);
  hooks.beforeTx = null;
  M.setSem = "real";
  if (!/✗ BAĞLA DURDU: İLK PARÇA TUTMADI: kalibre edilmiş kırpma \(kuyruk = SetOutPoint, baş = SetInPoint\)/.test(o1) || !/Kalibrasyon kaydı silindi/.test(o1) || !/YEDEK PLAN/.test(o1))
    fail("kalibre edilmiş kural ilk parçada tutmayınca DURMADI:\n" + failLines(o1));
  else ok("kalibrasyon kuralı ilk parçada tutmadı → DURDU, kalibrasyon kaydı silindi, YEDEK PLAN yazıldı");
  if (/"guid-main-edit"/.test(lsStore.get("spread.trimCal.v1") ?? "")) fail("tutmayan kalibrasyon kaydı silinmedi");
  if (!/Ctrl\+Z'ye 9 kez bas/.test(o1)) fail("geri alma talimatı yanlış (7 kalibrasyon + kesim hazırlığı + ilk parça = 9)");
  const n = counters.txNames.length;
  // v1.2.1: kilit değil SORU ("yarım kalmış görünüyor. … yine de çalıştırılsın mı?"); Vazgeç → hiçbir şey
  let q = "";
  const out = await clickAndWait("btn-bind", async (x) => ((q = x), no()), doneRe);
  if (!/^Bu sequence'ta önceki Bağla yarım kalmış görünüyor: .*YARIM hâlde/.test(q) || !/İptal edildi/.test(out) || counters.txNames.length !== n) fail("yarım düzende BAĞLA sormadı / yeniden başladı:\n" + q + "\n" + out);
  else ok("geri alınmamış yarım düzende BAĞLA → kilit değil soru ('yarım kalmış görünüyor'); Vazgeç → BAŞLAMADI");
  for (let i = 0; i < 9; i++) undo();
  if (mainTracks() !== afterCollect) fail("Ctrl+Z × 9 geri getirmedi");
  const out2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(out2) || !/KALİBRASYON SONUCU/.test(out2)) fail("geri aldıktan sonra BAĞLA (yeniden ölçerek) çalışmadı:\n" + failLines(out2));
  else ok("Ctrl+Z × 9 sonrası BAĞLA yeniden ölçtü ve normal çalıştı");
};

scenarios.notcollected = async () => {
  setupSync(smallSpec());
  await startHelper();
  const before = JSON.stringify(state.sequences, repl);
  const out = await clickAndWait("btn-bind", yes, doneRe);
  if (!/Önce TOPLA'ya bas: bu sequence için TOPLA kaydı yok/.test(out) || JSON.stringify(state.sequences, repl) !== before) fail("TOPLA'sız BAĞLA durmadı:\n" + out);
  else ok("TOPLA yapılmadan BAĞLA → 'önce TOPLA' (TOPLA kaydı yok; track sırasından tahmin edilmez), hiçbir şey değişmedi");
};

scenarios.limits = async () => {
  const cams = [{ name: "A038C001_260912AA.MP4", start: sec(0), dur: sec(700) }];
  const wavs = Array.from({ length: 270 }, (_, i) => ({ name: `R${String(i).padStart(3, "0")}_Tr1.WAV`, start: sec(2 + 2 * i), dur: sec(1.5) }));
  setupSync({ cams, wavs, others: [] });
  // hazırlık TOPLA'sı (270 kısa ses uzun kameranın içinde → şüpheli üye sorusu: Hayır = oturumda kalsın)
  const o1 = await clickAndWait("btn-collect", async (x) => (/ŞÜPHELİ ÜYE/.test(x) ? no() : yes()), doneRe);
  if (!/✓ TOPLA tamam: 1 oturum/.test(o1)) return fail("hazırlık TOPLA'sı tamamlanmadı:\n" + o1.split("\n").slice(-5).join("\n"));
  await startHelper();
  const before = JSON.stringify(state.sequences, repl);
  const out = await clickAndWait("btn-bind", yes, doneRe);
  // 1 kamera + 270 ses + 2 korunan kamera sesi (baştaki 2 sn ve sondaki 158.5 sn harici sessiz) = 273
  if (!/bağlanacak 273 öğe var, yardımcı en çok 256 kabul ediyor/.test(out) || JSON.stringify(state.sequences, repl) !== before)
    fail("grup boyutu sınırı kesmeden önce yakalanmadı:\n" + out.split("\n").slice(-6).join("\n"));
  else ok("grup yardımcının sınırını aşıyor → kesmeden ÖNCE plan hatası");
};

scenarios.identity = async () => {
  const { identify, sourceKey } = require(path.join(DIST, "src", "identity.js"));
  const cases = [
    ["A038C001_260912BD.MP4", "cinema", "A", null, "38.1"],
    ["A041C011_260923UW.MP4", "cinema", "A", null, "41.11"],
    ["C0142.MP4", "sony", "Sony", null, "142"],
    ["DJI_02_20260923_175336.WAV", "dji", "DJI", null, "20260923.175336.2"],
    ["260912_133224_Tr1.WAV", "zoom", "Zoom", "Tr1", "260912.133224"],
    ["260923_171315_TrLR.WAV", "zoom", "Zoom", "TrLR", "260923.171315"],
    ["ZOOM0001_LR.WAV", "generic", "ZOOM", "LR", "1"],
    ["ZOOM0001_Tr2.WAV", "generic", "ZOOM", "Tr2", "1"],
    ["TAKE_trim_0007.WAV", "generic", "TAKE_trim", null, "7"],
    ["MVI_1234.MOV", "generic", "MVI", null, "1234"],
  ];
  const bad = cases.filter(([n, p, d, ch, o]) => {
    const id = identify(n);
    return id.pattern !== p || id.device !== d || id.channel !== ch || id.order.join(".") !== o;
  });
  if (bad.length) fail(`kimlik: ${bad.map(([n]) => `${n} → ${JSON.stringify(identify(n))}`).join("; ")}`);
  else ok("kimlik: sinema (A, makara.klip), Sony (sayaç), DJI (tarih.saat.sayaç), Zoom (kayıt = tarih_saat, kanal), bilinmeyen (rakamsız ad, son sayı, sondaki kanal eki ayrı)");
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
  const { makePlan } = require(path.join(DIST, "src", "plan.js"));
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

// ------------------------------------------------------------ v1.2.0 güncelleme (sahte latest.json + sahte https + sahte süreçler)
// Gerçek yardımcı (helper.js + updater.js) ve gerçek panel akışı; ağ, Adobe kurucusu ve cmd.exe sahte. Yardımcı klasörü, veri klasörü
// ve proje dosyası geçici klasörde GERÇEK dosyalar (yedek / geri yükleme / değişme zamanı gerçekten sınanır).
const UPD = require(path.join(__dirname, "..", "..", "cep-helper", "js", "updater.js"));
const { EventEmitter } = require("events");
/** Sıkıştırmasız (stored) zip — updater.readZip'in sınanması için bağımsız yazıcı. */
function makeZip(files) {
  const locals = [];
  const cds = [];
  let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const nm = Buffer.from(name, "utf8");
    const crc = UPD.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(off, 42);
    locals.push(lh, nm, data);
    cds.push(cd, nm);
    off += 30 + nm.length + data.length;
  }
  const cdBuf = Buffer.concat(cds);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}
function kitZip(ver) {
  return makeZip({
    "spread.ccx": makeZip({ "manifest.json": `{"id":"com.badideagency.spread","version":"${ver}"}`, "index.js": "// panel" }),
    "KUR.cmd": "rem kur",
    "KALDIR.cmd": "rem kaldir",
    "OKU_BENI.txt": "oku",
    "SpreadHelper/CSXS/manifest.xml": `<ExtensionManifest Version="12.0" ExtensionBundleId="com.badideagency.spread.helper" ExtensionBundleVersion="${ver}"/>`,
    "SpreadHelper/.debug": "<ExtensionList/>",
    "SpreadHelper/index.html": `<html>yardımcı ${ver}</html>`,
    "SpreadHelper/js/spread-core.js": "// çekirdek",
    "SpreadHelper/js/helper.js": `var VERSION = "${ver}";`,
    "SpreadHelper/js/updater.js": "// güncelleyici",
    "SpreadHelper/js/senkron.js": "// senkron",
    "SpreadHelper/js/panel.js": "// panel",
    "SpreadHelper/jsx/host.jsx": "// host",
    "SpreadHelper/js/yeni-dosya.js": "// yalnız yeni sürümde",
  });
}
const U_EXT = path.join(TMPHOME, "extensions", "com.badideagency.spread.helper");
const U_UPIA = path.join(TMPHOME, "UnifiedPluginInstallerAgent.exe");
const U_HOST = "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Adobe Premiere Pro.exe";
const OLD_FILES = { "CSXS/manifest.xml": '<ExtensionManifest ExtensionBundleVersion="1.2.0"/>', ".debug": "<x/>", "index.html": "<html>eski</html>", "js/helper.js": 'var VERSION = "1.2.0";', "js/updater.js": "// eski", "js/panel.js": "// eski panel", "js/spread-core.js": "// eski çekirdek", "jsx/host.jsx": "// eski host" };
/** Klasördeki dosyalar → { göreli yol: içerik } */
function readTree(dir) {
  const out = {};
  if (!fsReal.existsSync(dir)) return out;
  const walk = (d, base) => {
    for (const n of fsReal.readdirSync(d)) {
      const p = path.join(d, n);
      const rel = base ? `${base}/${n}` : n;
      if (fsReal.statSync(p).isDirectory()) walk(p, rel);
      else out[rel] = fsReal.readFileSync(p, "utf8");
    }
  };
  walk(dir, "");
  return out;
}
function updReset(over = {}) {
  fsReal.rmSync(path.join(TMPHOME, "extensions"), { recursive: true, force: true });
  for (const n of ["yedek", "indirilen", "update.log", "restart-spread.cmd"]) fsReal.rmSync(path.join(updDataDir(), n), { recursive: true, force: true });
  for (const [rel, c] of Object.entries(OLD_FILES)) {
    const p = path.join(U_EXT, ...rel.split("/"));
    fsReal.mkdirSync(path.dirname(p), { recursive: true });
    fsReal.writeFileSync(p, c);
  }
  fsReal.writeFileSync(U_UPIA, "exe");
  Object.assign(upd, { latest: null, latestOffline: false, files: new Map(), spawns: [], upiaCode: 0, listShows: true, installed: null, saveWrites: true, saveReturns: undefined, httpsOffline: false, reloads: 0, uxpReloads: 0, restarterFail: false, renameFaultAt: 0, renames: 0, forceBusy: false }, over);
  mockProjects.length = 0;
  hostile.quit = false;
  counters.saves = 0;
}
function updDataDir() {
  return path.dirname(HELPER.infoPath(path, "darwin", TMPHOME));
}
function fakeHttps() {
  return {
    get(url, opts, cb) {
      const req = new EventEmitter();
      req.setTimeout = () => req;
      req.destroy = (e) => e && req.emit("error", e);
      setTimeout(() => {
        if (upd.httpsOffline) return req.emit("error", Object.assign(new Error("getaddrinfo ENOTFOUND raw.githubusercontent.com"), { code: "ENOTFOUND" }));
        const key = String(url).split("?")[0];
        const body = key.endsWith("/latest.json") ? (upd.latest ? Buffer.from(JSON.stringify(upd.latest)) : null) : upd.files.get(key);
        const res = new EventEmitter();
        res.headers = {};
        res.resume = () => {};
        res.statusCode = body ? 200 : 404;
        cb(res);
        if (body) res.emit("data", body);
        res.emit("end");
      }, 2);
      return req;
    },
  };
}
// v1.2.1: yüklü sürüm = paketin sürümü; "yeni sürüm" bir yama yukarısı (sürüm her yükseldiğinde senaryolar aynen çalışsın)
const CUR_VER = JSON.parse(fsReal.readFileSync(path.join(__dirname, "..", "public", "manifest.json"), "utf8")).version;
const NEXT_VER = CUR_VER.replace(/\d+$/, (n) => String(Number(n) + 1));
function fakeChild() {
  return {
    spawn(cmd, args, opts) {
      upd.spawns.push({ cmd, args, opts });
      const cp = new EventEmitter();
      cp.stdout = new EventEmitter();
      cp.stderr = new EventEmitter();
      cp.unref = () => {};
      cp.kill = () => {};
      // Node 15.1+: başarılı başlatmada 'spawn'; upd.restarterFail → yeniden başlatıcı için 'error' (Windows'ta ENOENT gibi)
      const isRestarter = !!(opts && opts.env && opts.env.SPREAD_RESTARTER);
      setTimeout(() => (isRestarter && upd.restarterFail ? cp.emit("error", Object.assign(new Error("spawn cmd.exe ENOENT"), { code: "ENOENT" })) : cp.emit("spawn")), 1);
      // sahte Adobe kurucusu: /install → çıkış kodu upd.upiaCode; /list all → kurulduysa (ve upd.listShows !== false) "Spread <sürüm>"
      if (cmd === U_UPIA && args[0] === "/install")
        setTimeout(() => {
          if (!upd.upiaCode) upd.installed = /spread-(\d+\.\d+\.\d+)\.ccx$/.exec(args[1])?.[1] ?? null;
          cp.stdout.emit("data", upd.upiaCode ? "Failed to install, status = -160!" : `Installation Successful for extension with file path = ${args[1]}`);
          cp.emit("close", upd.upiaCode);
        }, 5);
      if (cmd === U_UPIA && args[0] === "/list")
        setTimeout(() => {
          const v = upd.listShows === false ? CUR_VER : upd.installed ?? CUR_VER;
          cp.stdout.emit("data", `2 extension installed for Premiere Pro (ver 26.5.1)\r\n  Status   Extension Name   Version\r\n  Enabled  Spread           ${v}\r\n  Enabled  Başka Eklenti    3.1.0\r\n`);
          cp.emit("close", 0);
        }, 5);
      return cp;
    },
  };
}
/** Güncelleyicili yardımcı (paneldeki gibi: https, zlib, child_process, uzantı klasörü, Premiere yolu, ↻). */
async function startUpdHelper(extra = {}) {
  await stopHelper();
  const ctx = vm.createContext({ app: fakeApp });
  vm.runInContext(HOST_SRC, ctx);
  helperEval.fn = (script, cb) =>
    setTimeout(() => {
      let r;
      try {
        r = vm.runInContext(script, ctx, { timeout: 5000 });
      } catch (e) {
        r = "EvalScript error.";
      }
      cb(String(r));
    }, 1);
  // fs: upd.renameFaultAt = n → n. yeniden adlandırma EBUSY ile düşer (CEP dosyayı kilitlemiş gibi; .new yazılmış, taşınamadı)
  const fsU = Object.assign({}, fsReal, {
    renameSync: (a, b) => {
      upd.renames++;
      if (upd.renameFaultAt && upd.renames === upd.renameFaultAt) throw Object.assign(new Error(`EBUSY: resource busy or locked, rename '${a}'`), { code: "EBUSY" });
      return fsReal.renameSync(a, b);
    },
  });
  helper = HELPER.createHelper({
    http, crypto: cryptoReal, fs: fsU, path, os: osReal, core: CORE, home: TMPHOME, platform: "darwin", log: (l) => helperLog.push(l),
    evalScript: (script, cb) => helperEval.fn(script, cb),
    createUpdater: (d) => {
      const u = UPD.createUpdater(d);
      return Object.assign({}, u, { isBusy: () => upd.forceBusy || u.isBusy() });
    },
    https: fakeHttps(), zlib: require("zlib"), childProcess: fakeChild(), env: { ComSpec: "C:\\Windows\\system32\\cmd.exe" },
    extDir: U_EXT, hostApp: U_HOST, updaterPlatform: "win32", upiaCandidates: [U_UPIA],
    reload: () => upd.reloads++,
    ...extra,
  });
  await helper.start();
  // yeni sunucu: Node fetch'in havuzundaki eski (kapatılmış) bağlantı ilk isteği düşürebilir → nokta yeşillenene kadar yeniden dene
  for (let i = 0; i < 6; i++) {
    els["btn-helper"].click();
    await sleep(300);
    if (/\bon\b/.test(document.getElementById("helper-dot").className)) break;
  }
  return helper;
}
/** latest.json'u yayımla (zip + sha256); sha256 bilerek bozulabilir. */
function publish(ver, { badSha = false, notes = ["Daha hızlı bağlama.", "Yeni görünüm."] } = {}) {
  const zip = kitZip(ver);
  const url = `${UPD.ZIP_PREFIX}main/releases/Spread_Kurulum_v${ver}.zip`;
  upd.files.set(url, zip);
  upd.latest = { version: ver, date: "2026-09-27", notes, zip_url: url, sha256: badSha ? "0".repeat(64) : cryptoReal.createHash("sha256").update(zip).digest("hex"), min_premiere: "25.6.0" };
  return { zip, url };
}
async function checkNow() {
  els["btn-check-update"].click();
  await sleep(150);
}
const stripText = () => (els["update-strip"].style.display === "block" ? els["update-strip"].textContent : "(gizli)");
const resultHead = () => els["result-head"].textContent;
/** Şeride bas; sorulara sırayla cevap ver (answers: "Evet" / "Hayır"); sonuç satırı gelince döner. */
async function runStrip(answers) {
  const asked = [];
  const out = await clickAndWait(
    "update-strip",
    async (q) => {
      asked.push({ q, title: els["ask-title"].textContent, summary: Array.from(els["ask-summary"].children).map((c) => c.textContent), yes: els["ask-yes"].textContent, no: els["ask-no"].textContent });
      const a = answers.shift();
      await (a === "Evet" ? yes() : no());
    },
    /Yeniden başlatma sonraya kaldı|GÜNCELLEME DURDU|YENİDEN BAŞLATMA DURDU|Projeler kaydedildi ve doğrulandı|İptal edildi — güncelleme/
  );
  await sleep(120);
  return { out, asked };
}

scenarios.update_same = async () => {
  setupSync(smallSpec());
  updReset();
  await startUpdHelper();
  publish(CUR_VER);
  await checkNow();
  if (stripText() !== "(gizli)") fail(`aynı sürümde şerit göründü: ${stripText()}`);
  else ok(`latest.json = yüklü sürüm (${CUR_VER}) → şerit YOK`);
  publish("1.1.9");
  await checkNow();
  if (stripText() !== "(gizli)") fail("eski sürümde şerit göründü");
  else ok("latest.json eski sürüm → şerit YOK");
  await stopHelper();
};

scenarios.update_offline = async () => {
  setupSync(smallSpec());
  updReset({ latestOffline: true });
  await startUpdHelper();
  markLog();
  const resBefore = document.getElementById("result").style.display;
  await checkNow();
  const l = newLog();
  if (stripText() !== "(gizli)" || !/Güncelleme denetlenemedi \(Network request failed\)/.test(l) || document.getElementById("result").style.display !== resBefore || /✗/.test(l))
    fail(`internet yokken: şerit ${stripText()}, günlük ${l}`);
  else ok("internet yok → sessizce geçer (şerit yok, hata yok; günlükte soluk tek satır)");
  await stopHelper();
};

scenarios.update_new = async () => {
  setupSync(smallSpec());
  updReset();
  await startUpdHelper();
  const { zip } = publish(NEXT_VER);
  const before = readTree(U_EXT);
  await checkNow();
  if (stripText() !== `Yeni sürüm ${NEXT_VER} · Güncelle`) return fail(`şerit: ${stripText()}`);
  ok(`yeni sürüm → üstte şerit 'Yeni sürüm ${NEXT_VER} · Güncelle'`);
  const { asked } = await runStrip(["Evet", "Hayır"]);
  const a1 = asked[0], a2 = asked[1];
  if (!a1 || a1.title !== `Yeni sürüm ${NEXT_VER}` || a1.yes !== "Güncelle" || a1.no !== "Şimdi değil" || a1.summary.join("|") !== "Daha hızlı bağlama.|Yeni görünüm.")
    fail(`güncelleme sorusu: ${JSON.stringify(a1)}`);
  else ok("şeride bas → notlar (1–3 madde) + [Şimdi değil] [Güncelle]");
  if (!a2 || a2.title !== "Projeyi kaydedip Premiere'i yeniden başlatayım mı?" || a2.yes !== "Yeniden başlat" || a2.no !== "Sonra") fail(`yeniden başlatma sorusu: ${JSON.stringify(a2)}`);
  else ok("kurulunca → 'Projeyi kaydedip Premiere'i yeniden başlatayım mı?' [Sonra] [Yeniden başlat]");
  const after = readTree(U_EXT);
  const kitHelper = Object.fromEntries(UPD.readZip(require("zlib"), zip).filter((e) => e.name.startsWith("SpreadHelper/")).map((e) => [e.name.slice(13), e.data.toString("utf8")]));
  const wrote = Object.entries(kitHelper).every(([k, v]) => after[k] === v);
  const yedek = path.join(updDataDir(), "yedek");
  const bdirs = fsReal.existsSync(yedek) ? fsReal.readdirSync(yedek) : [];
  const backup = bdirs.length === 1 ? readTree(path.join(yedek, bdirs[0])) : {};
  if (!wrote || JSON.stringify(backup) !== JSON.stringify(before)) fail(`yardımcı dosyaları / yedek: yazıldı=${wrote}, yedek=${bdirs.length}`);
  else ok(`yardımcı: önce klasörün TAMAMI yedeklendi (${Object.keys(before).length} dosya), sonra ${NEXT_VER} dosyaları yazıldı`);
  const upia = upd.spawns.filter((x) => x.cmd === U_UPIA);
  const ccx = upia[0] && fsReal.readFileSync(upia[0].args[1]);
  const kitCcx = UPD.readZip(require("zlib"), zip).find((e) => e.name === "spread.ccx").data;
  if (upia.length !== 2 || upia[0].args[0] !== "/install" || upia[1].args.join(" ") !== "/list all" || !ccx || !ccx.equals(kitCcx) || upd.spawns.length !== 2)
    fail(`UPIA çağrısı: ${JSON.stringify(upd.spawns.map((x) => [x.cmd, x.args]))}`);
  else ok(`panel: UnifiedPluginInstallerAgent /install <indirilen spread.ccx> (KUR.cmd ile aynı), sonra /list all'da 'Spread ${NEXT_VER}' doğrulandı`);
  if (!resultHead().includes(`${NEXT_VER} kuruldu; Premiere'i yeniden başlatınca açılır`) || hostile.quit || counters.saves) fail(`sonuç: ${resultHead()} quit=${hostile.quit}`);
  else ok(`'Sonra' → Premiere'e dokunulmadı; tek satır '${NEXT_VER} kuruldu; Premiere'i yeniden başlatınca açılır.'`);
  const ulog = fsReal.readFileSync(path.join(updDataDir(), "update.log"), "utf8");
  if (!/sha256 doğru/.test(ulog) || !/paket denetimi tamam/.test(ulog) || !ulog.includes(`UPIA /list all: doğrulandı — Enabled Spread ${NEXT_VER}`) || !/bitti: yardımcı kuruldu, panel kuruldu/.test(ulog)) fail(`update.log: ${ulog}`);
  else ok("güncelleme günlüğü (update.log): sha256 → paket denetimi → yedek → yazma → UPIA → bitti");
  copied = null;
  els["btn-issue"].click();
  for (let i = 0; i < 40 && !copied; i++) await sleep(100);
  if (!/---- GÜNCELLEME GÜNLÜĞÜ \(Spread Helper, update\.log/.test(copied ?? "") || !/sha256 doğru/.test(copied ?? "")) fail("Sorun bildir raporunda güncelleme günlüğü yok");
  else ok("Sorun bildir raporu güncelleme günlüğünü (update.log) içerir");
  await stopHelper();
};

scenarios.update_badsha = async () => {
  setupSync(smallSpec());
  updReset();
  await startUpdHelper();
  publish(NEXT_VER, { badSha: true });
  const before = readTree(U_EXT);
  await checkNow();
  await runStrip(["Evet"]);
  const yedek = path.join(updDataDir(), "yedek");
  if (!/Güncelleme yapılamadı; eski sürüm yerinde/.test(resultHead()) || JSON.stringify(readTree(U_EXT)) !== JSON.stringify(before) || fsReal.existsSync(yedek) || upd.spawns.length || hostile.quit)
    fail(`bozuk sha256: ${resultHead()} spawns=${upd.spawns.length} yedek=${fsReal.existsSync(yedek)}`);
  else ok("sha256 tutmuyor → DUR: yardımcı klasörü birebir aynı, yedek bile alınmadı, kurucu çalışmadı ('eski sürüm yerinde')");
  const ulog = fsReal.readFileSync(path.join(updDataDir(), "update.log"), "utf8");
  if (!/DURDU \(sha256\): sha256 tutmuyor/.test(ulog)) fail(`update.log: ${ulog}`);
  else ok("update.log: 'DURDU (sha256): sha256 tutmuyor … hiçbir şey değişmedi'");
  await stopHelper();
};

scenarios.update_helper_closed = async () => {
  setupSync(smallSpec());
  updReset();
  await stopHelper();
  els["btn-helper"].click();
  await sleep(300);
  publish(NEXT_VER);
  await checkNow();
  if (stripText() !== `Yeni sürüm ${NEXT_VER} · Güncellemek için Spread Helper açık olmalı` || els["update-strip"].className !== "wait") return fail(`yardımcı kapalı şerit: ${stripText()}`);
  ok(`yardımcı kapalı → şerit 'Yeni sürüm ${NEXT_VER} · Güncellemek için Spread Helper açık olmalı' (vurgusuz)`);
  els["update-strip"].click();
  await sleep(200);
  if (els.ask.style.display === "block" || upd.spawns.length) fail("yardımcı kapalıyken güncelleme başladı");
  else ok("şeride basınca güncelleme BAŞLAMAZ (yardımcı yeniden denenir)");
};

scenarios.update_install_fail = async () => {
  for (const [label, over] of [
    ["UPIA çıkış kodu 1", { upiaCode: 1 }],
    ["UPIA 0 döndü ama /list all'da yeni sürüm yok", { listShows: false }],
  ]) {
    setupSync(smallSpec());
    updReset(over);
    await startUpdHelper();
    publish(NEXT_VER);
    await checkNow();
    const { asked } = await runStrip(["Evet", "Hayır"]);
    const ex = upd.spawns.find((x) => x.args[2] === 'start "" "%SPREAD_CCX%"');
    if (!ex || !ex.opts.env.SPREAD_CCX.endsWith(`spread-${NEXT_VER}.ccx`) || !ex.opts.windowsVerbatimArguments || !asked[1] || !/Install'a bas/.test(asked[1].summary[0]))
      fail(`${label}: ${JSON.stringify(upd.spawns.map((x) => [x.cmd, x.args]))} ${JSON.stringify(asked[1])}`);
    else ok(`${label} → spread.ccx Creative Cloud'la açıldı (start ""); soru 'açılan Creative Cloud penceresinde Install'a bas'`);
    if (!/Önce Creative Cloud penceresinde Install'a bas/.test(els["result-hint"].textContent)) fail(`ipucu: ${els["result-hint"].textContent}`);
    else ok("'Sonra' → ipucu 'Önce Creative Cloud penceresinde Install'a bas.'");
    await stopHelper();
  }
};

scenarios.update_write_fail = async () => {
  for (const [label, over, extra] of [
    ["yazma hatası (3 dosyadan sonra)", {}, { faultAfter: 3 }],
    ["2. dosya kilitli (.new yazıldı, üstüne taşınamadı: EBUSY)", { renameFaultAt: 2 }, {}],
  ]) {
    setupSync(smallSpec());
    updReset(over);
    await startUpdHelper(extra);
    publish(NEXT_VER);
    const before = readTree(U_EXT);
    await checkNow();
    await runStrip(["Evet"]);
    const after = readTree(U_EXT);
    if (!/Güncelleme yapılamadı; eski sürüm yerinde/.test(resultHead()) || JSON.stringify(after) !== JSON.stringify(before) || upd.spawns.length)
      fail(`${label}: ${resultHead()} aynı=${JSON.stringify(after) === JSON.stringify(before)} (${Object.keys(after).filter((k) => !(k in before)).join(", ")}) spawns=${upd.spawns.length}`);
    else ok(`${label} → yedek geri yüklendi: klasör birebir eski hâli (yeni ya da .new dosya kalmadı), kurucu çalışmadı`);
    await stopHelper();
  }
};

scenarios.update_restart = async () => {
  setupSync(smallSpec());
  updReset();
  const proj = path.join(TMPHOME, "Çekim 12 Eylül.prproj");
  fsReal.writeFileSync(proj, "proje");
  const t0 = new Date(Date.now() - 60000);
  fsReal.utimesSync(proj, t0, t0);
  mockProjects.push({ name: "Çekim 12 Eylül", path: proj, id: "doc-1" });
  await startUpdHelper();
  publish(NEXT_VER);
  await checkNow();
  await runStrip(["Evet", "Evet"]);
  await sleep(1100); // yardımcı yanıttan 800 ms sonra app.quit
  const cmdFile = path.join(updDataDir(), "restart-spread.cmd");
  const rs = upd.spawns.find((x) => x.opts && x.opts.env && x.opts.env.SPREAD_RESTARTER);
  const e = rs ? rs.opts.env : {};
  if (
    counters.saves !== 1 || !rs || rs.cmd !== "C:\\Windows\\system32\\cmd.exe" || JSON.stringify(rs.args) !== JSON.stringify(["/d", "/c", 'start "" /b cmd /d /c call "%SPREAD_RESTARTER%"']) ||
    !rs.opts.windowsVerbatimArguments || rs.opts.detached || e.SPREAD_RESTARTER !== cmdFile || e.SPREAD_EXE !== U_HOST || e.SPREAD_IMG !== "Adobe Premiere Pro.exe" || e.SPREAD_PRJ !== path.win32.normalize(proj)
  )
    fail(`yeniden başlatıcı: saves=${counters.saves} ${JSON.stringify(rs)}`);
  else ok("'Yeniden başlat' → proje kaydedildi (dosya gerçekten yazıldı) → yeniden başlatıcı: cmd /c start \"\" /b cmd /c call restart-spread.cmd (Premiere.exe, süreç adı, proje ortam değişkeniyle)");
  if (fsReal.readFileSync(cmdFile, "utf8") !== UPD.RESTART_CMD || /[^\x00-\x7e]/.test(UPD.RESTART_CMD) || !/\r\n/.test(UPD.RESTART_CMD)) fail("restart-spread.cmd içeriği / ASCII / CRLF");
  else ok("restart-spread.cmd: yalnız ASCII, CRLF");
  if (!hostile.quit || !/Premiere kapanıyor/.test(resultHead())) fail(`quit=${hostile.quit} sonuç=${resultHead()}`);
  else ok("ancak ondan SONRA app.quit(); sonuç 'Premiere kapanıyor; birkaç saniye sonra aynı projeyle yeniden açılacak.'");
  await stopHelper();
};

scenarios.update_restart_unsaved = async () => {
  for (const [label, setup] of [
    ["hiç kaydedilmemiş proje (yol yok)", () => mockProjects.push({ name: "Adsız", path: "", id: "doc-1" })],
    ["save() dosyayı yazmadı", () => {
      const p = path.join(TMPHOME, "yazilmayan.prproj");
      fsReal.writeFileSync(p, "x");
      mockProjects.push({ name: "Yazılmayan", path: p, id: "doc-1" });
      upd.saveWrites = false;
    }],
    ["yeniden başlatıcı başlatılamadı (spawn hatası)", () => {
      const p = path.join(TMPHOME, "baslatici.prproj");
      fsReal.writeFileSync(p, "x");
      const t0 = new Date(Date.now() - 60000);
      fsReal.utimesSync(p, t0, t0);
      mockProjects.push({ name: "Başlatıcı", path: p, id: "doc-1" });
      upd.restarterFail = true;
    }],
    ["save() 1 döndü", () => {
      const p = path.join(TMPHOME, "hata.prproj");
      fsReal.writeFileSync(p, "x");
      mockProjects.push({ name: "Hata", path: p, id: "doc-1" });
      upd.saveReturns = 1;
    }],
  ]) {
    setupSync(smallSpec());
    updReset();
    setup();
    await startUpdHelper();
    publish(NEXT_VER);
    await checkNow();
    await runStrip(["Evet", "Evet"]);
    await sleep(1100);
    if (hostile.quit || (!upd.restarterFail && upd.spawns.some((x) => x.opts && x.opts.env && x.opts.env.SPREAD_RESTARTER)) || !/Premiere kapatılmadı/.test(resultHead()))
      fail(`${label}: quit=${hostile.quit} sonuç=${resultHead()}`);
    else if (upd.restarterFail && !/yeniden başlatma hazırlanamadı/.test(resultHead())) fail(`${label}: sonuç ${resultHead()}`);
    else ok(`${label} → Premiere KAPATILMADI (app.quit yok); '${resultHead().replace(/^✗ /, "")}'`);
    await stopHelper();
  }
};

scenarios.reload = async () => {
  setupSync(smallSpec());
  updReset();
  await startUpdHelper();
  globalThis.location = { reload: () => upd.uxpReloads++ };
  els["btn-reload"].click();
  await sleep(1000);
  if (upd.reloads !== 1 || upd.uxpReloads !== 1) fail(`↻: yardımcı ${upd.reloads}, panel ${upd.uxpReloads}`);
  else ok("↻ → yardımcı paneli yeniden yüklendi (sunucu önce kapanır), sonra Spread paneli (location.reload)");
  // sahte location.reload sayfayı yenilemez → panel 5 sn sonra kendiliğinden açılır (gerçekte yeniden yüklenmediyse de kilitli kalmaz)
  await sleep(5300);
  if (!/↻ Panel yeniden yüklenmedi/.test(newLog())) fail("yeniden yüklenmeyen panel 5 sn sonra açılmadı");
  else ok("yeniden yükleme olmazsa panel 5 sn sonra kilidi açar (kilitli kalmaz)");
  // v1.2.1: ↻ soru sormaz; bu sequence'ın kayıtlarını siler (başka sequence'ınkini ve kalibrasyonu değil) — ayrıntı: reload_scope
  lsStore.set("spread.stoppedState.v2", JSON.stringify({ "guid-main-edit": { op: "BAĞLA", digest: "x" } }));
  upd.reloads = upd.uxpReloads = 0;
  els["btn-reload"].click();
  await sleep(1000);
  if (els.ask?.style.display === "block" || upd.reloads !== 1 || upd.uxpReloads !== 1 || /guid-main-edit/.test(lsStore.get("spread.stoppedState.v2") ?? ""))
    fail(`yarım işte ↻: soru ${els.ask?.style.display}, yardımcı ${upd.reloads}, panel ${upd.uxpReloads}, kayıt ${lsStore.get("spread.stoppedState.v2")}`);
  else ok("yarım iş kaydı varken ↻ → soru yok; kayıt silindi, iki panel yenilendi");
  await sleep(5300);
  lsStore.delete("spread.stoppedState.v2");
  // yardımcı meşgulken (güncelleme / bağlama) yardımcı yeniden YÜKLENMEZ; Spread yalnız kendini yeniler
  upd.forceBusy = true;
  upd.reloads = upd.uxpReloads = 0;
  markLog();
  els["btn-reload"].click();
  await sleep(900);
  if (upd.reloads || upd.uxpReloads !== 1 || !/Spread Helper yeniden yüklenmedi/.test(newLog())) fail(`meşgul yardımcıda ↻: yardımcı ${upd.reloads}, panel ${upd.uxpReloads}`);
  else ok("yardımcı meşgulken ↻ → yardımcı yeniden YÜKLENMEDİ (reddetti), yalnız Spread yenilendi");
  upd.forceBusy = false;
  await sleep(5300);
  delete globalThis.location;
  await stopHelper();
};

scenarios.update_unit = async () => {
  // latest.json doğrulayıcı ve zip okuyucu (yardımcı + yayın betiği aynı kodu kullanır)
  const good = { version: "1.2.1", date: "2026-09-27", notes: ["a"], zip_url: `${UPD.ZIP_PREFIX}main/releases/Spread_Kurulum_v1.2.1.zip`, sha256: "a".repeat(64), min_premiere: "25.6.0" };
  const bads = [
    ["zip başka alan adında", { zip_url: "https://evil.example/x.zip" }],
    ["zip başka depoda", { zip_url: "https://raw.githubusercontent.com/someone/else/main/x.zip" }],
    ["zip adresinde ..", { zip_url: `${UPD.ZIP_PREFIX}main/../x.zip` }],
    ["zip adresinde %2e%2e (normalleşince başka depo)", { zip_url: `${UPD.ZIP_PREFIX}%2e%2e/%2e%2e/evil/repo/main/x.zip` }],
    ["notlar 4 madde", { notes: ["a", "b", "c", "d"] }],
    ["notlar boş", { notes: [] }],
    ["sha256 kısa", { sha256: "abc" }],
    ["sürüm biçimi", { version: "1.2" }],
  ];
  let okAll = true;
  try {
    UPD.validateLatest(good);
  } catch (e) {
    okAll = false;
    fail(`geçerli latest.json reddedildi: ${e.message}`);
  }
  for (const [label, over] of bads) {
    try {
      UPD.validateLatest({ ...good, ...over });
      okAll = false;
      fail(`kabul edildi: ${label}`);
    } catch {
      /* beklenen */
    }
  }
  if (okAll) ok(`latest.json doğrulayıcı: geçerli kabul, ${bads.length} bozuk biçim reddedildi (başka alan adı / depo, '..', notlar, sha256, sürüm)`);
  const z = require("zlib");
  const evil = makeZip({ "../../evil.txt": "x" });
  let rej = false;
  try {
    UPD.readZip(z, evil);
  } catch (e) {
    rej = /güvensiz dosya adı/.test(e.message);
  }
  const corrupt = Buffer.from(kitZip("1.2.1"));
  corrupt[40] ^= 0xff; // ilk dosyanın verisi
  let crc = false;
  try {
    UPD.readZip(z, corrupt);
  } catch (e) {
    crc = /CRC tutmuyor/.test(e.message);
  }
  // depodaki GERÇEK kurulum zip'i (package-kurulum.sh, deflate) — yardımcının kuracağı paketle aynı denetimden geçmeli
  const relDir = path.join(__dirname, "..", "..", "release");
  const relZip = fsReal.readdirSync(relDir).find((n) => /^Spread_Kurulum_v\d+\.\d+\.\d+\.zip$/.test(n));
  const relVer = relZip && /v(\d+\.\d+\.\d+)\.zip$/.exec(relZip)[1];
  let real = [];
  let kitOk = false;
  try {
    real = UPD.readZip(z, fsReal.readFileSync(path.join(relDir, relZip)));
    UPD.checkKit(real, relVer);
    kitOk = true;
  } catch (e) {
    fail(`gerçek kurulum zip'i: ${e.message}`);
  }
  if (!rej || !crc || !kitOk) fail(`zip okuyucu: ../ reddi=${rej} CRC=${crc} paket=${kitOk}`);
  else ok(`zip okuyucu: '../' adı reddedildi, bozuk veri CRC'de yakalandı, gerçek ${relZip} (deflate, ${real.length} dosya) okundu ve paket denetiminden geçti`);
  let stale = false;
  try {
    UPD.checkCcx(z, makeZip({ "manifest.json": '{"id":"com.badideagency.spread","version":"1.1.0"}' }), "1.2.1");
  } catch (e) {
    stale = /sürümü 1\.1\.0, paket 1\.2\.1/.test(e.message);
  }
  if (!stale) fail("eski spread.ccx paket denetiminden geçti");
  else ok("paket denetimi: spread.ccx'in kendi manifest sürümü paketinkiyle aynı olmalı (eski .ccx reddedildi)");
  if (UPD.cmpVersion("1.10.0", "1.9.9") !== 1 || UPD.cmpVersion("1.2.0", "1.2.0") !== 0 || UPD.cmpVersion("1.2.0", "1.2.1") !== -1) fail("cmpVersion");
  else ok("sürüm karşılaştırma sayısal (1.10.0 > 1.9.9)");
};

// ------------------------------------------------------------ ekran görüntüleri (yalnız SPREAD_SCREENS ile; "all"a girmez)
if (SCREENS)
  scenarios.screens = async () => {
    const shot = (name) => {
      fsReal.writeFileSync(path.join(SCREENS, `${name}.html`), "<!DOCTYPE html>\n" + global.document.documentElement.outerHTML);
      ok(`ekran: ${name}`);
    };
    const visible = (id) => els[id] && els[id].style.display === "block";
    /** tıkla; ilk soru görünce shot(askName) + Devam; sonuç satırı gelince döner */
    const run = async (btn, askName, done) => {
      markLog();
      els[btn].click();
      let asked = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 60000) {
        await sleep(20);
        if (visible("ask")) {
          if (!asked && askName) shot(askName);
          asked = true;
          els["ask-yes"].click();
          await sleep(30);
        }
        if (done.test(newLog())) return sleep(150);
      }
      fail(`${btn}: zaman aşımı`);
    };
    const steps = (o) => lsStore.set("spread.steps.v1", JSON.stringify({ "guid-main-edit": o }));
    const SPREAD_OK = { kind: "ok", text: "58 klip kendi track'ine dağıtıldı.", at: "2026-09-26T10:00:00Z" };
    // 12 Eylül gerçek verisi (A27 / A30 çift kopyaları dahil); TrLR için seçim yok → v1.1.0 varsayılanı "Sil"; kamera sesi stereo,
    // Zoom Tr1/Tr2 mono, Premiere karışık grubu reddeder (gerçek 26.5.1 gibi)
    setupFromReport(R0912);
    M.chType = REAL_CH;
    M.linkRejectMixed = true;
    mockGen++;
    await startHelper();
    els["btn-helper"].click();
    await sleep(1800);
    shot("01-baslangic");
    // Dağıt + Synchronize bu panelde yapılmış sayılır
    steps({ spread: SPREAD_OK });
    await sleep(1700);
    shot("02-dagitildi");
    hooks.beforeTx = (name) => name === "TOPLA: park" && shot("04-topla-ilerleme");
    await run("btn-collect", "03-topla-onay", /✓ TOPLA tamam|✗ TOPLA DURDU/);
    await sleep(1600);
    shot("05-toplandi");
    hooks.beforeTx = (name) => name === "BAĞLA: kalibrasyon SetInPoint" && shot("07-bagla-olcum");
    await run("btn-bind", "06-bagla-onay", /✓ BAĞLA tamam|⚠ BAĞLA bitti|✗ BAĞLA DURDU|✓ KES tamam/);
    hooks.beforeTx = null;
    await sleep(1600);
    shot("08-bitti");
    // biten bir adımın adına tıkla → "Yeniden çalıştır"
    els["name-topla"].click();
    shot("12-yeniden-calistir");
    els["name-topla"].click();
    // hata örneği: set action'lar hiçbir şey yapmıyor → kalibrasyon kural vermez → DUR (kırmızı tek satır + "Ne yapmalıyım?")
    await collectThen(smallSpec());
    M.chType = null;
    M.linkRejectMixed = false;
    steps({ spread: { ...SPREAD_OK, text: "6 klip kendi track'ine dağıtıldı." }, topla: { kind: "ok", text: "1 oturum toplandı.", at: "2026-09-26T10:05:00Z" } });
    M.setSem = "noop";
    await run("btn-bind", null, /✗ BAĞLA DURDU/);
    await sleep(1600);
    shot("09-hata");
    els["result-help"].click();
    shot("10-hata-ne-yapmali");
    els["result-help"].click();
    // ⚙ Ayarlar: kaynak eşleme, eşik, boşluk, yardımcı, Durum raporu, günlük
    els["btn-issue"].click();
    await sleep(1500);
    els["btn-settings"].click();
    shot("11-ayarlar");
    els["btn-back"].click();
    await stopHelper();
    els["btn-helper"].click();
    await sleep(400);
    shot("13-yardimci-kapali");
    // v1.2.0: güncelleme şeridi → notlar [Şimdi değil] [Güncelle] → kurulunca [Sonra] [Yeniden başlat]
    updReset();
    await startUpdHelper();
    publish(NEXT_VER, { notes: ["Güncellemeler artık panelden gelir.", "↻ Yenile: iki panel tek tıkla yeniden yüklenir.", "Bağla onayında daha kısa özet."] });
    els["btn-settings"].click();
    els["btn-check-update"].click();
    await sleep(200);
    els["btn-back"].click();
    global.document.getElementById("result").style.display = "none";
    global.document.getElementById("issue-note").style.display = "none";
    shot("14-guncelleme-seridi");
    els["update-strip"].click();
    let n = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && n < 2) {
      await sleep(30);
      if (visible("ask")) {
        shot(n === 0 ? "15-guncelleme-onay" : "16-yeniden-baslat-onay");
        (n === 0 ? els["ask-yes"] : els["ask-no"]).click();
        n++;
        await sleep(60);
      }
    }
    await sleep(300);
    shot("17-guncellendi");
    await stopHelper();
  };

// ============================================================ v1.2.1 HATA 1: yanlış "kırpılmış kamera klibi" reddi
// Gerçek rapor (2026-09-29, A027C012_260803UH): 29.97 fps tek kamera, 12 dokunulmamış klip V9 / A9'da; out TAM KARE, medya süresi
// milisaniye hizalı → medya − out 0.026…0.940 kare. 1.2.0 hepsini "kırpılmış" saydı. Değerler fixtures/rapor-260929-a027.json.
const A027 = JSON.parse(fsReal.readFileSync(path.join(__dirname, "fixtures", "rapor-260929-a027.json"), "utf8"));
const FRAME2997 = BigInt(A027.frameTicks);
/** @param inOf klip index → in (tick) @param outOf klip index → out (tick) — gerçekten kırpılmış klip üretmek için */
function setupA027({ inOf = {}, outOf = {} } = {}) {
  setupSync({ cams: [], wavs: [], others: [] }); // tam sıfırlama (sayaçlar, bayraklar, localStorage)
  for (const k of Object.keys(projItems)) delete projItems[k];
  const T = A027.tracks;
  const s = mkSequence("A027C012_260803UH", "guid-a027", T.V, T.A);
  let t = 0n;
  A027.clips.forEach((c, i) => {
    const p = pi(c.name, BigInt(c.media), { channels: 1 });
    p.clipDur = BigInt(c.out); // overwrite "clip" kipinde yerleşen süre (Premiere'in tam kare sayısı)
    p.fps = 30000 / 1001;
    const inPt = inOf[i] ?? 0n;
    const d = (outOf[i] ?? BigInt(c.out)) - inPt;
    const L = "La" + i;
    s.v[T.camV - 1].push(mkClip("V", p, t, t + d, L, inPt));
    s.a[T.camA - 1].push(mkClip("A", p, t, t + d, L, inPt));
    t += d;
  });
  const wd = (t / 4n / 254016000n) * 254016000n; // 4 DJI WAV, ms hizalı, A4'te arka arkaya (sentetik süre)
  for (let k = 0; k < 4; k++) {
    const p = pi(`DJI_0${k + 1}.WAV`, wd, { video: false });
    s.a[T.wavA - 1].push(mkClip("A", p, wd * BigInt(k), wd * BigInt(k + 1)));
  }
  state.sequences = [s, state.sequences.find((x) => x.guid === "guid-other")];
  state.activeGuid = s.guid;
  M.timebase = FRAME2997;
  mockGen++;
  return s;
}
const a027Before = () => {
  const q = seqByGuid("guid-a027");
  return `${q.v.length}/${q.a.length}|${ser(q.v)}|${ser(q.a)}`; // id'ler ve seçim hariç
};
const undoN = (n) => {
  for (let i = 0; i < n; i++) undo();
};

scenarios.trimstate_unit = async () => {
  const T = require(path.join(DIST, "src", "trimstate.js"));
  const F = { ticks: FRAME2997, src: "footage" };
  const c = (inPt, outPt, mediaDur, frameTicks = String(FRAME2997)) => ({ inPt, outPt, mediaDur, frameTicks });
  const all = A027.clips.map((x) => T.trimState(c("0", x.out, x.media), null));
  if (all.some((x) => x.state !== "full")) fail(`A027: ${all.filter((x) => x.state !== "full").length} klip kırpılmış sayıldı`);
  else ok("A027'nin 12 klibi (medya − out 0.026…0.940 kare) → hepsi kırpılmamış");
  const f = FRAME2997;
  const cases = [
    ["medya − out = 1 kare − 1 tick", T.trimState(c("0", "1000000000000", String(1000000000000n + f - 1n)), null).state, "full"],
    ["medya − out = 1 kare", T.trimState(c("0", "1000000000000", String(1000000000000n + f)), null).state, "trimmed"],
    ["medya − out = 0", T.trimState(c("0", "1000000000000", "1000000000000"), null).state, "full"],
    ["medya − out = −1 tick (out medyayı aşıyor)", T.trimState(c("0", "1000000000001", "1000000000000"), null).state, "trimmed"],
    ["in = 1 tick", T.trimState(c("1", "1000000000000", "1000000000000"), null).state, "trimmed"],
    ["in = 1 tick, medya okunamıyor", T.trimState(c("1", "1000000000000", null), null).state, "trimmed"],
    ["in = 0, medya okunamıyor", T.trimState(c("0", "1000000000000", null), null).state, "unknown"],
  ];
  const bad = cases.filter(([, got, want]) => got !== want);
  if (bad.length) fail(`trimState sınırları: ${bad.map(([n, g, w]) => `${n}: ${g} (beklenen ${w})`).join("; ")}`);
  else ok(`trimState sınırları: ${cases.map(([n, g]) => `${n} → ${g}`).join("; ")}`);
  const fr = [
    ["footage önce", T.frameOf(String(FRAME2997), FRAME25).src, "footage"],
    ["footage yok → sequence", T.frameOf(null, FRAME25).src, "sequence"],
    ["ikisi de yok → 23.976", String(T.frameOf(null, null).ticks), "10594584000"],
    ["29.97 fps", String(T.fpsToFrameTicks(29.97)), "8475667200"],
    ["30000/1001 fps", String(T.fpsToFrameTicks(30000 / 1001)), "8475667200"],
    ["25 fps", String(T.fpsToFrameTicks(25)), "10160640000"],
    ["23.976 fps", String(T.fpsToFrameTicks(23.976)), "10594584000"],
    ["0 fps", String(T.fpsToFrameTicks(0)), "null"],
  ];
  const badF = fr.filter(([, g, w]) => g !== w);
  if (badF.length) fail(`kare süresi: ${badF.map(([n, g, w]) => `${n}: ${g} (beklenen ${w})`).join("; ")}`);
  else ok("kare süresi: footage → sequence timebase → 23.976; NTSC hızları tam değerine oturur (29.97 → 8475667200)");
  const o = { start: "1000", end: "2000", inPt: "0", outPt: "1000" };
  const w = (d) => ({ ...o, ...d });
  const fits = [
    ["birebir", T.overwriteFit(o, w({}), F), "exact"],
    ["kuyruk +0.73 kare", T.overwriteFit(o, w({ end: String(2000n + 6214924800n), outPt: String(1000n + 6214924800n) }), F), "tail"],
    ["kuyruk −0.5 kare", T.overwriteFit(o, w({ end: String(2000n - f / 2n), outPt: String(1000n - f / 2n) }), F), "tail"],
    ["kuyruk +1 kare", T.overwriteFit(o, w({ end: String(2000n + f), outPt: String(1000n + f) }), F), "other"],
    ["start kayması", T.overwriteFit(o, w({ start: "1001", end: "2001" }), F), "other"],
    ["baş (in +1)", T.overwriteFit(o, w({ start: "1001", inPt: "1" }), F), "other"],
    ["end ≠ out farkı", T.overwriteFit(o, w({ end: "2005", outPt: "1003" }), F), "other"],
  ];
  const badO = fits.filter(([, g, wnt]) => g !== wnt);
  if (badO.length) fail(`overwriteFit: ${badO.map(([n, g, wnt]) => `${n}: ${g} (beklenen ${wnt})`).join("; ")}`);
  else ok(`overwriteFit: ${fits.map(([n, g]) => `${n} → ${g}`).join("; ")}`);
};

scenarios.a027_spread = async () => {
  // (a) 12 kliplik gerçek veri → red YOK, plan kurulur; boş V/A track'leri kullanılır (yeni track yok); ilk overwrite birebir
  const s = setupA027();
  const before = a027Before();
  const exp = expectedLayout(s);
  let q = "";
  const out = await clickAndWait("btn-spread", async (x) => ((q = x), yes()));
  if (/kırpılmış/.test(out)) fail("A027: hâlâ 'kırpılmış' diyor:\n" + out.split("\n").filter((l) => /kırpılmış/.test(l)).join("\n"));
  else ok("A027: hiçbir kamera 'kırpılmış' sayılmadı (plan günlüğünde [kırpılmış] etiketi yok)");
  if (!/12 kamera, 4 ses bulundu, 0 track açılacak \(V 0, A 0\)/.test(q) || !/Taşınacak: 11 kamera/.test(q) || !/yerinde kalan: 1\./.test(q)) fail(`A027 onay metni: ${q}`);
  else ok("plan kuruldu: 12 kamera + 4 DJI WAV; 11 kamera taşınır, V9'daki yerinde kalır; 0 yeni track (V 12 / A 16'nın boşları kullanılır)");
  if (!/✓ SPREAD tamam/.test(out)) return fail("A027 SPREAD tamamlanmadı:\n" + out.split("\n").filter((l) => /DURDU|•|HATA/.test(l)).join("\n"));
  checkLayout(seqByGuid("guid-a027"), exp, "A027 (12 kamera + 4 DJI WAV)");
  const tx = counters.txNames.join(",");
  if (tx !== "Spread: yedek sequence,Spread: dağıt,Spread: ilk overwrite (ölçüm),Spread: overwrite") fail(`A027 transaction'lar: ${tx}`);
  else ok("transaction'lar: yedek → dağıt → ilk overwrite (ölçüm, birebir) → overwrite; SetOutPoint yok");
  if (!/ölçüm "A042C001_260925XX\.MP4": V1 birebir; A1 birebir/.test(out)) fail("ilk overwrite ölçümü günlükte yok");
  else ok('ölçüm günlükte: "A042C001": V1 birebir; A1 birebir');
  if (counters.setActions.size || counters.overwrites !== 11) fail(`set action ${counters.setActions.size}, overwrite ${counters.overwrites}`);
  else ok("11 overwrite, hiç set action yok");
  if (!/Ctrl\+Z'ye 3 kez bas/.test(out)) fail("Ctrl+Z sayısı 3 değil");
  undoN(3);
  if (a027Before() !== before) fail("Ctrl+Z × 3 aslına döndürmedi");
  else ok("Ctrl+Z × 3 → asıl düzen birebir");
};

scenarios.a027_status = async () => {
  // DURUM raporu aynı kuralı kullanır; kare kaynağı: footage → sequence timebase → 23.976
  setupA027();
  await clickAndWait("btn-status", yes, doneRe);
  let rep = els.report.value;
  const cams = rep.split("\n").filter((l) => /^  kamera V9 /.test(l));
  if (cams.length !== 12 || cams.some((l) => /\[kırpılmış\]/.test(l)) || !cams.every((l) => /tam boy/.test(l) && /29\.97 fps, proje öğesinin kare hızı/.test(l)))
    fail("DURUM: kamera kırpma satırları beklenen gibi değil:\n" + cams.join("\n"));
  else ok("DURUM: 12 kameranın hiçbiri [kırpılmış] değil (medya − out < 1 kare, kare = proje öğesinin 29.97 fps'i)");
  if (!/A042C007_260925XX\.MP4": tam boy \(medya − out = \+7967635200 tick = \+31\.367 ms = \+0\.940 kare < 1 kare/.test(rep)) fail("DURUM: fark tick + ms + kare olarak yazılmadı");
  else ok("DURUM: fark tick + ms + kare (C007: +7967635200 tick = +31.367 ms = +0.940 kare)");
  M.noFootage = true;
  await clickAndWait("btn-status", yes, doneRe);
  rep = els.report.value;
  if (!/29\.97 fps, sequence timebase/.test(rep) || /\[kırpılmış\]/.test(rep)) fail("footage okunamazken sequence timebase'ine düşülmedi");
  else ok("footage kare hızı okunamıyor → sequence timebase (29.97); yine kırpılmış yok");
  M.timebase = null;
  await clickAndWait("btn-status", yes, doneRe);
  rep = els.report.value;
  if (!/23\.976 fps, varsayılan 23\.976/.test(rep) || /\[kırpılmış\]/.test(rep)) fail("ikisi de okunamazken 23.976'ya düşülmedi");
  else ok("ikisi de okunamıyor → 1/23.976 sn; yine kırpılmış yok");
};

scenarios.a027_trimmed = async () => {
  // (b) gerçekten kırpılmış klip → red sürer; fark tick + ms + kare
  setupA027({ inOf: { 2: FRAME2997 } });
  let before = a027Before();
  let out = await clickAndWait("btn-spread", yes);
  if (!/✗ SPREAD DURDU: 1 kamera klibi kırpılmış .*Spread BAŞLAMADI/.test(out) || !/başı kırpılmış \(in = 8475667200 tick ≠ 0\) \(medya − out = \+2692569600 tick = \+10\.600 ms = \+0\.318 kare\)/.test(out))
    fail("in > 0 kamera reddedilmedi ya da fark yazılmadı:\n" + out.split("\n").filter((l) => /DURDU|•/.test(l)).join("\n"));
  else ok("in > 0 (1 kare baştan kırpık) → red sürer; satırda medya − out tick + ms + kare");
  if (a027Before() !== before || counters.txNames.length) fail("red sırasında bir şey değişti");
  const o4 = BigInt(A027.clips[4].out) - 2n * FRAME2997;
  setupA027({ outOf: { 4: o4 } });
  before = a027Before();
  out = await clickAndWait("btn-spread", yes);
  if (!/✗ SPREAD DURDU: 1 kamera klibi kırpılmış/.test(out) || !/kuyruğu kırpılmış \(medya − out = \+20473689600 tick = \+80\.6.. ms = \+2\.416 kare ≥ 1 kare\); 1 kare = 8475667200 tick \(29\.97 fps, proje öğesinin kare hızı\)/.test(out))
    fail("medya − out ≥ 1 kare reddedilmedi ya da fark yazılmadı:\n" + out.split("\n").filter((l) => /DURDU|•/.test(l)).join("\n"));
  else ok("medya − out = 2.416 kare (≥ 1) → red sürer; tick + ms + kare + kare kaynağı yazılı");
  if (a027Before() !== before || counters.txNames.length) fail("red sırasında bir şey değişti");
  else ok("reddedilince hiçbir şeye dokunulmadı (yedek bile alınmadı)");
  setupA027({ outOf: { 5: BigInt(A027.clips[5].media) + 1n } });
  out = await clickAndWait("btn-spread", yes);
  if (!/out medya sonunu aşıyor \(medya − out = -1 tick/.test(out)) fail("out > medya reddedilmedi:\n" + out.split("\n").filter((l) => /DURDU|•/.test(l)).join("\n"));
  else ok("out medya sonunu 1 tick aşıyor (negatif fark) → red");
};

async function a027Tail(follow) {
  // (c) overwrite kuyruğu medya sonuna uzatıyor (+0.733 kare ilk kamerada) → ayrı transaction'da SetOutPoint, yeniden doğrulama
  const s = setupA027();
  const before = a027Before();
  const exp = expectedLayout(s);
  M.owMode = "media";
  M.linkTrimFollow = follow;
  const out = await clickAndWait("btn-spread", yes);
  const tag = follow ? "bağlı ses izliyor" : "bağlı ses izlemiyor";
  if (!/✓ SPREAD tamam/.test(out)) return fail(`kuyruk (${tag}): SPREAD tamamlanmadı:\n` + out.split("\n").filter((l) => /DURDU|•|ölçüm/.test(l)).join("\n"));
  checkLayout(seqByGuid("guid-a027"), exp, `kuyruk medya sonuna uzadı → SetOutPoint (${tag})`);
  if (!/ölçüm "A042C001_260925XX\.MP4": V1 yalnız kuyruk \+6214924800 tick = \+24\.467 ms = \+0\.733 kare; A1 yalnız kuyruk \+6214924800 tick/.test(out)) fail("ilk ölçüm kuyruk farkını yazmadı");
  else ok("ilk ölçüm: V1 ve A1 yalnız kuyruk +6214924800 tick = +24.467 ms = +0.733 kare");
  // video ve ses SetOutPoint'i HER ZAMAN ayrı transaction'da (birlikte hiç ölçülmedi)
  const want = follow
    ? "Spread: yedek sequence,Spread: dağıt,Spread: ilk overwrite (ölçüm),Spread: ilk kuyruk düzeltme,Spread: overwrite,Spread: kuyruk düzeltme"
    : "Spread: yedek sequence,Spread: dağıt,Spread: ilk overwrite (ölçüm),Spread: ilk kuyruk düzeltme,Spread: ilk kuyruk düzeltme (ses),Spread: overwrite,Spread: kuyruk düzeltme,Spread: kuyruk düzeltme (ses)";
  if (counters.txNames.join(",") !== want) fail(`transaction'lar: ${counters.txNames.join(", ")}`);
  else ok(`transaction'lar: ${counters.txNames.slice(1).map((x) => x.replace("Spread: ", "")).join(" → ")} (SetOutPoint overwrite'tan AYRI)`);
  const acts = [...counters.setActions.values()].flat();
  const nOut = acts.filter((a) => a === "out").length;
  if (acts.some((a) => a !== "out") || nOut !== (follow ? 11 : 22)) fail(`set action'lar: ${acts.join(",")}`);
  else ok(`yalnız SetOutPoint (${nOut} klip, klip başına 1; End YOK)${follow ? " — sesler videoyu izledi, sese action yok" : ""}`);
  if (!new RegExp(`bağlı ses videonun SetOutPoint'ini ${follow ? "İZLİYOR" : "izlemiyor"}`).test(out)) fail("izleme ölçümü günlükte yok");
  const n = counters.txNames.length - 1;
  if (!new RegExp(`Ctrl\\+Z'ye ${n} kez bas`).test(out)) fail(`Ctrl+Z sayısı ${n} değil`);
  undoN(n);
  if (a027Before() !== before) fail(`Ctrl+Z × ${n} aslına döndürmedi`);
  else ok(`Ctrl+Z × ${n} → asıl düzen birebir`);
}
scenarios.a027_tail = () => a027Tail(false);
scenarios.a027_tail_follow = () => a027Tail(true);

scenarios.a027_head = async () => {
  // (d) baş kayması (overwrite yarım kare geç) → ilk overwrite'ta DUR; kalan kameralara dokunulmaz; fark + Ctrl+Z + yedek adı
  setupA027();
  const before = a027Before();
  M.owShift = FRAME2997 / 2n;
  let out = await clickAndWait("btn-spread", yes);
  if (!/✗ SPREAD DURDU: İLK OVERWRITE TUTMADI \(ölçüm, "A042C001_260925XX\.MP4"\)/.test(out) || !/start \+4237833600 tick = \+16\.683 ms = \+0\.500 kare; end \+4237833600 tick/.test(out))
    fail("baş kayması ilk overwrite'ta yakalanmadı:\n" + out.split("\n").filter((l) => /DURDU|•|ölçüm/.test(l)).join("\n"));
  else ok("baş kayması (+0.5 kare) → İLK OVERWRITE TUTMADI; ölçülen fark tick + ms + kare");
  if (counters.overwrites !== 1 || counters.setActions.size) fail(`ölçümden sonra devam edildi (overwrite ${counters.overwrites}, set ${counters.setActions.size})`);
  else ok("kalan 10 kameraya dokunulmadı, SetOutPoint denenmedi");
  if (!/Ctrl\+Z'ye 2 kez bas — ya da yedek sequence "A027C012_260803UH Copy"/.test(out)) fail("Ctrl+Z sayısı / yedek adı yok");
  else ok('talimat: Ctrl+Z × 2 (dağıt, ilk overwrite) ya da yedek "A027C012_260803UH Copy"');
  undoN(2);
  if (a027Before() !== before) fail("Ctrl+Z × 2 aslına döndürmedi");
  else ok("Ctrl+Z × 2 → asıl düzen birebir");
  // kuyruk ≥ 1 kare → da DUR (yalnız < 1 kare düzeltilir)
  setupA027();
  M.owMode = "media";
  M.owExtra = FRAME2997;
  out = await clickAndWait("btn-spread", yes);
  if (!/İLK OVERWRITE TUTMADI/.test(out) || !/end \+14690592000 tick = \+57\.833 ms = \+1\.733 kare/.test(out) || counters.setActions.size)
    fail("kuyruk ≥ 1 kare durmadı:\n" + out.split("\n").filter((l) => /DURDU|•|ölçüm/.test(l)).join("\n"));
  else ok("kuyruk +1.733 kare (≥ 1) → DUR, SetOutPoint denenmedi");
};

// ============================================================ v1.2.1 HATA 2: kayıt ipucudur, kilit değil
const shown = (id) => els[id] && els[id].style.display !== "none";
async function waitFor(cond, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await sleep(100);
  }
  return cond();
}
/** Aktif sequence'ı başka birine geçirip geri alır → panel "sequence değişti" diye kayıtları doğrular. */
async function revisit(guid) {
  state.activeGuid = "guid-other";
  mockGen++;
  await sleep(1700);
  state.activeGuid = guid;
  mockGen++;
  await sleep(1900);
}
const stepsOf = (g) => JSON.parse(lsStore.get("spread.steps.v1") ?? "{}")[g] ?? {};

scenarios.hint_spread_undo = async () => {
  // Emre: Dağıt → Ctrl+Z → Dağıt yeniden (aynı sequence). Önce 1.2.0'dan kalma parmak izsiz "Dağıt ✓" işareti (gerçek durum).
  setupA027();
  lsStore.set("spread.steps.v1", JSON.stringify({ "guid-a027": { spread: { kind: "ok", text: "12 klip kendi track'ine dağıtıldı.", at: "2026-09-29T08:00:00.000Z" } } }));
  markLog();
  await revisit("guid-a027");
  if (!shown("btn-spread") || stepsOf("guid-a027").spread || !/Önceki Dağıt kaydı timeline'la doğrulanamıyor \(parmak izi yok: eski sürümün/.test(newLog()))
    fail(`eski sürümün Dağıt ✓ işareti sequence açılınca unutulmadı: ${JSON.stringify(stepsOf("guid-a027"))}\n${newLog()}`);
  else ok("1.2.0'dan kalan parmak izsiz 'Dağıt ✓' → sequence açılınca doğrulanamadı, unutuldu (günlükte); Dağıt düğmesi görünür");
  const before = a027Before();
  let out = await clickAndWait("btn-spread", yes);
  if (!/✓ SPREAD tamam/.test(out)) return fail("A027 Dağıt tamamlanmadı:\n" + failLines(out));
  await sleep(150);
  const st = stepsOf("guid-a027").spread;
  if (!st || !/^\d+:[0-9a-f]+:[0-9a-f]+$/.test(st.fp ?? "") || !st.tp || shown("btn-spread") || !shown("btn-collect")) fail(`Dağıt işareti / parmak izi / gösterge: ${JSON.stringify(st)}`);
  else ok("Dağıt ✓ işareti işlem sonundaki timeline'ın parmak iziyle yazıldı (fp + tp); sıradaki adım Topla");
  undoN(3); // Ctrl+Z × 3 (overwrite, ilk overwrite, dağıt)
  mockGen++;
  markLog();
  if (!(await waitFor(() => shown("btn-spread"))) || !/Timeline değişmiş \(geri alma\/elle düzenleme\) — önceki Dağıt kaydı unutuldu\./.test(newLog()))
    fail("Ctrl+Z'den sonra gösterge Dağıt'a dönmedi:\n" + newLog());
  else ok("Ctrl+Z × 3 → şekil değişti → bayat Dağıt kaydı kendiliğinden unutuldu ('Timeline değişmiş … önceki Dağıt kaydı unutuldu.'); Dağıt düğmesi geri geldi");
  if (a027Before() !== before) return fail("mock geri alma aslına döndürmedi");
  out = await clickAndWait("btn-spread", yes);
  if (!/✓ SPREAD tamam/.test(out) || /zaten yapılmış görünüyor|YARIM/.test(out)) fail("geri alınan Dağıt yeniden çalışmadı:\n" + failLines(out));
  else ok("aynı sequence'ta Dağıt yeniden çalıştı (kilit yok, soru yok) — Ctrl+Z sayısı yine açık: " + (/Ctrl\+Z'ye (\d+) kez/.exec(out) || ["", "?"])[1]);
  // kısmi geri alma (3 adımdan yalnız 1'i): kameraların çoğu o anda YOK (dağıt'ta silindi) → "normal" çalışmak onları kaybettirir.
  // Ara hâl tanınır → kilit değil SORU, kaç Ctrl+Z daha gerektiğini söyler; Vazgeç → hiçbir şey; kalan Ctrl+Z'lerden sonra Dağıt normal.
  undoN(1);
  mockGen++;
  let q = "", title = "";
  const n0 = counters.txNames.length;
  out = await clickAndWait("btn-spread", async (x) => ((q = q || x), (title = title || els["ask-title"].textContent), no()));
  if (!/Timeline, önceki Dağıt'ın ara hâllerinden birinde \(yarım geri alınmış; klipler eksik olabilir\): tamamen geri almak için Ctrl\+Z × 2 daha ya da yedek sequence "A027C012_260803UH Copy/.test(out) ||
      !/^Bu sequence'ta önceki Dağıt yarım geri alınmış görünüyor: .*Ctrl\+Z'ye 2 kez daha bas/.test(q) || title !== "Dağıt yine de çalıştırılsın mı?" || counters.txNames.length !== n0 || !/İptal edildi/.test(out))
    fail("kısmi Ctrl+Z tanınmadı / sorulmadı:\n" + title + " | " + q + "\n" + failLines(out));
  else ok("kısmi Ctrl+Z (3 adımdan 1'i) → ara hâl tanındı: 'Dağıt yarım geri alınmış … Ctrl+Z'ye 2 kez daha bas' SORUSU (kilit değil); Vazgeç → hiçbir şey");
  if (shown("btn-spread") !== true) fail("kısmi geri almadan sonra gösterge Dağıt'a dönmedi");
  undoN(2);
  mockGen++;
  if (a027Before() !== before) return fail("Ctrl+Z × 2 daha aslına döndürmedi");
  out = await clickAndWait("btn-spread", yes);
  if (!/✓ SPREAD tamam/.test(out) || /yarım geri alınmış görünüyor/.test(out)) fail("kalan Ctrl+Z'lerden sonra Dağıt normal çalışmadı:\n" + failLines(out));
  else ok("kalan Ctrl+Z × 2 → yarım kaydı kendiliğinden unutuldu, Dağıt normal çalıştı (12 kamera)");
  // "Yine de çalıştır": soru kilit değil — ara hâlde de çalışır (eksik kameralarla, kullanıcının seçimi)
  undoN(1);
  mockGen++;
  out = await clickAndWait("btn-spread", yes);
  if (!/kullanıcı devam dedi/.test(out) || !/✓ SPREAD tamam|Zaten dağıtılmış/.test(out)) fail("'Yine de çalıştır' sonrası Dağıt çalışmadı:\n" + failLines(out));
  else ok("ara hâlde 'Yine de çalıştır' → Dağıt çalıştı (soru kilit değil)");
};

scenarios.hint_spread_reload = async () => {
  // Dağıt → ↻ → Dağıt; Emre'nin 5 adımlık sınamasının sonu: Dağıt → Ctrl+Z → Dağıt → ↻ → Dağıt
  setupA027();
  updReset();
  await startUpdHelper();
  globalThis.location = { reload: () => upd.uxpReloads++ };
  let out = await clickAndWait("btn-spread", yes);
  if (!/✓ SPREAD tamam/.test(out)) return fail("Dağıt tamamlanmadı:\n" + failLines(out));
  undoN(3);
  mockGen++;
  out = await clickAndWait("btn-spread", yes);
  if (!/✓ SPREAD tamam/.test(out)) return fail("Ctrl+Z sonrası Dağıt tamamlanmadı:\n" + failLines(out));
  await sleep(150);
  markLog();
  els["btn-reload"].click();
  await sleep(1000);
  if (Object.keys(stepsOf("guid-a027")).length || !/Bu sequence'ın kayıtları temizlendi\./.test(newLog()) || lsStore.get("spread.reloadNote.v1") !== "A027C012_260803UH" || upd.uxpReloads !== 1)
    fail(`↻ bu sequence'ın kayıtlarını temizlemedi: ${JSON.stringify(stepsOf("guid-a027"))} not=${lsStore.get("spread.reloadNote.v1")} reload=${upd.uxpReloads}\n${newLog()}`);
  else ok("↻ → bu sequence'ın adım kayıtları silindi, 'Bu sequence'ın kayıtları temizlendi.' (günlük + yeniden yüklemeden sonra bildirim), panel yenilendi");
  await sleep(5300); // sahte location.reload → panel 5 sn sonra kilidi açar
  let q = "";
  out = await clickAndWait("btn-spread", async (x) => ((q = x), yes()));
  if (q && /zaten yapılmış/.test(q)) fail("↻'dan sonra Dağıt hâlâ 'zaten yapılmış' diye soruyor");
  else if (!/Zaten dağıtılmış/.test(out)) fail("↻'dan sonra Dağıt çalışmadı:\n" + failLines(out));
  else ok("↻'dan sonra Dağıt kayıtsız çalıştı (timeline zaten dağıtılmış → 'Zaten dağıtılmış', soru yok)");
  lsStore.delete("spread.reloadNote.v1");
  delete globalThis.location;
  await stopHelper();
};

scenarios.hint_topla_undo = async () => {
  // Topla → Ctrl+Z (tamamı) → Topla yeniden: TOPLA kaydı bayat → unutulur, TOPLA baştan çalışır ("zaten toplanmış" / soru yok)
  setupSync(smallSpec());
  const before = mainTracks();
  const o1 = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✓ TOPLA tamam/.test(o1)) return fail("TOPLA tamamlanmadı:\n" + failLines(o1));
  await sleep(150);
  if (!stepsOf("guid-main-edit").topla?.fp || !lsStore.get("spread.collectRecord.v1")?.includes("guid-main-edit")) return fail("TOPLA işareti / kaydı yazılmadı");
  const m = /Ctrl\+Z'ye (\d+) kez bas/.exec(o1);
  const n = Number(m ? m[1] : 0);
  // önce KISMİ geri alma (1 adım): ara hâl tanınır → SORU (kaç Ctrl+Z daha); Vazgeç → hiçbir şey
  undoN(1);
  mockGen++;
  let pq = "";
  const tx0 = counters.txNames.length;
  const op = await clickAndWait("btn-collect", async (x) => ((pq = pq || x), no()), doneRe);
  if (!new RegExp(`^Bu sequence'ta önceki Topla yarım geri alınmış görünüyor: .*Ctrl\\+Z'ye ${n - 1} kez daha bas`).test(pq) || counters.txNames.length !== tx0 || lsStore.get("spread.collectRecord.v1")?.includes("guid-main-edit"))
    fail(`Topla kısmi Ctrl+Z tanınmadı / sorulmadı (${n - 1} daha beklenirdi):\n${pq}\n${failLines(op)}`);
  else ok(`Topla → Ctrl+Z × 1 (${n} adımdan) → 'Topla yarım geri alınmış … Ctrl+Z'ye ${n - 1} kez daha bas' SORUSU; yarım TOPLA'nın kaydı unutuldu; Vazgeç → hiçbir şey`);
  undoN(n - 1);
  mockGen++;
  if (mainTracks() !== before) return fail("mock TOPLA'yı geri almadı");
  const qs = [];
  const o2 = await clickAndWait("btn-collect", async (x) => (qs.push(x), yes()), doneRe);
  if (!/Timeline değişmiş \(geri alma\/elle düzenleme\) — önceki Topla \(yarım iş\) kaydı unutuldu\./.test(o2) || qs.some((x) => /zaten yapılmış|yarım geri alınmış/.test(x)) || !/✓ TOPLA tamam/.test(o2) || /Zaten toplanmış/.test(o2))
    fail("geri alınan TOPLA yeniden çalışmadı:\n" + qs.join("\n---\n") + "\n" + failLines(o2));
  else ok("Topla → Ctrl+Z → Topla: bayat TOPLA kaydı unutuldu (günlükte), TOPLA baştan çalıştı; kilit / soru yok");
};

scenarios.hint_same_question = async () => {
  // timeline değişmemiş + Dağıt yeniden → kilit değil SORU. Synchronize (zamanda kaydırma) Dağıt kaydını BAYATLATMAZ.
  setupA027();
  let out = await clickAndWait("btn-spread", yes);
  if (!/✓ SPREAD tamam/.test(out)) return fail("Dağıt tamamlanmadı:\n" + failLines(out));
  await sleep(150);
  const n = counters.txNames.length;
  let q = "", title = "";
  out = await clickAndWait("btn-spread", async (x) => ((q = x), (title = els["ask-title"].textContent), no()));
  if (!/^Bu sequence'ta Dağıt zaten yapılmış görünüyor .*Yine de çalıştırılsın mı\?$/.test(q) || title !== "Dağıt yine de çalıştırılsın mı?" || !/İptal edildi/.test(out) || counters.txNames.length !== n)
    fail(`değişmemiş timeline'da Dağıt sormadı: [${title}] ${q}\n${failLines(out)}`);
  else ok("değişmemiş timeline + Dağıt → 'Bu sequence'ta Dağıt zaten yapılmış görünüyor. Yine de çalıştırılsın mı?' (kilit yok); Vazgeç → hiçbir şey");
  out = await clickAndWait("btn-spread", yes);
  if (!/Zaten dağıtılmış/.test(out) || counters.txNames.length !== n) fail("Evet'ten sonra Dağıt çalışmadı:\n" + failLines(out));
  else ok("Evet → Dağıt çalıştı (timeline zaten dağıtılmış → 'Zaten dağıtılmış')");
  // Clip › Synchronize: harici ses ZAMANDA kayar, track'i aynı → Dağıt kaydı durur, sıradaki adım Topla
  const S = seqByGuid("guid-a027");
  const w = S.a[12][0];
  (w.start += sec(1.5)), (w.end += sec(1.5));
  mockGen++;
  markLog();
  await revisit("guid-a027");
  if (/önceki Dağıt kaydı unutuldu/.test(newLog()) || !stepsOf("guid-a027").spread || !shown("btn-collect")) fail("Synchronize (zaman kayması) Dağıt kaydını bayat saydı:\n" + newLog());
  else ok("Synchronize gibi zamanda kaydırma → Dağıt kaydı DURDU (track yerleşimi aynı), sıradaki adım yine Topla");
  q = "";
  out = await clickAndWait("btn-spread", async (x) => ((q = x), no()));
  if (/zaten yapılmış/.test(q) || !/Zaten dağıtılmış/.test(out)) fail("zaman kaymasından sonra: " + q + "\n" + failLines(out));
  else ok("zaman kaymasından sonra tam parmak izi tutmuyor → 'zaten yapılmış' sorusu yok; Dağıt doğrudan çalıştı ('Zaten dağıtılmış')");
};

scenarios.reload_scope = async () => {
  // ↻ yalnız aktif sequence'ın kayıtlarını siler: başka sequence'ın kayıtları ve kırpma kalibrasyonu kalır; eski KES planı yalnız bu
  // sequence'ınsa silinir
  setupSync(smallSpec());
  updReset();
  await startUpdHelper();
  globalThis.location = { reload: () => upd.uxpReloads++ };
  const two = (x) => JSON.stringify({ "guid-main-edit": x, "guid-other": x });
  lsStore.set("spread.steps.v1", two({ spread: { kind: "ok", text: "x", at: "2026-09-29T08:00:00.000Z" } }));
  lsStore.set("spread.stoppedState.v2", two({ op: "TOPLA", digest: "x" }));
  lsStore.set("spread.collectRecord.v1", two({ v: 1, at: "x" }));
  lsStore.set("spread.trimCal.v1", two({ v: 1 }));
  const planDir = path.join(TMPHOME, "Library", "Application Support", "BadIdeaAgency", "SpreadHelper");
  fsReal.mkdirSync(planDir, { recursive: true });
  const planFile = path.join(planDir, "link-plan.json");
  const plan = (guid) => JSON.stringify({ v: 1, kind: "spread-link-plan", sequence: { name: "x", guid }, createdAt: "2026-09-29T08:00:00.000Z", groups: [] });
  fsReal.writeFileSync(planFile, plan("guid-other"));
  els["btn-reload"].click();
  await sleep(1000);
  const has = (k, g) => g in JSON.parse(lsStore.get(k) ?? "{}");
  const mainGone = ["spread.steps.v1", "spread.stoppedState.v2", "spread.collectRecord.v1"].every((k) => !has(k, "guid-main-edit"));
  const otherKept = ["spread.steps.v1", "spread.stoppedState.v2", "spread.collectRecord.v1"].every((k) => has(k, "guid-other"));
  if (!mainGone || !otherKept || !has("spread.trimCal.v1", "guid-main-edit") || !fsReal.existsSync(planFile))
    fail(`↻ kapsamı: bu sequence silindi=${mainGone}, öteki kaldı=${otherKept}, kalibrasyon=${has("spread.trimCal.v1", "guid-main-edit")}, ötekinin planı=${fsReal.existsSync(planFile)}`);
  else ok("↻ → aktif sequence'ın işaret / yarım iş / TOPLA kaydı silindi; BAŞKA sequence'ınkiler, kırpma kalibrasyonu ve ötekinin KES planı durdu");
  await sleep(5300);
  fsReal.writeFileSync(planFile, plan("guid-main-edit"));
  upd.reloads = upd.uxpReloads = 0;
  els["btn-reload"].click();
  await sleep(1000);
  if (fsReal.existsSync(planFile)) fail("↻ bu sequence'ın eski KES planını silmedi");
  else ok("↻ → bu sequence'ın eski KES planı (link-plan.json) silindi");
  await sleep(5300);
  lsStore.delete("spread.reloadNote.v1");
  delete globalThis.location;
  await stopHelper();
};

scenarios.reload_pending_link = async () => {
  // inceleme #13 M3: Bağla kesimi bağlanmayı beklerken ↻ → "Kayıtlar da temizlensin mi?" (Yalnız yenile = kayıtlar ve KES planı kalır);
  // temizlenince (ya da kayıt hiç yoksa) TOPLA kesilmiş sesleri CANLI timeline'dan tanır → SORU
  await collectThen(smallSpec());
  await stopHelper();
  const o1 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ KES tamam/.test(o1)) return fail("köprüsüz KES tamamlanmadı:\n" + failLines(o1));
  await sleep(150);
  updReset();
  await startUpdHelper();
  globalThis.location = { reload: () => upd.uxpReloads++ };
  const planFile = path.join(TMPHOME, "Library", "Application Support", "BadIdeaAgency", "SpreadHelper", "link-plan.json");
  const rec = () => lsStore.get("spread.collectRecord.v1")?.includes("guid-main-edit");
  els["btn-reload"].click();
  await sleep(300);
  const title = els["ask-title"].textContent;
  await no();
  await sleep(900);
  if (title !== "Kayıtlar da temizlensin mi?" || !rec() || !fsReal.existsSync(planFile) || upd.uxpReloads !== 1 || Object.keys(stepsOf("guid-main-edit")).length)
    fail(`bekleyen bağlamada ↻: [${title}] kayıt=${rec()} plan=${fsReal.existsSync(planFile)} reload=${upd.uxpReloads} işaretler=${JSON.stringify(stepsOf("guid-main-edit"))}`);
  else ok("Bağla kesimi bağlanmayı beklerken ↻ → 'Kayıtlar da temizlensin mi?'; Yalnız yenile → adım işaretleri silindi, Topla / Bağla kaydı ve KES planı kaldı");
  await sleep(5300);
  upd.uxpReloads = 0;
  els["btn-reload"].click();
  await sleep(300);
  await yes();
  await sleep(900);
  if (rec() || fsReal.existsSync(planFile)) fail("'Temizle ve yenile' kayıtları / planı silmedi");
  else ok("'Temizle ve yenile' → kayıtlar ve bu sequence'ın KES planı silindi");
  await sleep(5300);
  lsStore.delete("spread.reloadNote.v1");
  delete globalThis.location;
  await stopHelper();
  const n = counters.txNames.length;
  let q = "";
  const o2 = await clickAndWait("btn-collect", async (x) => ((q = q || x), no()), doneRe);
  if (!/^Bu sequence'ta sesler kesilmiş görünüyor: aynı ses kaydının birden çok parçası/.test(q) || counters.txNames.length !== n || !/İptal edildi/.test(o2))
    fail("kayıtsız kesilmiş düzende TOPLA sormadı:\n" + q + "\n" + failLines(o2));
  else ok("kayıt yokken (↻ sonrası) TOPLA kesilmiş sesleri canlı timeline'dan tanıdı → SORU; Vazgeç → hiçbir şey");
};

scenarios.a027_batch_stop = async () => {
  // inceleme #13: ilk kamera birebir ama kalanlardan biri (C005) baştan kayık → "OVERWRITE TUTMADI", Ctrl+Z sayısı + yedek adı
  setupA027();
  const before = a027Before();
  M.owShift = FRAME2997 / 2n;
  M.owShiftFor = "A042C005";
  const out = await clickAndWait("btn-spread", yes);
  if (!/✗ SPREAD DURDU: OVERWRITE TUTMADI: .*Durduruldu; başka hiçbir şeye dokunulmadı/.test(out) || !/A042C005_260925XX\.MP4": ölçülen fark start \+4237833600 tick/.test(out) || !/Ctrl\+Z'ye 3 kez bas — ya da yedek sequence "A027C012_260803UH Copy"/.test(out) || counters.setActions.size)
    fail("toplu overwrite'ta baş kayması yakalanmadı:\n" + failLines(out));
  else ok("ilk kamera birebir, C005 +0.5 kare kayık → OVERWRITE TUTMADI; fark tick + ms + kare; Ctrl+Z × 3 ya da yedek; SetOutPoint denenmedi");
  undoN(3);
  if (a027Before() !== before) fail("Ctrl+Z × 3 aslına döndürmedi");
  else ok("Ctrl+Z × 3 → asıl düzen birebir");
};

scenarios.a027_follow_mismatch = async () => {
  // bağlı ses ilk kamerada videonun SetOutPoint'ini İZLEDİ, sonrakilerde izlemedi → tutarsız → DUR (tahmin yok)
  setupA027();
  M.owMode = "media";
  M.linkTrimFollow = (name) => name.startsWith("A042C001");
  const out = await clickAndWait("btn-spread", yes);
  if (!/✗ SPREAD DURDU: Kuyruk düzeltme: ilk ölçümde bağlı ses videonun SetOutPoint'ini izlemişti, bu kez izlemedi/.test(out) || !/Ctrl\+Z'ye 5 kez bas/.test(out))
    fail("izleme tutarsızlığında durmadı:\n" + failLines(out));
  else ok("bağlı ses ilk kamerada izledi, sonrakilerde izlemedi → DURDU; Ctrl+Z × 5 (dağıt, ilk overwrite, ilk kuyruk, overwrite, kuyruk)");
};

scenarios.hint_noop_mids = async () => {
  // inceleme #13 N1: "Zaten dağıtılmış" (no-op) Dağıt işaretinin ara hâllerini silmemeli → sonra kısmi Ctrl+Z yine tanınır
  setupA027();
  let out = await clickAndWait("btn-spread", yes);
  if (!/✓ SPREAD tamam/.test(out)) return fail("Dağıt tamamlanmadı:\n" + failLines(out));
  await sleep(150);
  out = await clickAndWait("btn-spread", yes); // "zaten yapılmış" → Yine de → Zaten dağıtılmış
  if (!/Zaten dağıtılmış/.test(out)) return fail("ikinci Dağıt no-op olmadı:\n" + failLines(out));
  await sleep(150);
  if (!(stepsOf("guid-a027").spread?.mid ?? []).length) fail("no-op Dağıt ara hâlleri sildi");
  undoN(1);
  mockGen++;
  let q = "";
  out = await clickAndWait("btn-spread", async (x) => ((q = q || x), no()));
  if (!/^Bu sequence'ta önceki Dağıt yarım geri alınmış görünüyor: .*Ctrl\+Z'ye 2 kez daha bas/.test(q)) fail("no-op sonrası kısmi Ctrl+Z tanınmadı:\n" + q + "\n" + failLines(out));
  else ok("no-op Dağıt ('Zaten dağıtılmış') ara hâlleri korudu → sonra kısmi Ctrl+Z yine 'Ctrl+Z'ye 2 kez daha' sorusu");
};

scenarios.hint_redo = async () => {
  // inceleme #13 N2: Topla → Ctrl+Z × 1 → (kayıt yarım sayılıp unutuldu) → Ctrl+Y → kayıtlar geri yüklenir → Bağla çalışır
  setupSync(smallSpec());
  const o1 = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✓ TOPLA tamam/.test(o1)) return fail("TOPLA tamamlanmadı:\n" + failLines(o1));
  await sleep(150);
  const done = deepCopy();
  undoN(1);
  mockGen++;
  markLog();
  await revisit("guid-main-edit");
  const l1 = newLog();
  if (!/Timeline, önceki Topla'nın ara hâllerinden birinde/.test(l1) || lsStore.get("spread.collectRecord.v1")?.includes("guid-main-edit")) return fail("kısmi Ctrl+Z tanınmadı:\n" + l1);
  restore(done); // Ctrl+Y
  mockGen++;
  markLog();
  await revisit("guid-main-edit");
  const l2 = newLog();
  if (!/Timeline, önceki işlemin bittiği hâle döndü \(ör\. Ctrl\+Y\) — unutulan kayıtlar geri yüklendi\./.test(l2) || !lsStore.get("spread.collectRecord.v1")?.includes("guid-main-edit") || !stepsOf("guid-main-edit").topla || !shown("btn-bind"))
    return fail("Ctrl+Y'den sonra kayıtlar geri yüklenmedi:\n" + l2);
  ok("Topla → Ctrl+Z → (yarım sayıldı, kayıt unutuldu) → Ctrl+Y → 'unutulan kayıtlar geri yüklendi'; Topla ✓ ve sıradaki adım Bağla");
  await startHelper();
  const o2 = await clickAndWait("btn-bind", yes, doneRe);
  if (!/✓ BAĞLA tamam/.test(o2) || /Önce TOPLA'ya bas|yarım/.test(o2)) fail("geri yüklenen kayıtla BAĞLA çalışmadı:\n" + failLines(o2));
  else ok("geri yüklenen TOPLA kaydıyla BAĞLA normal çalıştı");
  await stopHelper();
};

// ============================================================ v1.3.0 SENKRON SAĞLIĞI (Topla öncesi)
// Tarif: tek kamera A043 (15 klip, 29.97 fps), 3 DJI mikrofonu eşzamanlı (8 WAV). Premiere Synchronize C002–C009'u C001 / C013'ün
// üstüne atmış. fixtures/senkron-bozuk-a043.json (SENTETİK: tick'ler raporda yok, şekil tariften).
const A043 = JSON.parse(fsReal.readFileSync(path.join(__dirname, "fixtures", "senkron-bozuk-a043.json"), "utf8"));
const fr2997 = (secs) => BigInt(Math.round((secs * 30000) / 1001)) * FRAME2997;
function setupA043(pos = "premiere") {
  const s = setupSync({
    cams: A043.kamera.map((c) => ({ name: c.ad, start: fr2997(c[pos]), dur: fr2997(c.sure) })),
    wavs: A043.dji.map((w) => ({ name: w.ad, start: sec(w.start), dur: sec(w.sure) })),
    others: [],
  });
  M.timebase = FRAME2997;
  return s;
}

scenarios.health_unit = async () => {
  const H = require(path.join(DIST, "src", "health.js"));
  const u = (name, a, b, order) => ({ name, start: BigInt(a), end: BigInt(b), order });
  // eşit uzun iki zincir: [X1, X3] ve [X2, X3] (X1 ile X2 çakışıyor) → sayaçsız / sığma bilgisi yok → X1, X2 BELİRSİZ, X3 doğru
  let r = H.chainSelect([u("X1", 0, 100, null), u("X2", 50, 150, null), u("X3", 300, 400, null)], 1n, false);
  const names = (l) => l.map((x) => x.name).join(",");
  // inceleme #14 doğrulaması B1: sayaçsız cihazda (GoPro GX…, Canon MVI_…) sıra / sığma bilinmez → seçim yok, SORULUR
  if (!r.ask || !/sayacı güvenle okunamıyor/.test(r.ask)) fail(`sayaçsız: ask ${r.ask} keep ${names(r.keep)} amb ${names(r.ambiguous)}`);
  else ok("sayacı okunamayan cihazda üst üste klipler → hangisinin yanlış olduğu çıkarılamaz → SORULUR (tahmin yok)");
  // sayaçlı + sığma: C2, C1'in yerine düşmüş; C1 (100 sn) bileşen başı (0) ile C2 (20) arasına sığmaz → [C1, C3] tek uygun zincir
  r = H.chainSelect([u("C1", 10, 110, [1, 1]), u("C2", 20, 60, [1, 2]), u("C3", 300, 400, [1, 3])], 1n, true, { start: 0n, end: 500n });
  if (names(r.keep) !== "C1,C3" || names(r.suspect) !== "C2" || r.ambiguous.length) fail(`sığma elemesi: keep ${names(r.keep)} amb ${names(r.ambiguous)} sus ${names(r.suspect)}`);
  else ok("sığma denetimi: [C2, C3] zincirinde C1 başa sığmıyor → elendi; C1, C3 doğru, C2 şüpheli");
  // sayaç sırası ters (çakışma yok): C2 C1'den önce, ikisinin de yeri uygun (sığıyor) → ayırt edilemez → ikisi de BELİRSİZ
  r = H.chainSelect([u("C1", 300, 400, [1, 1]), u("C2", 100, 200, [1, 2])], 1n, true, { start: 0n, end: 1000n });
  if (r.keep.length || (names(r.ambiguous) !== "C2,C1" && names(r.ambiguous) !== "C1,C2") || !r.ask) fail(`ters sıra: keep ${names(r.keep)} amb ${names(r.ambiguous)} ask ${r.ask}`);
  else ok("sayaç sırası ters iki klip, ikisi de sığıyor → ikisi de BELİRSİZ, doğru sayılan yok → SORULUR (tahmin yok)");
  // inceleme #14 B1: aynı adlı iki gövde (Sony C0001–C0003 ve C0500–C0501 aynı anda) → hiçbir sıra sığmıyor → SORULUR
  r = H.chainSelect(
    [u("C0001", 0, 100, [1]), u("C0002", 110, 200, [2]), u("C0003", 210, 300, [3]), u("C0500", 50, 150, [500]), u("C0501", 160, 260, [501])],
    1n,
    true,
    { start: 0n, end: 300n }
  );
  if (!r.ask || !/tek bir sıralı çekim olarak yerleşemiyor/.test(r.ask)) fail(`iki gövde: ask ${r.ask} keep ${names(r.keep)} sus ${names(r.suspect)}`);
  else ok("aynı adlı iki gövde (C0001… ile C0500… aynı anda) → hiçbir sıra sığmıyor → SORULUR, şüpheli yok");
  // inceleme #14 M3: C005 bütün seslerden SONRA kaydedilmiş, C002'nin altına düşmüş → düz kural [C001…C004], sığma daha kısa → ayrışma:
  // yalnız ikisinde de dışarıda olan (C005) şüpheli, ikisinde de içeride olan doğru, gerisi BELİRSİZ
  r = H.chainSelect(
    [u("C001", 0, 100, [1, 1]), u("C002", 110, 200, [1, 2]), u("C003", 210, 300, [1, 3]), u("C004", 310, 400, [1, 4]), u("C005", 120, 160, [1, 5])],
    1n,
    true,
    { start: 0n, end: 420n }
  );
  if (r.ask || names(r.keep) !== "C001,C002" || names(r.ambiguous) !== "C003,C004" || names(r.suspect) !== "C005")
    fail(`ayrışma: keep ${names(r.keep)} amb ${names(r.ambiguous)} sus ${names(r.suspect)} ask ${r.ask}`);
  else ok("düz kural ile sığma ayrışınca: yalnız ikisinde de dışarıda olan ŞÜPHELİ (C005), ayrışanlar BELİRSİZ (C003, C004), ortaklar doğru");
  if (!H.vetoDevice("audio", { pattern: "generic" }) || H.vetoDevice("audio", { pattern: "dji" }) || !H.vetoDevice("camera", { pattern: "sony" })) fail("vetoDevice");
  else ok("veto: DJI hariç hepsinde (bilinmeyen adlı seslerde 1.2.1'deki gibi sürer)");
  if (!H.counterUsable([{ pattern: "cinema", order: [43, 1] }, { pattern: "cinema", order: [43, 2] }]) || H.counterUsable([{ pattern: "dji", order: [1] }, { pattern: "dji", order: [2] }]) || H.counterUsable([{ pattern: "cinema", order: [1, 1] }, { pattern: "cinema", order: [1, 1] }]))
    fail("counterUsable");
  else ok("sayaç: sinema / Sony / Zoom güvenli; DJI / bilinmeyen desen ve tekrarlı sayaç → kullanılmaz");
  if (!H.certainDevice("camera", { pattern: "generic" }) || H.certainDevice("audio", { pattern: "dji" }) || !H.certainDevice("audio", { pattern: "zoom" }) || H.certainDevice("audio", { pattern: "generic" }))
    fail("certainDevice");
  else ok("klip seçimi: kameralar ve Zoom; DJI / bilinmeyen adlı seste seçim yok");
};

scenarios.health_a043 = async () => {
  setupA043();
  const cam = (n) => clipNamed(new RegExp(`^A043C0${String(n).padStart(2, "0")}_`));
  const before = new Map(A043.kamera.map((c, i) => [c.ad, cam(i + 1).map((x) => x.c.start)]));
  const qs = [];
  const out = await clickAndWait("btn-collect", async (x) => (qs.push(x), yes()), doneRe);
  const conf = qs.find((x) => /^TOPLA — /.test(x)) ?? "";
  if (!/SENKRON SAĞLIĞI: Premiere senkronu 8 klipte bozuk: C002…C009 \(aynı kameranın C001, C010…C014 klipleriyle çakışıyor \/ sırası ters\)\. Bunlar oturuma alınmadı/.test(conf))
    fail("TOPLA sorusunda senkron sağlığı listesi yok / farklı:\n" + conf.split("\n").filter((l) => /SENKRON|ŞÜPHELİ|BELİRSİZ/.test(l)).join("\n"));
  else ok("TOPLA sorusu: 'Premiere senkronu 8 klipte bozuk: C002…C009 (aynı kameranın C001, C010…C014 klipleriyle çakışıyor / sırası ters). Bunlar oturuma alınmadı …'");
  if (/VETO|AYRILAMA/.test(qs.join("\n") + out)) fail("DJI eşzamanlı mikrofon çakışmaları veto / ayrılamadı üretti:\n" + out.split("\n").filter((l) => /VETO|AYRILAMA/.test(l)).join("\n"));
  else ok("üç eşzamanlı DJI mikrofonunun çakışan dosyaları hata SAYILMADI (veto yok)");
  // C002–C009 çıkınca iki DJI grubunu bağlayan kamera klibi kalmaz → 2 oturum (DJI kendi aralarında bağ kurmaz: kimlik kesin değil)
  if (!/✓ TOPLA tamam: 2 oturum/.test(out)) return fail("TOPLA tamamlanmadı:\n" + failLines(out));
  if (!/Track'ler: A → V1; DJI → A1 \(\+ A2, A3: eşzamanlı dosyalar, 3 şerit\)/.test(out) || !/DJI: bir oturumda 3 dosya aynı anda kayıtta/.test(out))
    fail("eşzamanlı DJI dosyaları şeritlere dağılmadı:\n" + out.split("\n").filter((l) => /Track'ler|şerit/.test(l)).join("\n"));
  else ok("üç eşzamanlı DJI dosyası tek track'e sığmıyor → DJI 3 şerit (A1 eşlenen, A2–A3 ek); çakışma yok");
  const S0 = seqByGuid("guid-main-edit");
  const djiBad = [];
  for (const t of [0, 1, 2]) {
    const list = S0.a[t].filter((c) => /^DJI_/.test(c.name)).map((c) => [c.start, c.end]).sort((x, y) => (x[0] < y[0] ? -1 : 1));
    for (let i = 1; i < list.length; i++) if (list[i][0] < list[i - 1][1]) djiBad.push(`A${t + 1}`);
  }
  if (djiBad.length) fail("şeritte üst üste DJI: " + djiBad.join(", "));
  const S = seqByGuid("guid-main-edit");
  const frameInfo = JSON.parse(lsStore.get("spread.collectRecord.v1"))["guid-main-edit"].frame;
  const bad = [];
  for (let i = 1; i <= 15; i++) {
    const clips = cam(i);
    const parkedNow = clips.every((x) => x.track >= (x.kind === "V" ? frameInfo.vPark : frameInfo.aPark));
    const sameTime = clips.every((x, k) => x.c.start === before.get(A043.kamera[i - 1].ad)[k]);
    const suspect = i >= 2 && i <= 9;
    if (suspect && !(parkedNow && sameTime)) bad.push(`C0${String(i).padStart(2, "0")} park'ta değil / zamanı değişti`);
    if (!suspect && parkedNow) bad.push(`C0${String(i).padStart(2, "0")} yanlışlıkla park'ta`);
    if (clips.length !== 2) bad.push(`C0${i}: ${clips.length} klip (video + kamera sesi olmalı)`);
  }
  if (bad.length) fail("park sonucu: " + bad.join("; "));
  else ok("doğru 7 klip (C001, C010–C015) oturumda; 8 şüpheli (C002–C009) video + kamera sesiyle park track'inde, zamanları aynı, silinmedi");
  if (!/Önce düzeltmek istersen Vazgeç/.test(conf)) fail("TOPLA sorusunda 'önce düzelt → Vazgeç' yolu yok");
  const rec = JSON.parse(lsStore.get("spread.collectRecord.v1"))["guid-main-edit"];
  if (A043.kamera.slice(1, 9).some((c) => !rec.parked.some((k) => k.includes(c.ad)))) fail("şüpheliler TOPLA kaydının park listesinde değil (BAĞLA onlara dokunabilir)");
  else ok("şüpheliler TOPLA kaydının park listesinde → BAĞLA onlara dokunmaz");
  // BAĞLA: şeritli DJI'lar kaynağın track'lerinde sayılır (yerinde); park'takilere dokunulmaz
  await sleep(150);
  await startHelper();
  const ob = await clickAndWait("btn-bind", yes, doneRe);
  await stopHelper();
  if (!/✓ BAĞLA tamam/.test(ob)) fail("şeritli düzende BAĞLA tamamlanmadı:\n" + failLines(ob));
  else if (A043.kamera.slice(1, 9).some((c, k) => cam(k + 2).length !== 2 || cam(k + 2).some((x) => x.c.start !== before.get(c.ad)[0])))
    fail("BAĞLA park'taki şüphelilere dokundu");
  else ok("BAĞLA şeritli düzende tamam (DJI şeritleri yerinde sayıldı); park'taki 8 şüpheliye dokunulmadı");
  // DURUM raporu: SENKRON SAĞLIĞI bölümü (TOPLA'dan ÖNCEKİ düzende)
  setupA043();
  await clickAndWait("btn-status", yes, doneRe);
  const rep = els.report.value;
  const sec2 = rep.slice(rep.indexOf("SENKRON SAĞLIĞI"), rep.indexOf("OTURUMLAR"));
  if (!/Premiere senkronu 8 klipte bozuk: C002…C009/.test(sec2) || !/ŞÜPHELİ A: A043C005_260925XX .*A043C013_260925XX ile çakışıyor/.test(sec2) || !/ses DJI: cihaz kimliği kesin değil \(8 dosya; birden çok eşzamanlı mikrofon olabilir\) → kendi dosyalarının çakışması hata sayılmaz \(\d+ çakışan çift\)/.test(sec2))
    fail("DURUM raporunda SENKRON SAĞLIĞI bölümü eksik:\n" + sec2);
  else ok("DURUM raporu: 'SENKRON SAĞLIĞI' — 8 şüpheli, her biri neyle çakıştığıyla; DJI: kimlik kesin değil, çakışmalar hata sayılmaz");
  // doğru yerleşim (senkron sağlam): şüpheli yok, bölüm "sorun yok"
  setupA043("dogru");
  await clickAndWait("btn-status", yes, doneRe);
  if (!/SENKRON SAĞLIĞI[^\n]*\n  sorun yok/.test(els.report.value)) fail("sağlam senkronda SENKRON SAĞLIĞI 'sorun yok' demedi");
  else ok("sağlam senkron (gerçek yerler) → 'sorun yok'");
  // sağlam senkronda TOPLA eski akış: şüpheli yok, sağlık satırı yok; C002–C009 iki DJI grubunu bağlar → tek oturum, hiçbir kamera park'ta değil
  setupA043("dogru");
  const q2 = [];
  const o2 = await clickAndWait("btn-collect", async (x) => (q2.push(x), yes()), doneRe);
  if (!/✓ TOPLA tamam: 1 oturum/.test(o2) || /SENKRON SAĞLIĞI|Park track'lerine .*A043/.test(q2.join("\n") + o2)) fail("sağlam senkronda TOPLA farklı davrandı:\n" + failLines(o2));
  else ok("sağlam senkron → TOPLA eski akış: 1 oturum, sağlık uyarısı yok, hiçbir kamera klibi park'ta değil");
};

scenarios.health_a043_ayrisma = async () => {
  // fixture'ın ilk sürümü: C002 ve C003 C001'in altında KENDİ aralarında sıralı → düz kural [C002, C003, C010–C015] (8), sığma
  // [C001, C010–C015] (7) → ayrışma: C001–C003 BELİRSİZ (tahmin yok), C004–C009 şüpheli, C010–C015 doğru
  setupA043("premiere_sirali");
  await clickAndWait("btn-status", yes, doneRe);
  const rep = els.report.value;
  const sec2 = rep.slice(rep.indexOf("SENKRON SAĞLIĞI"), rep.indexOf("OTURUMLAR"));
  if (!/Premiere senkronu 6 klipte bozuk: C004…C009 .*3 klip BELİRSİZ: C001…C003 \(aynı kameranın klipleri; hangisinin doğru olduğu çıkarılamadı\)/.test(sec2))
    return fail("ayrışmada BELİRSİZ ayrımı yok:\n" + sec2);
  ok("düz kural ile sığma ayrışıyor → 'Premiere senkronu 6 klipte bozuk: C004…C009 … 3 klip BELİRSİZ: C001…C003 (… hangisinin doğru olduğu çıkarılamadı)'");
  setupA043("premiere_sirali");
  const out = await clickAndWait("btn-collect", yes, doneRe);
  const cam = (n) => clipNamed(new RegExp(`^A043C0${String(n).padStart(2, "0")}_`));
  const rec = JSON.parse(lsStore.get("spread.collectRecord.v1") ?? "{}")["guid-main-edit"];
  const parked = (i) => cam(i).every((x) => x.track >= (x.kind === "V" ? rec.frame.vPark : rec.frame.aPark));
  const bad = [];
  for (let i = 1; i <= 15; i++) if (parked(i) !== i <= 9) bad.push(`C0${String(i).padStart(2, "0")}`);
  if (!/✓ TOPLA tamam/.test(out) || bad.length) fail("ayrışmada park sonucu: " + bad.join(", ") + "\n" + failLines(out));
  else ok("TOPLA: C001–C009 park'ta (3 belirsiz + 6 şüpheli; zamanı aynı), yalnız C010–C015 oturumda");
};

scenarios.health_ask_stacked = async () => {
  // inceleme #14 B1: iki ilişkisiz grup (Sony + Zoom 10:00 / A kamera + Zoom 11:00, 11:30) üst üste; çakışan YALNIZ Zoom → hiçbir Zoom
  // sırası sığmıyor → klip seçilmez, 1.2.1'deki gibi AYRILAMAYAN OTURUM sorulur (Sony yanlış oturuma karışmaz)
  setupSync({
    cams: [
      { name: "C0001.MP4", start: sec(100), dur: sec(100) },
      { name: "A001C001_260912AB.MP4", start: sec(100), dur: sec(48) },
      { name: "A001C002_260912AB.MP4", start: sec(154), dur: sec(46) },
    ],
    wavs: [
      { name: "260912_100000_Tr1.WAV", start: sec(95), dur: sec(110) },
      { name: "260912_110000_Tr1.WAV", start: sec(98), dur: sec(52) },
      { name: "260912_113000_Tr1.WAV", start: sec(152), dur: sec(50) },
    ],
    others: [],
  });
  const qs = [];
  const out = await clickAndWait("btn-collect", async (x) => (qs.push(x), no()), doneRe);
  const q = qs.join("\n---\n");
  if (!/AYRILAMAYAN OTURUM/.test(q) || !/tek bir sıralı çekim olarak yerleşemiyor/.test(q) || /SENKRON SAĞLIĞI/.test(q + out)) fail("üst üste gruplar sorulmadı / şüpheli üretildi:\n" + q + "\n" + failLines(out));
  else ok("üst üste iki grup, çakışan yalnız Zoom → sığan sıra yok → AYRILAMAYAN OTURUM soruldu (şüpheli yok, tahmin yok)");
};

scenarios.health_generic_veto = async () => {
  // inceleme #14 M2: bilinmeyen adlı ses (REC0001 / REC0002) — veto 1.2.1'deki gibi SÜRER: üst üste iki grup en zayıf bağlar kesilerek ayrılır
  setupSync({
    // grup içi bağlar %100; gruplar arası %91–%92.6 (güçlü ama açıkça zayıf) → REC0001 ↔ REC0002 vetosu en zayıfları keserek çözülür
    cams: [
      { name: "C0001.MP4", start: 0n, dur: sec(100) },
      { name: "A001C001_260912AB.MP4", start: sec(12), dur: sec(95) },
    ],
    wavs: [
      { name: "REC0001.WAV", start: 0n, dur: sec(100) },
      { name: "REC0002.WAV", start: sec(9), dur: sec(100) },
    ],
    others: [],
  });
  const qs = [];
  const out = await clickAndWait("btn-collect", async (x) => (qs.push(x), yes()), doneRe);
  const q = qs.join("\n");
  if (!/VETO: REC: REC0001 .*REC0002/.test(q + out) || !/✓ TOPLA tamam: 2 oturum/.test(out) || /SENKRON SAĞLIĞI/.test(q + out)) fail("bilinmeyen adlı seste veto çalışmadı:\n" + failLines(out) + "\n" + q.split("\n").filter((l) => /VETO|oturum/.test(l)).join("\n"));
  else ok("bilinmeyen adlı ses (REC0001/REC0002) üst üste → VETO 1.2.1'deki gibi: en zayıf bağlar kesildi, 2 oturum; sağlık uyarısı yok");
};

scenarios.health_wrap = async () => {
  // inceleme #14 doğrulaması m1: Sony sayacı başa dönmüş (C9998, C9999, C0001, C0002; çakışma yok) → sıra "ters" ama hangisi yanlış
  // çıkarılamaz → 1.2.1'deki gibi TEK oturum, uyarı satırıyla (soru yok, park yok)
  setupSync({
    cams: [
      { name: "C9998.MP4", start: 0n, dur: sec(100) },
      { name: "C9999.MP4", start: sec(110), dur: sec(90) },
      { name: "C0001.MP4", start: sec(210), dur: sec(90) },
      { name: "C0002.MP4", start: sec(310), dur: sec(90) },
    ],
    wavs: [{ name: "260912_101512_Tr1.WAV", start: 0n, dur: sec(400) }],
    others: [],
  });
  const qs = [];
  const out = await clickAndWait("btn-collect", async (x) => (qs.push(x), yes()), doneRe);
  const q = qs.join("\n");
  if (!/✓ TOPLA tamam: 1 oturum/.test(out) || /AYRILAMAYAN|SENKRON SAĞLIĞI/.test(q) || !/SIRA: Sony: .*hangi klibin yanlış olduğu çıkarılamadı/.test(q + out))
    return fail("sayaç dönüşü 1.2.1 gibi değil:\n" + failLines(out) + "\n" + q.split("\n").filter((l) => /SIRA|AYRIL|SENKRON/.test(l)).join("\n"));
  ok("Sony sayacı başa dönmüş (C9998 → C0002) → tek oturum, soru / park yok, 'SIRA: … hangi klibin yanlış olduğu çıkarılamadı' uyarısı");
  await clickAndWait("btn-status", yes, doneRe);
  const sec2 = els.report.value.slice(els.report.value.indexOf("SENKRON SAĞLIĞI"), els.report.value.indexOf("OTURUMLAR"));
  if (/sorun yok/.test(sec2) || !/klip ayrılmadı: sayaç sırası ters görünen/.test(sec2)) fail("Durum raporu SIRA notuyla çelişiyor:\n" + sec2);
  else ok("Durum raporu: 'sorun yok' demez; 'klip ayrılmadı: sayaç sırası ters görünen oturum(lar) var …' + SIRA notu");
};

scenarios.health_order = async () => {
  // (b) oturum İÇİNDE sayaç sırası ters (çakışma yok): Sony C0003, C0001'den önce düşmüş; tek DJI dosyası hepsini kapsıyor
  setupSync({
    cams: [
      { name: "C0001.MP4", start: sec(100), dur: sec(100) },
      { name: "C0002.MP4", start: sec(300), dur: sec(100) },
      { name: "C0003.MP4", start: sec(20), dur: sec(60) },
      { name: "C0004.MP4", start: sec(700), dur: sec(100) },
    ],
    wavs: [{ name: "DJI_01_20260925_090000.WAV", start: 0n, dur: sec(1000) }],
    others: [],
  });
  const qs = [];
  const out = await clickAndWait("btn-collect", async (x) => (qs.push(x), yes()), doneRe);
  const conf = qs.find((x) => /^TOPLA — /.test(x)) ?? "";
  if (!/SENKRON SAĞLIĞI: Premiere senkronu 1 klipte bozuk: C0003 \(aynı kameranın C0001, C0002 klipleriyle sırası ters\)/.test(conf))
    return fail("oturum içi sayaç sırası bozukluğu bulunmadı:\n" + conf.split("\n").filter((l) => /SENKRON|ŞÜPHELİ|BELİRSİZ/.test(l)).join("\n") + "\n" + failLines(out));
  ok("oturum içinde C0003 C0001'den önce (çakışma yok) → 'Premiere senkronu 1 klipte bozuk: C0003 (… C0001, C0002 klipleriyle sırası ters)'");
  const c3 = clipNamed(/^C0003/);
  if (!/✓ TOPLA tamam: 1 oturum/.test(out) || !c3.length || c3.some((x) => x.c.start !== sec(20) || x.track < (x.kind === "V" ? 1 : 3)))
    fail("C0003 park'ta değil / zamanı değişti:\n" + failLines(out));
  else ok("C0003 park track'inde (zamanı aynı); C0001, C0002, C0004 + DJI tek oturum");
};

// ============================================================ v1.4.0 SENKRON (Dağıt → SENKRON → Topla)
// Dağıt düzeni (her dosya kendi track'inde, zamanlar senkronsuz), sentetik sesler (dev/senkron-synth.cjs) sahte ffmpeg'le (<yol>.pcm).
const SYN = require("./senkron-synth.cjs");
const SENKRON_TRUTH = {
  "DJI_01_20260925_160000.WAV": 0,
  "DJI_02_20260925_160001.WAV": 1.5,
  "DJI_03_20260925_160003.WAV": 3.25,
  "A080C001_260925XX.MP4": 20.5,
  "A080C002_260925XX.MP4": 80.25,
  "A080C003_260925XX.MP4": 140.125,
};
let senkronScene = null;
function setupSenkron({ shareTrack = false } = {}) {
  senkronScene ??= SYN.scene(220, 1234);
  const media = path.join(TMPHOME, "medya");
  fsReal.mkdirSync(media, { recursive: true });
  const cams = [
    { name: "A080C001_260925XX.MP4", start: 0n, dur: sec(40), t: 20.5, mic: SYN.MIC.cam },
    { name: "A080C002_260925XX.MP4", start: sec(60), dur: sec(50), t: 80.25, mic: SYN.MIC.cam },
    { name: "A080C003_260925XX.MP4", start: sec(130), dur: sec(45), t: 140.125, mic: SYN.MIC.cam },
    { name: "A080C004_260925XX.MP4", start: sec(200), dur: sec(30), t: null, mic: null }, // sessiz → emin değil
  ];
  const wavs = [
    { name: "DJI_01_20260925_160000.WAV", start: 0n, dur: sec(200), t: 0, mic: SYN.MIC.lav1 },
    { name: "DJI_02_20260925_160001.WAV", start: 0n, dur: sec(190), t: 1.5, mic: SYN.MIC.lav2 },
    { name: "DJI_03_20260925_160003.WAV", start: shareTrack ? sec(300) : 0n, dur: sec(195), t: 3.25, mic: SYN.MIC.lav3 },
  ];
  const s = setupSync({ cams: cams.map(({ name, start, dur }) => ({ name, start, dur })), wavs: wavs.map(({ name, start, dur }) => ({ name, start, dur })), others: [] });
  if (shareTrack) {
    // Dağıt düzeni DEĞİL: DJI_03 DJI_01'in track'inde (zamanda ayrı)
    const i3 = s.a.findIndex((tr) => tr.some((c) => /^DJI_03/.test(c.name)));
    const i1 = s.a.findIndex((tr) => tr.some((c) => /^DJI_01/.test(c.name)));
    s.a[i1].push(...s.a[i3]);
    s.a[i3] = [];
  }
  let seed = 1;
  for (const x of [...cams, ...wavs]) {
    const p = projItems[x.name];
    const file = path.join(media, x.name);
    p.mediaPath = file;
    fsReal.writeFileSync(file, "sahte medya " + x.name);
    const secs = Number(x.dur / TPS);
    const pcm = x.t === null ? new Int16Array(secs * 8000) : SYN.record(senkronScene, x.t, secs, x.mic, seed++);
    fsReal.writeFileSync(file + ".pcm", Buffer.from(pcm.buffer));
  }
  return s;
}
const mediaStartOf = (name) => {
  const l = clipNamed(new RegExp("^" + name.replace(/\./g, "\\.") + "$"));
  const v = new Set(l.map((x) => x.c.start - x.c.inPt));
  return v.size === 1 ? [...v][0] : null;
};
const reportFile = () => path.join(TMPHOME, "Library", "Application Support", "BadIdeaAgency", "Spread", "senkron-deneme.txt");

scenarios.senkron_dene = async () => {
  const s = setupSenkron();
  await startHelper();
  try {
    fsReal.rmSync(reportFile(), { force: true });
  } catch {}
  const before = JSON.stringify(allClips(s).map(entry), (k, v) => (typeof v === "bigint" ? v.toString() : v));
  const qs = [];
  const out = await clickAndWait("btn-senkron", async (x) => (qs.push(x), yes()), doneRe);
  const after = JSON.stringify(allClips(seqByGuid("guid-main-edit")).map(entry), (k, v) => (typeof v === "bigint" ? v.toString() : v));
  if (!/✓ SENKRON \(Dene\) bitti: 6\/7 dosya 1 grupta yerleşti; emin değil 1\. Timeline'a dokunulmadı\./.test(out)) return fail("SENKRON Dene sonucu:\n" + failLines(out) + "\n" + out.split("\n").slice(-12).join("\n"));
  ok("SENKRON (Dene): 6/7 dosya tek grupta yerleşti, sessiz klip 'emin değil'; yardımcı sesleri (sahte ffmpeg) çözdü, motor eşleştirdi");
  if (qs.length || counters.txNames.length || before !== after) fail(`Dene timeline'a dokundu / soru sordu: ${counters.txNames.join(", ")} ${qs.join(" | ")}`);
  else ok("Dene: hiçbir transaction yok, soru yok, timeline birebir aynı");
  let rep = "";
  try {
    rep = fsReal.readFileSync(reportFile(), "utf8");
  } catch {}
  const pos = (n) => {
    const m = new RegExp(`G1\\s+(-?[\\d.]+) sn .*"${n.replace(/\./g, "\\.")}"`).exec(rep);
    return m ? Number(m[1]) : null;
  };
  const errs = Object.entries(SENKRON_TRUTH).map(([n, t]) => (pos(n) === null ? Infinity : Math.abs(pos(n) - pos("DJI_01_20260925_160000.WAV") - t) * 1000));
  if (!/SPREAD SENKRON — DENEME RAPORU/.test(rep) || !/Grup 1: 6 dosya/.test(rep) || !/"A080C004_260925XX\.MP4" — sessiz/.test(rep) || Math.max(...errs) > 1)
    fail("senkron-deneme.txt eksik / yanlış:\n" + rep.split("\n").slice(0, 30).join("\n") + "\nhatalar ms: " + errs.join(", "));
  else ok(`senkron-deneme.txt: grup özeti, dosya başına konum / güven / eşleştiği dosya / saat ipucu farkı, 'emin değil' listesi; bilinen ofsetler ≤ ${Math.max(...errs).toFixed(3)} ms`);
  const issue = await (async () => {
    copied = null;
    markLog();
    els["btn-issue"].click();
    // rapor bütün günlüğü toplar (tam koşuda uzun sürer; bu sırada panel meşgul) → "Sorun raporu:" satırını bekle
    for (let i = 0; i < 3000 && !/Sorun raporu:/.test(newLog()); i++) await sleep(20);
    return copied ?? "";
  })();
  if (!/---- SON SENKRON DENEMESİ/.test(issue) || !/SPREAD SENKRON — DENEME RAPORU/.test(issue)) fail("Sorun bildir raporunda SENKRON bölümü yok");
  else ok("Sorun bildir raporu: 'SON SENKRON DENEMESİ' bölümü (tam rapor)");
  copied = null;
};

scenarios.senkron_uygula = async () => {
  // Ayarlar › "Deneysel: SENKRON uygula" açık → Dene'den sonra Uygula sorulur → yalnız zamanda taşır; sonra Topla tek oturum bulur
  const s0 = setupSenkron();
  lsStore.set("spread.senkronApply.v1", "1");
  await startHelper();
  const qs = [];
  const out = await clickAndWait("btn-senkron", async (x) => (qs.push(x), yes()), senkronDoneRe);
  // DJI_01 sahnenin başında (grup başı 0) ve timeline'da zaten 0'da → taşınmaz; kalan 6 dosya (sessiz C004 dahil) taşınır
  if (!/✓ SENKRON UYGULANDI: 6 dosya zamanda taşındı/.test(out) || !qs.some((q) => /SENKRON UYGULA \(deneysel\) — 6 dosyanın 10 klibi YALNIZ ZAMANDA/.test(q)))
    return fail("Uygula:\n" + qs.map((q) => q.slice(0, 200)).join("\n---\n"));
  const want = ["SENKRON: yedek sequence", "SENKRON: ilk park (ölçüm)", "SENKRON: park", "SENKRON: ilk yerleştirme (ölçüm)", "SENKRON: yerleştir"];
  if (counters.txNames.join("|") !== want.join("|")) fail("transaction'lar: " + counters.txNames.join(", "));
  else ok("Uygula: yedek → ilk park (ölçüm, tek dosya) → park → ilk yerleştirme (ölçüm) → yerleştir; her adım tick düzeyinde doğrulandı");
  // konumlar: grup başı 0; harici sesler tick düzeyinde (≤ 1 ms), kameralar kareye yuvarlı (≤ ½ kare + 1 ms)
  const bad = [];
  const half = Number(FRAME25 / 2n) / Number(TPS);
  for (const [n, t] of Object.entries(SENKRON_TRUTH)) {
    const ms = mediaStartOf(n);
    const e = ms === null ? Infinity : Math.abs(Number(ms) / Number(TPS) - t);
    const tol = /^A080/.test(n) ? half + 0.001 : 0.001;
    if (e > tol) bad.push(`${n}: ${(e * 1000).toFixed(3)} ms`);
    if (/^A080/.test(n) && ms % FRAME25 !== 0n) bad.push(`${n}: kareye oturmadı`);
  }
  const c4 = mediaStartOf("A080C004_260925XX.MP4");
  if (c4 === null || c4 < sec(200)) bad.push(`A080C004 (emin değil) en sonda değil: ${c4}`);
  const tracksSame = allClips(seqByGuid("guid-main-edit")).every((x) => allClips(s0).some((y) => y.c.name === x.c.name && y.kind === x.kind && y.track === x.track));
  if (bad.length || !tracksSame) fail("Uygula konumları: " + bad.join("; ") + (tracksSame ? "" : " / track değişti"));
  else ok("konumlar: harici sesler ≤ 1 ms, kameralar kareye yuvarlı (≤ ½ kare), track'ler aynı; 'emin değil' klip grubun ardında tek başına");
  // akış: Dağıt → SENKRON → Topla
  const o2 = await clickAndWait("btn-collect", yes, doneRe);
  if (!/✓ TOPLA tamam: 1 oturum/.test(o2) || !/park: A080C004_260925XX/.test(o2) || /SENKRON SAĞLIĞI/.test(o2)) fail("SENKRON'dan sonra Topla:\n" + failLines(o2));
  else ok("ardından Topla: 1 oturum (A080C001–C003 + 3 DJI, 3 şerit), sessiz klip sahipsiz → park; senkron sağlığı temiz");
  lsStore.delete("spread.senkronApply.v1");
};

scenarios.senkron_iptal = async () => {
  setupSenkron();
  await startHelper();
  fsReal.rmSync(path.join(TMPHOME, "Library", "Application Support", "BadIdeaAgency", "Spread", "senkron-cache"), { recursive: true, force: true });
  process.env.FAKE_FFMPEG_SLOW_MS = "1500";
  markLog();
  els["btn-senkron"].click();
  let seen = false;
  for (let i = 0; i < 300; i++) {
    await sleep(20);
    if (/ses okunuyor/.test(els["progress-text"]?.textContent ?? "") && els["btn-cancel"]?.style.display === "flex") {
      seen = true;
      break;
    }
  }
  els["btn-cancel"].click();
  let out = "";
  for (let i = 0; i < 500 && !/İptal edildi|SENKRON DURDU|bitti/.test(out); i++) {
    await sleep(20);
    out = newLog();
  }
  delete process.env.FAKE_FFMPEG_SLOW_MS;
  await sleep(300);
  if (!seen || !/İptal edildi — hiçbir şey değişmedi/.test(out) || counters.txNames.length || els["btn-cancel"].style.display !== "none")
    fail(`İptal: ilerleme görüldü ${seen}, iptal düğmesi ${els["btn-cancel"]?.style.display}\n` + out.split("\n").slice(-6).join("\n"));
  else ok("İptal: ilerleme 'ses okunuyor …' ve İptal düğmesi göründü → İptal → yardımcıdaki iş durdu, 'İptal edildi — hiçbir şey değişmedi', düğme gizlendi");
};

scenarios.senkron_yok = async () => {
  // yardımcı yok → açık hata; Dağıt düzeni değil → Uygula başlamaz; ilk kullanımda ffmpeg indirme sorusu / indirilemezse açık hata
  setupSenkron();
  await stopHelper();
  let out = await clickAndWait("btn-senkron", yes, doneRe);
  if (!/✗ SENKRON DURDU: SENKRON Spread Helper'la çalışır/.test(out) || counters.txNames.length) fail("yardımcısız SENKRON:\n" + failLines(out));
  else ok("yardımcı kapalı → 'SENKRON Spread Helper'la çalışır …' (timeline değişmedi)");
  setupSenkron({ shareTrack: true });
  lsStore.set("spread.senkronApply.v1", "1");
  await startHelper();
  out = await clickAndWait("btn-senkron", yes, senkronDoneRe);
  lsStore.delete("spread.senkronApply.v1");
  if (!/Uygula yalnız Dağıt düzeninde çalışır/.test(out) || counters.txNames.length) fail("Dağıt dışı düzende Uygula:\n" + failLines(out));
  else ok("iki dosya aynı track'te (Dağıt düzeni değil) → Uygula başlamadı, hiçbir şey değişmedi");
  await stopHelper();
  await startHelper({ senkronTools: undefined, senkronPlatform: "win32", senkronDownload: () => Promise.reject(new Error("getaddrinfo ENOTFOUND github.com")) });
  setupSenkron();
  await sleep(600); // yeni token dosyası (yardımcı yeniden başladı)
  const qs = [];
  out = await clickAndWait("btn-senkron", async (x) => (qs.push(x), no()), doneRe);
  if (!/ffmpeg'i indirir: resmî Windows derlemesi \(7\.1\.1/.test(qs.join("\n")) || !/İptal edildi — hiçbir şey değişmedi/.test(out)) fail("ffmpeg indirme sorusu:\n" + qs.join("\n") + "\n" + failLines(out));
  else ok("ilk kullanım: 'ffmpeg'i indirir (7.1.1, ~88 MB, sha256 doğrulanır) … İndirilsin mi?' → Vazgeç → hiçbir şey");
  out = await clickAndWait("btn-senkron", yes, doneRe);
  if (!/✗ SENKRON DURDU: SENKRON yardımcıda durdu: ffmpeg indirilemedi: getaddrinfo ENOTFOUND github\.com/.test(out)) fail("indirilemeyen ffmpeg:\n" + failLines(out) + out.split("\n").slice(-4).join("\n"));
  else ok("indirme olmazsa açık hata: 'ffmpeg indirilemedi: … İnternet bağlantısını kontrol et; olmazsa … şu klasöre koy' (timeline değişmedi)");
  await stopHelper();
};

scenarios.senkron_degisti = async () => {
  // inceleme #15 M2: (a) eşleştirme sürerken timeline değişirse Uygula başlamaz; (b) taşınacak dosyanın track'inde yolu okunamayan
  // başka bir dosyanın klibi varsa (ör. çevrimdışı müzik) Dağıt düzeni sayılmaz — yalnız okunan dosyalara bakmak yetmez
  const s = setupSenkron();
  lsStore.set("spread.senkronApply.v1", "1");
  await startHelper();
  await sleep(600); // önceki senaryo yardımcıyı durdurduysa: yeni token dosyası
  fsReal.rmSync(path.join(TMPHOME, "Library", "Application Support", "BadIdeaAgency", "Spread", "senkron-cache"), { recursive: true, force: true });
  process.env.FAKE_FFMPEG_SLOW_MS = "300";
  const qs = [];
  const run = clickAndWait("btn-senkron", async (x) => (qs.push(x), yes()), senkronDoneRe);
  let moved = false;
  for (let i = 0; i < 500 && !moved; i++) {
    await sleep(20);
    if (/ses okunuyor/.test(els["progress-text"]?.textContent ?? "")) {
      const c = s.a.flat().find((x) => /^DJI_02/.test(x.name));
      c.start += sec(1);
      c.end += sec(1);
      moved = true;
    }
  }
  let out = await run;
  delete process.env.FAKE_FFMPEG_SLOW_MS;
  if (!moved || !/✗ SENKRON DURDU: Eşleştirme sürerken timeline değişti/.test(out) || counters.txNames.length || qs.length)
    fail(`eşleştirme sırasında değişen timeline: ${moved} ${counters.txNames.join(", ")} ${qs.join(" | ")}\n` + failLines(out));
  else ok("eşleştirme sürerken klip kaydırıldı → Uygula başlamadı (soru yok, transaction yok, yedek yok)");
  lsStore.delete("spread.senkronApply.v1");
  const s2 = setupSenkron();
  lsStore.set("spread.senkronApply.v1", "1");
  const stray = pi("MUZIK_ALTYAPI.WAV", sec(30), { video: false }); // mediaPath yok → yolu okunamaz
  const i2 = s2.a.findIndex((tr) => tr.some((c) => /^DJI_02/.test(c.name)));
  s2.a[i2].push(mkClip("A", stray, sec(400), sec(430)));
  out = await clickAndWait("btn-senkron", yes, senkronDoneRe);
  lsStore.delete("spread.senkronApply.v1");
  // track adı kullanıcının gördüğü gibi (1'den): dizin i2 → "A{i2 + 1}"
  if (!new RegExp(`Uygula yalnız Dağıt düzeninde çalışır .*: A${i2 + 1}\\.`).test(out) || counters.txNames.length) fail("okunamayan klip aynı track'te:\n" + failLines(out));
  else ok(`DJI_02'nin track'inde (A${i2 + 1}) yolu okunamayan başka bir klip → Uygula başlamadı, hiçbir şey değişmedi`);
};

scenarios.senkron_lead = async () => {
  // inceleme #15 N5: ses akışının dosya başına göre yeri bilinmeyen dosya (ffprobe > 5 sn kayma gösteriyor) — sesi eşleşse de Uygula onu
  // bulunan yere TAŞIMAZ, emin olunmayanlarla en sona koyar; rapor bunu yazar
  setupSenkron();
  const dji2 = path.join(TMPHOME, "medya", "DJI_02_20260925_160001.WAV");
  fsReal.writeFileSync(dji2 + ".meta.json", JSON.stringify({ audioStart: 9 }));
  lsStore.set("spread.senkronApply.v1", "1");
  await startHelper();
  await sleep(600);
  const out = await clickAndWait("btn-senkron", yes, senkronDoneRe);
  lsStore.delete("spread.senkronApply.v1");
  fsReal.rmSync(dji2 + ".meta.json", { force: true });
  let rep = "";
  try {
    rep = fsReal.readFileSync(reportFile(), "utf8");
  } catch {}
  const d2 = mediaStartOf("DJI_02_20260925_160001.WAV");
  const d1 = mediaStartOf("DJI_01_20260925_160000.WAV");
  const okMove = /✓ SENKRON UYGULANDI/.test(out) && /"DJI_02_20260925_160001\.WAV": sesi eşleşti ama ses akışının dosya başına göre yeri bilinmiyor → taşınmaz, en sona/.test(out);
  const atEnd = d2 !== null && d1 !== null && d2 >= sec(200) && d2 - d1 !== sec(1.5);
  if (!okMove || !atEnd || !/DJI_02_20260925_160001\.WAV".*ses başlangıcı bilinmiyor → Uygula'da taşınmaz/.test(rep))
    fail(`bilinmeyen ses başlangıcı: DJI_02 ${d2} DJI_01 ${d1}\n` + failLines(out) + out.split("\n").filter((l) => /DJI_02/.test(l)).join("\n"));
  else ok("ses akışının başlangıcı bilinmeyen DJI_02 (ffprobe 9 sn kayma) → sesi eşleşti ama taşınmadı, en sona kondu; raporda yazıyor");
};

scenarios.senkron_grup_once = async () => {
  // iki ayrı çekim (iki grup; Grup 1 = eşleşmesi en güçlü dosyanın grubu = B çekimi); dosya adındaki saate göre Grup 2 (A, 16:00),
  // Grup 1'den (B, 17:00) 1 saat ÖNCE → Uygula önce onu koyar, Grup 1'i saat farkı kadar sonra (inceleme #15: eski kod saat sırasında
  // ilk gelen grubu "Grup 1'in başı" sanıyordu → Grup 1 saatten kopup boşlukla hemen ardına gidiyordu)
  const A = SYN.scene(70, 4321);
  const B = SYN.scene(70, 8765);
  const media = path.join(TMPHOME, "medya2");
  fsReal.mkdirSync(media, { recursive: true });
  const spec = [
    { name: "A081C001_260925XX.MP4", cam: true, start: 0n, dur: sec(40), sc: A, t: 10, mic: SYN.MIC.cam },
    { name: "A081C002_260925XX.MP4", cam: true, start: sec(50), dur: sec(40), sc: B, t: 5, mic: SYN.MIC.cam },
    { name: "DJI_01_20260925_160000.WAV", cam: false, start: 0n, dur: sec(60), sc: A, t: 0, mic: SYN.MIC.lav1 },
    { name: "DJI_02_20260925_170000.WAV", cam: false, start: 0n, dur: sec(60), sc: B, t: 0, mic: SYN.MIC.lav2 },
  ];
  setupSync({ cams: spec.filter((x) => x.cam), wavs: spec.filter((x) => !x.cam), others: [] });
  let seed = 50;
  for (const x of spec) {
    const file = path.join(media, x.name);
    projItems[x.name].mediaPath = file;
    fsReal.writeFileSync(file, "sahte medya " + x.name);
    fsReal.writeFileSync(file + ".pcm", Buffer.from(SYN.record(x.sc, x.t, Number(x.dur / TPS), x.mic, seed++).buffer));
  }
  lsStore.set("spread.senkronApply.v1", "1");
  await startHelper();
  await sleep(600);
  const out = await clickAndWait("btn-senkron", yes, senkronDoneRe);
  lsStore.delete("spread.senkronApply.v1");
  let rep = "";
  try {
    rep = fsReal.readFileSync(reportFile(), "utf8");
  } catch {}
  const st = (n) => mediaStartOf(n);
  const got = spec.map((x) => `${x.name.slice(0, 8)} ${st(x.name) === null ? "?" : (Number(st(x.name)) / Number(TPS)).toFixed(3)}`).join(", ");
  const before = /Grup 2: 2 dosya.*Grup 1'den 3600\.000 sn ÖNCE/.test(rep);
  const exact =
    st("DJI_01_20260925_160000.WAV") === 0n &&
    st("A081C001_260925XX.MP4") === sec(10) &&
    st("DJI_02_20260925_170000.WAV") === sec(3600) &&
    st("A081C002_260925XX.MP4") === sec(3605);
  if (!/✓ SENKRON UYGULANDI/.test(out) || !before || !exact) fail(`saatle önce gelen grup: ${got}\n` + rep.split("\n").filter((l) => /Grup \d/.test(l)).join("\n") + "\n" + failLines(out));
  else ok(`Grup 2 saat ipucuna göre Grup 1'den 3600 sn ÖNCE → önce o (DJI_01 0 sn, C001 10 sn), Grup 1 saat farkıyla 3600 sn'de (DJI_02 3600, C002 3605)`);
};

// ------------------------------------------------------------ çalıştır
(async () => {
  setupReal({ nCams: 2, nWavSessions: 1 });
  require(path.join(DIST, "index.js"));
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
