// SMOKE TEST — Premiere OLMADAN, sahte ("mock") bir premierepro modülüyle dist/'i Node'da çalıştırır.
// Amaç: panelin kod yollarını (akış, sorular, rapor, PROBE_ kilidi, hata yakalama/sınıflama) denemek.
// UYARI: Buradaki davranışlar TAHMİNDİR, gerçek API gerçeği DEĞİLDİR. Gerçek cevap yalnızca Premiere'deki testten gelir.
// v0.1.0'ın gerçek Premiere 26.5.1 raporundan alınan tek kesin davranış burada da uygulanır:
//   bir transaction işlendikten sonra ESKİ TrackItem / seçim nesneleri "The script object is no longer valid" verir.
// Kullanım: npm run build && node dev/smoke.cjs [happy|grim|throw]

/* eslint-disable */
const Module = require("module");
const path = require("path");

const TPS = 254016000000n; // tick / saniye
// "happy": her şey yolunda. "grim": kötümser varsayımlar (API yok / davranış yok → CEP kararı).
// "throw": olmayan track'e clone/overwrite istisna fırlatır (sınıflanamayan hata → GEÇİCİ karar, CEP DEĞİL).
// "strict": happy + clearSelection/setSelection de eski referansları geçersiz kılar (en kötü ihtimal) → yine hepsi PASS olmalı.
// "linked": Linked Selection seçimi ve silmeyi bağlı partnere genişletir + olmayan track'e clone istisna → T2 yedek yolu yanlış CEP vermemeli.
// "filter": createRemoveItemsAction'ın mediaType'ı FİLTRE (VIDEO yalnız videoyu siler) → T3 [KOD], T7 bunu ölçer, CEP yok.
const MODES = ["grim", "throw", "strict", "linked", "filter"];
const MODE = MODES.includes(process.argv[2]) ? process.argv[2] : "happy";
const G = MODE === "grim";
const TH = MODE === "throw";
const ST = MODE === "strict";
const LK = MODE === "linked";
const FI = MODE === "filter";
const sec = (s) => BigInt(Math.round(s * 1000)) * (TPS / 1000n);

// ------------------------------------------------------------ sahte model
let nextId = 1;
let mockGen = 0; // her işlenen transaction / undo'da artar; eski sarmalayıcılar geçersiz olur
const STALE = "The script object is no longer valid";
const stale = (w) => {
  if (w.__gen !== mockGen) throw new Error(STALE);
};
const mkTT = (t) => ({ ticks: t.toString(), seconds: Number(t) / Number(TPS), ticksNumber: Number(t) });
const mkGuid = (s) => ({ toString: () => s });
const projItems = {
  cam: { name: "CAM_A001.MP4", getId: () => "pi-cam", dur: sec(12) },
  cam2: { name: "CAM_A002.MP4", getId: () => "pi-cam2", dur: sec(10) },
  ext1: { name: "260912_133224_Tr1.WAV", getId: () => "pi-ext1", dur: sec(8) },
  ext2: { name: "260912_133224_Tr2.WAV", getId: () => "pi-ext2", dur: sec(6) },
  ext3: { name: "ZOOM0001.WAV", getId: () => "pi-ext3", dur: sec(12) },
};
for (const p of Object.values(projItems)) p.__gen = -1; // ProjectItem'lar kuşaktan bağımsız

function mkClip(kind, pi, start, end, linkId = null, inPt = 0n) {
  return { id: nextId++, kind, pi, start, end, inPt, outPt: inPt + (end - start), speed: 1, disabled: false, name: pi.name, linkId };
}
function mkSequence(name, guid) {
  return { name, guid, v: [[], [], []], a: [[], [], []], sel: new Set() };
}

const state = { sequences: [], activeGuid: null };
const hooks = { onVCount: null, onCloneSeq: null, onGetActive: null };
const undoStack = [];

const repl = (k, v) => (typeof v === "bigint" ? { __b: v.toString() } : v instanceof Set ? { __s: [...v] } : k === "pi" ? v.getId() : v);
const rev = (k, v) => {
  if (v && typeof v === "object" && "__b" in v) return BigInt(v.__b);
  if (v && typeof v === "object" && "__s" in v) return new Set(v.__s);
  if (k === "pi") return Object.values(projItems).find((p) => p.getId() === v);
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
const deepCopyOne = (seq) => JSON.stringify(seq, repl);

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
const ensureTrack = (grp, idx) => {
  while (grp.length <= idx) grp.push([]);
};
function placeOverwrite(grp, idx, clip) {
  ensureTrack(grp, idx);
  grp[idx] = grp[idx].filter((x) => x.end <= clip.start || x.start >= clip.end);
  grp[idx].push(clip);
}

function wrapItem(id) {
  const w = { __id: id, __gen: mockGen };
  const g = (fn) => async () => (stale(w), fn(need(id)));
  const act = (fn) => (t) => {
    stale(w);
    need(id);
    return { apply: () => fn(need(id), BigInt(t.ticks)) };
  };
  Object.assign(w, {
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
    // kırpma anlamı (tahmin): in/out değişince start sabit kalır; start/end değişince karşı kenar sabit kalır
    createSetInPointAction: act(({ c }, t) => ((c.inPt = t), (c.end = c.start + (c.outPt - c.inPt)))),
    createSetOutPointAction: act(({ c }, t) => ((c.outPt = t), (c.end = c.start + (c.outPt - c.inPt)))),
    createSetStartAction: act(({ c }, t) => ((c.inPt += t - c.start), (c.start = t))),
    createSetEndAction: act(({ c }, t) => ((c.outPt += t - c.end), (c.end = t))),
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

function wrapTrack(seqGuid, kind, idx) {
  return {
    getTrackItems: () => {
      const s = seqByGuid(seqGuid);
      return ((kind === "V" ? s.v : s.a)[idx] ?? []).map((c) => wrapItem(c.id));
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
    clearSelection: async () => ((s().sel = new Set()), ST && mockGen++, true),
    getSelection: async () => wrapSelection([...s().sel]),
    setSelection: (sel) => {
      stale(sel);
      const ids = new Set(sel.__ids);
      if (LK)
        for (const id of [...ids]) {
          const f = findClip(id);
          if (f && f.c.linkId) for (const grp of [s().v, s().a]) for (const tr of grp) for (const c of tr) if (c.linkId === f.c.linkId) ids.add(c.id);
        }
      s().sel = ids;
      if (ST) mockGen++;
      return true;
    },
    createCloneAction: () => {
      if (G) throw new TypeError("sequence.createCloneAction is not a function");
      return {
        apply() {
          const seq = JSON.parse(deepCopyOne(s()), rev);
          seq.name = s().name + " Copy";
          seq.guid = "guid-" + nextId++;
          seq.sel = new Set();
          for (const grp of [seq.v, seq.a]) for (const tr of grp) for (const c of tr) c.id = nextId++;
          state.sequences.push(seq);
          if (hooks.onCloneSeq) hooks.onCloneSeq(seq.guid);
        },
      };
    },
  };
}

const editorFor = (seqW) => {
  const guid = seqW.guid.toString();
  const seq = () => seqByGuid(guid);
  const grpOf = (k) => (k === "V" ? seq().v : seq().a);
  const target = (kind, idx) => {
    if ((TH || LK) && idx >= grpOf(kind).length) throw new Error(`mock: hedef track ${idx} yok`);
    return G ? Math.min(idx, grpOf(kind).length - 1) : idx;
  };
  return {
    createCloneTrackItemAction: (item, off, vOff, aOff, align, isInsert) => {
      stale(item);
      return {
        apply() {
          const f = need(item.__id);
          const newLink = f.c.linkId ? "L" + nextId++ : null;
          const offT = BigInt(off.ticks);
          const copy = (c, t) =>
            placeOverwrite(grpOf(c.kind), target(c.kind, t + (c.kind === "V" ? vOff : aOff)), {
              ...c,
              id: nextId++,
              start: c.start + offT,
              end: c.end + offT,
              linkId: newLink,
            });
          const partners = [];
          if (f.c.linkId && !G)
            for (const grp of [seq().v, seq().a])
              for (let t = 0; t < grp.length; t++) for (const p of grp[t]) if (p.linkId === f.c.linkId && p.id !== f.c.id) partners.push([p, t]);
          copy(f.c, f.t);
          for (const [p, t] of partners) copy(p, t);
        },
      };
    },
    createRemoveItemsAction: (sel, ripple, mt) => {
      stale(sel);
      const ids = [...sel.__ids];
      if (LK)
        for (const id of [...ids]) {
          const f = findClip(id);
          if (f && f.c.linkId)
            for (const grp of [seq().v, seq().a]) for (const tr of grp) for (const c of tr) if (c.linkId === f.c.linkId && !ids.includes(c.id)) ids.push(c.id);
        }
      return {
        apply() {
          for (const id of ids) {
            const f = findClip(id);
            if (!f || f.s !== seq()) continue;
            if (FI && mt !== 0 && (mt === 2 ? f.c.kind !== "V" : f.c.kind !== "A")) continue; // filtre anlamı
            f.grp[f.t] = f.grp[f.t].filter((x) => x.id !== id);
            if (G) {
              const d = f.c.end - f.c.start;
              for (const x of f.grp[f.t]) if (x.start >= f.c.end) (x.start -= d), (x.end -= d);
            }
          }
        },
      };
    },
    createInsertProjectItemAction: (pi, time, vIdx, aIdx, limitShift) => ({
      apply() {
        const st = BigInt(time.ticks);
        const L = "L" + nextId++;
        ensureTrack(seq().v, vIdx);
        ensureTrack(seq().a, aIdx);
        seq().v[vIdx].push(mkClip("V", pi, st, st + pi.dur, L));
        seq().a[aIdx].push(mkClip("A", pi, st, st + pi.dur, L));
      },
    }),
    createOverwriteItemAction: (pi, time, vIdx, aIdx) => ({
      apply() {
        const st = BigInt(time.ticks);
        const L = "L" + nextId++;
        placeOverwrite(seq().v, target("V", vIdx), mkClip("V", pi, st, st + pi.dur, L));
        if (!G) placeOverwrite(seq().a, target("A", aIdx), mkClip("A", pi, st, st + pi.dur, L));
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
  TickTime: { TIME_ZERO: mkTT(0n), createWithTicks: (t) => mkTT(BigInt(t)) },
  TrackItemSelection: {
    createEmptySelection: () => {
      throw new Error("v0.1.1 createEmptySelection KULLANMAMALI (Adobe kalıbı: getSelection)");
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
      mockGen++;
      throw e;
    }
    undoStack.push(snap);
    mockGen++; // KESİN DAVRANIŞ (26.5.1): işlenen transaction eski referansları geçersiz kılar
    return true;
  },
};

// ------------------------------------------------------------ kurulum (kullanıcının gerçek düzeni)
function setupProbe(withOtherProbe = false) {
  const s = mkSequence("PROBE_test", "guid-probe");
  // V1: kameralar arka arkaya (sesleri A1'de bağlı). CAM_A001 kırpılmış: in=1s out=11s
  s.v[0].push(mkClip("V", projItems.cam, 0n, sec(10), "Lcam", sec(1)));
  s.a[0].push(mkClip("A", projItems.cam, 0n, sec(10), "Lcam", sec(1)));
  s.v[0].push(mkClip("V", projItems.cam2, sec(10), sec(20), "Lcam2"));
  s.a[0].push(mkClip("A", projItems.cam2, sec(10), sec(20), "Lcam2"));
  // A2: iki harici ses arka arkaya; A3: bir harici ses
  s.a[1].push(mkClip("A", projItems.ext1, 0n, sec(8)));
  s.a[1].push(mkClip("A", projItems.ext2, sec(8), sec(14)));
  s.a[2].push(mkClip("A", projItems.ext3, 0n, sec(12)));
  const other = mkSequence("Main Edit", "guid-main");
  other.v[0].push(mkClip("V", projItems.cam, 0n, sec(10), "Lmain"));
  state.sequences = [s, other];
  if (withOtherProbe) {
    const o = mkSequence("PROBE_other", "guid-probe-other");
    o.a[0].push(mkClip("A", projItems.ext1, 0n, sec(8)));
    state.sequences.push(o);
  }
  state.activeGuid = "guid-probe";
  undoStack.length = 0;
  mockGen++;
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
global.document = { getElementById: (id) => (els[id] ??= mkEl(id)), createElement: () => mkEl(null) };
let copied = null;
Object.defineProperty(globalThis, "navigator", {
  value: { clipboard: { setContent: async (d) => (copied = d["text/plain"]) } },
  configurable: true,
});

Module._load = ((orig) =>
  function (request) {
    if (request === "premierepro") return ppro;
    if (request === "uxp") return { versions: { uxp: "uxp-MOCK" }, host: { name: "premierepro", version: "26.5.1" } };
    return orig.apply(this, arguments);
  })(Module._load);

// ------------------------------------------------------------ yardımcılar
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logText = () => (els.log?.children ?? []).map((c) => c.textContent).join("\n");
const fail = (m) => {
  console.error("SMOKE FAIL:", m);
  process.exit(1);
};
let logMark = 0;
const markLog = () => (logMark = (els.log?.children ?? []).length);
const newLog = () => (els.log?.children ?? []).slice(logMark).map((c) => c.textContent).join("\n");

/** "Hepsini çalıştır" bitene (Bitti. / durduruldu) kadar soruları cevaplar. */
async function waitIdle(answerer, timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(25);
    if (els.ask?.style.display === "block") await answerer(els["ask-text"].textContent);
    if (/Bitti\.|kalan testler durduruldu/.test(newLog())) {
      await sleep(100);
      return;
    }
  }
  fail("zaman aşımı");
}
/** Kullanıcı sorudaki track'teki videoya tıklar → Linked Selection bağlı partnerleri de seçer. */
function clickVideoIn(q) {
  const m = q.match(/(V\d+) üzerindeki (?:KOPYA|YENİ) videoya/);
  if (!m) return;
  const s = seqByGuid("guid-probe");
  const v = (s.v[Number(m[1].slice(1)) - 1] ?? []).find((c) => c.pi === projItems.cam);
  if (!v) return;
  s.sel = new Set([v.id, ...s.v.flat().concat(s.a.flat()).filter((c) => v.linkId && c.linkId === v.linkId).map((c) => c.id)]);
}
const happyAnswer = async (q) => {
  if (/Ctrl\+Z/.test(q)) undo(); // kullanıcı bir kez geri alıyor
  clickVideoIn(q);
  els["ask-yes"].click();
  await sleep(30);
};
function summary(report) {
  const out = {};
  for (const t of ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]) {
    const m = report.match(new RegExp(`^  ${t} .*? (PASS|FAIL|BELİRSİZ|ÇALIŞMADI)(?: \\[([^\\]]+)\\])?$`, "m"));
    if (!m) fail(`${t} özeti yok`);
    out[t] = m[2] ? `${m[1]} [${m[2]}]` : m[1];
  }
  return out;
}
function expectSummary(report, want) {
  const got = summary(report);
  for (const [t, w] of Object.entries(want)) if (got[t] !== w) fail(`${t}: beklenen ${w}, gelen ${got[t]}`);
}
async function runAll(answerer) {
  markLog();
  els["btn-all"].click();
  await sleep(50);
  await waitIdle(answerer);
  return els.report.value;
}
const mainUntouched = () => {
  const main = seqByGuid("guid-main");
  if (main.v[0].length !== 1 || main.v.length !== 3 || main.a.length !== 3) fail("Main Edit değişti!");
};

// ------------------------------------------------------------ senaryolar
async function grimScenario() {
  const report = await runAll(async () => {
    els["ask-no"].click(); // kullanıcı her şeye "Hayır" diyor, Ctrl+Z'ye de basmıyor
    await sleep(30);
  });
  console.log(report);
  expectSummary(report, GRIM_EXPECT);
  // CEP yalnız ÖLÇÜLEN davranıştan (T7: ripple=false başka klipleri kaydırdı) gelmeli; istisnalar (T1 "is not a function") değil
  for (const needle of ["Öneri: CEP'e geç", "Engeller (API — CEP gerekçesi):", "T7: ripple=false olsa bile", "YEDEK YÖNTEM"])
    if (!report.includes(needle)) fail(`raporda yok: ${needle}`);
  if (/✗ T1:/.test(report)) fail("T1 istisnası engel sayıldı");
  mainUntouched();
  console.log("\nSMOKE (grim) OK");
  process.exit(0);
}

const GRIM_EXPECT = {
  T1: "FAIL [BELİRSİZ]", // TypeError "is not a function" → istisna, kanıt değil
  T2: "PASS", // clone track açmadı (ölçüldü) ama insert+sil yedeği çalıştı
  T3: "FAIL [BELİRSİZ]", // hedef track yoktu, clone üst track'e yapıştı → T2'nin bulgusu tekrar sayılmaz
  T4: "PASS",
  T5: "FAIL [API]", // kullanıcı "Hayır" (gözlem)
  T6: "FAIL [API]", // kullanıcı Ctrl+Z'ye basmadı, "Hayır" dedi → geri gelmedi (gözlem + otomatik karşılaştırma)
  T7: "FAIL [API]", // ripple=false yine kaydırdı (ölçüldü) → engel
  T8: "FAIL [API]", // overwrite yalnız video üretti (ölçüldü)
};

async function linkedScenario() {
  const report = await runAll(happyAnswer);
  console.log(report);
  const got = summary(report);
  if (got.T2 !== "PASS") fail(`linked: T2 yedek yolu bağlı partnerle çalışmalıydı, gelen ${got.T2}`);
  if (report.includes("Öneri: CEP")) fail("linked: bağlı seçim yanlış CEP önerisine yol açtı");
  if (!/YEDEK YÖNTEM/.test(report) || !/eklenenlerden kalan: 0/.test(report)) fail("linked: T2 yedek yolu çalışıp eklenenleri temizlemedi");
  if (/silme İPTAL/.test(report)) fail("linked: bağlı seçim T2 yedek silmesini iptal ettirdi");
  console.log("\nSMOKE (linked) OK — Linked Selection varken T2 yedek yolu eklenenleri tek seçimle sildi, CEP yok");
  process.exit(0);
}

async function filterScenario() {
  const report = await runAll(happyAnswer);
  console.log(report);
  expectSummary(report, { T1: "PASS", T2: "PASS", T3: "FAIL [KOD]", T4: "PASS", T5: "PASS", T6: "PASS", T7: "PASS", T8: "PASS" });
  if (report.includes("Öneri: CEP")) fail("filter: mediaType kullanım hatası CEP önerisine yol açtı");
  for (const needle of ["mediaType FİLTRE gibi davranıyor", "Öneri: GEÇİCİ", "Kod/kullanım hataları"])
    if (!report.includes(needle)) fail(`filter: raporda yok: ${needle}`);
  console.log("\nSMOKE (filter) OK — mediaType filtre ise T3 [KOD], T7 ölçtü, CEP yok");
  process.exit(0);
}

async function throwScenario() {
  const report = await runAll(happyAnswer);
  console.log(report);
  expectSummary(report, {
    T1: "PASS",
    T2: "PASS",
    T3: "FAIL [BELİRSİZ]",
    T4: "FAIL [BELİRSİZ]",
    T5: "PASS",
    T6: "BELİRSİZ",
    T7: "PASS",
    T8: "FAIL [BELİRSİZ]",
  });
  // İstisna tek başına "API yok" değildir → CEP önerilmemeli, karar GEÇİCİ olmalı
  if (report.includes("Öneri: CEP")) fail("sınıflanamayan istisnalar CEP önerisine yol açtı");
  for (const needle of ["Öneri: GEÇİCİ: UXP + workaround", "Sınıflanamayan hatalar:", "clone HATA verdi", "YEDEK YÖNTEM"])
    if (!report.includes(needle)) fail(`raporda yok: ${needle}`);
  console.log("\nSMOKE (throw) OK");
  process.exit(0);
}

(async () => {
  // 0) mock öz-sınaması: transaction sonrası eski referans hata vermeli (gerçek 26.5.1 davranışı)
  setupProbe();
  {
    const it = (await wrapSequence("guid-probe").getVideoTrack(0)).getTrackItems(1, false)[0];
    await it.getName();
    projectW.executeTransaction(() => {}, "öz-sınama");
    let threw = false;
    try {
      await it.getName();
    } catch (e) {
      threw = String(e.message).includes(STALE);
    }
    if (!threw) fail("mock öz-sınaması: bayat referans hata vermedi");
  }
  setupProbe();
  require(path.join(__dirname, "..", "dist", "index.js"));
  await sleep(100);
  if (G || TH) {
    await sleep(1700);
    return G ? grimScenario() : throwScenario();
  }
  if (LK || FI) {
    await sleep(1700);
    return LK ? linkedScenario() : filterScenario();
  }
  if (ST) {
    await sleep(1700);
    const report = await runAll(happyAnswer);
    expectSummary(report, { T1: "PASS", T2: "PASS", T3: "PASS", T4: "PASS", T5: "PASS", T6: "PASS", T7: "PASS", T8: "PASS" });
    if (/no longer valid|BAYAT REFERANS/.test(report)) fail("bayat referans kullanıldı (strict)");
    console.log(report.split("KARAR ÖNERİSİ")[1]);
    console.log("\nSMOKE (strict) OK — seçim çağrıları referansları geçersiz kılsa bile hiçbir referans aşılmadı");
    process.exit(0);
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

  // 2) Hepsini çalıştır (bayat referans kullanılsaydı mock "no longer valid" verirdi)
  state.activeGuid = "guid-probe";
  await sleep(1700);
  if (els["btn-all"].hasAttribute("disabled")) fail("PROBE_test aktifken butonlar kilitli");
  const report = await runAll(happyAnswer);
  console.log(report);
  expectSummary(report, { T1: "PASS", T2: "PASS", T3: "PASS", T4: "PASS", T5: "PASS", T6: "PASS", T7: "PASS", T8: "PASS" });
  if (!/Öneri: UXP yeterli\./.test(report)) fail("karar önerisi beklenen gibi değil");
  if (!/Premiere: 26\.5\.1/.test(report)) fail("Premiere sürümü host'tan okunmadı");
  if (/no longer valid|BAYAT REFERANS/.test(report)) fail("bayat referans kullanıldı");
  if (/Order of operations|createEmptySelection KULLANMAMALI/.test(report)) fail("createEmptySelection kullanıldı");
  mainUntouched();
  console.log("✓ Hepsini çalıştır: T1–T8 PASS, hiçbir TrackItem referansı transaction sınırını aşmadı, Premiere 26.5.1 raporda");

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

  // 5) Premiere yedeği (kopya) aktif yaparsa T1 aslına döner, testler ASIL üzerinde sürer, yedeğe dokunulmaz
  setupProbe();
  await sleep(1700);
  let cloneGuid = null;
  hooks.onCloneSeq = (g) => {
    cloneGuid = g;
    state.activeGuid = g;
    hooks.onCloneSeq = null;
  };
  let cloneSnap = null;
  const r5 = await runAll(async (q) => {
    if (!cloneSnap && cloneGuid) cloneSnap = deepCopyOne(seqByGuid(cloneGuid));
    await happyAnswer(q);
  });
  if (!/yeni kopya aktif oldu/.test(r5) || !/tekrar aktif yapıldı \(setActiveSequence\): true/.test(r5)) fail("T1 kopyadan aslına dönmedi");
  if (/sequence: "PROBE_test Copy"/.test(r5)) fail("testler yedek sequence üzerinde koştu");
  if (!cloneSnap || deepCopyOne(seqByGuid(cloneGuid)) !== cloneSnap) fail("yedek sequence değişti");
  if (!/Öneri: UXP yeterli\./.test(r5)) fail("5. aşamada karar beklenen gibi değil");
  console.log("✓ T1: kopya aktif olunca aslına döndü; testler aslında koştu, yedeğe dokunulmadı");

  // 6) Kullanıcı T1 sırasında başka sequence'a (Main Edit) geçerse: geri çekilmez, koşu durur, eski sonuçlar temizlenir
  setupProbe();
  await sleep(1700);
  hooks.onCloneSeq = () => {
    state.activeGuid = "guid-main";
    hooks.onCloneSeq = null;
  };
  const main6 = deepCopyOne(seqByGuid("guid-main"));
  const r6 = await runAll(happyAnswer);
  if (state.activeGuid !== "guid-main") fail("kullanıcı Main Edit'e geçtiği hâlde panel geri çekti");
  if (deepCopyOne(seqByGuid("guid-main")) !== main6) fail("Main Edit değişti");
  if (!/^  T2 .*ÇALIŞMADI$/m.test(r6)) fail("eski koşunun T2 sonucu raporda kaldı / koşu durmadı");
  if (!/T1 sırasında kullanıcı başka bir sequence'a geçti/.test(r6)) fail("T1 kilit nedeni raporda yok");
  console.log("✓ kilit: T1 sırasında kullanıcı çıkınca geri çekilmedi, koşu durdu, eski sonuçlar silindi");

  // 7) Koşu ortasında başka bir PROBE_* sequence aktif olursa (sabitleme) → durur, ona dokunulmaz
  setupProbe(true);
  await sleep(1700);
  // T1 bittikten sonra (T1'in son getActive'i = 1. çağrı), T2'nin requireProbe'undan önce (2. çağrı) geç
  hooks.onCloneSeq = () => {
    hooks.onCloneSeq = null;
    let n = 0;
    hooks.onGetActive = () => {
      if (++n === 2) {
        state.activeGuid = "guid-probe-other";
        hooks.onGetActive = null;
      }
    };
  };
  const other7 = deepCopyOne(seqByGuid("guid-probe-other"));
  await runAll(happyAnswer);
  if (deepCopyOne(seqByGuid("guid-probe-other")) !== other7) fail("PROBE_other değişti");
  if (!/başladığı sequence değil/.test(newLog())) fail("sabitleme (pin) kilidi devreye girmedi");
  if (!/^  T1 .*PASS$/m.test(els.report.value)) fail("7. aşamada T1 PASS değil");
  console.log("✓ kilit: koşu ortasında başka PROBE_* sequence'a geçilince durdu, ona dokunulmadı");

  console.log("\nSMOKE OK");
  process.exit(0);
})().catch((e) => fail(e && e.stack ? e.stack : e));
