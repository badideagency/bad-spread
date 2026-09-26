/*
 * Spread Helper paneli v1.0.0 — yalnız ARAYÜZ. Sunucu, plan okuma ve BAĞLA mantığı js/helper.js'te (Node testleri aynı kodu çalıştırır).
 * Görünen: tek durum satırı. Köprüsüz BAĞLA bölümü YALNIZ Spread "yardımcı panelinden bağla" dediğinde (plan.handoff === "panel",
 * henüz bağlanmamış). Gerisi "Ayrıntı ▸" altında. Dosyadan / planından gelen metinler yalnız textContent ile yazılır.
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
  var shownFor = null; // bu panelde BAĞLA'ya basılan planın createdAt'i (sonuç görünür kalsın)
  var busy = false;

  function renderStatus() {
    if (!app) {
      set("dot", "", "dot bad");
      return set("srv", "Spread Helper çalışmıyor: çekirdek (js/helper.js) yüklenmedi — yeniden kur", "bad");
    }
    if (app.helper) set("ver", app.helper.state().version);
    if (!app.helper) {
      set("dot", "", "dot bad");
      return set("srv", "Spread Helper çalışmıyor: " + (app.error || "sunucu kurulamadı"), "bad");
    }
    var st = app.helper.state();
    if (st.listening) {
      set("dot", "", "dot ok");
      set("srv", "Spread Helper çalışıyor", "");
    } else if (st.error) {
      set("dot", "", "dot bad");
      set("srv", "Spread Helper çalışmıyor: " + st.error, "bad");
    } else {
      set("dot", "", "dot warn");
      set("srv", "Spread Helper başlatılıyor…", "");
    }
    set("listen", st.listening ? "dinliyor: localhost:" + st.port + " (" + st.addresses.join(", ") + (st.v6 && st.v6 !== "dinliyor" ? "; ::1 " + st.v6 : "") + ")" : "sunucu kapalı");
    set("env", "Premiere " + (st.premiere || "?") + " · yardımcı " + st.version + " · Node " + st.node + " · ortak modül " + (st.core || "YOK"));
    set("info", st.infoFile);
    var r = st.lastRequest;
    set(
      "req",
      r
        ? hhmmss(r.at) + " " + r.method + " " + r.url + " → " + r.status + " (" + r.ms + " ms) · toplam " + st.requests
        : "henüz istek gelmedi — Spread paneli \"yardımcı kapalı\" diyorsa isteği buraya hiç ulaşmıyor demektir"
    );
  }

  /** Köprüsüz BAĞLA bölümü: yalnız plan panel yolunu beklerken (ya da bu panelde az önce bağlandıysa sonucu için). */
  function renderBindBox() {
    if (!app || !app.helper || typeof app.helper.planStatus !== "function") return;
    var p = app.helper.planStatus();
    var box = $("bindbox");
    var visible = p.waiting || (shownFor !== null && p.createdAt === shownFor);
    if (box) box.style.display = visible ? "block" : "none";
    if (p.waiting) {
      set("bind-msg", "Spread bağlamayı bekliyor: \"" + p.sequence + "\" · " + p.groups + " grup. Premiere'de o sequence açıkken BAĞLA'ya bas.", "");
      $("btn-bind").style.display = "";
    } else if (visible) {
      set("bind-msg", "\"" + p.sequence + "\" planı bu panelde bağlandı.", "ok");
      $("btn-bind").style.display = "none";
    }
  }

  function renderPlan() {
    if (!app || !app.helper) return;
    try {
      var p = app.helper.readPlan($("paste") ? $("paste").value : "");
      set("plan", "\"" + p.sequence + "\" · " + p.groups.length + " grup · " + p.createdAt + " · " + p.from, "dim");
    } catch (e) {
      set("plan", (e && e.message) || String(e), "warn");
    }
    renderBindBox();
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
      if (x.status === "tamam") return; // başarılı gruplar tek tek listelenmez (özet yeter; ayrıntı günlükte)
      add((x.status === "doğrulanamadı" ? "⚠ " : "✗ ") + x.label + (x.detail ? " — " + x.detail : ""), x.status === "doğrulanamadı" ? "warn" : "bad");
    });
  }

  function onBind() {
    if (!app || !app.helper || busy) return;
    busy = true;
    var p = typeof app.helper.planStatus === "function" ? app.helper.planStatus() : null;
    shownFor = p && p.createdAt ? p.createdAt : null;
    var b1 = $("btn-bind");
    var b2 = $("btn-bind2");
    b1.disabled = b2.disabled = true;
    $("bindbox").style.display = "block";
    set("summary", "… bağlanıyor", "row warn");
    app.helper
      .bindFromPlan({ text: $("paste") ? $("paste").value : "" })
      .then(renderResult, function (e) {
        renderResult({ ok: false, summary: "✗ " + ((e && e.message) || e), rows: [], ignored: [], lines: [] });
      })
      .then(function () {
        b1.disabled = b2.disabled = false;
        busy = false;
        renderBindBox();
      });
  }

  function toggleMore() {
    var m = $("more");
    var open = m.style.display !== "block";
    m.style.display = open ? "block" : "none";
    set("more-toggle", open ? "Ayrıntı ▾" : "Ayrıntı ▸");
    if (open) renderPlan();
  }

  if (app) {
    app.onLog = renderLog;
    if (app.helper) app.helper.subscribe(renderStatus);
  }
  $("btn-bind").addEventListener("click", onBind);
  $("btn-bind2").addEventListener("click", onBind);
  $("btn-plan").addEventListener("click", renderPlan);
  $("more-toggle").addEventListener("click", toggleMore);
  if ($("paste")) $("paste").addEventListener("change", renderPlan);
  renderStatus();
  renderBindBox();
  renderLog();
  // Spread planı yazınca bölüm kendiliğinden görünsün (dosya okuma; sunucuya dokunmaz)
  setInterval(function () {
    if (!busy) renderBindBox();
  }, 2000);
})();
