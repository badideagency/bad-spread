/*
 * Spread Helper — GÖRÜNÜR CEP paneli (Window > Extensions (Legacy) > Spread Helper; Node açık). Premiere UXP'de link API'si
 * olmadığı için bağlamayı ExtendScript Sequence.linkSelection() ile yapar. İki yol:
 *  - KÖPRÜ: Spread (UXP) paneli POST /v1/link ile grupları gönderir (tek tık).
 *  - KÖPRÜSÜZ: Spread KES'ten sonra planı dosyaya yazar (link-plan.json, bilgi dosyasıyla aynı klasör); bu paneldeki BAĞLA düğmesi
 *    planı okur, aktif sequence'ı ExtendScript ile okur (spreadHelper_read), grupları Spread'in AYNI modülüyle (js/spread-core.js:
 *    classify + groupsFromLayout) düzenden bulur, planla BİREBİR karşılaştırır, aynıysa köprüyle AYNI ExtendScript fonksiyonuyla
 *    (spreadHelper_link) bağlar. Plan dosyası okunamazsa panele yapıştırılabilir.
 *
 * GÜVENLİK
 *  - Yalnız geri döngü dinlenir: 127.0.0.1:PORT ve (varsa) [::1]:PORT (sabit port). Spread (UXP) http://localhost:PORT'a gider:
 *    UXP ağ izni IP yazılı alan adlarını kabul etmiyor (handoff.md, kaynaklı) ve "localhost" önce ::1'e çözülebilir. Uzak adres
 *    127.0.0.1 / ::ffff:127.0.0.1 / ::1 değilse → 403.
 *  - Host başlığı localhost:PORT, 127.0.0.1:PORT ya da [::1]:PORT olmalı (DNS rebinding'e karşı) → değilse 403.
 *  - Her açılışta crypto.randomBytes(32) ile yeni token; kullanıcının ev klasöründeki küçük bir dosyaya yazılır
 *    (Windows: %USERPROFILE%\AppData\Roaming\BadIdeaAgency\SpreadHelper\helper.json,
 *     macOS: ~/Library/Application Support/BadIdeaAgency/SpreadHelper/helper.json). Panel oradan okur, her istekte
 *    "X-Spread-Token" başlığıyla gönderir; sabit zamanlı karşılaştırma. Tarayıcı sayfaları dosyayı okuyamaz; özel başlık
 *    CORS ön-isteği gerektirir ve bu sunucu HİÇBİR CORS izni vermez.
 *  - Yalnız iki komut: POST /v1/ping, POST /v1/link. Rastgele betik çalıştırma YOK: ExtendScript'e yalnız host.jsx'teki
 *    sabit iki fonksiyon, doğrulanmış (tip / uzunluk / biçim) ve JSON.stringify ile üretilmiş sabit değerlerle çağrılır.
 *  - Gövde ≤ 1 MB. ExtendScript çağrıları sırayla (kuyruk), zaman aşımlı.
 *
 * Bu dosya hem CEP'te (index.html) hem Node'da (spread/dev/smoke.cjs testleri) çalışır: createHelper() bağımlılıkları
 * parametre olarak alır.
 */
(function () {
  "use strict";

  var VERSION = "0.3.2";
  var PORT = 47731;
  var MAX_BODY = 1024 * 1024;
  // Panelle AYNI sınırlar (spread/src/linker.ts LINK_LIMITS) — panel BAĞLA planında kesmeden ÖNCE denetler
  var LIMITS = { groupItems: 256, groupsPerRequest: 64, name: 1024, sequenceName: 512 };
  /** Plan dosyasındaki grup sayısı üst sınırı (paneldeki BAĞLA grupları LINK_BATCH'lik partilerle gönderir). */
  var PLAN_MAX_GROUPS = 4096;
  var LINK_BATCH = 8;

  function infoPath(pathMod, platform, home) {
    if (/^win/i.test(platform)) return pathMod.win32.join(home, "AppData", "Roaming", "BadIdeaAgency", "SpreadHelper", "helper.json");
    return pathMod.posix.join(home, "Library", "Application Support", "BadIdeaAgency", "SpreadHelper", "helper.json");
  }

  /** KES planı: bilgi dosyasıyla aynı klasörde (Spread UXP paneli yazar; spread/src/linker.ts helperPlanPath ile AYNI kural). */
  function planPath(pathMod, platform, home) {
    var p = /^win/i.test(platform) ? pathMod.win32 : pathMod.posix;
    return p.join(p.dirname(infoPath(pathMod, platform, home)), "link-plan.json");
  }

  /** Paneldeki BAĞLA'nın sonucu (Spread'in durum raporu okur; spread/src/linker.ts helperResultPath ile AYNI kural). */
  function resultPath(pathMod, platform, home) {
    var p = /^win/i.test(platform) ? pathMod.win32 : pathMod.posix;
    return p.join(p.dirname(infoPath(pathMod, platform, home)), "link-result.json");
  }

  // ------------------------------------------------------------------ doğrulama
  var ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
  var TICKS_RE = /^-?\d{1,24}$/;

  function bad(msg) {
    var e = new Error(msg);
    e.status = 400;
    return e;
  }

  function cleanGroup(g, gi) {
    if (!g || typeof g !== "object" || typeof g.id !== "string" || !ID_RE.test(g.id)) throw bad("grup " + gi + ": id geçersiz");
    if (!Array.isArray(g.items) || g.items.length < 1 || g.items.length > LIMITS.groupItems)
      throw bad("grup " + g.id + ": items 1.." + LIMITS.groupItems + " olmalı");
    var items = g.items.map(function (it, ii) {
      var where = "grup " + g.id + " öğe " + ii;
      if (!it || typeof it !== "object") throw bad(where + ": nesne değil");
      if (it.kind !== "V" && it.kind !== "A") throw bad(where + ": kind V/A olmalı");
      if (typeof it.track !== "number" || !Number.isInteger(it.track) || it.track < 0 || it.track > 999) throw bad(where + ": track geçersiz");
      if (typeof it.start !== "string" || !TICKS_RE.test(it.start)) throw bad(where + ": start geçersiz");
      if (typeof it.end !== "string" || !TICKS_RE.test(it.end)) throw bad(where + ": end geçersiz");
      if (typeof it.name !== "string" || !it.name || it.name.length > LIMITS.name) throw bad(where + ": name geçersiz");
      return { kind: it.kind, track: it.track, start: it.start, end: it.end, name: it.name };
    });
    return { id: g.id, items: items };
  }

  function cleanLinkRequest(body) {
    if (!body || typeof body !== "object") throw bad("gövde nesne değil");
    if (typeof body.sequence !== "string" || !body.sequence || body.sequence.length > LIMITS.sequenceName) throw bad("sequence adı geçersiz");
    if (!Array.isArray(body.groups) || body.groups.length < 1 || body.groups.length > LIMITS.groupsPerRequest)
      throw bad("groups 1.." + LIMITS.groupsPerRequest + " olmalı");
    return { sequence: body.sequence, groups: body.groups.map(cleanGroup) };
  }

  var isTrack = function (n) {
    return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 999;
  };

  /** Spread'in KES planı (link-plan.json) — yapıya ve sınırlara göre doğrulanır; yalnız bilinen alanlar alınır. */
  function cleanPlan(obj) {
    if (!obj || typeof obj !== "object" || obj.kind !== "spread-link-plan" || obj.v !== 1) throw bad("bu bir Spread KES planı değil (kind/v)");
    var seq = obj.sequence;
    if (!seq || typeof seq.name !== "string" || !seq.name || seq.name.length > LIMITS.sequenceName) throw bad("plan: sequence adı geçersiz");
    var f = obj.frame;
    if (!f || !isTrack(f.vPark) || !isTrack(f.aPark) || !Array.isArray(f.silTracks) || f.silTracks.length > 64 || !f.silTracks.every(isTrack))
      throw bad("plan: track çerçevesi geçersiz");
    if (!Array.isArray(obj.groups) || obj.groups.length > PLAN_MAX_GROUPS) throw bad("plan: groups 0.." + PLAN_MAX_GROUPS + " olmalı");
    var groups = obj.groups.map(function (g, gi) {
      var c = cleanGroup(g, gi);
      c.label = typeof g.label === "string" ? g.label.slice(0, 512) : c.id;
      return c;
    });
    var at = typeof obj.createdAt === "string" ? obj.createdAt.slice(0, 64) : "?";
    return { sequence: seq.name, createdAt: at, frame: { vPark: f.vPark, aPark: f.aPark, silTracks: f.silTracks.slice() }, groups: groups };
  }

  /**
   * Doğrulanmış değeri ExtendScript kaynak koduna SABİT olarak gömer: JSON ⊂ ES3 literal. ASCII dışı her karakter (U+2028/2029
   * dahil) \uXXXX kaçışlı → ExtendScript'e yalnız ASCII kaynak gider (dosya adlarındaki Türkçe harfler bozulmaz).
   */
  function literal(v) {
    return JSON.stringify(v).replace(/[\u007f-￿]/g, function (c) {
      return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  // ------------------------------------------------------------------ yardımcı
  /**
   * @param deps { http, crypto, fs, path, os, evalScript(script, cb), core (js/spread-core.js: SpreadCore), log?(line), port?, home?,
   *               platform? }
   */
  function createHelper(deps) {
    var port = deps.port || PORT;
    var token = deps.crypto.randomBytes(32).toString("hex");
    var tokenBuf = Buffer.from(token, "utf8");
    var log = deps.log || function () {};
    var home = deps.home || deps.os.homedir();
    var platform = deps.platform || deps.os.platform();
    var file = infoPath(deps.path, platform, home);
    var server = null;
    var server6 = null;
    var chain = Promise.resolve();
    var planFile = planPath(deps.path, platform, home);
    var resultFile = resultPath(deps.path, platform, home);
    var core = deps.core || null;
    var listeners = [];
    // panelde gösterilen durum (sunucu, Premiere, son istek, son BAĞLA)
    var state = {
      version: VERSION,
      listening: false,
      addresses: [],
      v6: null,
      port: port,
      error: null,
      infoFile: file,
      planFile: planFile,
      premiere: null,
      node: typeof process !== "undefined" && process.version ? process.version : "?",
      core: core && core.CORE_VERSION ? core.CORE_VERSION : null,
      requests: 0,
      lastRequest: null,
      lastBind: null,
    };
    function emit(type) {
      for (var i = 0; i < listeners.length; i++) {
        try {
          listeners[i](type, state);
        } catch (e) {
          /* panel çizimi hatası sunucuyu etkilemesin */
        }
      }
    }

    /** ExtendScript'i sırayla, zaman aşımlı çağırır; dönen metni JSON olarak çözer. */
    function jsx(script, timeoutMs) {
      var run = function () {
        return new Promise(function (resolve, reject) {
          var done = false;
          var t = setTimeout(function () {
            if (!done) {
              done = true;
              reject(new Error("ExtendScript " + timeoutMs / 1000 + " sn içinde yanıt vermedi"));
            }
          }, timeoutMs);
          try {
            deps.evalScript(script, function (res) {
              if (done) return;
              done = true;
              clearTimeout(t);
              if (typeof res !== "string" || res === "EvalScript error.") return reject(new Error("ExtendScript hatası: " + String(res)));
              try {
                resolve(JSON.parse(res));
              } catch (e) {
                reject(new Error("ExtendScript yanıtı JSON değil: " + String(res).slice(0, 200)));
              }
            });
          } catch (e) {
            done = true;
            clearTimeout(t);
            reject(e);
          }
        });
      };
      var p = chain.then(run, run);
      chain = p.then(
        function () {},
        function () {}
      );
      return p;
    }

    function send(res, status, obj) {
      var body = JSON.stringify(obj);
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(body);
    }

    function authorized(req) {
      var ra = req.socket && req.socket.remoteAddress;
      if (ra !== "127.0.0.1" && ra !== "::ffff:127.0.0.1" && ra !== "::1") return "uzak adres reddedildi";
      var host = String(req.headers.host || "");
      if (host !== "127.0.0.1:" + port && host !== "localhost:" + port && host !== "[::1]:" + port) return "Host başlığı reddedildi";
      var got = Buffer.from(String(req.headers["x-spread-token"] || ""), "utf8");
      if (got.length !== tokenBuf.length || !deps.crypto.timingSafeEqual(got, tokenBuf)) return "token geçersiz";
      return null;
    }

    function readBody(req) {
      return new Promise(function (resolve, reject) {
        var chunks = [];
        var size = 0;
        req.on("data", function (c) {
          size += c.length;
          if (size > MAX_BODY) {
            reject(bad("gövde çok büyük"));
            req.destroy();
          } else chunks.push(c);
        });
        req.on("end", function () {
          try {
            var text = Buffer.concat(chunks).toString("utf8");
            resolve(text ? JSON.parse(text) : {});
          } catch (e) {
            reject(bad("gövde JSON değil"));
          }
        });
        req.on("error", reject);
      });
    }

    function handle(req, res) {
      var t0 = Date.now();
      var reply = function (status, obj) {
        send(res, status, obj);
        state.requests++;
        state.lastRequest = { at: new Date().toISOString(), method: req.method, url: String(req.url).slice(0, 64), status: status, ms: Date.now() - t0 };
        emit("request");
      };
      // tarayıcıyla canlılık denemesi (GET) → 405 ama kim olduğumuzu söyle (token / CORS yok; hiçbir iş yapılmaz)
      if (req.method !== "POST") return reply(405, { ok: false, error: "yalnız POST", helper: "Spread Helper " + VERSION });
      var why = authorized(req);
      if (why) {
        log("403 " + req.url + " — " + why);
        return reply(why === "token geçersiz" ? 401 : 403, { ok: false, error: why });
      }
      if (req.url !== "/v1/ping" && req.url !== "/v1/link") return reply(404, { ok: false, error: "bilinmeyen komut" });
      readBody(req)
        .then(function (body) {
          if (req.url === "/v1/ping")
            return jsx("spreadHelper_ping()", 10000).then(function (r) {
              if (!r || r.ok !== true) throw new Error((r && r.error) || "ping başarısız");
              return { ok: true, helper: VERSION, premiere: r.premiere, sequence: r.sequence };
            });
          var clean = cleanLinkRequest(body);
          log("link: " + clean.groups.length + " grup, sequence \"" + clean.sequence + "\"");
          return jsx("spreadHelper_link(" + literal(clean) + ")", 170000).then(function (r) {
            if (!r || r.ok !== true) throw new Error((r && r.error) || "link başarısız");
            return { ok: true, sequence: r.sequence, results: r.results, detail: r.detail || "" };
          });
        })
        .then(
          function (out) {
            reply(200, out);
          },
          function (e) {
            log("hata " + req.url + ": " + (e && e.message));
            reply(e && e.status === 400 ? 400 : 500, { ok: false, error: String((e && e.message) || e) });
          }
        );
    }

    /** ExtendScript okumasını Spread'in ClipInfo biçimine çevirir (yalnız sınıflama ve gruplamanın kullandığı alanlar). */
    function toClip(r) {
      var nm = typeof r.name === "string" && r.name ? r.name : "?";
      return {
        kind: r.kind,
        track: r.track,
        loopTrack: r.track,
        start: String(r.start),
        end: String(r.end),
        inPt: "0",
        outPt: "0",
        speed: 1,
        disabled: false,
        adjustment: false,
        name: nm,
        projId: typeof r.pid === "string" && r.pid ? r.pid : "?",
        projName: nm,
      };
    }

    function stopWith(msg, lines) {
      var e = new Error(msg);
      e.lines = lines || [];
      return e;
    }

    /** Plan metni: yapıştırılan (varsa) ya da plan dosyası. */
    function readPlan(text) {
      var src = text && String(text).trim() ? String(text) : null;
      var from = src ? "yapıştırılan plan" : planFile;
      if (!src) {
        try {
          src = deps.fs.readFileSync(planFile, "utf8");
        } catch (e) {
          throw stopWith("KES planı okunamadı (" + planFile + "): " + (e && e.message) + " — Spread'de BAĞLA'ya bas (önce KES yapar, planı yazar) ya da planı buraya yapıştır.");
        }
      }
      var obj;
      try {
        obj = JSON.parse(src);
      } catch (e) {
        throw stopWith(from + " JSON değil: " + (e && e.message));
      }
      var plan = cleanPlan(obj);
      plan.from = from;
      return plan;
    }

    /**
     * Paneldeki BAĞLA: planı oku → aktif sequence'ı oku → grupları Spread'in AYNI modülüyle düzenden bul → planla BİREBİR
     * karşılaştır → aynıysa köprüyle AYNI ExtendScript fonksiyonuyla (spreadHelper_link) parti parti bağla. Sonuç grup grup döner.
     * Uyuşmazlıkta HİÇBİR ŞEY yapılmaz.
     */
    function bindFromPlan(opts) {
      var t0 = new Date().toISOString();
      var planAt = null;
      var finish = function (out) {
        state.lastBind = { at: t0, ok: out.ok, summary: out.summary };
        // Spread'in durum raporu için: bu plan (createdAt) panelde bağlandı mı
        try {
          if (out.sequence)
            deps.fs.writeFileSync(
              resultFile,
              JSON.stringify({ v: 1, kind: "spread-link-result", sequence: out.sequence, planCreatedAt: planAt, at: t0, ok: out.ok, summary: out.summary }),
              "utf8"
            );
        } catch (e) {
          log("sonuç dosyası yazılamadı: " + (e && e.message));
        }
        emit("bind");
        return out;
      };
      return Promise.resolve()
        .then(function () {
          if (!core || typeof core.groupsFromLayout !== "function") throw stopWith("js/spread-core.js yüklenmedi — yardımcıyı yeniden kur");
          var plan = readPlan(opts && opts.text);
          planAt = plan.createdAt;
          log("BAĞLA (panel): plan " + plan.from + ", " + plan.groups.length + " grup, sequence \"" + plan.sequence + "\"");
          return jsx("spreadHelper_read()", 60000).then(function (r) {
            if (!r || r.ok !== true) throw stopWith("aktif sequence okunamadı: " + ((r && r.error) || "?"));
            if (r.sequence !== plan.sequence)
              throw stopWith("aktif sequence \"" + r.sequence + "\", plan \"" + plan.sequence + "\" için — hiçbir şey yapılmadı. Doğru sequence'ı aç.");
            var clips = (r.clips || []).map(toClip);
            var items = core.classify({ vCount: 0, aCount: 0, clips: clips, warnings: [], gen: 0 });
            var lay = core.groupsFromLayout(items, plan.frame);
            if (lay.errors.length) throw stopWith("Düzen KES sonrası hâlinde değil — hiçbir şey yapılmadı.", lay.errors);
            var diff = core.compareLinkGroups(plan.groups, lay.groups);
            if (diff.length) throw stopWith("Düzen KES planıyla uyuşmuyor (KES'ten sonra değişmiş olabilir) — hiçbir şey yapılmadı.", diff);
            var groups = plan.groups.filter(function (g) {
              return g.items.length >= 2;
            });
            var results = [];
            var batchError = null;
            var i = 0;
            var next = function () {
              if (i >= groups.length) return Promise.resolve();
              var batch = groups.slice(i, i + LINK_BATCH);
              i += LINK_BATCH;
              var req = cleanLinkRequest({ sequence: plan.sequence, groups: batch });
              var fail = function (why) {
                // bu parti ve sonrakiler gönderilmedi / sonuçsuz: grup grup "hata" olarak raporlanır (bağlananlar korunur)
                batchError = why;
                groups.slice(i - LINK_BATCH).forEach(function (g) {
                  results.push({ id: g.id, total: g.items.length, found: g.items.length, missing: [], linked: false, verified: null, detail: "bağlanmadı — " + why });
                });
              };
              return jsx("spreadHelper_link(" + literal(req) + ")", 170000).then(
                function (lr) {
                  if (!lr || lr.ok !== true) return fail("bağlama isteği başarısız: " + ((lr && lr.error) || "?"));
                  for (var k = 0; k < lr.results.length; k++) results.push(lr.results[k]);
                  return next();
                },
                function (e) {
                  return fail("bağlama isteği başarısız: " + ((e && e.message) || e));
                }
              );
            };
            return next().then(function () {
              var labelOf = {};
              groups.forEach(function (g) {
                labelOf[g.id] = g.label;
              });
              var rows = results.map(function (x) {
                return {
                  id: x.id,
                  label: labelOf[x.id] || x.id,
                  status: x.found !== x.total || !x.linked || x.verified === false ? "hata" : x.verified === null ? "doğrulanamadı" : "tamam",
                  detail: x.found !== x.total ? x.found + "/" + x.total + " öğe bulundu (" + x.missing.join(", ") + ")" : x.detail || "",
                };
              });
              var bad = rows.filter(function (x) {
                return x.status === "hata";
              }).length;
              var unv = rows.filter(function (x) {
                return x.status === "doğrulanamadı";
              }).length;
              var summary =
                (bad ? "✗ " + bad + "/" + rows.length + " grup bağlanamadı" : unv ? "⚠ " + rows.length + " grup bağlandı, " + unv + " doğrulanamadı" : "✓ " + rows.length + " grup bağlandı ve doğrulandı") +
                (lay.ignored.length ? " (" + lay.ignored.length + " öğeye dokunulmadı)" : "");
              if (batchError) summary += " — " + batchError + " (yeniden basmak güvenli: bağlananlar yeniden bağlanır)";
              log("BAĞLA (panel): " + summary);
              return finish({ ok: !bad, summary: summary, sequence: plan.sequence, rows: rows, ignored: lay.ignored, lines: [] });
            });
          });
        })
        .catch(function (e) {
          var summary = "✗ " + String((e && e.message) || e);
          log("BAĞLA (panel) durdu: " + summary);
          return finish({ ok: false, summary: summary, sequence: null, rows: [], ignored: [], lines: (e && e.lines) || [] });
        });
    }

    function writeInfo() {
      deps.fs.mkdirSync(deps.path.dirname(file), { recursive: true });
      var info = { port: port, token: token, version: VERSION, pid: process.pid, startedAt: new Date().toISOString() };
      deps.fs.writeFileSync(file, JSON.stringify(info), { encoding: "utf8", mode: 384 }); // 0600
    }

    function removeInfo() {
      try {
        var cur = JSON.parse(deps.fs.readFileSync(file, "utf8"));
        if (cur && cur.token === token) deps.fs.unlinkSync(file); // yalnız KENDİ dosyamızı sil
      } catch (e) {
        /* yoksa geç */
      }
    }

    var api0 = {
      version: VERSION,
      port: port,
      infoFile: file,
      resultFile: resultFile,
      address: function () {
        return server ? server.address() : null;
      },
      start: function () {
        // Bilgi dosyası dinlemeden ÖNCE silinmez: port başka bir Spread Helper'daysa (EADDRINUSE) dosya ONUNDUR. Başarılı dinlemede
        // üzerine yazılır; kapanışta yalnız KENDİ token'ımızı taşıyorsa silinir.
        if (server) return Promise.resolve();
        return new Promise(function (resolve, reject) {
          server = deps.http.createServer(handle);
          server.on("error", function (e) {
            var code = e && e.code ? e.code + ": " : "";
            state.listening = false;
            state.error =
              code + ((e && e.message) || String(e)) + (e && e.code === "EADDRINUSE" ? " — port " + port + " kullanımda (ikinci bir Spread Helper paneli ya da başka bir program)" : "");
            log("sunucu hatası: " + state.error);
            emit("status");
            reject(e);
          });
          server.listen(port, "127.0.0.1", function () {
            try {
              writeInfo();
            } catch (e) {
              state.error = "bilgi dosyası yazılamadı (" + file + "): " + e.message;
              log(state.error);
              emit("status");
              return reject(e);
            }
            state.listening = true;
            state.error = null;
            state.addresses = ["127.0.0.1"];
            log("dinliyor 127.0.0.1:" + port + " (bilgi: " + file + ")");
            emit("status");
            // IPv6 geri döngü: "localhost" ::1'e çözülürse de bağlanılsın. Açılamazsa (IPv6 yok) sorun değil, bildirilir.
            try {
              server6 = deps.http.createServer(handle);
              server6.on("error", function (e6) {
                server6 = null;
                if (e6 && e6.code === "EADDRINUSE") {
                  // [::1]:PORT başka bir programda: "localhost" oraya çözülürse Spread token'ı ONA gönderirdi → güvenlik için dur
                  state.error = "[::1]:" + port + " başka bir program tarafından kullanılıyor — token sızmasın diye sunucu DURDURULDU";
                  log(state.error);
                  api0.stop();
                  return;
                }
                state.v6 = "açılamadı (" + ((e6 && e6.code) || (e6 && e6.message) || e6) + ") — IPv6 yok, localhost 127.0.0.1'e gider";
                log("[::1]:" + port + " " + state.v6);
                emit("status");
              });
              server6.listen(port, "::1", function () {
                state.addresses.push("::1");
                state.v6 = "dinliyor";
                log("dinliyor [::1]:" + port);
                emit("status");
              });
            } catch (e6) {
              state.v6 = "açılamadı (" + ((e6 && e6.message) || e6) + ")";
              server6 = null;
            }
            // Premiere sürümü (panelde gösterilir; ExtendScript de böylece sınanmış olur)
            jsx("spreadHelper_ping()", 10000).then(
              function (r) {
                state.premiere = r && r.ok ? String(r.premiere) : "ExtendScript yanıtı: " + String((r && r.error) || "?");
                emit("status");
              },
              function (e2) {
                state.premiere = "ExtendScript çağrılamadı: " + (e2 && e2.message);
                emit("status");
              }
            );
            resolve();
          });
        });
      },
      planFile: planFile,
      state: function () {
        return state;
      },
      subscribe: function (fn) {
        listeners.push(fn);
      },
      readPlan: readPlan,
      bindFromPlan: bindFromPlan,
      stop: function () {
        state.listening = false;
        removeInfo();
        var close = function (srv) {
          return new Promise(function (resolve) {
            if (!srv) return resolve();
            try {
              srv.close(function () {
                resolve();
              });
            } catch (e) {
              resolve();
            }
          });
        };
        var s4 = server;
        var s6 = server6;
        server = null;
        server6 = null;
        return Promise.all([close(s4), close(s6)]).then(function () {
          emit("status");
        });
      },
    };
    return api0;
  }

  var api = { createHelper: createHelper, cleanLinkRequest: cleanLinkRequest, cleanPlan: cleanPlan, literal: literal, infoPath: infoPath, planPath: planPath, resultPath: resultPath, VERSION: VERSION, PORT: PORT, LIMITS: LIMITS };
  if (typeof module === "object" && module && module.exports) module.exports = api;

  // ------------------------------------------------------------------ CEP paneli: sunucuyu başlat, arayüze (js/panel.js) aç
  // --mixed-context ile `require` doğrudan; ayrı bağlamda Adobe örneğindeki gibi `cep_node.require`.
  var nodeRequire = typeof cep_node !== "undefined" && cep_node && cep_node.require ? cep_node.require : typeof require === "function" ? require : null;
  if (typeof window !== "undefined" && window.__adobe_cep__) {
    var app = { helper: null, lines: [], error: null, onLog: null };
    window.SpreadHelperApp = app;
    var push = function (line) {
      app.lines.push(new Date().toISOString().slice(11, 19) + " " + line);
      if (app.lines.length > 200) app.lines.shift();
      if (app.onLog) app.onLog();
    };
    if (!nodeRequire) {
      app.error = "Node.js bu panelde kapalı (require yok) — manifest'teki --enable-nodejs / --mixed-context çalışmadı; sunucu BAŞLAMADI.";
      push(app.error);
    } else {
      var fs = nodeRequire("fs");
      var path = nodeRequire("path");
      var os = nodeRequire("os");
      var logFile = path.join(os.tmpdir(), "spread-helper.log");
      try {
        fs.writeFileSync(logFile, ""); // her açılışta sıfırla
      } catch (e) {
        /* yoksa geç */
      }
      var logLine = function (line) {
        push(line);
        try {
          fs.appendFileSync(logFile, new Date().toISOString() + " " + line + "\n");
        } catch (e) {
          /* yoksa geç */
        }
      };
      // CSInterface.evalScript ile aynı alt çağrı: window.__adobe_cep__.evalScript(script, callback)
      // (Adobe-CEP/CEP-Resources, CSInterface.js — CSInterface.prototype.evalScript)
      var evalScript = function (script, cb) {
        window.__adobe_cep__.evalScript(script, cb);
      };
      try {
        app.helper = createHelper({
          http: nodeRequire("http"),
          crypto: nodeRequire("crypto"),
          fs: fs,
          path: path,
          os: os,
          evalScript: evalScript,
          core: window.SpreadCore || null,
          log: logLine,
        });
        logLine("Spread Helper " + VERSION + " açıldı (Node " + (typeof process !== "undefined" && process.version ? process.version : "?") + ", günlük: " + logFile + ")");
        app.helper.start().catch(function (e) {
          logLine("SUNUCU BAŞLAMADI: " + ((e && e.message) || e));
        });
        window.addEventListener("unload", function () {
          app.helper.stop();
        });
      } catch (e) {
        app.error = "yardımcı kurulamadı: " + ((e && e.message) || e);
        logLine(app.error);
      }
    }
  }
})();
