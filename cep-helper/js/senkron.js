/*
 * Spread Helper — SENKRON (v1.4.0). Spread (UXP) medya dosyalarının listesini POST /v1/senkron { op: "start" } ile gönderir; burada
 * (CEP'in Node'u) sesler ffmpeg ile mono 8 kHz'e çözülür ve Spread'in AYNI modülüyle (js/spread-core.js: SpreadCore.senkronSolve,
 * kaynak spread/src/senkron.ts) eşleştirilir. UXP yalnız okur ve yerleştirir. { op: "status" } ilerlemeyi / sonucu, { op: "cancel" }
 * iptali verir. Aynı anda tek iş.
 *
 * ffmpeg / ffprobe
 *  - Kurulum paketine GÖMÜLMEZ. İlk kullanımda SABİT sürümlü resmî Windows derlemesi (gyan.dev "essentials", GitHub sürüm deposu
 *    GyanD/codexffmpeg) SABİT adresten indirilir; zip'in sha256'sı SABİT değerle karşılaştırılır, tutmazsa hiçbir şey yazılmaz.
 *    Zip'ten yalnız ffmpeg.exe, ffprobe.exe ve LICENSE çıkarılır (her birinin CRC-32 + sha256'sı da sabit), %APPDATA%\BadIdeaAgency\
 *    Spread\ffmpeg\ altına (".new" → yeniden adlandırma). Sonraki açılışlarda dosyaların sha256'sı yeniden denetlenir.
 *  - İndirme olmazsa açık hata: neden + zip'i elle aynı klasöre koyma yolu (aynı sha256 denetimi).
 *  - Lisans: GPL v3 (derlemenin kendi LICENSE / README'si); kullanıcının bilgisayarına kullanım anında indirilir, bizim paketimizle
 *    dağıtılmaz. handoff.md → v1.4.0.
 *  - Çağrı: child_process.spawn(exe, [sabit bayraklar…, dosya yolu]) — kabuk YOK; yol "-" ile başlayamaz (mutlak yol şartı).
 *
 * ÖNBELLEK: çözülmüş PCM (s16le, 8 kHz, mono) %APPDATA%\BadIdeaAgency\Spread\senkron-cache\ altında, anahtar = sha1(yol | boyut |
 * değişme zamanı). Toplam > 2 GB olursa en eskiler silinir.
 *
 * Bu dosya hem CEP'te (index.html) hem Node'da (spread/dev/smoke.cjs) çalışır: createSenkron() bağımlılıkları parametre olarak alır.
 */
(function () {
  "use strict";

  /** Sabit ffmpeg derlemesi (sha256'lar indirilen dosyadan hesaplandı: 2026-09-29, handoff.md → v1.4.0). */
  var FFMPEG = {
    version: "7.1.1-essentials_build-www.gyan.dev",
    url: "https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip",
    zipName: "ffmpeg-7.1.1-essentials_build.zip",
    size: 92234348,
    sha256: "04861d3339c5ebe38b56c19a15cf2c0cc97f5de4fa8910e4d47e5e6404e4a2d4",
    entries: [
      { name: "ffmpeg-7.1.1-essentials_build/bin/ffmpeg.exe", out: "ffmpeg.exe", size: 87429632, sha256: "b90225987bdd042cca09a1efb5e34e9848f2d1dbf5fbcd388753a44145522997" },
      { name: "ffmpeg-7.1.1-essentials_build/bin/ffprobe.exe", out: "ffprobe.exe", size: 87291904, sha256: "05e8fa639450f8191635192871ae37a3ec3e4638fa12f3b7d49c6522ba16a8ed" },
      { name: "ffmpeg-7.1.1-essentials_build/LICENSE", out: "LICENSE.txt", size: 35147, sha256: "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903" },
    ],
    /** github.com → release-assets.githubusercontent.com (302; eski adres objects.githubusercontent.com) */
    hosts: ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"],
  };
  var MAX_FILES = 400;
  var CACHE_MAX = 2 * 1024 * 1024 * 1024;
  var SR = 8000;

  function fail(stage, msg) {
    var e = new Error(msg);
    e.stage = stage;
    return e;
  }

  /** Spread'in veri klasörü (spread/src/journal.ts ile AYNI kural): …\AppData\Roaming\BadIdeaAgency\Spread */
  function spreadDir(pathMod, platform, home) {
    if (/^win/i.test(platform)) return pathMod.win32.join(home, "AppData", "Roaming", "BadIdeaAgency", "Spread");
    return pathMod.posix.join(home, "Library", "Application Support", "BadIdeaAgency", "Spread");
  }

  var CRC_TABLE = null;
  function crc32(buf) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * Zip'ten YALNIZ istenen kayıtları çıkarır (büyük kayıtlar dahil; zip64 yok). Her kaydın boyutu ve CRC-32'si denetlenir.
   * @returns { ad: Buffer }
   */
  function extractEntries(zlib, buf, wanted) {
    if (!buf || buf.length < 22) throw fail("zip", "zip çok kısa");
    var eocd = -1;
    for (var i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--)
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw fail("zip", "zip sonu bulunamadı");
    var count = buf.readUInt16LE(eocd + 10);
    var cdSize = buf.readUInt32LE(eocd + 12);
    var cdOff = buf.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOff === 0xffffffff || cdOff + cdSize > eocd) throw fail("zip", "zip merkezi dizini geçersiz (zip64 desteklenmez)");
    var want = {};
    wanted.forEach(function (n) {
      want[n] = true;
    });
    var out = {};
    var p = cdOff;
    for (var e = 0; e < count; e++) {
      if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw fail("zip", "zip merkezi dizin kaydı bozuk");
      var flags = buf.readUInt16LE(p + 8);
      var method = buf.readUInt16LE(p + 10);
      var crc = buf.readUInt32LE(p + 16);
      var csize = buf.readUInt32LE(p + 20);
      var usize = buf.readUInt32LE(p + 24);
      var nlen = buf.readUInt16LE(p + 28);
      var xlen = buf.readUInt16LE(p + 30);
      var clen = buf.readUInt16LE(p + 32);
      var loff = buf.readUInt32LE(p + 42);
      var name = buf.slice(p + 46, p + 46 + nlen).toString("utf8");
      p += 46 + nlen + xlen + clen;
      if (!want[name]) continue;
      if (flags & 1) throw fail("zip", "şifreli zip kaydı: " + name);
      if (loff + 30 > buf.length || buf.readUInt32LE(loff) !== 0x04034b50) throw fail("zip", "yerel başlık bozuk: " + name);
      var start = loff + 30 + buf.readUInt16LE(loff + 26) + buf.readUInt16LE(loff + 28);
      if (start + csize > buf.length) throw fail("zip", "dosya verisi eksik: " + name);
      var raw = buf.slice(start, start + csize);
      var data;
      if (method === 0) data = raw;
      else if (method === 8) data = zlib.inflateRawSync(raw);
      else throw fail("zip", "desteklenmeyen sıkıştırma (" + method + "): " + name);
      if (data.length !== usize) throw fail("zip", "boyut tutmuyor: " + name);
      if (crc32(data) !== crc) throw fail("zip", "CRC tutmuyor: " + name);
      out[name] = data;
    }
    wanted.forEach(function (n) {
      if (!out[n]) throw fail("zip", "zip'te yok: " + n);
    });
    return out;
  }

  /** "HH:MM:SS:FF" / "HH:MM:SS;FF" → günün saniyesi (kare atılır) ya da null. */
  function timecodeSec(tc) {
    var m = /^(\d{1,2}):(\d{2}):(\d{2})[:;.](\d{2,3})$/.exec(String(tc || "").trim());
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  }

  /**
   * UXP'den gelen iş isteğini doğrular (tip / uzunluk / biçim). Yol mutlak olmalı (ffmpeg'e seçenek sanılmasın).
   * @returns { files, opts }
   */
  function cleanStart(body, pathMod, platform) {
    if (!body || !Array.isArray(body.files) || !body.files.length) throw fail("istek", "dosya listesi boş");
    if (body.files.length > MAX_FILES) throw fail("istek", "çok fazla dosya (" + body.files.length + " > " + MAX_FILES + ")");
    var P = /^win/i.test(platform) ? pathMod.win32 : pathMod.posix;
    var seen = {};
    var files = body.files.map(function (f, i) {
      var bad = function (w) {
        return fail("istek", "files[" + i + "]: " + w);
      };
      if (!f || typeof f !== "object") throw bad("nesne değil");
      if (typeof f.id !== "string" || !f.id || f.id.length > 256) throw bad("id geçersiz");
      if (seen[f.id]) throw bad("id tekrarı");
      seen[f.id] = true;
      if (typeof f.path !== "string" || f.path.length > 1024 || !P.isAbsolute(f.path) || f.path.indexOf("\0") >= 0) throw bad("yol mutlak değil");
      if (typeof f.name !== "string" || f.name.length > 512) throw bad("ad geçersiz");
      if (f.kind !== "camera" && f.kind !== "audio") throw bad("tür geçersiz");
      if (typeof f.device !== "string" || f.device.length > 128) throw bad("cihaz geçersiz");
      var order = null;
      if (Array.isArray(f.order) && f.order.length <= 6 && f.order.every(function (x) {
        return typeof x === "number" && isFinite(x);
      }))
        order = f.order.slice();
      if (typeof f.recording !== "string" || f.recording.length > 512) throw bad("kayıt geçersiz");
      return { id: f.id, path: f.path, name: f.name || P.basename(f.path), kind: f.kind, device: f.device, recording: f.recording, certain: f.certain === true, order: order };
    });
    var o = body.opts && typeof body.opts === "object" ? body.opts : {};
    var opts = {};
    if (typeof o.frameSec === "number" && o.frameSec > 0.001 && o.frameSec < 1) opts.frameSec = o.frameSec;
    return { files: files, opts: opts };
  }

  /**
   * @param deps { fs, path, os, https, crypto, zlib, childProcess, core (SpreadCore), log(line), home, platform?,
   *               tools?: { ffmpeg, ffprobe } (sınama: hazır ikililer — indirme yok), download?(url) → Promise<Buffer> (sınama) }
   */
  function createSenkron(deps) {
    var log = deps.log || function () {};
    var platform = deps.platform || deps.os.platform();
    var dir = deps.dataDir || spreadDir(deps.path, platform, deps.home || deps.os.homedir());
    var ffDir = deps.path.join(dir, "ffmpeg");
    var cacheDir = deps.path.join(dir, "senkron-cache");
    var job = null;
    var seq = 0;
    var verified = null; // bu oturumda doğrulanmış ikililer

    function sha256(buf) {
      return deps.crypto.createHash("sha256").update(buf).digest("hex");
    }

    /** https GET → Buffer; yalnız izinli alan adları, en çok 5 yönlendirme, boyut ve süre sınırlı; ilerleme (bayt). */
    function get(url, maxBytes, hops, onBytes) {
      return new Promise(function (resolve, reject) {
        var u;
        try {
          u = new URL(url);
        } catch (e) {
          return reject(fail("ffmpeg", "adres geçersiz"));
        }
        if (u.protocol !== "https:" || FFMPEG.hosts.indexOf(u.hostname) < 0) return reject(fail("ffmpeg", "izin verilmeyen adres: " + u.hostname));
        var req = deps.https.get(url, { headers: { "User-Agent": "SpreadHelper-senkron" } }, function (res) {
          var code = res.statusCode;
          if (code >= 300 && code < 400 && res.headers.location) {
            res.resume();
            if (hops >= 5) return reject(fail("ffmpeg", "çok fazla yönlendirme"));
            return resolve(get(new URL(res.headers.location, url).toString(), maxBytes, hops + 1, onBytes));
          }
          if (code !== 200) {
            res.resume();
            return reject(fail("ffmpeg", "HTTP " + code));
          }
          var chunks = [];
          var size = 0;
          res.on("data", function (c) {
            size += c.length;
            if (size > maxBytes) {
              req.destroy();
              reject(fail("ffmpeg", "dosya beklenenden büyük"));
            } else {
              chunks.push(c);
              if (onBytes) onBytes(size);
            }
          });
          res.on("end", function () {
            resolve(Buffer.concat(chunks));
          });
          res.on("error", function (e) {
            reject(fail("ffmpeg", "indirme kesildi: " + e.message));
          });
        });
        req.setTimeout(120000, function () {
          req.destroy(fail("ffmpeg", "120 sn içinde yanıt yok"));
        });
        req.on("error", function (e) {
          reject(e && e.stage ? e : fail("ffmpeg", "bağlantı hatası: " + ((e && e.message) || e)));
        });
      });
    }

    function exePaths() {
      return { ffmpeg: deps.path.join(ffDir, "ffmpeg.exe"), ffprobe: deps.path.join(ffDir, "ffprobe.exe") };
    }

    /** Kurulu ikililer sabit sha256'larla tutuyor mu (bu oturumda bir kez). */
    function installedOk() {
      if (verified) return true;
      try {
        FFMPEG.entries.forEach(function (e) {
          var p = deps.path.join(ffDir, e.out);
          var st = deps.fs.statSync(p);
          if (st.size !== e.size || sha256(deps.fs.readFileSync(p)) !== e.sha256) throw new Error("tutmuyor");
        });
        verified = exePaths();
        return true;
      } catch (e) {
        return false;
      }
    }

    /** ffmpeg hazır mı; değilse indir + doğrula + çıkar. @returns { ffmpeg, ffprobe, how } */
    function ensureFfmpeg(progress) {
      if (deps.tools) return Promise.resolve({ ffmpeg: deps.tools.ffmpeg, ffprobe: deps.tools.ffprobe, how: "sınama" });
      if (!/^win/i.test(platform)) return Promise.reject(fail("ffmpeg", "SENKRON şimdilik yalnız Windows'ta (sabit ffmpeg derlemesi Windows için)"));
      if (installedOk()) return Promise.resolve({ ffmpeg: verified.ffmpeg, ffprobe: verified.ffprobe, how: "kurulu (sha256 doğrulandı)" });
      var manual = deps.path.join(ffDir, FFMPEG.zipName);
      var fromDisk = null;
      try {
        if (deps.fs.statSync(manual).size === FFMPEG.size) fromDisk = deps.fs.readFileSync(manual);
      } catch (e) {
        fromDisk = null;
      }
      var src = fromDisk ? "elle konan zip" : FFMPEG.url;
      if (!fromDisk) {
        log("senkron: ffmpeg indiriliyor: " + FFMPEG.url);
        progress("ffmpeg indiriliyor (ilk kullanım, ~88 MB)…", 0.01);
      }
      var dl = fromDisk
        ? Promise.resolve(fromDisk)
        : (deps.download || function (u) {
            return get(u, FFMPEG.size + 1024, 0, function (n) {
              progress("ffmpeg indiriliyor " + Math.round((100 * n) / FFMPEG.size) + "%", 0.01 + 0.04 * (n / FFMPEG.size));
            });
          })(FFMPEG.url);
      return dl.then(
        function (buf) {
          var h = sha256(buf);
          if (buf.length !== FFMPEG.size || h !== FFMPEG.sha256)
            throw fail("ffmpeg", "ffmpeg zip'inin sha256'sı tutmuyor (" + src + ": " + h.slice(0, 16) + "…, beklenen " + FFMPEG.sha256.slice(0, 16) + "…) — hiçbir şey yazılmadı");
          progress("ffmpeg çıkarılıyor…", 0.05);
          var got = extractEntries(
            deps.zlib,
            buf,
            FFMPEG.entries.map(function (e) {
              return e.name;
            })
          );
          FFMPEG.entries.forEach(function (e) {
            var d = got[e.name];
            if (d.length !== e.size || sha256(d) !== e.sha256) throw fail("ffmpeg", e.out + " sha256 tutmuyor — hiçbir şey yazılmadı");
          });
          deps.fs.mkdirSync(ffDir, { recursive: true });
          FFMPEG.entries.forEach(function (e) {
            var p = deps.path.join(ffDir, e.out);
            deps.fs.writeFileSync(p + ".new", got[e.name]);
            deps.fs.renameSync(p + ".new", p);
          });
          deps.fs.writeFileSync(
            deps.path.join(ffDir, "KAYNAK.txt"),
            "ffmpeg " + FFMPEG.version + "\r\n" + FFMPEG.url + "\r\nzip sha256 " + FFMPEG.sha256 + "\r\nLisans: GPL v3 (LICENSE.txt). Spread SENKRON için indirildi; silinebilir (gerekirse yeniden iner).\r\n"
          );
          verified = exePaths();
          log("senkron: ffmpeg kuruldu ve doğrulandı (" + src + ", sha256 " + FFMPEG.sha256 + ")");
          return { ffmpeg: verified.ffmpeg, ffprobe: verified.ffprobe, how: (fromDisk ? "elle konan zip'ten" : "indirildi") + ", sha256 doğrulandı" };
        },
        function (e) {
          throw fail(
            "ffmpeg",
            "ffmpeg indirilemedi: " +
              ((e && e.message) || e) +
              ". İnternet bağlantısını kontrol et; olmazsa " +
              FFMPEG.url +
              " dosyasını başka bir yoldan indirip şu klasöre koy: " +
              ffDir +
              " (aynı sha256 denetimi yapılır)."
          );
        }
      );
    }

    /** Alt süreç: stdout Buffer; iptalde öldürülür. */
    function run(exe, args, maxOut) {
      return new Promise(function (resolve, reject) {
        var cp;
        try {
          cp = deps.childProcess.spawn(exe, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        } catch (e) {
          return reject(fail("ffmpeg", "çalıştırılamadı: " + ((e && e.message) || e)));
        }
        if (job) job.child = cp;
        var out = [];
        var size = 0;
        var err = "";
        cp.stdout.on("data", function (c) {
          size += c.length;
          if (size > maxOut) {
            cp.kill();
            return;
          }
          out.push(c);
        });
        cp.stderr.on("data", function (c) {
          err = (err + c.toString("utf8")).slice(-2000);
        });
        cp.on("error", function (e) {
          reject(fail("ffmpeg", "çalıştırılamadı: " + ((e && e.message) || e)));
        });
        cp.on("close", function (code) {
          if (job && job.child === cp) job.child = null;
          if (job && job.cancel) return reject(fail("iptal", "iptal edildi"));
          if (size > maxOut) return reject(fail("ffmpeg", "çıktı çok büyük"));
          if (code !== 0) return reject(fail("ffmpeg", "çıkış " + code + ": " + (err.trim().split(/\r?\n/).pop() || "?")));
          resolve(Buffer.concat(out));
        });
      });
    }

    /** ffprobe: süre, ses akışı var mı, creation_time / timecode. */
    function probe(tools, file) {
      return run(tools.ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file.path], 4 * 1024 * 1024).then(function (b) {
        var j = JSON.parse(b.toString("utf8") || "{}");
        var fmt = j.format || {};
        var streams = Array.isArray(j.streams) ? j.streams : [];
        var tags = [fmt.tags || {}].concat(
          streams.map(function (s) {
            return s.tags || {};
          })
        );
        var pick = function (k) {
          for (var i = 0; i < tags.length; i++) if (tags[i] && tags[i][k]) return String(tags[i][k]);
          return null;
        };
        return {
          duration: Number(fmt.duration) || null,
          audio: streams.some(function (s) {
            return s.codec_type === "audio";
          }),
          creation: pick("creation_time"),
          timecode: pick("timecode"),
        };
      });
    }

    function cacheKey(file) {
      var st = deps.fs.statSync(file.path);
      return { key: deps.crypto.createHash("sha1").update(file.path + "|" + st.size + "|" + st.mtimeMs).digest("hex").slice(0, 24), size: st.size };
    }

    function pruneCache() {
      try {
        var list = deps.fs.readdirSync(cacheDir).map(function (n) {
          var p = deps.path.join(cacheDir, n);
          var st = deps.fs.statSync(p);
          return { p: p, size: st.size, t: st.mtimeMs };
        });
        var tot = list.reduce(function (s, x) {
          return s + x.size;
        }, 0);
        list.sort(function (a, b) {
          return a.t - b.t;
        });
        while (tot > CACHE_MAX && list.length) {
          var x = list.shift();
          deps.fs.unlinkSync(x.p);
          tot -= x.size;
        }
      } catch (e) {
        /* önbellek yoksa */
      }
    }

    /** mono 8 kHz s16le (önbellekten ya da ffmpeg ile). */
    function decode(tools, file) {
      var k = cacheKey(file);
      var p = deps.path.join(cacheDir, k.key + ".pcm");
      try {
        var b = deps.fs.readFileSync(p);
        var now = new Date();
        deps.fs.utimesSync(p, now, now);
        return Promise.resolve({ pcm: new Int16Array(b.buffer, b.byteOffset, b.length >> 1), cached: true });
      } catch (e) {
        /* yok → çöz */
      }
      var args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", file.path, "-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "1", "-ar", String(SR), "-acodec", "pcm_s16le", "-f", "s16le", "pipe:1"];
      return run(tools.ffmpeg, args, 24 * 3600 * SR * 2).then(function (b) {
        if (b.length & 1) b = b.slice(0, b.length - 1);
        try {
          deps.fs.mkdirSync(cacheDir, { recursive: true });
          deps.fs.writeFileSync(p + ".new", b);
          deps.fs.renameSync(p + ".new", p);
        } catch (e) {
          log("senkron: önbelleğe yazılamadı: " + ((e && e.message) || e));
        }
        var copy = new Uint8Array(b.length);
        copy.set(b);
        return { pcm: new Int16Array(copy.buffer), cached: false };
      });
    }

    function progress(text, frac) {
      if (!job) return;
      job.progress = { text: text, frac: Math.max(0, Math.min(1, frac)) };
    }

    function tick() {
      return new Promise(function (r) {
        (typeof setImmediate === "function" ? setImmediate : setTimeout)(r, 0);
      });
    }

    function work(req) {
      var tools = null;
      var inputs = [];
      var info = [];
      return ensureFfmpeg(progress)
        .then(function (t) {
          tools = t;
          job.ffmpeg = t.how;
          var chain = Promise.resolve();
          req.files.forEach(function (f, i) {
            chain = chain.then(function () {
              if (job.cancel) throw fail("iptal", "iptal edildi");
              progress("ses okunuyor " + (i + 1) + "/" + req.files.length + ": " + f.name, 0.06 + 0.34 * (i / req.files.length));
              var row = { id: f.id, name: f.name, path: f.path, ok: false, why: "", cached: false, seconds: null, clock: null, clockSrc: null, probe: null };
              info.push(row);
              var pr = null;
              return probe(tools, f)
                .then(
                  function (x) {
                    pr = x;
                    row.probe = x;
                  },
                  function () {
                    pr = null;
                  }
                )
                .then(function () {
                  if (pr && !pr.audio) throw fail("ffmpeg", "dosyada ses akışı yok");
                  return decode(tools, f);
                })
                .then(
                  function (d) {
                    row.ok = true;
                    row.cached = d.cached;
                    row.seconds = d.pcm.length / SR;
                    // saat ipucu: dosya adı > timecode > creation_time (cihaz başına tek kaynak aşağıda)
                    var c = deps.core.senkronClock(f.name);
                    if (c !== null) {
                      row.clock = c;
                      row.clockSrc = "ad";
                    } else if (pr && timecodeSec(pr.timecode) !== null) {
                      row.clock = timecodeSec(pr.timecode);
                      row.clockSrc = "timecode";
                    } else if (pr && pr.creation && !isNaN(Date.parse(pr.creation))) {
                      row.clock = Date.parse(pr.creation) / 1000;
                      row.clockSrc = "creation_time";
                    }
                    inputs.push({ id: f.id, name: f.name, kind: f.kind, device: f.device, recording: f.recording, certain: f.certain, order: f.order, pcm: d.pcm, clock: row.clock, clockSrc: row.clockSrc });
                  },
                  function (e) {
                    if (e && e.stage === "iptal") throw e;
                    row.why = "ses okunamadı: " + ((e && e.message) || e);
                  }
                );
            });
          });
          return chain;
        })
        .then(function () {
          pruneCache();
          // cihaz başına tek saat kaynağı (çoğunluk); farklı kaynaklı dosyaların saati kullanılmaz
          var bySrc = {};
          inputs.forEach(function (x) {
            if (!x.clockSrc) return;
            var m = (bySrc[x.device] = bySrc[x.device] || {});
            m[x.clockSrc] = (m[x.clockSrc] || 0) + 1;
          });
          inputs.forEach(function (x) {
            var m = bySrc[x.device];
            if (!m || !x.clockSrc) return;
            var best = Object.keys(m).sort(function (a, b) {
              return m[b] - m[a];
            })[0];
            if (x.clockSrc !== best) {
              x.clock = null;
              x.clockSrc = null;
            }
          });
          progress("eşleştiriliyor…", 0.4);
          return deps.core.senkronSolve(inputs, req.opts, {
            progress: function (text, frac) {
              progress(text, 0.4 + 0.58 * frac);
            },
            cancelled: function () {
              return !!(job && job.cancel);
            },
            yieldNow: tick,
          });
        })
        .then(function (res) {
          return {
            ffmpeg: job.ffmpeg,
            files: info.map(function (r) {
              var x = inputs.filter(function (q) {
                return q.id === r.id;
              })[0];
              return { id: r.id, name: r.name, ok: r.ok, why: r.why, cached: r.cached, seconds: r.seconds, clock: x ? x.clock : null, clockSrc: x ? x.clockSrc : null };
            }),
            result: res,
          };
        });
    }

    /** Hızlı durum (sha256 yok, yalnız dosya boyları): UXP ilk kullanımda indirme onayı sorsun. */
    function ffmpegState() {
      var installed = !!deps.tools || !!verified;
      if (!installed)
        try {
          installed = FFMPEG.entries.every(function (e) {
            return deps.fs.statSync(deps.path.join(ffDir, e.out)).size === e.size;
          });
        } catch (e) {
          installed = false;
        }
      return { installed: installed, version: FFMPEG.version, dir: ffDir, supported: !!deps.tools || /^win/i.test(platform) };
    }

    return {
      FFMPEG: FFMPEG,
      ffmpegDir: ffDir,
      ffmpegState: ffmpegState,
      ensureFfmpeg: ensureFfmpeg,
      start: function (body) {
        if (job && job.state === "running") throw fail("istek", "SENKRON zaten çalışıyor");
        if (!deps.core || typeof deps.core.senkronSolve !== "function") throw fail("istek", "spread-core.js'de SENKRON yok (yardımcı eski sürüm)");
        var req = cleanStart(body, deps.path, platform);
        seq++;
        job = { id: seq, state: "running", progress: { text: "başlıyor…", frac: 0 }, started: new Date().toISOString(), cancel: false, child: null, out: null, error: null, ffmpeg: null };
        var mine = job;
        log("senkron: iş " + mine.id + " — " + req.files.length + " dosya");
        work(req).then(
          function (out) {
            mine.out = out;
            mine.state = "done";
            mine.progress = { text: "bitti", frac: 1 };
            log("senkron: iş " + mine.id + " bitti");
          },
          function (e) {
            var cancelled = mine.cancel || (e && (e.stage === "iptal" || e.message === "iptal edildi"));
            mine.state = cancelled ? "cancelled" : "error";
            mine.error = cancelled ? "iptal edildi" : String((e && e.message) || e);
            log("senkron: iş " + mine.id + " " + mine.state + ": " + mine.error);
          }
        );
        return { ok: true, job: mine.id };
      },
      status: function () {
        if (!job) return { ok: true, state: "idle" };
        var r = { ok: true, job: job.id, state: job.state, progress: job.progress, started: job.started };
        if (job.state === "done") r.out = job.out;
        if (job.error) r.error = job.error;
        return r;
      },
      cancel: function () {
        if (!job || job.state !== "running") return { ok: true, state: job ? job.state : "idle" };
        job.cancel = true;
        if (job.child)
          try {
            job.child.kill();
          } catch (e) {
            /* zaten bitmiş */
          }
        return { ok: true, state: "cancelling" };
      },
      isBusy: function () {
        return !!(job && job.state === "running");
      },
    };
  }

  var api = { createSenkron: createSenkron, extractEntries: extractEntries, cleanStart: cleanStart, timecodeSec: timecodeSec, spreadDir: spreadDir, FFMPEG: FFMPEG, crc32: crc32 };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.SpreadSenkron = api;
})();
