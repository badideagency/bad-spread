/*
 * Spread Helper — GÖRÜNMEZ CEP yardımcısı (Node açık). Spread UXP panelinin BAĞLA adımı için ExtendScript
 * Sequence.linkSelection() çağırır (UXP'de link API'si yok).
 *
 * GÜVENLİK
 *  - Yalnız 127.0.0.1:PORT dinlenir (sabit port, rastgele değil). Uzak adres 127.0.0.1 / ::ffff:127.0.0.1 değilse → 403.
 *  - Host başlığı 127.0.0.1:PORT ya da localhost:PORT olmalı (DNS rebinding'e karşı) → değilse 403.
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

  var VERSION = "0.3.0";
  var PORT = 47731;
  var MAX_BODY = 1024 * 1024;

  function infoPath(pathMod, platform, home) {
    if (/^win/i.test(platform)) return pathMod.win32.join(home, "AppData", "Roaming", "BadIdeaAgency", "SpreadHelper", "helper.json");
    return pathMod.posix.join(home, "Library", "Application Support", "BadIdeaAgency", "SpreadHelper", "helper.json");
  }

  // ------------------------------------------------------------------ doğrulama
  var ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
  var TICKS_RE = /^-?\d{1,24}$/;

  function bad(msg) {
    var e = new Error(msg);
    e.status = 400;
    return e;
  }

  function cleanLinkRequest(body) {
    if (!body || typeof body !== "object") throw bad("gövde nesne değil");
    if (typeof body.sequence !== "string" || !body.sequence || body.sequence.length > 512) throw bad("sequence adı geçersiz");
    if (!Array.isArray(body.groups) || body.groups.length < 1 || body.groups.length > 1000) throw bad("groups 1..1000 olmalı");
    var groups = body.groups.map(function (g, gi) {
      if (!g || typeof g !== "object" || typeof g.id !== "string" || !ID_RE.test(g.id)) throw bad("grup " + gi + ": id geçersiz");
      if (!Array.isArray(g.items) || g.items.length < 1 || g.items.length > 64) throw bad("grup " + g.id + ": items 1..64 olmalı");
      var items = g.items.map(function (it, ii) {
        var where = "grup " + g.id + " öğe " + ii;
        if (!it || typeof it !== "object") throw bad(where + ": nesne değil");
        if (it.kind !== "V" && it.kind !== "A") throw bad(where + ": kind V/A olmalı");
        if (typeof it.track !== "number" || !Number.isInteger(it.track) || it.track < 0 || it.track > 999) throw bad(where + ": track geçersiz");
        if (typeof it.start !== "string" || !TICKS_RE.test(it.start)) throw bad(where + ": start geçersiz");
        if (typeof it.end !== "string" || !TICKS_RE.test(it.end)) throw bad(where + ": end geçersiz");
        if (typeof it.name !== "string" || !it.name || it.name.length > 1024) throw bad(where + ": name geçersiz");
        return { kind: it.kind, track: it.track, start: it.start, end: it.end, name: it.name };
      });
      return { id: g.id, items: items };
    });
    return { sequence: body.sequence, groups: groups };
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
   * @param deps { http, crypto, fs, path, os, evalScript(script, cb), log?(line), port?, home?, platform? }
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
    var chain = Promise.resolve();

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
      if (ra !== "127.0.0.1" && ra !== "::ffff:127.0.0.1") return "uzak adres reddedildi";
      var host = String(req.headers.host || "");
      if (host !== "127.0.0.1:" + port && host !== "localhost:" + port) return "Host başlığı reddedildi";
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
      if (req.method !== "POST") return send(res, 405, { ok: false, error: "yalnız POST" });
      var why = authorized(req);
      if (why) {
        log("403 " + req.url + " — " + why);
        return send(res, why === "token geçersiz" ? 401 : 403, { ok: false, error: why });
      }
      if (req.url !== "/v1/ping" && req.url !== "/v1/link") return send(res, 404, { ok: false, error: "bilinmeyen komut" });
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
            send(res, 200, out);
          },
          function (e) {
            log("hata " + req.url + ": " + (e && e.message));
            send(res, e && e.status === 400 ? 400 : 500, { ok: false, error: String((e && e.message) || e) });
          }
        );
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

    return {
      version: VERSION,
      port: port,
      infoFile: file,
      address: function () {
        return server ? server.address() : null;
      },
      start: function () {
        return new Promise(function (resolve, reject) {
          server = deps.http.createServer(handle);
          server.on("error", function (e) {
            log("sunucu hatası: " + (e && e.message));
            reject(e);
          });
          server.listen(port, "127.0.0.1", function () {
            try {
              writeInfo();
            } catch (e) {
              log("bilgi dosyası yazılamadı: " + e.message);
              return reject(e);
            }
            log("dinliyor 127.0.0.1:" + port + " (bilgi: " + file + ")");
            resolve();
          });
        });
      },
      stop: function () {
        removeInfo();
        return new Promise(function (resolve) {
          if (!server) return resolve();
          server.close(function () {
            resolve();
          });
        });
      },
    };
  }

  var api = { createHelper: createHelper, cleanLinkRequest: cleanLinkRequest, literal: literal, infoPath: infoPath, VERSION: VERSION, PORT: PORT };
  if (typeof module === "object" && module && module.exports) module.exports = api;

  // ------------------------------------------------------------------ CEP içinde kendiliğinden başla
  // --mixed-context ile `require` doğrudan; ayrı bağlamda Adobe örneğindeki gibi `cep_node.require`.
  var nodeRequire = typeof cep_node !== "undefined" && cep_node && cep_node.require ? cep_node.require : typeof require === "function" ? require : null;
  if (typeof window !== "undefined" && window.__adobe_cep__ && nodeRequire) {
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
    var helper = createHelper({ http: nodeRequire("http"), crypto: nodeRequire("crypto"), fs: fs, path: path, os: os, evalScript: evalScript, log: logLine });
    helper.start().catch(function (e) {
      logLine("BAŞLAMADI: " + (e && e.message));
    });
    window.addEventListener("unload", function () {
      helper.stop();
    });
  }
})();
