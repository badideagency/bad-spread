/*
 * Spread Helper paneli v1.2.0 — yalnız ARAYÜZ. Sunucu, plan okuma, BAĞLA ve güncelleme mantığı js/helper.js / js/updater.js'te (Node
 * testleri aynı kodu çalıştırır). Görünen: tek satır "Spread Helper çalışıyor ↻ ●" (hata varsa kırmızı tek satır). Köprüsüz BAĞLA
 * yalnız Spread "yardımcı panelinden bağla" dediğinde (plan.handoff === "panel", henüz bağlanmamış) tek düğme olarak çıkar. Gerisi
 * gizli: durum satırına tıklayınca. v1.2.0: Spread paneliyle aynı sabit koyu dil (index.html) — Premiere'in CEP temasına uyma
 * (v1.1.0) kaldırıldı; ↻ bu paneli yeniden yükler (sunucu önce kapanır, port boşalır).
 * Dosyadan / planından gelen metinler yalnız textContent ile yazılır.
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
  // bu panelde son BAĞLA: hangi plan (createdAt; yapıştırılan plan → "yapıştır"), o an dosyadaki plan (seen) ve sonucu. Sonuç, plan
  // dosyası değişene (Spread yeni bir plan yazana) kadar görünür; sonra yeni plan gösterilir.
  var last = null; // { at: string, seen: string, ok: boolean|null }
  var busy = false;
  // durum satırında sunucu durumu yerine gösterilecek bağlama durumu ("Bağla bekliyor…" / son sonuç); null → sunucu durumu
  var bindLine = null; // { text, cls }

  // ------------------------------------------------------------------ durum satırı
  function renderStatus() {
    if (!app) {
      set("dot", "", "dot bad");
      return set("srv", "Spread Helper çalışmıyor: çekirdek yüklenmedi — yeniden kur", "bad");
    }
    if (!app.helper) {
      set("dot", "", "dot bad");
      return set("srv", "Spread Helper çalışmıyor: " + (app.error || "sunucu kurulamadı"), "bad");
    }
    var st = app.helper.state();
    if (st.listening) {
      set("dot", "", "dot ok");
      if (bindLine) set("srv", bindLine.text, bindLine.cls);
      else set("srv", "Spread Helper çalışıyor", "");
    } else if (st.error) {
      set("dot", "", "dot bad");
      set("srv", "Spread Helper çalışmıyor: " + st.error, "bad");
    } else {
      set("dot", "", "dot warn");
      set("srv", "Spread Helper başlatılıyor…", "");
    }
    set("ver", "Spread Helper " + st.version);
    set("listen", st.listening ? "dinliyor: localhost:" + st.port + " (" + st.addresses.join(", ") + (st.v6 && st.v6 !== "dinliyor" ? "; ::1 " + st.v6 : "") + ")" : "sunucu kapalı");
    set("env", "Premiere " + (st.premiere || "?") + " · Node " + st.node + " · ortak modül " + (st.core || "YOK"));
    set("persist", st.persistent === true ? "istendi (Premiere hata vermedi)" : st.persistent === false ? "istenemedi (panel görünmezken Premiere onu kapatabilir)" : "?");
    set("info", st.infoFile);
    var r = st.lastRequest;
    set("req", r ? hhmmss(r.at) + " " + r.method + " " + r.url + " → " + r.status + " (" + r.ms + " ms) · toplam " + st.requests : "henüz istek gelmedi");
  }

  // ------------------------------------------------------------------ köprüsüz BAĞLA (yalnız gerektiğinde)
  function clearResult() {
    set("summary", "", "row");
    var rs = $("results");
    while (rs && rs.firstChild) rs.removeChild(rs.firstChild);
  }

  function renderBindBox() {
    if (!app || !app.helper || typeof app.helper.planStatus !== "function") return;
    var p = app.helper.planStatus();
    var box = $("bindbox");
    if (last !== null && last.ok !== null && String(p.createdAt || "") !== last.seen) {
      last = null; // yeni plan geldi → eski sonuç onun değil
      clearResult();
    }
    var mine = last !== null && last.ok !== null;
    if (box) box.style.display = mine ? "block" : "none";
    if (mine && last.ok === true) {
      bindLine = { text: last.summary || "✓ Bu panelde bağlandı", cls: "" };
      $("btn-bind").style.display = "none";
    } else if (mine && last.ok === false) {
      bindLine = { text: "✗ Bağlama tamamlanmadı — ayrıntı için tıkla", cls: "bad" };
      $("btn-bind").style.display = "inline-block";
    } else if (p.waiting) {
      // sayı önce: dar panelde uzun sequence adı kesilsin, grup sayısı değil (tam metin ipucunda)
      bindLine = { text: p.groups + " grup bekliyor · “" + p.sequence + "”", cls: "" };
      $("btn-bind").style.display = "inline-block";
    } else {
      bindLine = null;
      $("btn-bind").style.display = "none";
    }
    renderStatus();
  }

  function renderPlan() {
    if (!app || !app.helper) return;
    try {
      var p = app.helper.readPlan($("paste") ? $("paste").value : "");
      set("plan", "\"" + p.sequence + "\" · " + p.groups.length + " grup · " + p.createdAt + " · " + p.from);
    } catch (e) {
      set("plan", (e && e.message) || String(e));
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
    set("summary", out.summary, out.ok ? "row" : "row bad");
    var box = $("results");
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    var add = function (text, cls) {
      var d = document.createElement("div");
      d.textContent = text;
      d.className = cls;
      box.appendChild(d);
    };
    (out.lines || []).forEach(function (l) {
      add("• " + l, "bad");
    });
    (out.notes || []).forEach(function (l) {
      add("• " + l, "");
    });
    (out.rows || []).forEach(function (x) {
      if (x.status === "tamam") return; // başarılı gruplar tek tek listelenmez (özet yeter; ayrıntı günlükte)
      add((x.status === "hata" ? "✗ " : "⚠ ") + x.label + (x.detail ? " — " + x.detail : ""), x.status === "hata" ? "bad" : "");
    });
  }

  function onBind() {
    if (!app || !app.helper || busy) return;
    busy = true;
    var pasted = $("paste") && $("paste").value.trim() !== "";
    var p = typeof app.helper.planStatus === "function" ? app.helper.planStatus() : null;
    var seen = String((p && p.createdAt) || "");
    last = { at: pasted || !seen ? "yapıştır" : seen, seen: seen, ok: null };
    var b1 = $("btn-bind");
    var b2 = $("btn-bind2");
    b1.disabled = b2.disabled = true;
    bindLine = { text: "… bağlanıyor", cls: "" };
    renderStatus();
    app.helper
      .bindFromPlan({ text: $("paste") ? $("paste").value : "" })
      .then(
        function (out) {
          last.ok = !!out.ok;
          last.summary = out.summary;
          renderResult(out);
        },
        function (e) {
          last.ok = false;
          renderResult({ ok: false, summary: "✗ " + ((e && e.message) || e), rows: [], ignored: [], lines: [], notes: [] });
        }
      )
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
    if (open) renderPlan();
  }

  if (app) {
    app.onLog = renderLog;
    if (app.helper) app.helper.subscribe(renderStatus);
  }
  $("btn-bind").addEventListener("click", onBind);
  $("btn-bind2").addEventListener("click", onBind);
  $("btn-plan").addEventListener("click", renderPlan);
  $("srv").addEventListener("click", toggleMore);
  // ↻ Yenile: sunucuyu kapat (port boşalsın), paneli yeniden yükle
  $("btn-reload").addEventListener("click", function () {
    if (busy) return;
    if (app && app.helper && typeof app.helper.stop === "function")
      app.helper.stop().then(
        function () {
          window.location.reload();
        },
        function () {
          window.location.reload();
        }
      );
    else window.location.reload();
  });
  if ($("paste")) $("paste").addEventListener("change", renderPlan);
  renderStatus();
  renderBindBox();
  renderLog();
  // Spread planı yazınca bölüm kendiliğinden görünsün (dosya okuma; sunucuya dokunmaz)
  setInterval(function () {
    if (!busy) renderBindBox();
  }, 2000);
})();
