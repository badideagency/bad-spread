// Spread Helper — ExtendScript tarafı (Premiere Pro). ES3: JSON / Array.indexOf / forEach YOK (bu dosya `npm run check:jsx` ile
// ES3 olarak ayrıştırılır). Yalnız iki fonksiyon dışarıya açık: spreadHelper_ping(), spreadHelper_link(req).
// Her Premiere DOM çağrısının yanında "docs:" yorumu = Premiere Pro Scripting Guide (https://ppro-scripting.docsforadobe.dev/,
// kaynağı github.com/docsforadobe/premiere-scripting-guide) sayfası; kılavuzda OLMAYAN tek üye getLinkedItems() için Adobe'nin
// PProPanel örneğindeki tip tanımı. `npm run check:jsx` her DOM üyesinin yanında bu yorumun olduğunu denetler.
// Belgeler ile Adobe örnekleri arasındaki iki çelişki bilinçli olarak ikisini de kabul edecek biçimde ele alındı:
//   - Collection "[]": belge "ilk nesne index 1", PProPanel örneği clips[0]'dan başlar → 0..n taranır, nodeId ile tekilleştirilir.
//   - getLinkedItems(): PProPanel örneği sonucu "aynı kaynaktan klipler" diye adlandırıyor → bağlamadan ÖNCE ve SONRA okunur;
//     bağlama sonucu değiştirmediyse doğrulama "bilinmiyor" (null) sayılır, "bağlandı" diye uydurulmaz.
//
// Klip bulma: (track tipi, track index, start ticks, end ticks, kaynak adı) — UXP panelinin okuduğu değerlerle aynı anahtar.
// Bağlama: seçimi temizle → grubun kliplerini setSelected(true, true) → seçimi say → Sequence.linkSelection() → seçimi temizle →
// her klibin getLinkedItems() sonucu gruptaki diğer bütün klipleri içeriyor mu (doğrulama).

var SPREAD_HELPER_JSX = "0.3.0";

function spreadHelper_q(s) {
  var out = "\"";
  var str = String(s);
  for (var i = 0; i < str.length; i++) {
    var ch = str.charAt(i);
    var c = str.charCodeAt(i);
    if (ch === "\"" || ch === "\\") out += "\\" + ch;
    else if (c < 32 || c > 126) out += "\\u" + ("0000" + c.toString(16)).slice(-4);
    else out += ch;
  }
  return out + "\"";
}

// Küçük JSON üreticisi (ExtendScript'te JSON nesnesi yok): null, boolean, number, string, dizi, düz nesne.
function spreadHelper_json(v) {
  var i;
  var parts;
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return isFinite(v) ? String(v) : "null";
  if (typeof v === "string") return spreadHelper_q(v);
  if (v instanceof Array) {
    parts = [];
    for (i = 0; i < v.length; i++) parts.push(spreadHelper_json(v[i]));
    return "[" + parts.join(",") + "]";
  }
  parts = [];
  for (var k in v) {
    if (v.hasOwnProperty(k)) parts.push(spreadHelper_q(k) + ":" + spreadHelper_json(v[k]));
  }
  return "{" + parts.join(",") + "}";
}

function spreadHelper_err(e) {
  return spreadHelper_json({ ok: false, error: String(e) });
}

function spreadHelper_activeSequence() {
  // docs: https://ppro-scripting.docsforadobe.dev/application/application/#appproject
  return app.project.activeSequence; // docs: https://ppro-scripting.docsforadobe.dev/general/project/#projectactivesequence
}

function spreadHelper_ping() {
  try {
    var seq = spreadHelper_activeSequence();
    return spreadHelper_json({
      ok: true,
      jsx: SPREAD_HELPER_JSX,
      premiere: String(app.version), // docs: https://ppro-scripting.docsforadobe.dev/application/application/#appversion
      sequence: seq ? String(seq.name) : null // docs: https://ppro-scripting.docsforadobe.dev/sequence/sequence/#sequencename
    });
  } catch (e) {
    return spreadHelper_err(e);
  }
}

function spreadHelper_tracks(seq, kind) {
  if (kind === "V") return seq.videoTracks; // docs: https://ppro-scripting.docsforadobe.dev/sequence/sequence/#sequencevideotracks
  return seq.audioTracks; // docs: https://ppro-scripting.docsforadobe.dev/sequence/sequence/#sequenceaudiotracks
}

function spreadHelper_label(it) {
  return it.kind + (it.track + 1) + " \"" + it.name + "\" [" + it.start + "\u2013" + it.end + "]";
}

/** Collection'ı 0..n aralığında tarar (0 ya da 1 tabanlı olabilir), boşları atlar, nodeId ile tekilleştirir. */
function spreadHelper_items(coll, count) {
  var out = [];
  var seen = {};
  if (!coll) return out;
  for (var i = 0; i <= count; i++) {
    var x = coll[i];
    if (!x) continue;
    var id = String(x.nodeId); // docs: https://ppro-scripting.docsforadobe.dev/item/trackitem/#trackitemnodeid
    if (seen[id]) continue;
    seen[id] = true;
    out.push(x);
  }
  return out;
}

/** Bir track'in kliplerini (anahtar değerleriyle) BİR KEZ okur; aynı istekte önbellekten. */
function spreadHelper_index(seq, kind, track, cache) {
  var key = kind + track;
  if (cache[key]) return cache[key];
  var rows = [];
  var tracks = spreadHelper_tracks(seq, kind);
  if (track < tracks.numTracks && tracks[track]) { // docs: https://ppro-scripting.docsforadobe.dev/collection/trackcollection/#trackcollectionnumtracks
    var clipsColl = tracks[track].clips; // docs: https://ppro-scripting.docsforadobe.dev/sequence/track/#trackclips
    var clips = spreadHelper_items(clipsColl, clipsColl.numItems); // docs: https://ppro-scripting.docsforadobe.dev/collection/trackitemcollection/#trackitemcollectionnumitems
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i];
      var pi = c.projectItem; // docs: https://ppro-scripting.docsforadobe.dev/item/trackitem/#trackitemprojectitem
      rows.push({
        item: c,
        st: String(c.start.ticks), // docs: https://ppro-scripting.docsforadobe.dev/item/trackitem/#trackitemstart , https://ppro-scripting.docsforadobe.dev/other/time/#timeticks
        en: String(c.end.ticks), // docs: https://ppro-scripting.docsforadobe.dev/item/trackitem/#trackitemend
        nm: pi ? String(pi.name) : null // docs: https://ppro-scripting.docsforadobe.dev/item/projectitem/#projectitemname
      });
    }
  }
  cache[key] = rows;
  return rows;
}

/** Tek eşleşme → { item, count: 1 }; yok ya da birden çok → { item: null, count }. PProPanel örneği: videoTracks[0] = V1. */
function spreadHelper_find(seq, it, cache) {
  var rows = spreadHelper_index(seq, it.kind, it.track, cache);
  var hit = null;
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].st === it.start && rows[i].en === it.end && rows[i].nm === it.name) {
      hit = rows[i].item;
      n++;
    }
  }
  return { item: n === 1 ? hit : null, count: n };
}

function spreadHelper_selection(seq) {
  var sel = seq.getSelection(); // docs: https://ppro-scripting.docsforadobe.dev/sequence/sequence/#sequencegetselection
  return spreadHelper_items(sel, sel ? sel.length : 0); // docs: https://ppro-scripting.docsforadobe.dev/collection/collection/ (length)
}

function spreadHelper_clearSelection(seq) {
  var sel = spreadHelper_selection(seq);
  for (var i = 0; i < sel.length; i++) sel[i].setSelected(false, true); // docs: https://ppro-scripting.docsforadobe.dev/item/trackitem/#trackitemsetselected
}

/** nodeId → true kümesi; null = getLinkedItems yok. */
function spreadHelper_linkedIds(item) {
  if (typeof item.getLinkedItems !== "function") return null; // docs: https://github.com/Adobe-CEP/Samples/blob/master/PProPanel/jsx/PremierePro.23.0.d.ts#L1253
  var li = item.getLinkedItems(); // docs: https://github.com/Adobe-CEP/Samples/blob/master/PProPanel/jsx/PremierePro.23.0.d.ts#L1253
  var set = {};
  if (!li) return set;
  var arr = spreadHelper_items(li, li.numItems); // docs: https://ppro-scripting.docsforadobe.dev/collection/trackitemcollection/#trackitemcollectionnumitems
  for (var i = 0; i < arr.length; i++) set[String(arr[i].nodeId)] = true; // docs: https://ppro-scripting.docsforadobe.dev/item/trackitem/#trackitemnodeid
  return set;
}

function spreadHelper_sameSet(a, b) {
  var k;
  for (k in a) if (a.hasOwnProperty(k) && !b[k]) return false;
  for (k in b) if (b.hasOwnProperty(k) && !a[k]) return false;
  return true;
}

/**
 * Bağ doğrulaması. before/after: bağlamadan önce/sonra her öğenin getLinkedItems kümesi.
 * true  = her öğe gruptaki diğer bütün öğelere bağlı ve grup dışına bağı yok
 * null  = API yok ya da sonuç bağlamayla hiç değişmedi (API bağ yerine başka bir şey döndürüyor olabilir) → doğrulanamadı
 * false = bağlama sonucu değiştirdi ama beklenen bağ yok
 */
function spreadHelper_verify(items, before, after) {
  var ids = [];
  var i;
  var j;
  for (i = 0; i < items.length; i++) ids.push(String(items[i].nodeId)); // docs: https://ppro-scripting.docsforadobe.dev/item/trackitem/#trackitemnodeid
  var changed = false;
  for (i = 0; i < items.length; i++) {
    if (before[i] === null || after[i] === null) return { verified: null, detail: "getLinkedItems yok \u2014 ba\u011f do\u011frulanamad\u0131" };
    if (!spreadHelper_sameSet(before[i], after[i])) changed = true;
  }
  var problem = "";
  for (i = 0; i < items.length && !problem; i++) {
    for (j = 0; j < ids.length; j++) {
      if (j !== i && !after[i][ids[j]]) {
        problem = "\u00f6\u011fe " + (i + 1) + ", \u00f6\u011fe " + (j + 1) + "'e ba\u011fl\u0131 g\u00f6r\u00fcnm\u00fcyor";
        break;
      }
    }
    for (var k in after[i]) {
      if (after[i].hasOwnProperty(k) && !problem) {
        var inGroup = false;
        for (j = 0; j < ids.length; j++) if (ids[j] === k) inGroup = true;
        if (!inGroup) problem = "\u00f6\u011fe " + (i + 1) + " grup d\u0131\u015f\u0131 bir \u00f6\u011feye de ba\u011fl\u0131";
      }
    }
  }
  if (!problem) return { verified: true, detail: "" };
  if (!changed) return { verified: null, detail: "getLinkedItems ba\u011flamayla de\u011fi\u015fmedi (ba\u011f yerine ayn\u0131 kaynakl\u0131 klipleri d\u00f6nd\u00fcr\u00fcyor olabilir) \u2014 ba\u011f do\u011frulanamad\u0131" };
  return { verified: false, detail: problem };
}

/**
 * req = { sequence: "ad", groups: [ { id, items: [ { kind: "V"|"A", track, start, end, name } ] } ] }
 * (Node tarafında doğrulanmış, sabit değer olarak gömülür.)
 */
function spreadHelper_link(req) {
  try {
    var seq = spreadHelper_activeSequence();
    if (!seq) return spreadHelper_err("aktif sequence yok");
    var seqName = String(seq.name); // docs: https://ppro-scripting.docsforadobe.dev/sequence/sequence/#sequencename
    if (seqName !== req.sequence) return spreadHelper_err("aktif sequence \"" + seqName + "\", beklenen \"" + req.sequence + "\" \u2014 hi\u00e7bir \u015fey yap\u0131lmad\u0131");
    var results = [];
    var cache = {};
    for (var g = 0; g < req.groups.length; g++) {
      var grp = req.groups[g];
      var found = [];
      var missing = [];
      var i;
      for (i = 0; i < grp.items.length; i++) {
        var f = spreadHelper_find(seq, grp.items[i], cache);
        if (f.item) found.push(f.item);
        else missing.push(spreadHelper_label(grp.items[i]) + (f.count > 1 ? " (" + f.count + " aday)" : " (yok)"));
      }
      var r = { id: grp.id, total: grp.items.length, found: found.length, missing: missing, linked: false, verified: null, detail: "" };
      if (missing.length) {
        r.detail = "eksik \u00f6\u011fe var \u2014 ba\u011flanmad\u0131";
        results.push(r);
        continue;
      }
      try {
        var before = [];
        for (i = 0; i < found.length; i++) before.push(spreadHelper_linkedIds(found[i]));
        spreadHelper_clearSelection(seq);
        for (i = 0; i < found.length; i++) found[i].setSelected(true, true); // docs: https://ppro-scripting.docsforadobe.dev/item/trackitem/#trackitemsetselected
        var n = spreadHelper_selection(seq).length;
        if (n !== found.length) {
          r.detail = "se\u00e7im " + n + "/" + found.length + " \u2014 ba\u011flanmad\u0131";
          spreadHelper_clearSelection(seq);
          results.push(r);
          continue;
        }
        var ok = seq.linkSelection(); // docs: https://ppro-scripting.docsforadobe.dev/sequence/sequence/#sequencelinkselection
        spreadHelper_clearSelection(seq);
        r.linked = ok !== false;
        if (!r.linked) r.detail = "linkSelection false d\u00f6nd\u00fc";
        else {
          // taze bul (önbellek sıfırlanır) ve doğrula
          cache = {};
          var again = [];
          for (i = 0; i < grp.items.length; i++) {
            var f2 = spreadHelper_find(seq, grp.items[i], cache);
            if (f2.item) again.push(f2.item);
          }
          if (again.length !== grp.items.length) {
            r.verified = false;
            r.detail = "ba\u011flamadan sonra \u00f6\u011feler yeniden bulunamad\u0131";
          } else {
            var after = [];
            for (i = 0; i < again.length; i++) after.push(spreadHelper_linkedIds(again[i]));
            var v = spreadHelper_verify(again, before, after);
            r.verified = v.verified;
            r.detail = v.detail;
          }
        }
      } catch (e2) {
        r.detail = "hata: " + String(e2);
        try {
          spreadHelper_clearSelection(seq);
        } catch (e3) {
          r.detail += " (se\u00e7im temizlenemedi)";
        }
      }
      results.push(r);
    }
    return spreadHelper_json({ ok: true, sequence: seqName, results: results, detail: "" });
  } catch (e) {
    return spreadHelper_err(e);
  }
}
