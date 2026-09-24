// SMOKE TEST — Premiere OLMADAN, sahte ("mock") bir premierepro modülüyle dist/'i Node'da çalıştırır.
// Amaç: panelin kod yollarını (akış, sorular, rapor, PROBE_ kilidi, hata yakalama) denemek.
// UYARI: Buradaki davranışlar TAHMİNDİR, gerçek API gerçeği DEĞİLDİR. Gerçek cevap yalnızca Premiere'deki testten gelir.
// Kullanım: npm run build && node dev/smoke.cjs

/* eslint-disable */
const Module = require("module");
const path = require("path");

const TPS = 254016000000n; // tick / saniye
// "happy": her şey yolunda varsayımı. "grim": kötümser varsayımlar (hata/yedek yollarını denemek için).
// "throw": olmayan track'e clone istisna fırlatır, gerisi yolunda (yedek yol + karar mantığı denenir).
const MODE = ["grim", "throw"].includes(process.argv[2]) ? process.argv[2] : "happy";
const G = MODE === "grim";
const TH = MODE === "throw";
const sec = (s) => BigInt(Math.round(s * 1000)) * (TPS / 1000n);

// ------------------------------------------------------------ sahte model
let nextId = 1;
const mkTT = (t) => ({
  ticks: t.toString(),
  seconds: Number(t) / Number(TPS),
  ticksNumber: Number(t),
});
const mkGuid = (s) => ({ toString: () => s });
const projItems = {
  cam: { name: "CAM_A001.mp4", getId: () => "pi-cam", dur: sec(10) },
  ext1: { name: "ZOOM_01.wav", getId: () => "pi-ext1", dur: sec(8) },
  ext2: { name: "ZOOM_02.wav", getId: () => "pi-ext2", dur: sec(6) },
};

function mkClip(kind, pi, start, end, linkId = null) {
  return {
    id: nextId++,
    kind,
    pi,
    start,
    end,
    inPt: 0n,
    outPt: end - start,
    speed: 1,
    disabled: false,
    name: pi.name,
    linkId,
  };
}

function mkSequence(name, guid) {
  return { name, guid, v: [[], [], []], a: [[], [], []], sel: new Set() };
}

const state = { sequences: [], activeGuid: null };
const hooks = { onVCount: null };
const undoStack = [];

function deepCopy() {
  return JSON.parse(
    JSON.stringify(state, (k, v) => (typeof v === "bigint" ? { __b: v.toString() } : v instanceof Set ? { __s: [...v] } : k === "pi" ? v.getId() : v))
  );
}
function restore(snap) {
  const rev = (k, v) => {
    if (v && typeof v === "object" && "__b" in v) return BigInt(v.__b);
    if (v && typeof v === "object" && "__s" in v) return new Set(v.__s);
    if (k === "pi") return Object.values(projItems).find((p) => p.getId() === v);
    return v;
  };
  const s = JSON.parse(JSON.stringify(snap), rev);
  state.sequences = s.sequences;
  state.activeGuid = s.activeGuid;
}
function undo() {
  const s = undoStack.pop();
  if (s) restore(s);
}

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
  if (!f) throw new Error(`stale track item ${id}`);
  return f;
}
function ensureTrack(grp, idx) {
  while (grp.length <= idx) grp.push([]);
}

function wrapItem(id) {
  const g = (fn) => async () => fn(need(id));
  return {
    __id: id,
    getStartTime: g((f) => mkTT(f.c.start)),
    getEndTime: g((f) => mkTT(f.c.end)),
    getInPoint: g((f) => mkTT(f.c.inPt)),
    getOutPoint: g((f) => mkTT(f.c.outPt)),
    getSpeed: g((f) => f.c.speed),
    isDisabled: g((f) => f.c.disabled),
    getName: g((f) => f.c.name),
    getTrackIndex: g((f) => f.t),
    getIsSelected: g((f) => f.s.sel.has(id)),
    getProjectItem: g((f) => f.c.pi),
  };
}

function wrapSelection(ids) {
  const set = new Set(ids);
  return {
    __ids: set,
    addItem: (it) => (set.add(it.__id), true),
    removeItem: (it) => set.delete(it.__id),
    getTrackItems: async () => [...set].filter((i) => findClip(i)).map(wrapItem),
  };
}

function wrapTrack(seqGuid, kind, idx) {
  return {
    getTrackItems: () => {
      const s = seqByGuid(seqGuid);
      return (kind === "V" ? s.v : s.a)[idx].map((c) => wrapItem(c.id));
    },
  };
}

function wrapSequence(guid) {
  const s = () => seqByGuid(guid);
  return {
    get name() {
      return s().name;
    },
    guid: mkGuid(guid),
    getVideoTrackCount: async () => (hooks.onVCount && hooks.onVCount(), s().v.length),
    getAudioTrackCount: async () => s().a.length,
    getVideoTrack: async (i) => wrapTrack(guid, "V", i),
    getAudioTrack: async (i) => wrapTrack(guid, "A", i),
    getEndTime: async () => {
      let m = 0n;
      for (const grp of [s().v, s().a]) for (const tr of grp) for (const c of tr) if (c.end > m) m = c.end;
      return mkTT(m);
    },
    getSelection: async () => wrapSelection([...s().sel]),
    setSelection: (sel) => {
      if (G) return false;
      s().sel = new Set(sel.__ids);
      return true;
    },
    createCloneAction: () => {
      if (G) throw new Error("mock: createCloneAction yok");
      return {
      apply() {
        const src = s();
        const copy = JSON.parse(deepCopyOne(src));
        restoreSeqInto(copy, src.name + " Copy", "guid-" + nextId++);
      },
    };
    },
  };
}
function deepCopyOne(seq) {
  return JSON.stringify(seq, (k, v) => (typeof v === "bigint" ? { __b: v.toString() } : v instanceof Set ? { __s: [] } : k === "pi" ? v.getId() : v));
}
function restoreSeqInto(raw, name, guid) {
  const rev = (k, v) => {
    if (v && typeof v === "object" && "__b" in v) return BigInt(v.__b);
    if (v && typeof v === "object" && "__s" in v) return new Set();
    if (k === "pi") return Object.values(projItems).find((p) => p.getId() === v);
    return v;
  };
  const seq = JSON.parse(JSON.stringify(raw), rev);
  seq.name = name;
  seq.guid = guid;
  for (const grp of [seq.v, seq.a]) for (const tr of grp) for (const c of tr) c.id = nextId++;
  state.sequences.push(seq);
}

function cloneClipTo(seq, c, trackIdx, linkId) {
  const grp = c.kind === "V" ? seq.v : seq.a;
  ensureTrack(grp, trackIdx);
  const n = { ...c, id: nextId++, linkId };
  // overwrite: çakışanı sil
  grp[trackIdx] = grp[trackIdx].filter((x) => x.end <= n.start || x.start >= n.end);
  grp[trackIdx].push(n);
}

const editorFor = (seqW) => {
  const guid = seqW.guid.toString();
  return {
    createCloneTrackItemAction: (item, off, vOff, aOff, align, isInsert) => ({
      apply() {
        const f = need(item.__id);
        const seq = seqByGuid(guid);
        const newLink = f.c.linkId ? "L" + nextId++ : null;
        const offT = BigInt(off.ticks);
        const shift = (c) => ({ ...c, start: c.start + offT, end: c.end + offT });
        const grpOf = (k) => (k === "V" ? seq.v : seq.a);
        const tgt = (c, t, off) => {
          if (TH && t + off >= grpOf(c.kind).length) throw new Error(`mock: hedef track ${t + off} yok`);
          return G ? Math.min(t + off, grpOf(c.kind).length - 1) : t + off;
        };
        cloneClipTo(seq, shift(f.c), tgt(f.c, f.t, f.c.kind === "V" ? vOff : aOff), newLink);
        if (f.c.linkId && !G) {
          for (const grp of [seq.v, seq.a])
            for (let t = 0; t < grp.length; t++)
              for (const p of grp[t])
                if (p.linkId === f.c.linkId && p.id !== f.c.id) cloneClipTo(seq, shift(p), t + (p.kind === "V" ? vOff : aOff), newLink);
        }
      },
    }),
    createRemoveItemsAction: (sel, ripple, mt) => ({
      apply() {
        const seq = seqByGuid(guid);
        for (const id of sel.__ids) {
          const f = findClip(id);
          if (!f || f.s !== seq) continue;
          f.grp[f.t] = f.grp[f.t].filter((x) => x.id !== id);
          if (G) {
            const d = f.c.end - f.c.start;
            for (const x of f.grp[f.t]) if (x.start >= f.c.end) (x.start -= d), (x.end -= d);
          }
        }
      },
    }),
    createInsertProjectItemAction: (pi, time, vIdx, aIdx, limitShift) => ({
      apply() {
        const seq = seqByGuid(guid);
        const st = BigInt(time.ticks);
        const L = "L" + nextId++;
        ensureTrack(seq.v, vIdx);
        ensureTrack(seq.a, aIdx);
        seq.v[vIdx].push({ ...mkClip("V", pi, st, st + pi.dur, L) });
        seq.a[aIdx].push({ ...mkClip("A", pi, st, st + pi.dur, L) });
      },
    }),
  };
};

let projectW;
const ppro = {
  Constants: {
    TrackItemType: { EMPTY: 0, CLIP: 1, TRANSITION: 2, PREVIEW: 3, FEEDBACK: 4 },
    MediaType: { ANY: 0, DATA: 1, VIDEO: 2, AUDIO: 3 },
  },
  Application: { version: Promise.resolve("26.0.0-MOCK") },
  TickTime: { TIME_ZERO: mkTT(0n) },
  TrackItemSelection: {
    createEmptySelection: (cb) => {
      if (G) throw new Error("mock: createEmptySelection desteklenmiyor");
      cb(wrapSelection([]));
      return true;
    },
  },
  SequenceEditor: { getEditor: (s) => editorFor(s) },
  Project: { getActiveProject: async () => projectW },
};
projectW = {
  getActiveSequence: async () => (state.activeGuid ? wrapSequence(state.activeGuid) : null),
  getSequences: async () => state.sequences.map((s) => wrapSequence(s.guid)),
  lockedAccess: (cb) => cb(),
  executeTransaction: (cb, name) => {
    const acts = [];
    cb({
      addAction: (a) => (acts.push(a), true),
      get empty() {
        return acts.length === 0;
      },
    });
    const snap = deepCopy();
    try {
      for (const a of acts) a.apply();
    } catch (e) {
      restore(snap); // atomik: hata olursa hiçbir şey uygulanmaz
      throw e;
    }
    undoStack.push(snap);
    return true;
  },
};

// ------------------------------------------------------------ kurulum
function setupProbe() {
  const s = mkSequence("PROBE_test", "guid-probe");
  const L = "Lcam";
  s.v[0].push(mkClip("V", projItems.cam, 0n, sec(10), L));
  s.a[0].push(mkClip("A", projItems.cam, 0n, sec(10), L));
  s.a[0].push(mkClip("A", projItems.ext1, sec(10), sec(18)));
  s.a[0].push(mkClip("A", projItems.ext2, sec(18), sec(24)));
  const other = mkSequence("Main Edit", "guid-main");
  other.v[0].push(mkClip("V", projItems.cam, 0n, sec(10), "Lmain"));
  state.sequences = [s, other];
  state.activeGuid = "guid-probe";
}

// ------------------------------------------------------------ sahte DOM
const els = {};
function mkEl(id) {
  const listeners = [];
  const attrs = {};
  const el = {
    id,
    children: [],
    style: {},
    textContent: "",
    value: "",
    scrollTop: 0,
    scrollHeight: 0,
    set innerHTML(v) {
      el.children = [];
    },
    get innerHTML() {
      return "";
    },
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
global.document = {
  getElementById: (id) => (els[id] ??= mkEl(id)),
  createElement: () => mkEl(null),
};
let copied = null;
Object.defineProperty(globalThis, "navigator", {
  value: { clipboard: { setContent: async (d) => (copied = d["text/plain"]) } },
  configurable: true,
});

Module._load = ((orig) =>
  function (request) {
    if (request === "premierepro") return ppro;
    if (request === "uxp") return { versions: { uxp: "uxp-MOCK" }, host: { name: "premierepro", version: "mock" } };
    return orig.apply(this, arguments);
  })(Module._load);

// ------------------------------------------------------------ çalıştır
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logText = () => (els.log?.children ?? []).map((c) => c.textContent).join("\n");
const fail = (m) => {
  console.error("SMOKE FAIL:", m);
  process.exit(1);
};

async function waitIdle(answerer, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(25);
    if (els.ask?.style.display === "block") {
      const q = els["ask-text"].textContent;
      await answerer(q);
    }
    if (!els["btn-all"].hasAttribute("disabled") || /Bitti\./.test(logText().split("\n").slice(-1)[0] || "")) {
      // butonlar tekrar açıldıysa iş bitti
      if (!els["btn-all"].hasAttribute("disabled")) return;
    }
  }
  fail("zaman aşımı");
}

async function grimScenario() {
  els["btn-all"].click();
  await sleep(50);
  await waitIdle(async (q) => {
    els["ask-no"].click(); // kullanıcı her şeye "Hayır" diyor, Ctrl+Z'ye de basmıyor
    await sleep(30);
  });
  const report = els.report.value;
  console.log(report);
  // T3 BELİRSİZ: T6'da Ctrl+Z yapılmadığı için asıl kamera videosu silinmiş kalıyor (tasarım gereği).
  const expect = { T1: "FAIL", T2: "PASS", T3: "BELİRSİZ", T4: "PASS", T5: "FAIL", T6: "FAIL", T7: "FAIL" };
  for (const [t, want] of Object.entries(expect)) {
    const m = report.match(new RegExp(`^  ${t} .*? (PASS|FAIL|BELİRSİZ|ÇALIŞMADI)$`, "m"));
    if (!m) fail(`${t} özeti yok`);
    if (m[1] !== want) fail(`${t}: beklenen ${want}, gelen ${m[1]}`);
  }
  for (const needle of [
    "HATA (yakalandı): Error: mock: createCloneAction yok",
    "YEDEK YÖNTEM",
    "yedek yol: getSelection + removeItem",
    "Öneri: CEP'e geç",
    "T7: ripple=false olsa bile",
  ])
    if (!report.includes(needle)) fail(`raporda yok: ${needle}`);
  const main = seqByGuid("guid-main");
  if (main.v[0].length !== 1 || main.v.length !== 3 || main.a.length !== 3) fail("Main Edit değişti!");
  console.log("\nSMOKE (grim) OK");
  process.exit(0);
}

async function throwScenario() {
  els["btn-all"].click();
  await sleep(50);
  await waitIdle(async (q) => {
    if (/Ctrl\+Z/.test(q)) undo();
    if (/KOPYA videoya/.test(q)) {
      const s = seqByGuid("guid-probe");
      const v = s.v.flat().filter((c) => c.pi === projItems.cam).pop();
      s.sel = new Set(s.v.flat().concat(s.a.flat()).filter((c) => c.linkId && c.linkId === v.linkId).map((c) => c.id));
    }
    els["ask-yes"].click();
    await sleep(30);
  });
  const report = els.report.value;
  console.log(report);
  const expect = { T1: "PASS", T2: "PASS", T3: "PASS", T4: "PASS", T5: "PASS", T6: "FAIL", T7: "PASS" };
  for (const [t, want] of Object.entries(expect)) {
    const m = report.match(new RegExp(`^  ${t} .*? (PASS|FAIL|BELİRSİZ|ÇALIŞMADI)$`, "m"));
    if (!m) fail(`${t} özeti yok`);
    if (m[1] !== want) fail(`${t}: beklenen ${want}, gelen ${m[1]}`);
  }
  for (const needle of ["clone HATA verdi", "YEDEK YÖNTEM", "Öneri: UXP + workaround", "T6: FAIL — HATA (yakalandı)"])
    if (!report.includes(needle)) fail(`raporda yok: ${needle}`);
  console.log("\nSMOKE (throw) OK");
  process.exit(0);
}

(async () => {
  setupProbe();
  require(path.join(__dirname, "..", "dist", "index.js"));
  await sleep(100);
  if (G || TH) {
    await sleep(1700);
    return G ? grimScenario() : throwScenario();
  }

  // 1) KİLİT: aktif sequence PROBE_ değilken hiçbir şey değişmemeli
  state.activeGuid = "guid-main";
  await sleep(1700);
  if (!els["btn-t2"].hasAttribute("disabled")) fail("PROBE_ dışı sequence'ta butonlar açık");
  const before = deepCopy();
  els["btn-t2"].click();
  els["btn-all"].click();
  await sleep(1500);
  if (JSON.stringify(deepCopy()) !== JSON.stringify(before)) fail("kilitliyken timeline değişti");
  if (!/kilitli/i.test(logText())) fail("kilit mesajı loga düşmedi");
  console.log("✓ kilit: PROBE_ dışı sequence'ta butonlar kilitli ve hiçbir şey değişmedi");

  // 2) Hepsini çalıştır
  state.activeGuid = "guid-probe";
  await sleep(1700);
  if (els["btn-all"].hasAttribute("disabled")) fail("PROBE_test aktifken butonlar kilitli");
  els["btn-all"].click();
  await sleep(50);
  await waitIdle(async (q) => {
    if (/Ctrl\+Z/.test(q)) undo(); // kullanıcı bir kez geri alıyor
    if (/KOPYA videoya/.test(q)) {
      // kullanıcı kopya videoya tıklıyor → linked selection ikisini de seçer
      const s = seqByGuid("guid-probe");
      const v = s.v.flat().filter((c) => c.pi === projItems.cam).pop();
      s.sel = new Set(s.v.flat().concat(s.a.flat()).filter((c) => c.linkId && c.linkId === v.linkId).map((c) => c.id));
    }
    els["ask-yes"].click();
    await sleep(30);
  });
  const report = els.report.value;
  console.log(report);
  for (const t of ["T1", "T2", "T3", "T4", "T5", "T6", "T7"]) {
    const m = report.match(new RegExp(`^  ${t} .*? (PASS|FAIL|BELİRSİZ|ÇALIŞMADI)$`, "m"));
    if (!m) fail(`${t} özeti yok`);
    if (m[1] !== "PASS") fail(`${t} mock'ta PASS değil: ${m[1]}`);
  }
  if (!/Öneri: UXP yeterli\./.test(report)) fail("karar önerisi beklenen gibi değil");
  const main = seqByGuid("guid-main");
  if (main.v[0].length !== 1 || main.v.length !== 3 || main.a.length !== 3) fail("Main Edit değişti!");

  // 3) Kopyalama
  els["btn-copy"].click();
  await sleep(50);
  if (!copied || !copied.includes("KARAR ÖNERİSİ")) fail("rapor panoya kopyalanmadı");

  // 4) Test sırasında sequence değişirse durmalı (ilk okuma sonrası kullanıcı Main Edit'e geçiyor)
  setupProbe();
  await sleep(1700);
  const mainBefore = deepCopyOne(seqByGuid("guid-main"));
  const probeBefore = deepCopyOne(seqByGuid("guid-probe"));
  hooks.onVCount = () => {
    state.activeGuid = "guid-main";
    hooks.onVCount = null;
  };
  els["btn-t2"].click();
  await sleep(3000);
  if (deepCopyOne(seqByGuid("guid-main")) !== mainBefore) fail("sequence değişince Main Edit'e dokunuldu");
  if (deepCopyOne(seqByGuid("guid-probe")) !== probeBefore) fail("kilit tetiklendiği hâlde PROBE_test değişti");
  if (!/aktif sequence değişti/i.test(logText())) fail("test sırasında sequence değişimi yakalanmadı");
  console.log("✓ kilit: test sırasında aktif sequence değişince durdu, hiçbir sequence'a dokunulmadı");

  console.log("\nSMOKE OK");
  process.exit(0);
})().catch((e) => fail(e && e.stack ? e.stack : e));
