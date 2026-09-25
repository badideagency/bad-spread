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
// Kullanım: npm run build:spread && node spread/dev/smoke.cjs all   (ya da tek senaryo adı)

/* eslint-disable */
const Module = require("module");
const path = require("path");

const TPS = 254016000000n;
const FRAME25 = TPS / 25n;
const sec = (s) => BigInt(Math.round(s * 1000)) * (TPS / 1000n);
const frames = (n) => BigInt(n) * FRAME25;

// ------------------------------------------------------------ mock ayarları (senaryo başına)
const M = { broken: false, nonseq: false, nobackup: false, backupActive: false };
const hooks = { onCloneSeq: null, onGetActive: null, beforeRemoveApply: null };
const counters = { setActions: new Map(), overwrites: 0, clones: 0, txNames: [] };

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
    return { apply: () => fn(need(id), BigInt(t.ticks)) };
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
    createSetInPointAction: act("in", ({ c }, t) => ((c.inPt = t), (c.end = c.start + (c.outPt - c.inPt)))),
    createSetOutPointAction: act("out", ({ c }, t) => ((c.outPt = t), (c.end = c.start + (c.outPt - c.inPt)))),
    createSetStartAction: act("start", ({ c }, t) => ((c.inPt += t - c.start), (c.start = t))),
    createSetEndAction: act("end", ({ c }, t) => ((c.outPt += t - c.end), (c.end = t))),
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
    getVideoTrackCount: async () => s().v.length,
    getAudioTrackCount: async () => s().a.length,
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
          const o = BigInt(off.ticks);
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
  ProjectItem: { TYPE_CLIP: 1 },
  ClipProjectItem: { cast: (p) => ({ getMedia: async () => ({ getDuration: () => mkTT(p.dur) }) }) },
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
    return true;
  },
};

// ------------------------------------------------------------ sahte DOM
const els = {};
function mkEl(id) {
  const listeners = [];
  const attrs = {};
  const el = {
    id, children: [], style: {}, textContent: "", value: "", scrollTop: 0, scrollHeight: 0,
    set innerHTML(v) { el.children = []; },
    get innerHTML() { return ""; },
    appendChild: (c) => el.children.push(c),
    setAttribute: (k, v) => (attrs[k] = v),
    removeAttribute: (k) => delete attrs[k],
    hasAttribute: (k) => k in attrs,
    addEventListener: (ev, fn) => listeners.push(fn),
    click: () => listeners.forEach((f) => f()),
    scrollIntoView: () => {},
  };
  return el;
}
global.document = { getElementById: (id) => (els[id] ??= mkEl(id)), createElement: () => mkEl(null) };
let copied = null;
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { setContent: async (d) => (copied = d["text/plain"]) } }, configurable: true });
Module._load = ((orig) =>
  function (request) {
    if (request === "premierepro") return ppro;
    if (request === "uxp") return { versions: { uxp: "uxp-MOCK" }, host: { name: "premierepro", version: "26.5.1" } };
    return orig.apply(this, arguments);
  })(Module._load);

// ------------------------------------------------------------ kurulumlar
/**
 * Kullanıcının gerçek düzeni: V1'de iki kameranın klipleri arka arkaya (A038C0xx_260912*.MP4 ve C01xx.MP4, her biri A1'de
 * kendi sesiyle bağlı), harici sesler A2/A3'te arka arkaya (260912_HHMMSS_Tr1/Tr2/TrLR.WAV). 22 kamera + 12 WAV.
 * NOT: Probe raporunun tam tick değerleri bu oturumda yok; adlar, sayılar ve düzen gerçek, süreler 25 fps kare-hizalı üretildi.
 */
function setupReal({ trimmed = [], channelsOf = {}, nCams = 22, nWavSessions = 4 } = {}) {
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
    const p = pi(name, media, { channels: channelsOf[i] ?? 1 });
    const L = "Lcam" + i;
    s.v[0].push(mkClip("V", p, t, t + d, L, inPt));
    for (let c = 0; c < p.channels; c++) s.a[c].push(mkClip("A", p, t, t + d, L, inPt));
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
  Object.assign(M, { broken: false, nonseq: false, nobackup: false, backupActive: false });
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
  if (!p.errors.some((e) => /döngü/.test(e))) fail(`döngü yakalanmadı: ${JSON.stringify(p.errors)}`);
  else ok("plan: birbirinin hedefinde çakışan iki ses → 'güvenli sıra yok (döngü)' hatası, Spread başlamaz");
  // hız≠1 kamera → hata
  const v = C("V", 0, 0n, sec(5), "CAM.MP4", { speed: 2 });
  const a = C("A", 0, 0n, sec(5), "CAM.MP4", { speed: 2, projId: v.projId });
  p = makePlan(snap([v, a]), 1);
  if (!p.errors.some((e) => /hızı 2/.test(e))) fail("hız≠1 kamera yakalanmadı");
  else ok("plan: hızı değiştirilmiş kamera → hata (overwrite hızı korumaz)");
  // eşleşmeyen kamera kaynaklı ses → uyarı + ayrı ses birimi
  const v2 = C("V", 0, 0n, sec(5), "CAM2.MP4");
  const a2 = C("A", 0, sec(1), sec(5), "CAM2.MP4", { projId: v2.projId });
  p = makePlan(snap([v2, a2]), 1);
  if (!p.warnings.some((w) => /eşleşmeyen ses/.test(w)) || p.counts.audio !== 1 || p.counts.videoOnly !== 1) fail("eşleşmeyen kamera sesi yanlış sınıflandı");
  else ok("plan: kamera kaynaklı ama eşleşmeyen ses → uyarı + ayrı ses birimi");
  // WAV'ın hedef track'inde (A2) henüz silinmemiş bir KAMERA sesi var → güvenli sıra yok → hata
  const vX = C("V", 0, 0n, sec(10), "X.MP4");
  const aX = C("A", 1, 0n, sec(10), "X.MP4", { projId: vX.projId }); // kamera sesi A2'de
  const wW = C("A", 0, 0n, sec(10), "W.WAV"); // WAV A1'de → hedefi A2
  p = makePlan(snap([vX, aX, wW]), 1);
  if (!p.errors.some((e) => /güvenli sıra yok/.test(e) && /kamera klibi/.test(e))) fail(`kamera çakışması yakalanmadı: ${JSON.stringify(p.errors)}`);
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
  const which = process.argv[2] && process.argv[2] !== "all" ? [process.argv[2]] : Object.keys(scenarios);
  for (const name of which) {
    console.log(`▶ ${name}`);
    try {
      await scenarios[name]();
    } catch (e) {
      fail(`${name}: ${e && e.stack ? e.stack : e}`);
    }
  }
  if (fails.length) {
    console.error(`\nSPREAD SMOKE FAIL (${fails.length})`);
    process.exit(1);
  }
  console.log(`\nSPREAD SMOKE OK (${which.length} senaryo)`);
  process.exit(0);
})();
