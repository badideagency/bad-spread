/*
 * Spread Helper — güncelleme (v1.2.0). Spread (UXP) yeni sürümü latest.json'dan görür ve kullanıcı "Güncelle" deyince köprüden
 * POST /v1/update gönderir. İndirme, doğrulama, kurulum ve yeniden başlatma BURADA: CEP'in Node'u var, UXP'nin yok.
 *
 * GÜVENLİK / GÜVENCE
 *  - latest.json'u ve zip'i yardımcı KENDİSİ, SABİT adresten okur (UPDATE_REPO). İstek gövdesi yalnız beklenen sürümü taşır; adres
 *    ya da dosya yolu köprüden gelmez. zip_url yalnız güncelleme deposunun raw adresi olabilir, yönlendirme yalnız aynı alan adına.
 *  - sha256 tutmazsa (ya da zip / içerik denetimi düşerse) HİÇBİR ŞEYE dokunulmaz: yedek bile alınmaz, dosya yazılmaz.
 *  - Yardımcı dosyaları: önce mevcut klasörün TAMAMI yedeklenir; yazma yarıda kalırsa yedek geri yüklenir (eski sürüm yerinde).
 *  - Spread paneli (spread.ccx) Adobe'nin UnifiedPluginInstallerAgent'ıyla kurulur (KUR.cmd'deki doğrulanmış yol ve bayrak).
 *    Kurulamazsa .ccx Creative Cloud'la açılır, kullanıcıya "Install'a bas" denir.
 *  - Yeniden başlatma: açık projelerin HEPSİ kaydedilir ve dosyalarının gerçekten yazıldığı (değişme zamanı) doğrulanır; biri bile
 *    doğrulanamazsa (hiç kaydedilmemiş proje, kaydetme hatası, dosya değişmedi) Premiere KAPATILMAZ. Sonra bağımsız küçük bir
 *    yeniden başlatıcı (restart-spread.cmd) Premiere'in kapanmasını bekleyip aynı projeyle yeniden açar; Premiere ExtendScript
 *    app.quit() ile kapanır.
 *  - Her adım güncelleme günlüğüne (update.log, bilgi dosyasıyla aynı klasör) yazılır; Spread'in Sorun bildir raporu onu da ekler.
 *
 * Bu dosya hem CEP'te (index.html) hem Node'da (spread/dev/smoke.cjs) çalışır: createUpdater() bağımlılıkları parametre olarak alır.
 */
(function () {
  "use strict";

  var UPDATE_REPO = "badideagency/bad-spread-updates";
  var RAW = "https://raw.githubusercontent.com/";
  var LATEST_URL = RAW + UPDATE_REPO + "/main/latest.json";
  var ZIP_PREFIX = RAW + UPDATE_REPO + "/";
  var ALLOWED_HOSTS = ["raw.githubusercontent.com"];
  var MAX_JSON = 64 * 1024;
  var MAX_ZIP = 64 * 1024 * 1024;
  var MAX_ENTRY = 64 * 1024 * 1024;
  var EXT_DIR_NAME = "com.badideagency.spread.helper";
  /** Kurulum paketinde olması gereken dosyalar (scripts/package-kurulum.sh ile aynı liste). */
  var KIT_FILES = [
    "spread.ccx",
    "SpreadHelper/CSXS/manifest.xml",
    "SpreadHelper/.debug",
    "SpreadHelper/index.html",
    "SpreadHelper/js/spread-core.js",
    "SpreadHelper/js/helper.js",
    "SpreadHelper/js/updater.js",
    "SpreadHelper/js/panel.js",
    "SpreadHelper/jsx/host.jsx",
  ];
  var UPIA_REL = "Adobe\\Adobe Desktop Common\\RemoteComponents\\UPI\\UnifiedPluginInstallerAgent\\UnifiedPluginInstallerAgent.exe";

  function fail(stage, msg) {
    var e = new Error(msg);
    e.stage = stage;
    return e;
  }

  /** "1.10.0" > "1.9.2" (yalnız sayısal x.y.z). a < b → -1, eşit → 0, a > b → 1. */
  function cmpVersion(a, b) {
    var x = String(a).split(".");
    var y = String(b).split(".");
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var p = Number(x[i] || 0);
      var q = Number(y[i] || 0);
      if (p !== q) return p < q ? -1 : 1;
    }
    return 0;
  }

  /** latest.json'u doğrular; bozuksa hata (hiçbir şey yapılmaz). notes: 1–3 Türkçe madde. */
  function validateLatest(o) {
    if (!o || typeof o !== "object") throw fail("latest", "latest.json nesne değil");
    if (typeof o.version !== "string" || !/^\d+\.\d+\.\d+$/.test(o.version)) throw fail("latest", "latest.json: version geçersiz");
    if (typeof o.date !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(o.date)) throw fail("latest", "latest.json: date geçersiz");
    var notes = o.notes;
    if (!Array.isArray(notes) || notes.length < 1 || notes.length > 3) throw fail("latest", "latest.json: notes 1–3 madde olmalı");
    for (var i = 0; i < notes.length; i++)
      if (typeof notes[i] !== "string" || !notes[i].trim() || notes[i].length > 300) throw fail("latest", "latest.json: notes[" + i + "] geçersiz");
    // yüzde kodlaması da reddedilir ("%2e%2e" normalleşince başka depoya çıkabilirdi); ayrıştırılmış adres de aynı önekle başlamalı
    var zu = null;
    try {
      zu = typeof o.zip_url === "string" ? new URL(o.zip_url) : null;
    } catch (e) {
      zu = null;
    }
    if (
      typeof o.zip_url !== "string" || o.zip_url.indexOf(ZIP_PREFIX) !== 0 || !/\.zip$/.test(o.zip_url) || /[\s"'<>\\%?#]|\.\./.test(o.zip_url) ||
      !zu || zu.href !== o.zip_url || zu.href.indexOf(ZIP_PREFIX) !== 0
    )
      throw fail("latest", "latest.json: zip_url güncelleme deposunun bir zip'i değil");
    if (typeof o.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(o.sha256)) throw fail("latest", "latest.json: sha256 geçersiz");
    if (typeof o.min_premiere !== "string" || !/^\d+(\.\d+){0,2}$/.test(o.min_premiere)) throw fail("latest", "latest.json: min_premiere geçersiz");
    return { version: o.version, date: o.date, notes: notes.slice(), zip_url: o.zip_url, sha256: o.sha256, min_premiere: o.min_premiere };
  }

  // ------------------------------------------------------------------ zip okuma (bağımlılıksız: merkezi dizin + inflateRaw)
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

  /** Güvenli göreli yol mu (mutlak / sürücü / ".." / ters bölü yok). */
  function safeName(n) {
    return typeof n === "string" && n.length > 0 && n.length < 512 && n.indexOf("\\") < 0 && n.charAt(0) !== "/" && !/^[A-Za-z]:/.test(n) && n.split("/").indexOf("..") < 0 && n.indexOf("\0") < 0;
  }

  /**
   * Zip'in dosyalarını çıkarır: [{ name, data }]. Yalnız stored (0) ve deflate (8); zip64, şifreli ve güvensiz adlar reddedilir;
   * her dosyanın CRC-32'si denetlenir.
   */
  function readZip(zlib, buf) {
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
    var out = [];
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
      if (flags & 1) throw fail("zip", "şifreli zip kaydı: " + name);
      if (!safeName(name)) throw fail("zip", "güvensiz dosya adı: " + JSON.stringify(name));
      if (name.charAt(name.length - 1) === "/") continue; // klasör kaydı
      if (usize > MAX_ENTRY || csize > buf.length) throw fail("zip", "dosya çok büyük: " + name);
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
      out.push({ name: name, data: data });
    }
    return out;
  }

  /** Paket bu sürümün kurulum paketi mi: gerekli dosyalar + yardımcı manifest / helper.js sürümü. */
  function checkKit(entries, version) {
    var by = {};
    entries.forEach(function (x) {
      by[x.name] = x.data;
    });
    for (var i = 0; i < KIT_FILES.length; i++) if (!by[KIT_FILES[i]]) throw fail("kit", "pakette " + KIT_FILES[i] + " yok");
    var man = by["SpreadHelper/CSXS/manifest.xml"].toString("utf8");
    if (man.indexOf('ExtensionBundleId="' + EXT_DIR_NAME + '"') < 0) throw fail("kit", "yardımcı manifest başka bir eklentinin");
    if (man.indexOf('ExtensionBundleVersion="' + version + '"') < 0) throw fail("kit", "yardımcı manifest sürümü " + version + " değil");
    if (by["SpreadHelper/js/helper.js"].toString("utf8").indexOf('var VERSION = "' + version + '"') < 0) throw fail("kit", "helper.js sürümü " + version + " değil");
    var ccx = by["spread.ccx"];
    if (ccx.length < 4 || ccx.readUInt32LE(0) !== 0x04034b50) throw fail("kit", "spread.ccx zip değil");
    return by;
  }

  /** spread.ccx'in kendi manifest'i: kimlik com.badideagency.spread ve sürüm = paketin sürümü (eski bir .ccx paketlenmesin). */
  function checkCcx(zlib, ccx, version) {
    var man = null;
    readZip(zlib, ccx).forEach(function (e) {
      if (e.name === "manifest.json") man = e.data;
    });
    if (!man) throw fail("kit", "spread.ccx içinde manifest.json yok");
    var m;
    try {
      m = JSON.parse(man.toString("utf8"));
    } catch (e) {
      throw fail("kit", "spread.ccx manifest.json JSON değil");
    }
    if (!m || m.id !== "com.badideagency.spread") throw fail("kit", "spread.ccx başka bir eklentinin (" + (m && m.id) + ")");
    if (m.version !== version) throw fail("kit", "spread.ccx sürümü " + m.version + ", paket " + version);
  }

  // ------------------------------------------------------------------ yeniden başlatıcı (Windows, ayrı süreç)
  /**
   * restart-spread.cmd — yalnız ASCII, CRLF. Girdiler YALNIZ ortam değişkenlerinden (Unicode / boşluk / "( ) &" içeren yollar
   * komut satırında bozulmasın): SPREAD_IMG süreç adı (Premiere.exe yolunun son parçası), SPREAD_EXE Premiere.exe tam yolu,
   * SPREAD_PRJ açılacak proje (boş olabilir), SPREAD_LOG günlük, SPREAD_MAX en çok kaç yoklama (1 sn arayla).
   * Bekleme: "tasklist /NH /FO CSV | find /I" (CSV: uzun süreç adı kesilmez) — 0 = çalışıyor, 1 = yok, 2 = HATA. "Yok" ancak Premiere
   * ÖNCE çalışırken görüldüyse "kapandı" sayılır (başlatıcı app.quit'ten önce başlar); hiç görülmediyse (liste boş / okunamadı, ad
   * eşleşmedi), hata ya da süre dolması → HİÇBİR ŞEY açılmaz (ikinci Premiere yok). Uyku: ping (timeout /t yönlendirilmiş girdide
   * belgesiz). Tasarım Wine'da sınandı (scripts/test-restarter-wine.sh).
   */
  var RESTART_CMD = [
    "@echo off",
    "setlocal EnableExtensions DisableDelayedExpansion",
    "rem Spread Helper - Premiere yeniden baslatici (v1.2.0). Premiere kapaninca ayni projeyle yeniden acar.",
    'if not defined SPREAD_MAX set "SPREAD_MAX=300"',
    "set /a N=0",
    'set "SEEN=0"',
    '>>"%SPREAD_LOG%" echo %date% %time% baslatici: "%SPREAD_IMG%" kapanmasi bekleniyor',
    ":wait",
    'tasklist /NH /FO CSV 2>nul | find /I "%SPREAD_IMG%" >nul',
    "if errorlevel 2 goto :err",
    "if errorlevel 1 goto :notrunning",
    'set "SEEN=1"',
    "set /a N+=1",
    "if %N% geq %SPREAD_MAX% goto :late",
    "ping -n 2 127.0.0.1 >nul",
    "goto :wait",
    ":notrunning",
    "rem Premiere hic calisirken GORULMEDIYSE (surec listesi bos / okunamadi, ad eslesmedi) kapandi sanilmaz",
    'if not "%SEEN%"=="1" goto :unseen',
    ":gone",
    "rem Premiere kapandi; dosyalar serbest kalsin",
    "ping -n 4 127.0.0.1 >nul",
    'if not exist "%SPREAD_EXE%" goto :noexe',
    'if defined SPREAD_PRJ if exist "%SPREAD_PRJ%" goto :withprj',
    'start "" "%SPREAD_EXE%"',
    "goto :started",
    ":withprj",
    'start "" "%SPREAD_EXE%" "%SPREAD_PRJ%"',
    ":started",
    '>>"%SPREAD_LOG%" echo %date% %time% baslatici: Premiere yeniden acildi',
    "exit /b 0",
    ":late",
    '>>"%SPREAD_LOG%" echo %date% %time% baslatici: Premiere %SPREAD_MAX% sn icinde kapanmadi - hicbir sey acilmadi',
    "exit /b 2",
    ":err",
    '>>"%SPREAD_LOG%" echo %date% %time% baslatici: surec listesi okunamadi - hicbir sey acilmadi',
    "exit /b 3",
    ":unseen",
    '>>"%SPREAD_LOG%" echo %date% %time% baslatici: "%SPREAD_IMG%" surec listesinde hic gorulmedi - hicbir sey acilmadi',
    "exit /b 5",
    ":noexe",
    '>>"%SPREAD_LOG%" echo %date% %time% baslatici: Premiere.exe bulunamadi - hicbir sey acilmadi',
    "exit /b 4",
    "",
  ].join("\r\n");

  /**
   * Yeniden başlatıcıyı başlatır. Neden bu biçim (kaynaklar handoff.md'de): Node'un "detached" seçeneği konsolsuz süreç açar →
   * içindeki her tasklist / ping yeni bir konsol penceresi açar ve Wine sınamasında süreç listesi okunamayınca İKİNCİ Premiere açıldı.
   * `cmd /c start "" /b cmd /c call …` ile açılan torun süreç, CEP motoru kapanınca öldürülen iş nesnesinden (job) çıkar (libuv
   * win/process.c; Wine'da sınandı). Değerler yalnız ortam değişkeniyle geçer (windowsVerbatimArguments: komut satırı sabit).
   */
  function restarterSpawnArgs(comspec, cmdPath, vars, baseEnv) {
    var env = {};
    Object.keys(baseEnv || {}).forEach(function (k) {
      env[k] = baseEnv[k];
    });
    Object.keys(vars).forEach(function (k) {
      env[k] = vars[k];
    });
    env.SPREAD_RESTARTER = cmdPath;
    return {
      cmd: comspec,
      args: ["/d", "/c", 'start "" /b cmd /d /c call "%SPREAD_RESTARTER%"'],
      opts: { stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true, env: env },
    };
  }

  /**
   * @param deps { https, crypto, zlib, fs, path, os, childProcess, env, jsx(script, timeoutMs) → Promise<obj>, log(line),
   *               dataDir (bilgi dosyasının klasörü), extDir (bu eklentinin klasörü), hostApp (Premiere.exe yolu),
   *               platform?, now?() }
   */
  function createUpdater(deps) {
    var log = deps.log || function () {};
    var platform = deps.platform || deps.os.platform();
    var logFile = deps.path.join(deps.dataDir, "update.log");
    var busy = false;

    function ulog(line) {
      log("güncelleme: " + line);
      try {
        deps.fs.mkdirSync(deps.dataDir, { recursive: true });
        try {
          if (deps.fs.statSync(logFile).size > 256 * 1024) {
            var old = deps.fs.readFileSync(logFile, "utf8");
            deps.fs.writeFileSync(logFile, old.slice(-128 * 1024).replace(/^[^\n]*\n/, ""));
          }
        } catch (e) {
          /* günlük yoksa */
        }
        deps.fs.appendFileSync(logFile, new Date().toISOString() + " " + line + "\n");
      } catch (e) {
        /* günlük yazılamazsa işlem sürer */
      }
    }

    /** https GET → Buffer; yalnız izinli alan adı, en çok 3 yönlendirme, boyut ve süre sınırlı. */
    function get(url, maxBytes, hops) {
      return new Promise(function (resolve, reject) {
        var u;
        try {
          u = new URL(url);
        } catch (e) {
          return reject(fail("download", "adres geçersiz: " + url));
        }
        if (u.protocol !== "https:" || ALLOWED_HOSTS.indexOf(u.hostname) < 0) return reject(fail("download", "izin verilmeyen adres: " + u.protocol + "//" + u.hostname));
        var req = deps.https.get(url, { headers: { "User-Agent": "SpreadHelper-updater", "Cache-Control": "no-cache" } }, function (res) {
          var code = res.statusCode;
          if (code >= 300 && code < 400 && res.headers.location) {
            res.resume();
            if (hops >= 3) return reject(fail("download", "çok fazla yönlendirme"));
            return resolve(get(new URL(res.headers.location, url).toString(), maxBytes, hops + 1));
          }
          if (code !== 200) {
            res.resume();
            return reject(fail("download", "HTTP " + code + " — " + url));
          }
          var chunks = [];
          var size = 0;
          res.on("data", function (c) {
            size += c.length;
            if (size > maxBytes) {
              req.destroy();
              reject(fail("download", "dosya beklenenden büyük (" + size + " bayt)"));
            } else chunks.push(c);
          });
          res.on("end", function () {
            resolve(Buffer.concat(chunks));
          });
          res.on("error", function (e) {
            reject(fail("download", "indirme kesildi: " + e.message));
          });
        });
        req.setTimeout(60000, function () {
          req.destroy(fail("download", "60 sn içinde yanıt yok"));
        });
        req.on("error", function (e) {
          reject(e && e.stage ? e : fail("download", "bağlantı hatası: " + ((e && e.message) || e)));
        });
      });
    }

    function latest() {
      return get(LATEST_URL + "?t=" + Date.now(), MAX_JSON, 0).then(function (b) {
        var o;
        try {
          o = JSON.parse(b.toString("utf8"));
        } catch (e) {
          throw fail("latest", "latest.json JSON değil");
        }
        return validateLatest(o);
      });
    }

    function sha256(buf) {
      return deps.crypto.createHash("sha256").update(buf).digest("hex");
    }

    function listFiles(dir, base) {
      var out = [];
      deps.fs.readdirSync(dir).forEach(function (n) {
        var p = deps.path.join(dir, n);
        var rel = base ? base + "/" + n : n;
        if (deps.fs.statSync(p).isDirectory()) out = out.concat(listFiles(p, rel));
        else out.push(rel);
      });
      return out;
    }
    function writeFile(root, rel, data) {
      var p = deps.path.join.apply(null, [root].concat(rel.split("/")));
      deps.fs.mkdirSync(deps.path.dirname(p), { recursive: true });
      deps.fs.writeFileSync(p, data);
    }
    /** Önce yanına ".new", sonra üstüne taşı (fs.rename Windows'ta var olanın yerine geçer; yarım yazılmış dosya kalmaz). */
    function replaceFile(root, rel, data) {
      var p = deps.path.join.apply(null, [root].concat(rel.split("/")));
      deps.fs.mkdirSync(deps.path.dirname(p), { recursive: true });
      deps.fs.writeFileSync(p + ".new", data);
      deps.fs.renameSync(p + ".new", p);
    }

    /** Yardımcı klasörünü yedekler, yeni dosyaları yazar; yarıda kalırsa yedeği geri yükler. */
    function installHelper(by, version) {
      var ext = deps.extDir;
      if (!ext || deps.path.basename(ext) !== EXT_DIR_NAME) throw fail("helper", "eklenti klasörü beklenen yerde değil: " + ext);
      var old = listFiles(ext, "");
      var backup = deps.path.join(deps.dataDir, "yedek", "helper-" + new Date().toISOString().replace(/[:.]/g, "-"));
      old.forEach(function (rel) {
        writeFile(backup, rel, deps.fs.readFileSync(deps.path.join.apply(null, [ext].concat(rel.split("/")))));
      });
      var copied = listFiles(backup, "");
      if (copied.length !== old.length) throw fail("helper", "yedek eksik (" + copied.length + "/" + old.length + ") — hiçbir şey yazılmadı");
      ulog("yardımcı yedeklendi (" + old.length + " dosya): " + backup);
      var names = Object.keys(by).filter(function (n) {
        return n.indexOf("SpreadHelper/") === 0;
      });
      var written = [];
      var touched = []; // yazılmaya BAŞLANAN her dosya (yarıda kalan dahil) — geri yüklemede .new'leri de temizlenir
      try {
        names.forEach(function (n) {
          var rel = n.slice("SpreadHelper/".length);
          touched.push(rel);
          if (deps.faultAfter !== undefined && written.length >= deps.faultAfter) throw new Error("sınama: yazma hatası");
          replaceFile(ext, rel, by[n]);
          written.push(rel);
        });
      } catch (e) {
        ulog("yardımcı yazılamadı (" + e.message + ") — yedek geri yükleniyor");
        var bad = restore(ext, backup, old, touched);
        if (bad.length) throw fail("helper", "yardımcı dosyaları yazılamadı: " + e.message + " — geri yükleme EKSİK (" + bad.join(", ") + "); yedek: " + backup);
        throw fail("helper", "yardımcı dosyaları yazılamadı: " + e.message + " — eski sürüm geri yüklendi");
      }
      ulog("yardımcı " + version + " yazıldı (" + written.length + " dosya)");
      pruneBackups(3);
      return { backup: backup, files: written.length, old: old, written: written };
    }

    /** En yeni `keep` yedek kalır (adlar zaman damgalı → alfabetik sıra = zaman sırası). */
    function pruneBackups(keep) {
      try {
        var root = deps.path.join(deps.dataDir, "yedek");
        var dirs = deps.fs.readdirSync(root).filter(function (n) {
          return /^helper-/.test(n);
        });
        dirs.sort();
        dirs.slice(0, Math.max(0, dirs.length - keep)).forEach(function (n) {
          deps.fs.rmSync(deps.path.join(root, n), { recursive: true, force: true });
          ulog("eski yedek silindi: " + n);
        });
      } catch (e) {
        /* temizlenemezse sorun değil */
      }
    }

    /** Yedeği geri yazar; her dosya ayrı denenir (biri düşse de diğerleri yazılır). @returns geri yüklenemeyen dosyalar */
    function restore(ext, backup, old, written) {
      var bad = [];
      old.forEach(function (rel) {
        try {
          writeFile(ext, rel, deps.fs.readFileSync(deps.path.join.apply(null, [backup].concat(rel.split("/")))));
        } catch (e) {
          bad.push(rel);
        }
      });
      written
        .filter(function (rel) {
          return old.indexOf(rel) < 0;
        })
        .concat(
          written.map(function (rel) {
            return rel + ".new";
          })
        )
        .forEach(function (rel) {
          try {
            deps.fs.unlinkSync(deps.path.join.apply(null, [ext].concat(rel.split("/"))));
          } catch (e) {
            /* yoksa geç */
          }
        });
      ulog(bad.length ? "yedek geri yüklenirken " + bad.length + " dosya yazılamadı: " + bad.join(", ") + " (yedek: " + backup + ")" : "yedek geri yüklendi: " + backup);
      return bad;
    }

    /** KUR.cmd'deki sıra: %CommonProgramW6432%, %CommonProgramFiles%, C:\Program Files\Common Files (sınama: deps.upiaCandidates). */
    function findUpia() {
      var env = deps.env || {};
      var cands = deps.upiaCandidates || [env.CommonProgramW6432, env.CommonProgramFiles, "C:\\Program Files\\Common Files"].filter(Boolean).map(function (c) {
        return c + "\\" + UPIA_REL;
      });
      for (var i = 0; i < cands.length; i++) {
        var p = cands[i];
        try {
          if (deps.fs.statSync(p).isFile()) return p;
        } catch (e) {
          /* sonraki aday */
        }
      }
      return null;
    }

    /** UPIA'yı çalıştırır, çıktısını toplar. Hata fırlatmaz: { code, out } (başlatılamadı / zaman aşımı → code null). */
    function runUpia(upia, args, ms) {
      return new Promise(function (resolve) {
        var out = "";
        var cp;
        try {
          cp = deps.childProcess.spawn(upia, args, { windowsHide: true });
        } catch (e) {
          return resolve({ code: null, out: "başlatılamadı: " + e.message });
        }
        var t = setTimeout(function () {
          try {
            cp.kill();
          } catch (e) {
            /* geç */
          }
          resolve({ code: null, out: out + " (" + ms / 1000 + " sn içinde bitmedi)" });
        }, ms);
        var collect = function (d) {
          out += String(d);
          if (out.length > 8000) out = out.slice(-8000);
        };
        if (cp.stdout) cp.stdout.on("data", collect);
        if (cp.stderr) cp.stderr.on("data", collect);
        cp.on("error", function (e) {
          clearTimeout(t);
          resolve({ code: null, out: "hata: " + e.message });
        });
        cp.on("close", function (code) {
          clearTimeout(t);
          resolve({ code: code, out: out });
        });
      });
    }

    /**
     * spread.ccx → UnifiedPluginInstallerAgent /install (KUR.cmd ile aynı yol ve bayrak; Adobe belgesi: /install /remove /list).
     * Çıkış kodu belgesiz ve güvenilmez (topluluk: hep 0) → kurulum "/list all" çıktısında "Spread" ve yeni sürüm AYNI satırda
     * görülürse sayılır. Görülmezse .ccx Creative Cloud'la açılır (Adobe: .ccx'e çift tıklamak Install penceresini açar) ve
     * kullanıcıya "Install'a bas" denir. Önceki sürüm otomatik kaldırılmaz.
     */
    function installCcx(ccx, version) {
      var dir = deps.path.join(deps.dataDir, "indirilen");
      deps.fs.mkdirSync(dir, { recursive: true });
      var file = deps.path.join(dir, "spread-" + version + ".ccx");
      // önceki güncellemelerin .ccx'leri silinir (yalnız bu sürümünki kalır)
      try {
        deps.fs.readdirSync(dir).forEach(function (n) {
          if (/^spread-.*\.ccx$/.test(n) && n !== "spread-" + version + ".ccx") deps.fs.unlinkSync(deps.path.join(dir, n));
        });
      } catch (e) {
        /* geç */
      }
      deps.fs.writeFileSync(file, ccx);
      var upia = findUpia();
      var openCcx = function (why) {
        ulog("panel Adobe kurucusuyla kurulamadı (" + why + ") — spread.ccx Creative Cloud'la açılıyor: " + file);
        try {
          var cp = deps.childProcess.spawn((deps.env && deps.env.ComSpec) || "cmd.exe", ["/d", "/c", 'start "" "%SPREAD_CCX%"'], {
            stdio: "ignore",
            windowsHide: true,
            windowsVerbatimArguments: true,
            env: Object.assign({}, deps.env || {}, { SPREAD_CCX: file }),
          });
          if (cp && cp.on)
            cp.on("error", function (e) {
              ulog(".ccx açılamadı: " + e.message);
            });
          if (cp && cp.unref) cp.unref();
        } catch (e) {
          ulog(".ccx açılamadı: " + e.message);
        }
        return { panel: "manual", ccx: file, why: why };
      };
      if (!upia) return Promise.resolve(openCcx("UnifiedPluginInstallerAgent bulunamadı"));
      ulog("panel kuruluyor: \"" + upia + "\" /install \"" + file + "\"");
      return runUpia(upia, ["/install", file], 5 * 60 * 1000).then(function (r1) {
        ulog("UPIA /install çıkış kodu " + r1.code + (r1.out.trim() ? " — " + r1.out.trim().replace(/\s+/g, " ").slice(0, 400) : ""));
        return runUpia(upia, ["/list", "all"], 60 * 1000).then(function (r2) {
          var row = String(r2.out)
            .split(/\r?\n/)
            .filter(function (l) {
              return /Spread/.test(l) && !/Spread Helper/.test(l) && l.indexOf(version) >= 0;
            })[0];
          ulog("UPIA /list all: " + (row ? "doğrulandı — " + row.trim().replace(/\s+/g, " ") : "\"Spread " + version + "\" satırı YOK"));
          return row ? { panel: "installed" } : openCcx("kurulum doğrulanamadı: /install kodu " + r1.code + ", /list all'da Spread " + version + " yok");
        });
      });
    }

    /**
     * Güncelle: latest.json (yeniden, sabit adresten) → sürüm isteğe uyuyor mu → indir → sha256 → zip → paket denetimi →
     * yardımcı (yedekli) → panel (UPIA). sha256 / zip / paket denetimi düşerse HİÇBİR ŞEYE dokunulmaz.
     */
    function update(expected, current, panel) {
      if (busy) return Promise.reject(fail("busy", "bir güncelleme zaten sürüyor"));
      busy = true;
      panel = panel || current;
      ulog("başladı: istenen " + expected + ", yüklü yardımcı " + current + ", panel " + panel);
      var info;
      return latest()
        .then(function (l) {
          info = l;
          if (l.version !== expected) throw fail("latest", "yayındaki sürüm " + l.version + " (istenen " + expected + ") — panel yeniden denetlesin");
          // yardımcı ya da panel eskiyse güncellenir (ör. panel önceki güncellemede elle kurulmamış kaldıysa)
          if (cmpVersion(l.version, current) <= 0 && cmpVersion(l.version, panel) <= 0)
            throw fail("latest", "yüklü sürümler (yardımcı " + current + ", panel " + panel + ") zaten " + l.version + " ya da yeni");
          ulog("indiriliyor: " + l.zip_url);
          return get(l.zip_url, MAX_ZIP, 0);
        })
        .then(function (zip) {
          var got = sha256(zip);
          if (got !== info.sha256) throw fail("sha256", "sha256 tutmuyor (beklenen " + info.sha256 + ", inen " + got + ") — hiçbir şey değişmedi");
          ulog("sha256 doğru (" + zip.length + " bayt)");
          var by = checkKit(readZip(deps.zlib, zip), info.version);
          checkCcx(deps.zlib, by["spread.ccx"], info.version);
          ulog("paket denetimi tamam");
          var h = installHelper(by, info.version);
          return installCcx(by["spread.ccx"], info.version).then(function (c) {
            var r = { ok: true, version: info.version, helper: "installed", backup: h.backup, panel: c.panel };
            if (c.ccx) r.ccx = c.ccx;
            if (c.why) r.why = c.why;
            ulog("bitti: yardımcı kuruldu, panel " + (c.panel === "installed" ? "kuruldu" : "ELLE kurulacak (Install)"));
            return r;
          });
        })
        .then(
          function (r) {
            busy = false;
            return r;
          },
          function (e) {
            busy = false;
            ulog("DURDU (" + (e.stage || "?") + "): " + e.message);
            throw e;
          }
        );
    }

    function mtimeMs(p) {
      try {
        return deps.fs.statSync(p).mtime.getTime();
      } catch (e) {
        return null;
      }
    }

    /**
     * Yeniden başlatmaya hazırlık: açık projelerin hepsi kaydedilir ve dosyaları gerçekten yazılmış mı (değişme zamanı ileri gitti)
     * denetlenir; biri bile doğrulanamazsa hata (Premiere KAPATILMAZ). Sonra yeniden başlatıcı bağımsız süreç olarak başlar.
     * Kapatma (app.quit) ayrı: quit().
     */
    function prepareRestart() {
      if (busy) return Promise.reject(fail("busy", "bir güncelleme sürüyor; bitince yeniden başlat"));
      if (platform !== "win32") return Promise.reject(fail("restart", "yeniden başlatma yalnız Windows'ta"));
      if (!deps.hostApp) return Promise.reject(fail("restart", "Premiere'in yolu okunamadı"));
      var before = {};
      return deps
        .jsx("spreadHelper_projects()", 20000)
        .then(function (r) {
          if (!r || r.ok !== true || !Array.isArray(r.projects)) throw fail("save", (r && r.error) || "açık projeler okunamadı");
          if (!r.projects.length) throw fail("save", "açık proje yok");
          r.projects.forEach(function (p) {
            if (!p.path) throw fail("save", "\"" + p.name + "\" projesi hiç kaydedilmemiş — önce Ctrl+S ile bir yere kaydet");
            before[p.path] = mtimeMs(p.path);
          });
          return deps.jsx("spreadHelper_saveProjects()", 120000);
        })
        .then(function (r) {
          if (!r || r.ok !== true || !Array.isArray(r.saved)) throw fail("save", (r && r.error) || "projeler kaydedilemedi");
          var paths = Object.keys(before);
          paths.forEach(function (p) {
            var t = mtimeMs(p);
            if (t === null || before[p] === null || !(t > before[p])) throw fail("save", "\"" + p + "\" kaydedildiği doğrulanamadı (dosya değişmedi) — Premiere kapatılmadı");
          });
          ulog("kaydedildi ve doğrulandı: " + paths.join(" · "));
          // CEP getSystemPath Windows'ta "C:/…" verir → ters bölüye çevrilir (cmd'nin "start" / "if exist"i için)
          var exe = deps.path.win32.normalize(deps.hostApp);
          var img = deps.path.win32.basename(exe);
          var cmd = deps.path.join(deps.dataDir, "restart-spread.cmd");
          deps.fs.writeFileSync(cmd, RESTART_CMD);
          var proj = r.active || paths[0] || "";
          proj = proj ? deps.path.win32.normalize(proj) : "";
          ulog("yeniden başlatıcı: \"" + exe + "\" (" + img + ") → " + (proj || "(proje yok)"));
          var sp = restarterSpawnArgs((deps.env && deps.env.ComSpec) || "cmd.exe", cmd, { SPREAD_IMG: img, SPREAD_EXE: exe, SPREAD_PRJ: proj, SPREAD_LOG: logFile, SPREAD_MAX: "300" }, deps.env);
          // başlatıcı GERÇEKTEN başlamadan Premiere kapatılmaz: 'spawn' (Node 15.1+) gelmeli; 'error' ya da 5 sn → DUR
          return new Promise(function (resolve, reject) {
            var cp;
            try {
              cp = deps.childProcess.spawn(sp.cmd, sp.args, sp.opts);
            } catch (e) {
              return reject(fail("restart", "yeniden başlatıcı başlatılamadı: " + e.message + " — Premiere kapatılmadı"));
            }
            var done = false;
            var t = setTimeout(function () {
              if (done) return;
              done = true;
              reject(fail("restart", "yeniden başlatıcı 5 sn içinde başlamadı — Premiere kapatılmadı"));
            }, 5000);
            cp.on("error", function (e) {
              ulog("yeniden başlatıcı hatası: " + e.message);
              if (done) return;
              done = true;
              clearTimeout(t);
              reject(fail("restart", "yeniden başlatıcı başlatılamadı: " + e.message + " — Premiere kapatılmadı"));
            });
            cp.on("spawn", function () {
              if (done) return;
              done = true;
              clearTimeout(t);
              if (cp.unref) cp.unref();
              resolve({ ok: true, project: proj, image: img });
            });
          });
        });
    }

    function quit() {
      ulog("Premiere kapatılıyor (app.quit)");
      return deps.jsx("spreadHelper_quit()", 10000).catch(function (e) {
        ulog("app.quit yanıtı: " + e.message);
      });
    }

    function readLog(max) {
      try {
        var t = deps.fs.readFileSync(logFile, "utf8").split("\n");
        return t.slice(-(max || 200)).join("\n");
      } catch (e) {
        return "";
      }
    }

    return {
      latest: latest,
      update: update,
      prepareRestart: prepareRestart,
      quit: quit,
      readLog: readLog,
      logFile: logFile,
      isBusy: function () {
        return busy;
      },
    };
  }

  var api = {
    createUpdater: createUpdater,
    cmpVersion: cmpVersion,
    validateLatest: validateLatest,
    readZip: readZip,
    checkKit: checkKit,
    checkCcx: checkCcx,
    crc32: crc32,
    LATEST_URL: LATEST_URL,
    ZIP_PREFIX: ZIP_PREFIX,
    UPDATE_REPO: UPDATE_REPO,
    RESTART_CMD: RESTART_CMD,
    restarterSpawnArgs: restarterSpawnArgs,
    KIT_FILES: KIT_FILES,
    EXT_DIR_NAME: EXT_DIR_NAME,
  };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.SpreadUpdater = api;
})();
