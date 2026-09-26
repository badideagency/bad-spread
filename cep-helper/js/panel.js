/*
 * Spread Helper paneli — yalnız ARAYÜZ. Sunucu, plan okuma ve BAĞLA mantığı js/helper.js'te (Node testleri aynı kodu çalıştırır).
 * Dosyadan / planından gelen metinler yalnız textContent ile yazılır (HTML olarak yorumlanmaz).
 */
(function () {
  "use strict";
  var $ = function (id) {
    return document.getElementById(id);
  };
  var app = window.SpreadHelperApp;
  var set = function (id, text, cls) {
    var el = $(id);
    if (!el) return;
    el.textContent = text;
    if (cls !== undefined) el.className = cls;
  };
  var hhmmss = function (iso) {
    return iso ? String(iso).slice(11, 19) : "—";
  };

  function renderStatus() {
    if (!app) return set("srv", "✗ yardımcı çekirdeği (js/helper.js) yüklenmedi", "row bad");
    if (!app.helper) return set("srv", "✗ " + (app.error || "sunucu kurulamadı"), "row bad");
    var st = app.helper.state();
    if (st.listening) set("srv", "● dinliyor: localhost:" + st.port + " (" + st.addresses.join(", ") + (st.v6 && st.v6 !== "dinliyor" ? "; ::1 " + st.v6 : "") + ")", "row ok");
    else if (st.error) set("srv", "✗ SUNUCU BAŞLAMADI: " + st.error, "row bad");
    else set("srv", "… başlatılıyor", "row warn");
    set("env", "Premiere " + (st.premiere || "?") + " · yardımcı " + st.version + " · Node " + st.node + " · ortak modül " + (st.core || "YOK"));
    set("info", st.infoFile);
    var r = st.lastRequest;
    set(
      "req",
      r
        ? hhmmss(r.at) + " " + r.method + " " + r.url + " → " + r.status + " (" + r.ms + " ms) · toplam " + st.requests
        : "henüz istek gelmedi — Spread paneli \"bağlı değil\" diyorsa isteği buraya hiç ulaşmıyor demektir"
    );
  }

  function renderPlan() {
    if (!app || !app.helper) return;
    try {
      var p = app.helper.readPlan($("paste") ? $("paste").value : "");
      set("plan", "\"" + p.sequence + "\" · " + p.groups.length + " grup · " + p.createdAt + " · " + p.from, "dim");
    } catch (e) {
      set("plan", (e && e.message) || String(e), "warn");
    }
  }

  function renderLog() {
    var el = $("log");
    if (!el || !app) return;
    el.textContent = app.lines.slice(-60).join("\n");
    el.scrollTop = el.scrollHeight;
  }

  function renderResult(out) {
    set("summary", out.summary, out.ok ? (/⚠/.test(out.summary) ? "row warn" : "row ok") : "row bad");
    var box = $("results");
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    var add = function (text, cls) {
      var d = document.createElement("div");
      d.textContent = text;
      d.className = cls;
      box.appendChild(d);
    };
    out.lines.forEach(function (l) {
      add("• " + l, "bad");
    });
    out.rows.forEach(function (x) {
      add((x.status === "tamam" ? "✓ " : x.status === "doğrulanamadı" ? "⚠ " : "✗ ") + x.label + (x.detail ? " — " + x.detail : ""), x.status === "tamam" ? "ok" : x.status === "doğrulanamadı" ? "warn" : "bad");
    });
    out.ignored.forEach(function (l) {
      add("· " + l, "dim");
    });
  }

  function onBind() {
    if (!app || !app.helper) return;
    var btn = $("btn-bind");
    btn.disabled = true;
    set("summary", "… bağlanıyor", "row warn");
    app.helper
      .bindFromPlan({ text: $("paste") ? $("paste").value : "" })
      .then(renderResult, function (e) {
        renderResult({ ok: false, summary: "✗ " + ((e && e.message) || e), rows: [], ignored: [], lines: [] });
      })
      .then(function () {
        btn.disabled = false;
      });
  }

  if (app) {
    app.onLog = renderLog;
    if (app.helper) app.helper.subscribe(renderStatus);
  }
  $("btn-bind").addEventListener("click", onBind);
  $("btn-plan").addEventListener("click", renderPlan);
  if ($("paste")) $("paste").addEventListener("change", renderPlan);
  renderStatus();
  renderPlan();
  renderLog();
})();
