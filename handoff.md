# handoff — Spread (ADIM 3: TOPLA + BAĞLA, v0.3.0) + geçmiş (ADIM 2 SPREAD, ADIM 1 Probe)

## Durum (tek bakışta)

| | |
|---|---|
| Sürüm | **Spread v0.3.0** (`com.badideagency.spread`, `release/spread.ccx`) + **Spread Helper v0.3.0** (görünmez CEP, `com.badideagency.spread.helper`, `release/spread-helper.zxp`) |
| Yapılan | **TOPLA** (yalnız dikey: cihaz → V, kanal → A, kılavuz sesler altta), **BAĞLA** (grup → çapa → harici sesi çapaya göre kes → kılavuz + kapalı kanal sil → yardımcıyla bağla), **kanal ayarı** (localStorage), **yardımcı göstergesi**, durum raporuna sınıflama/gruplar |
| Yardımcı paketi | **İMZALI**: Adobe `ZXPSignCmd` 4.1.3 x64 (CEP-Resources) Linux'ta **Wine** ile çalıştırıldı → self-signed `.p12` (10 yıl) → `ZXPSignCmd -verify`: "Signature verified successfully". Zaman damgası YOK (TSA'ya ulaşılamadı). Yedek: `release/spread-helper-klasor.zip` (aynı imzalı içerik açılmış + `KUR.cmd` + `PlayerDebugMode_CSXS12.reg` + BENIOKU). |
| Probe / SPREAD | Probe dosyaları ve `release/spread-probe.ccx` değişmedi. SPREAD davranışı aynı; güvenlik kodu `guard.ts`'e taşındı (18 eski senaryo aynen geçiyor). |
| Bulutta doğrulanan | `tsc --strict`, Adobe eslint, d.ts (74) + uxp.d.ts (5) satır kontrolü, host.jsx ES3 + belge kontrolü (19 DOM üyesi), Probe smoke, **Spread smoke 35 senaryo** (panel → HTTP → **gerçek** yardımcı sunucusu → **gerçek** host.jsx → sahte Premiere DOM), bağımsız alt ajan incelemesi |
| Doğrulanamayan | Gerçek Premiere'de: set In/Out/Start/End ile GERÇEK kırpma, negatif clone ofsetleri, ExtendScript `linkSelection` ile 2 video + sesler, `getLinkedItems` anlamı, UXP ağ izninin 127.0.0.1'e izin vermesi, CEP 12'nin kendinden imzalı yardımcıyı yüklemesi |
| Eksik girdi | Kullanıcının **gerçek senkron sonucu durum raporu** bu turda gelmedi (mesajda yer tutucu kaldı). Mock'ta onun yerine adları/sayıları gerçek düzenden alınmış **sentetik** bir senkron sonucu var (`sync`). Rapor gelince `spread/dev/fixtures/senkron-raporu.txt`'e koy → `node spread/dev/smoke.cjs report` (okuyucu hazır ve `reportparse` ile sınandı). |
| Dal | `claude/sweet-bell-do4j75` |

## KANITLANMIŞ (kullanıcı, gerçek Premiere 26.x, ADIM 2 sonrası)

- **SPREAD v0.2.0 gerçek projede çalıştı** ve ardından **Clip > Synchronize, panelin programla yaptığı seçimle DOĞRUDAN çalıştı**:
  Premiere komutları, timeline'da **görünmeyen programatik seçimi** kullanıyor (Probe T5'te "seçim görünmüyor" diye FAIL sayılan
  davranış işlevsel olarak doğru). → Menü komutlarını tetiklemeden önce `getSelection + addItem + setSelection` yeterli.
- (Dolaylı) SPREAD'in kullandığı yollar gerçek Premiere'de işledi: TX-A (park ofsetli clone ile ardışık track açma), TX-B (clone +
  remove(ripple=false) + overwrite aynı transaction'da), yedek sequence.

## Kullanıcının kararları (DEĞİŞTİRME)

- Senkronu Premiere yapar. Elle adım YOK; tek istisna TOPLA ile BAĞLA arasında gözle kontrol.
- Bağlama: UXP'de link API'si yok → görünmez CEP yardımcısı ExtendScript `sequence.linkSelection()` çalıştırır; kullanıcı yalnız BAĞLA'ya basar.
- Hedef: V1 A kamera (`A038C0xx_*.MP4`), V2 B kamera (`C01xx.MP4`) — cihaz = dosya adı öneki, toplam süresi uzun cihaz V1;
  A1 Tr1, A2 Tr2 (A3 Tr3…); kamera kılavuz sesleri YOK (BAĞLA siler); her grup (aynı anda çeken kameralar + o aralıktaki harici ses
  parçaları) TEK bağ; gruplar senkronun bıraktığı zamanda, YATAY KAYDIRMA YOK, gruplar arası boşluk kapatılmaz.

## TOPLA tasarımı (`spread/src/classify.ts`, `collect.ts`, `topla.ts`)

**Sınıflama** (dosya adı = proje öğesi adı):
- KAMERA = video + video uzantısı + ayar katmanı değil; **cihaz** = ilk rakamdan önceki kısım (`A038C001_…` → `A`, `C0112` → `C`, `DJI_0001` → `DJI`).
  Neden harf öneki: aynı kameranın farklı kartları (A038/A039) aynı track'e düşsün; çakışırsa zaten DURUR.
- KILAVUZ = ses, kaynağı timeline'daki bir kamera videosuyla aynı. HARİCİ = ses uzantısı; **kanal** = `_Tr…` son eki (`Tr1`, `TrLR`), yoksa `(eksiz)`.
- BİLİNMEYEN (grafik/metin/renk/ayar katmanı, videosu olmayan kamera sesi, okunamayan) → **dokunulmaz**.

**Hedef:** cihazlar toplam süreye göre V1, V2…; tutulan kanallar (Tr sayısal → alfabetik → eksiz) A1…, kapatılanlar onların altında;
kılavuz sesler cihaz sırasıyla (cihaz başına kanal sayısı kadar track) en altta.
**Çakışma = HATA:** son düzende aynı track'te zamanda çakışan iki klip (ör. senkron iki ilgisiz çekimi bindirmiş) ya da hedefte bir
bilinmeyen öğe → TOPLA BAŞLAMAZ, çakışmalar tek tek (track, klipler, süre, olası neden) raporlanır. Sessizce başka track'e konmaz.

**Taşıma (seçilen yol + neden):** iki transaction, ikisi de kanıtlı kalıp (clone + remove(ripple=false) aynı transaction'da):
1. `TOPLA: park` — taşınacak her klip AYNI track'te `+P` (P = max(sequence sonu, en büyük klip sonu) + 10 sn) → asıllar silinir.
2. `TOPLA: yerleştir` — park kopyaları `−P` zaman + dikey ofsetle hedefe → park kopyaları silinir.
Neden doğrudan değil: hedef yerlerin çoğunda henüz taşınmamış bir asıl var (Spread sonrası A1..A22'de kılavuz sesler, Tr1 A1'e
gelecek); bir kopyanın aynı transaction'da silinecek bir asılın üstüne yazılması KANITLANMADI (SPREAD planı da bunu yasaklar).
Park bölgesi hiçbir klibe değmez; park kopyaları birbirine değmez (aynı track'teki asıllar zaten çakışmaz).
**Bağlı çift kuralı:** kamera videosu ile aynı yerdeki kılavuz ses(ler)inden biri taşınıyorsa hepsi taşınır (silme seçiminde bağlı
çiftin yalnız yarısı olmasın — bağlı partnerin de silinip silinmediği kanıtlanmadı). Sonuç: taşınan kameralar kılavuz seslerinden
**ayrı** düşer (clone tek öğe kopyalar); BAĞLA zaten kılavuzları silip yeniden bağlar. Onay metni bunu söyler.
Track gerekirse SPREAD'deki TX-A (kanıtlı) aynen (`guard.prepareTracks`). Ctrl+Z: 2 (+1 track hazırlığı).
**Doğrulama:** her transaction sonrası BEKLENEN klip kümesiyle (tür, track, start, end, in, out, hız, kaynak) birebir karşılaştırma
(`layout.compareLayout`) + son düzende track başına çakışma yok. Tutmazsa DUR + Ctrl+Z sayısı + yedek adı.
**Bitiş:** "Kontrol et, sonra BAĞLA'ya bas."

## BAĞLA tasarımı (`spread/src/bind.ts`, `bagla.ts`)

1. **Önce ping** — yardımcı yoksa HİÇBİR ŞEYE dokunmadan (yedek dahil) DUR + kurulum talimatı.
2. **Grup** = zamanda çakışan kamera klipleri (aralık grafiğinin bağlı bileşenleri; bitiş=başlangıç çakışma değil). Harici sesler grup tanımına katılmaz.
3. **Çapa** = gruptaki en uzun kamera klibi (eşitlikte alt V track, sonra erken start).
4. **Parça** = WAV ∩ çapa; `in = WAV.in + (parça.start − WAV.start)`, `out = in + süre`. Çapa dışı ses SİLİNİR; tamamen tek çapanın
   içindeki ses kesilmez. Kesilecek WAV'da hız ≠ 1 ya da `end−start ≠ out−in` → plan hatası.
5. **Silme:** tüm kılavuz sesler + kanal ayarında kapatılmış kanallar + çapa dışı sesler.
6. **Kesme yolu (seçilen: UXP; neden aşağıda)** — hepsi aynı track'te:
   - `BAĞLA: kesim hazırlığı` — her parça için WAV'ın tam boy kopyası sequence sonunun ötesindeki bir **park yuvasına** (clone, +ofset;
     yuvalar arası ≥ WAV boyu + 1 sn) + silinecekler ve kesilecek asıllar tek seçimle silinir.
   - `BAĞLA: ilk parça` — **ÖLÇÜM**: yalnız zamanda ilk parçanın park kopyası kırpılır (set **End → Start → In → Out**). Tutmazsa
     "İLK PARÇA TUTMADI" + beklenen/okunan tick farkları → DUR (Ctrl+Z × 2).
   - `BAĞLA: parçalar` — kalanlar kırpılır. `BAĞLA: yerleştir` — kırpılmış park kopyaları `−(yuva − WAV.start)` ofsetle asıl yerlerine,
     park kopyaları silinir.
   Neden park: set action'lar klibi zamanda TAŞIMAK zorunda kalmasın (yalnız kenar kırpma); taşıma kanıtlı clone ofsetiyle.
   Neden End → Start → In → Out: "kenar kırpma" (mock varsayılanı) ve "start klibi taşır" anlamlarının İKİSİNDE de doğru sonuca
   varır (ikisi de mock'ta sınanıyor: `sync`/`setmove`); End önce → ara durumda sağa taşma en az.
   **Yedek plan (YAZILMADI):** CEP yardımcısında QE DOM razor — `app.enableQE(); qe.project.getActiveSequence().getAudioTrackAt(i).razor(timecode)`
   (belgesiz; Adobe örneklerinde yok; pymiere belgesi `getVideoTrackAt(0).razor(timecode)`, timecode `Time.getFormatted(...)` ile;
   bir 3. taraf 26.3'te QE yapısal düzenlemelerinin sessizce yok sayıldığını bildiriyor). YALNIZ UXP yolu gerçek Premiere'de ilk
   parçada ölçülerek başarısız olursa yazılacak (kullanıcı kararı).
7. **Doğrulama:** her transaction sonrası beklenen kümeyle birebir; sonda ek olarak: her tutulan kanalın her çapa içindeki ses süresi
   öncekiyle aynı (hiçbir çapa içinde boşluk yok), her harici klipte `in − start` kaynağıyla aynı (kaynak kayması yok), çapa dışına
   taşan ses / kılavuz / kapalı kanal kalmadı, track'lerde çakışma yok.
8. **Bağlama** (en son): tekrar ping → `linkTargets` (grubun kameraları + çapasındaki parçalar, değerler taze okumadan) → yardımcı →
   grup başına sonuç (bulundu / bağlandı / doğrulandı). Bağlamadan önce/sonra timeline birebir aynı olmalı.
   Tek öğeli grup atlanır. Kesme/silme yoksa yedek alınmaz (yalnız bağlama) → BAĞLA'yı tekrar basmak güvenli (idempotent).
   Ctrl+Z: kesme varsa 4 (+ yedek sayılmaz). **Bağlamanın geri alma geçmişine kaç kayıt eklediği ÖLÇÜLMEDİ** → mesajlar yedeği önerir.

## CEP yardımcısı (`cep-helper/`)

- **Görünmez CEP eklentisi** (Adobe CEP 12 Cookbook "Invisible HTML Extensions" + CEP 12 görünmez örneği): `Type=Custom`,
  `AutoVisible=false`, `<Menu>` yok; `StartOn`: `com.adobe.csxs.events.ApplicationActivate` (Premiere başlangıçta gönderir — Adobe örneği),
  `applicationActivate` (Cookbook: Premiere'de yalnız macOS), `com.adobe.csxs.events.ApplicationInitialized` (yalnız Audition örneğinde
  görüldü; zararsız). CEF: `--enable-nodejs`, `--mixed-context`. `ScriptPath ./jsx/host.jsx`.
- **CSXS sürümü: 12.0** — Cookbook host tablosu "Premiere Pro 25.0 (CEP 12)"; 26.x için ayrı sütun yok, CEP 13 yok (CEP-Resources
  2026-02); PProPanel ReadMe (Kasım 2025) macOS anahtarını CSXS.12 yaptı. `Host PPRO [25.0,99.9]`, `ExtensionManifest Version="12.0"`
  (CEP 12 örneği gibi). PlayerDebugMode anahtarı: `HKCU\Software\Adobe\CSXS.12`, `PlayerDebugMode` = "1" (string).
  **Risk:** 3. taraf raporları CEP 12'nin bazı kurulumlarda PlayerDebugMode'u yok saydığını söylüyor → bu yüzden paket İMZALI.
- **Sunucu** (`js/helper.js`): Node `http`, yalnız **127.0.0.1:47731** (sabit). Uzak adres 127.0.0.1 değilse / Host başlığı
  `127.0.0.1:47731|localhost:47731` değilse 403; `X-Spread-Token` sabit zamanlı karşılaştırma (yanlış → 401); CORS başlığı YOK
  (tarayıcı sayfası özel başlıklı istek atamaz, dosyayı okuyamaz); yalnız `POST /v1/ping`, `POST /v1/link`; gövde ≤ 1 MB; şema
  doğrulaması (id, kind V/A, track 0..999, tick dizesi, ad ≤ 1024); ExtendScript'e yalnız host.jsx'teki iki sabit fonksiyon, değerler
  `JSON.stringify` + ASCII dışı `\uXXXX` kaçışıyla **sabit** olarak gömülür (enjeksiyon mock'ta sınandı); ExtendScript çağrıları
  sırayla ve zaman aşımlı (Adobe forumunda 25.6.2'de evalScript'in asılı kaldığı bildirildi). Günlük: `%TEMP%\spread-helper.log`.
- **Token eşleşmesi:** her açılışta 256 bit token → `<ev>\AppData\Roaming\BadIdeaAgency\SpreadHelper\helper.json` (macOS:
  `~/Library/Application Support/BadIdeaAgency/SpreadHelper/helper.json`), izin 600; kapanışta yalnız KENDİ token'ını taşıyorsa silinir.
  Panel aynı yolu `os.homedir()` (uxp.d.ts:L9232) + sabit alt yol ile kurar ve `fs.readFileSync` (L8985) ile okur; olmazsa
  `localFileSystem.getEntryWithUrl("file:…")` (L516). İki taraf da `%APPDATA%`'ya değil ev klasörüne dayanır → yol hep aynı
  (UXP'de %APPDATA% veren belgeli API yok). Bu **manifest'te `localFileSystem: "fullAccess"`** gerektirir (Adobe filesystem tarifi:
  `file:/` keyfi yol = fullAccess). Daha dar seçenek yok: yardımcı UXP'nin `plugin-data:` klasörünün yerini güvenilir biçimde bilemez.
- **host.jsx** (ES3): JSON YOK (Adobe'den Bruce Bullis: JSON yalnız CC Libraries paneli açıkken var) → kendi küçük üreticisi; istek
  sabit literal olarak gelir. Klip bulma (tip, track, start ticks, end ticks, kaynak adı), tek eşleşme şart (birden çok aday → bağlanmaz).
  Seçim temizleme: ExtendScript'te toplu temizleme yok → `getSelection()` öğelerine `setSelected(false, true)`. Belge çelişkileri:
  Collection "ilk nesne index 1" ↔ PProPanel `clips[0]` → 0..n taranır, `nodeId` ile tekilleştirilir; `setSelected` belge "Integer",
  Adobe örneği/tip tanımı boolean → örnek izlendi. `getLinkedItems()` **kılavuzda yok** (PProPanel tip tanımı L1253; örnek sonucu
  "aynı kaynaktan klipler" diye adlandırıyor) → bağlamadan ÖNCE ve SONRA okunur: değişmediyse doğrulama **null** ("doğrulanamadı"),
  uydurulmaz. Her grup: temizle → seç → say → `linkSelection()` → temizle → taze bul → doğrula.
- **Paketleme** (`scripts/package-helper.sh`): Adobe ZXPSignCmd (Linux sürümü YOK → Wine; `ZXPSIGNCMD=…exe`), self-signed sertifika
  `.signing/` altında (git'e girmez; her temiz kurulumda yeni sertifika), `-verify` "Signature verified successfully" şartı.
  Kurulum: aescripts ZXP/UXP Installer (UPIA kullanır) ya da `UnifiedPluginInstallerAgent.exe /install <zxp>` ya da `KUR.cmd`
  (imzalı klasörü `%APPDATA%\Adobe\CEP\extensions`'a kopyalar, kayıt defterine dokunmaz).

### ExtendScript belge tablosu (her çağrı host.jsx'te `// docs:` ile; `npm run check:jsx` doğrular)

| Üye | Kaynak (github.com/docsforadobe/premiere-scripting-guide) |
|---|---|
| `app.project` | docs/application/application.md "### app.project" → /application/application/#appproject |
| `app.version` | "### app.version" → /application/application/#appversion |
| `Project.activeSequence` | docs/general/project.md → /general/project/#projectactivesequence |
| `Sequence.name` / `.videoTracks` / `.audioTracks` / `.getSelection()` / `.linkSelection()` | docs/sequence/sequence.md → #sequencename, #sequencevideotracks, #sequenceaudiotracks, #sequencegetselection, #sequencelinkselection ("Returns a boolean; true if successful") |
| `TrackCollection.numTracks` | docs/collection/trackcollection.md → #trackcollectionnumtracks |
| `Track.clips` | docs/sequence/track.md → #trackclips |
| `TrackItemCollection.numItems`, Collection `length` | docs/collection/trackitemcollection.md, collection.md |
| `TrackItem.start` / `.end` / `.projectItem` / `.nodeId` / `.setSelected()` | docs/item/trackitem.md |
| `Time.ticks` | docs/other/time.md → #timeticks (String) |
| `ProjectItem.name` | docs/item/projectitem.md → #projectitemname |
| `TrackItem.getLinkedItems()` | **kılavuzda yok** → Adobe-CEP/Samples PProPanel/jsx/PremierePro.23.0.d.ts#L1253 |

### Yeni UXP (Premiere dışı) çağrılar — `uxp.d.ts` = `@adobe/cc-ext-uxp-types/uxp/index.d.ts`

| satır | üye | nerede |
|---|---|---|
| L9198 | `OS.platform` | linker.ts (token yolu) |
| L9232 | `OS.homedir` | linker.ts |
| L8985 | `fs.readFileSync` | linker.ts |
| L516 | `FileSystemProvider.getEntryWithUrl` | linker.ts (yedek okuma) |
| L345 | `File.read` | linker.ts |
| — | `fetch` (global) | linker.ts → yalnız `http://127.0.0.1:47731` |
| — | `window.localStorage` | settings.ts (try/catch) |

**Manifest izinleri** (`spread/public/manifest.json`): `localFileSystem: "fullAccess"` (token dosyası), `network.domains:
["http://127.0.0.1", "http://127.0.0.1:47731"]`. **Risk:** Adobe'nin Premiere belgesi port/localhost biçimini tanımlamıyor; Photoshop'ta
açık bir hata kaydı (uxp-photoshop#321) bu biçimlerin "Permission denied" verdiğini söylüyor; Adobe'nin kendi Premiere örneği
(oauth-workflow-sample) `http://localhost:8000` için `"domains": "all"` kullanıyor. Kullanıcı "localhost izni" istediği için dar biçim
seçildi. Panel "Permission denied" gösterirse düzeltme tek satır: `"domains": "all"` (kod yine yalnız 127.0.0.1'e bağlanır).
macOS'ta Premiere `http://`'yi engelliyor (Adobe ağ tarifi) — kullanıcı Windows'ta.

## Bağlama modülü ve risk notu

- Bağlama **tek modülde** izole: `spread/src/linker.ts` (`Linker` arayüzü: `ping()`, `link(sequenceName, groups)`, `installHint()`).
  BAĞLA yalnız bu arayüzü görür. Başka bir yol (FCP XML dışa/içe aktarma ya da ileride çıkacak bir UXP link API'si) geldiğinde
  yalnız bu dosya (+ `cep-helper/`) değişir.
- **CEP/ExtendScript emekliye ayrılıyor.** Premiere Scripting Guide ana sayfası: "As of November 2025, Premiere Pro has moved to
  extensibility based on UXP … ExtendScript-based integrations are still supported, and the plan is for them to remain so, through
  September 2026." PProPanel ReadMe (Kasım 2025): 25.6'dan itibaren CEP'in yerini UXP aldı, "support both CEP and UXP for a calendar
  year". (Doğrulanamayan, yalnız arama özeti: Adobe'nin Eylül 2026 blog yazısı daha uzun bir takvim veriyor — yeni CEP gönderimleri
  Aralık 2027'de kapanır, CEP Aralık 2028'de varsayılan kapalı, Aralık 2029'dan itibaren yeni sürümlerde yok.) → Bir Premiere
  güncellemesi yardımcıyı her an çalışmaz hâle getirebilir: panel bunu "Yardımcı: bağlı değil" olarak gösterir ve BAĞLA hiçbir şeye
  dokunmadan durur. Plan: UXP'ye link API'si gelince `linker.ts`'e UXP uygulaması; gelmezse XML yolu.
- ExtendScript API'sine 23.0'dan beri yeni özellik eklenmiyor (Scripting Guide changelog).

## Dosya haritası (yeni / değişen)

```
spread/src/guard.ts     ortak güvenlik: runTx (ölçülü Ctrl+Z sayısı), expectState, makeBackup(op), prepareTracks (TX-A), parkBase, reportStop
spread/src/classify.ts  SAF: kamera/kılavuz/harici/bilinmeyen, cihaz öneki, kanal eki, cihaz sırası (toplam süre)
spread/src/layout.ts    SAF: beklenen ↔ okunan birebir karşılaştırma (tick farklarıyla), track çakışmaları, findExp
spread/src/collect.ts   SAF: TOPLA planı (hedefler, bağlı çift kuralı, çakışma = hata), park/son beklenen düzenler
spread/src/topla.ts     TOPLA akışı: plan → onay → yedek → [TX-A] → park → yerleştir
spread/src/bind.ts      SAF: gruplar, çapa, parçalar, silinecekler, park yuvaları, beklenen düzenler, içerik doğrulaması, bağ hedefleri
spread/src/bagla.ts     BAĞLA akışı: ping → plan → onay → [yedek → kesim hazırlığı → ilk parça → parçalar → yerleştir] → bağla
spread/src/linker.ts    BAĞLAMA MODÜLÜ (tek, izole): Linker arayüzü + CEP yardımcısı istemcisi (token dosyası, 127.0.0.1)
spread/src/settings.ts  "Tutulacak harici kanallar" (localStorage, try/catch) + onay kutuları
spread/src/spread.ts    SPREAD (davranış aynı; güvenlik guard.ts'ten)
spread/src/status.ts    + SINIFLAMA bölümü (cihazlar, kanallar, dokunulmayanlar, gruplar/çapalar), rol etiketi
spread/index.ts, public/index.html  TOPLA / BAĞLA / Yardımcıyı kontrol et / Kanalları tara, yardımcı göstergesi, kanal kutuları
spread/public/manifest.json  0.3.0 + localFileSystem fullAccess + network 127.0.0.1
cep-helper/CSXS/manifest.xml  görünmez CEP 12 eklentisi
cep-helper/js/helper.js       localhost sunucusu (CEP'te kendiliğinden başlar; Node testlerinde createHelper)
cep-helper/jsx/host.jsx       ExtendScript: spreadHelper_ping(), spreadHelper_link(req)
scripts/check-jsx.mjs         host.jsx: ES3 ayrıştırma, yasak yapılar, ASCII dizeler, her DOM üyesine belge adresi (+ kaynaksız üye yakalama)
scripts/check-api-refs.mjs    + uxp.d.ts satır/sınıf kontrolü
scripts/package-helper.sh     imzalı ZXP + yedek klasör paketi;  scripts/helper-kit/  KUR.cmd, .reg, BENIOKU.txt
spread/dev/smoke.cjs          + sahte ExtendScript DOM, gerçek yardımcı sunucusu, TOPLA/BAĞLA senaryoları, durum raporu okuyucu
```

### Komutlar

```bash
npm run check                                          # hepsi (≈3 dk)
node spread/dev/smoke.cjs sync                         # tek senaryo
ZXPSIGNCMD=$PWD/.signing/ZXPSignCmd.exe npm run package:helper   # Linux: apt install wine64; exe CEP-Resources/ZXPSignCMD/4.1.3/x64
npm run package:spread
```

### Mock senaryoları (v0.3.0, `spread/dev/smoke.cjs`) — panel → HTTP → gerçek yardımcı → gerçek host.jsx → sahte DOM

| Senaryo | Ne gösterir |
|---|---|
| `sync` | **Sentetik gerçek senkron sonucu**: 22 kamera (11 çekim × A038C0xx + C01xx, Spread sonrası her biri kendi track'inde, bağlı kılavuz sesleriyle), 12 WAV (4 kayıt × Tr1/Tr2/TrLR, her kayıt birden çok çekimi kapsıyor, kare-altı start, biri in≠0), V1'de "YAĞ SIVISI" grafiği. TOPLA onayı ve düzeni (A→V1, C→V2, Tr1/Tr2/TrLR→A1–A3, kılavuzlar A4–A5, grafik yerinde, 3 transaction, Ctrl+Z 2) → TrLR kapatılır (localStorage) → BAĞLA: 22 parça tick düzeyinde = WAV ∩ çapa, TrLR + 22 kılavuz silindi, 11 grup tek bağ (grup dışı bağ yok), 5 transaction, kameralar değişmedi, Ctrl+Z × 4 → TOPLA sonrası birebir |
| `wav2groups` | bir WAV iki grubu kapsıyor → 2 parça, in = WAV.in + (parça.start − WAV.start), iki grup ayrı bağ |
| `outside` | çapa dışı ses silinir; kısmen dışarıdaki kırpılır; tamamen içerideki olduğu gibi kalır |
| `overlap` | senkron iki ilgisiz çekimi üst üste bindirmiş → TOPLA DURUR, çakışma (V1 + kılavuz A2) raporlanır, hiçbir şey değişmez (yedek bile yok) |
| `graphic` | hedef V1'de sınıflanamayan grafik kamera klibiyle çakışıyor → TOPLA DURUR, grafiğe dokunulmaz |
| `helperoff` | yardımcı kapalı → BAĞLA hiçbir şeye dokunmadan durur (yedek yok, transaction yok), kurulum talimatı, gösterge "bağlı değil" |
| `setnoop` | set action'lar kırpmıyor → "İLK PARÇA TUTMADI" + tick farkları, kalanlara/bağlamaya geçmez, Ctrl+Z × 2 → TOPLA sonrası birebir |
| `setmove` | set anlamı "start klibi taşır" → End→Start→In→Out sırası yine doğru parçalar |
| `linkfail` | bir grubun linkSelection'ı false → hangi grup, neden; kesme yerinde; Ctrl+Z sayısı |
| `linksource` | getLinkedItems bağ yerine aynı kaynaklıları döndürüyor → "doğrulanamadı" (uydurulmaz) |
| `rebind` | ikinci BAĞLA: kesme/silme yok → yedek/transaction yok, yalnız bağlama |
| `again` | ikinci TOPLA → "Zaten toplanmış" |
| `channels` | kanal kutuları sequence'tan (Tr1, Tr2, TrLR); localStorage bozuksa panel çökmez |
| `security` | bilgi dosyası (port, 256 bit token, 600); token yok/yanlış → 401; yabancı Host → 403; GET → 405; bilinmeyen komut → 404; bozuk JSON / şema dışı / >1 MB → 400; CORS başlığı yok; **ad alanına ExtendScript kodu enjeksiyonu çalışmaz**; başka sequence aktifken hiçbir şey yapılmaz; yalnız 127.0.0.1 dinlenir; durunca token dosyası silinir |
| `status2` | durum raporunda cihazlar, kanallar, dokunulmayanlar, gruplar/çapalar |
| `reportparse` | durum raporu → timeline okuyucusu birebir (kullanıcının raporu için hazır) |
| `report` | `spread/dev/fixtures/senkron-raporu.txt` varsa gerçek rapor üzerinde TOPLA + BAĞLA; yoksa atlanır |

Mock'un set In/Out/Start/End anlamı TAHMİNDİR (`M.setSem`: trim / move / noop); ExtendScript DOM'u Adobe örneklerine göre
(0 tabanlı koleksiyonlar, `getSelection()` dizi, `linkSelection()` boolean, `getLinkedItems()` bağ partnerleri — `linksource` diğer anlamı sınar).

### Belirsizlikler (gerçek Premiere'de ilk koşuda ölçülecek)

1. **set In/Out/Start/End gerçek kırpma** — ilk parça ölçümü; tutmazsa QE razor yedek planı.
2. **Negatif clone ofsetleri** (TOPLA `−P` zaman + yukarı dikey; BAĞLA `−(yuva − start)`) ilk kez kullanılıyor — API "offset from the
   original position" diyor; tutmazsa doğrulama yakalar (DUR + Ctrl+Z).
3. **linkSelection** ile 2 video + N ses tek bağ (kullanıcı bunu elle yapıyor → mümkün); aynı track'te iki kamera klibi olan grup (uyarı verilir).
4. **getLinkedItems anlamı** (bağ mı, aynı kaynak mı) → null = "doğrulanamadı" olarak raporlanır.
5. **UXP ağ izni** biçimi (127.0.0.1 + port) — "Permission denied" → `"domains": "all"`.
6. **CEP 12 + self-signed** yükleme; olmazsa PlayerDebugMode .reg; o da olmazsa `%TEMP%\spread-helper.log`.
7. **ExtendScript koleksiyon indeksi** (belge 1, örnek 0) — iki taban da taranıyor; `videoTracks[i]` örnekteki gibi 0 = V1 varsayıldı
   (yanlışsa klip bulunamaz → bağlanmaz, zarar yok).
8. Cihaz öneki kuralı: aynı harf önekli iki farklı kamera (ör. iki "C…" Sony) tek cihaz sayılır → çakışırsa TOPLA durur.

### Sonraki adım

Kullanıcı: yardımcıyı kur → Save As kopyasında SPREAD → Synchronize → **Durum raporu (bana getir)** → TOPLA → kontrol → BAĞLA.
Gelecek raporlar: `spread/dev/fixtures/senkron-raporu.txt` → `node spread/dev/smoke.cjs report`. İlk parça tutmazsa: QE razor yolu
(`cep-helper/jsx/host.jsx`'e `spreadHelper_razor`, `linker.ts`'e `cut()`), kararı buraya yaz.

---

## Geçmiş: ADIM 2 — SPREAD v0.2.0

### Durum (tek bakışta)

| | |
|---|---|
| Sürüm | **Spread v0.2.0** — yeni eklenti: id `com.badideagency.spread`, panel "Spread", paket `release/spread.ccx` |
| Yapılan | **SPREAD** (her klip kendi track'ine, zaman değişmeden) + **DURUM RAPORU** (+ kopyala). RE-STACK **yazılmadı** (bilinçli). |
| Probe | `Spread Probe` v0.1.1 repoda **aynen** duruyor (kök `index.ts`, `src/`, `public/`, `dev/smoke.cjs`); kaynak dosyaları ve `release/spread-probe.ccx` **bayt bayt aynı** (sha256 doğrulandı). |
| Bulutta doğrulanan | `tsc --strict`, Adobe eslint kuralları, d.ts satır kontrolü (iki eklenti, 74 ref), Spread mock'uyla 18 senaryo (kullanıcının gerçek 22 kamera + 12 WAV düzeni, bozuk overwrite dahil), Probe smoke 6 senaryo, `.ccx` yapısı, bağımsız alt ajan incelemesi |
| Doğrulanamayan | Gerçek Premiere davranışı — kullanıcının koşusu bekleniyor ([KURULUM_TR.md](KURULUM_TR.md)) |
| Dal | `claude/sweet-bell-do4j75` |

### Yoklamanın kanıtladıkları (Premiere 26.5.1, Probe v0.1.1 gerçek raporu)

- `createCloneTrackItemAction`: hedef track yoksa açıyor (V ve A). Kopya start/end/in/out/speed tick düzeyinde birebir.
  Kopya **TEK öğe**: bağlı partner gelmez, kopyalar birbirine **BAĞLI DEĞİL**.
- `createOverwriteItemAction(projectItem, time, vIdx, aIdx)`: video+sesi **BAĞLI** doğuruyor; set In/Out/Start/End ile aslına tick düzeyinde
  eşitlendi. **Dikkat:** T8'de klip kırpılmamıştı (set action'lar gerçek bir kırpmayı düzeltirken henüz ölçülmedi); overwrite'ın
  **olmayan** track'i açıp açmadığı ölçülmedi (T8 mevcut V3/A5'e yazdı).
- `createRemoveItemsAction(ripple=false)`: başka klibi kaydırmıyor. `mediaType` filtre değil → video+ses tek seçimle tek action'da silinir.
- **TEK transaction = tek Ctrl+Z** ile tamamen geri alınıyor.
- **TrackItem referansları transaction sonrası geçersiz.** Her transaction'dan sonra yeniden oku, klibi (tip, track, start, end, kaynak) ile yeniden bul.
- Seçim: `getSelection + addItem + setSelection` programla doğru ama timeline'da **GÖRÜNMÜYOR**.
- **Link/unlink API'si YOK.** Harici ses kameraya bağlanamaz.

### SPREAD tasarımı (v0.2.0)

**Birimler** (`spread/src/plan.ts`, saf fonksiyon): KAMERA = video + aynı kaynaklı, aynı start/end/in/out'lu ses klip(ler)i (çok kanal
olabilir); SADECE-VİDEO; SES = kamera birimine ait olmayan her ses klibi. Start'a göre sıralı (eşitlikte track, sonra ad).
**Hedef düzen:** video birimleri V1, V2, …; kamera ses kanalları (birim sırasıyla, kanallar ardışık) A1, A2, …; ses birimleri onların altında.
Her track'te ≤1 klip. Tüm klipleri zaten hedefindeyse birim **yerinde kalır** (kullanıcının düzeninde: ilk kamera V1/A1'de kalır).

**Taşıma yöntemleri:** kamera → `createOverwriteItemAction` (proje öğesinden, BAĞLI doğar); ses / sadece-video → `createCloneTrackItemAction`
(kanıtlı, zaman ofseti 0); asıllar → tek seçimle `createRemoveItemsAction(ripple=false)`.

**Transaction'lar (ve seçilen yol + neden):**
1. `Spread: yedek sequence` — `createCloneAction`; `getSequences` ile tam 1 yeni sequence görülmezse Spread **başlamaz**; yedeğin
   **içeriği** de okunup aslıyla karşılaştırılır (eksikse başlamaz); yedek aktif olursa `setActiveSequence(asıl)` + doğrulama.
   (Undo sayısına katılmaz; kullanıcıya "yedeği geri alma" denmez.)
2. `Spread: track hazırlığı` (**TX-A**, yalnız yeni track gerekiyorsa) — **SEÇİLEN YOL: gereken track'ler önce KANITLI yöntemle
   (clone ofseti) açılır**, overwrite'ın track açmasına güvenilmez. Her yeni track için bir geçici yardımcı kopya, hedef index = o anki
   track sayısı olacak şekilde sırayla (V için ilk video klibi, A için ilk ses klibi), **sequence sonunun 10 sn ötesine park edilerek**.
   Park yeri = max(`getEndTime`, en büyük klip sonu) + 10 sn.
   Neden: (a) overwrite'ın olmayan track'i açtığı ölçülmedi; (b) tek transaction'da ardışık birden çok track açılması da ölçülmedi —
   bu belirsiz adımı **asıllara dokunmadan önce** ayrı bir transaction'da ölçmek, başarısızlıkta zararı "birkaç yardımcı klip" ile sınırlar
   (park edildikleri için hiçbir asılla zamanda çakışamazlar; tek Ctrl+Z). Sonra `verifyTracks`: track sayıları ≥ gereken, her yeni
   track'te tam 1 yardımcı, yardımcılar park yerinde, **asıllar birebir duruyor**. Tutmazsa DUR.
3. `Spread: dağıt` (**TX-B**, tek transaction) — hemen öncesinde: taşınan asıllar + yardımcılar Adobe seçim kalıbıyla birebir seçilir
   (`clearSelection → getSelection → addItem → setSelection → geri okuma`); uygun değilse DUR. Transaction içinde sıra:
   (1) clone'lar (ses / sadece-video; bir kopyanın hedef track'inde zamanda çakıştığı HERHANGİ bir asıl varsa → plan hatası, Spread
   başlamaz — kopyası alınmış bir asılın üstüne aynı transaction'da yazmak kanıtlanmadığı için sıralama yerine yasak; kullanıcının
   düzeninde ses hedefleri A23.. hep yeni track olduğundan oluşmaz),
   (2) remove (asıllar + yardımcılar, tek seçim), (3) kamera overwrite'ları (hedefler artık boş).
4. `Spread: kırpma eşitlemesi` (**TX-C**, yalnız gerekirse) — yalnız "kırpılmış asıl, overwrite ile beklenen biçimde kırpılmamış yerleşmiş"
   kamera klipleri (aynı track + kaynak + **aynı start** + in=0 + out=**bilinen** medya süresi + aynı hız) için set In → Out → Start → End.
   **Kırpılmamış kliplere set action hiç çalışmaz**; medya süresi okunamazsa eşitleme adayı yoktur. Başka her fark (ör. kaymış start,
   yanlış uzunluk) eşitleme adayı DEĞİL → DUR.
   Adımlar arasında (TX-A→TX-B, TX-B→TX-C) timeline beklenen hâlde mi kontrol edilir; kullanıcı arada Ctrl+Z bastıysa adım
   "yapılanlar"dan düşülür ve DUR (Ctrl+Z sayısı doğru kalır). `executeTransaction` false dönerse ya da hata verirse önce/sonra
   karşılaştırılır; yalnız timeline gerçekten değiştiyse adım sayılır.

**Doğrulama** (`spread/src/verify.ts`, saf; her transaction'dan sonra): klip sayısı aynı; her klibin start/end/in/out(+hız) aslıyla tick
düzeyinde aynı; her track'te ≤1 klip; kamera birimlerinde video ve ses(ler) aynı start/end'de; her klip planladığı track'te ve doğru
kaynaktan. Tutmazsa **DUR**: panel farkları (tick) yazar, "Ctrl+Z'ye N kez bas ya da yedek sequence'ı kullan" der, **kendi başına
düzeltmez**. Hata veren transaction'da önce/sonra karşılaştırılıp kısmen uygulanıp uygulanmadığı ölçülür (N doğru söylensin).

**Ön kontroller (plan hatası → hiçbir şey değişmez):** kamera klibinde hız≠1, devre dışı, ayar katmanı, proje öğesi okunamıyor / medya
klibi değil (overwrite bunları koruyamaz); **aynı kaynaklı bir videoyla zamanda çakışan ama tick düzeyinde birebir olmayan ses** (1 tick
bile — ayrı taşınırsa bağı kopar ve link API'si yok); okuma hataları; clone hedefinde çakışan asıl. **Uyarılar:** kamera kaynaklı ama
hiçbir videoyla çakışmayan ses (ayrı ses birimi); yeniden adlandırılmış kamera klibi (ad taşınmaz); kırpılmış kameralar (TX-C gerekebilir).
Onay metni açıkça söyler: kamera klibindeki efektler, ses kazancı/keyframe'ler ve klip adı taşınmaz.
**Probe'da sınanmamış okumalar** (ayar katmanı, ProjectItem.type, TYPE_CLIP, ClipProjectItem.cast/getMedia/getDuration) isteğe bağlıdır:
hata verirlerse "bilinmiyor" sayılır, plan hatası üretmez (Application.version'daki gibi bir sürprizde ilk koşu engellenmesin).

**Referans kuralı:** Probe'daki kuşak koruması aynen (`spread/src/model.ts`): transaction / soru / clearSelection / setSelection sonrası kuşak
artar; `useRef/useProj/FreshSelection` eski kuşak referansını Premiere'e göndermeden `StaleRefError` verir. TX-A yardımcıları `s1`'den, TX-B
kaynakları seçimden SONRA okunan `so.snap`'ten, TX-C klipleri `sC0`'dan.

**Bitiş:** tüm klipler programla seçilir (görünmeyebilir) + "Şimdi Clip > Synchronize'ı dene. Menü gri ise timeline'a tıkla, Ctrl+A, sağ tık >
Synchronize (Audio)." + geri alma bilgisi.

**DURUM RAPORU** (`spread/src/status.ts`, salt okuma): track başına klipler (start/end/in/out tick + saniye, kaynak, medya süresi); birim
eşleşmesi — her ses birimi için zamanda çakıştığı kameralar (çakışma tick/saniye/%), her kamera için çakışan sesler; makine okunur
`CLIP;…` ve `OVERLAP;…` satırları. Kullanıcı bunu **Synchronize'dan SONRA** getirecek → RE-STACK bu veriyle tasarlanacak.

#### Spread dosya haritası

```
spread/index.ts        giriş: SPREAD / Durum raporu / Raporu kopyala, aktif sequence göstergesi, meşgul kilidi
spread/src/ppro.ts     require("premierepro") + d.ts tipleri
spread/src/session.ts  aktif sequence bağlamı + koşu boyunca sabitleme (assertSameSequence)
spread/src/model.ts    snapshot (kuşaklı, medya süresi ile), anahtarlar, relocate
spread/src/edit.ts     transact()+TxOps (Adobe düzenleme kalıbı), selectExactly/selectAll (Adobe seçim kalıbı)
spread/src/plan.ts     SAF: birimler, hedef düzen, ön kontroller, clone bağımlılık sırası
spread/src/verify.ts   SAF: verifySpread (TX-B/TX-C), verifyTracks (TX-A)
spread/src/spread.ts   akış: plan → onay → yedek → TX-A → TX-B → TX-C → seç
spread/src/status.ts   DURUM RAPORU
spread/public/         manifest.json (com.badideagency.spread, 0.2.0), index.html, ikonlar
spread/dev/smoke.cjs   mock Premiere + 12 senaryo
```

#### Komutlar

```bash
npm run build:spread     # spread/dist
npm run smoke:spread     # 12 senaryo
npm run package:spread   # release/spread.ccx (+ zip kontrolü)
npm run check            # iki eklenti: typecheck + lint + check:api + Probe smoke + Spread smoke
```

#### Spread smoke (`spread/dev/smoke.cjs`) — mock yalnız KANITLANMIŞ davranışı uygular

Kanıtlanmamış olanlarda mock **hata verir**: clone hedefi > track sayısı ("atlamalı" açma), overwrite olmayan track'e, `createEmptySelection`,
bayat referans. Böylece Spread'in bunlara dayanmadığı da sınanır. set In/Out/Start/End'in anlamı mock'ta TAHMİNDİR.

| Senaryo | Ne gösterir |
|---|---|
| `real` | **Kullanıcının gerçek düzeni**: V1'de 22 kamera (A038C0xx_260912*.MP4 / C01xx.MP4 dönüşümlü, A1'de bağlı sesleri), A2/A3'te 12 WAV (260912_HHMMSS_Tr1/Tr2/TrLR). Onay "22 kamera, 12 ses bulundu, 50 track açılacak (V 19, A 31)"; son düzen V1..V22 / A1..A22 kamera, A23..A34 WAV; zamanlar tick düzeyinde aynı; kameralar bağlı; 3 transaction (yedek, track hazırlığı, dağıt), set action yok; yedek aslıyla aynı; başka sequence'a dokunulmadı; Ctrl+Z ×2 → asıl düzen birebir. **Not:** Probe raporunun tam tick değerleri bu oturumda yok — adlar, sayılar, düzen gerçek; süreler 25 fps kare-hizalı üretildi. |
| `trim` | 2 kırpılmış kamera → TX-C yalnız o 4 klibe set action → aslına eşit |
| `broken` | **bozuk overwrite** (video 1 kare kayık) → doğrulama yakalar, fark tick olarak yazılır, TX-C **çalışmaz** (kendi başına düzeltme yok), "Ctrl+Z ×2 ya da yedek" |
| `nonseq` | tek transaction'da ardışık track açma çalışmazsa → TX-A'da DUR, asıla hiç dokunulmadı |
| `nobackup` | yedek oluşmazsa → Spread başlamaz, timeline'a dokunulmaz |
| `backupactive` | yedek aktif olursa → asıla dönülür, Spread asılda tamamlanır, yedeğe dokunulmaz |
| `cancel` | onayda "Hayır" → hiçbir şey (yedek de) oluşmaz |
| `switch` | işlem ortasında başka sequence'a geçiş → DUR, diğer sequence'a dokunulmaz |
| `multichannel` | 2 kanallı kamera → kanallar ardışık A track'lerine, bağlı |
| `already` | dağıtılmış sequence'ta ikinci SPREAD → "Zaten dağıtılmış", işlem yok |
| `status` | Synchronize taklidinden sonra durum raporu: çakışma tick değeri doğru, CLIP satırları tam, panoya kopyalanıyor |
| `falsetx` | `executeTransaction` false döner → DUR; timeline değişmedi olarak ölçülür; Ctrl+Z sayısı gerçek undo kayıtlarıyla aynı (yedeğe dokundurmaz) |
| `subframe` | kamera sesi videodan 1 tick kısa → plan hatası (bağ korunamazdı), Spread başlamaz |
| `badbackup` | yedek eksik kopyalanmış → Spread başlamaz |
| `undobetween` | kullanıcı TX-A'dan sonra Ctrl+Z basar → DUR, adım düşülür, ek Ctrl+Z istenmez |
| `notype` | TYPE_CLIP / ClipProjectItem.cast yok (sınanmamış API'ler) → kırpılmamış kliplerle SPREAD yine tamamlanır |
| `extrach` | proje öğesinde timeline'dakinden fazla ses kanalı → overwrite fazla kanal üretir → doğrulama "2 klip var" ile DUR |
| `plan` | saf plan testleri: hedefte çakışan asıl → hata; hız≠1 kamera → hata; birebir olmayan kamera sesi → hata; çakışmayan kamera kaynaklı ses → uyarı; WAV hedefinde silinmemiş kamera sesi → hata; dağıtılmış düzen → iş yok |

#### Kullanılan Premiere API'leri (iki eklenti; `premierepro.d.ts` 26.5.0; `npm run api:table`)

| d.ts satırı | API | d.ts'teki satır |
|---|---|---|
| L14 | `premierepro` | `export declare type premierepro = {` |
| L434 | `AudioClipTrackItem.createSetEndAction` | `createSetEndAction(tickTime: TickTime): Action;` |
| L441 | `AudioClipTrackItem.createSetInPointAction` | `createSetInPointAction(tickTime: TickTime): Action;` |
| L455 | `AudioClipTrackItem.createSetOutPointAction` | `createSetOutPointAction(tickTime: TickTime): Action;` |
| L462 | `AudioClipTrackItem.createSetStartAction` | `createSetStartAction(tickTime: TickTime): Action;` |
| L472 | `AudioClipTrackItem.getEndTime` | `getEndTime(): Promise<TickTime>;` |
| L477 | `AudioClipTrackItem.getInPoint` | `getInPoint(): Promise<TickTime>;` |
| L482 | `AudioClipTrackItem.getIsSelected` | `getIsSelected(): Promise<boolean>;` |
| L497 | `AudioClipTrackItem.getName` | `getName(): Promise<string>;` |
| L502 | `AudioClipTrackItem.getOutPoint` | `getOutPoint(): Promise<TickTime>;` |
| L507 | `AudioClipTrackItem.getProjectItem` | `getProjectItem(): Promise<ProjectItem>;` |
| L512 | `AudioClipTrackItem.getSpeed` | `getSpeed(): Promise<number>;` |
| L517 | `AudioClipTrackItem.getStartTime` | `getStartTime(): Promise<TickTime>;` |
| L522 | `AudioClipTrackItem.getTrackIndex` | `getTrackIndex(): Promise<number>;` |
| L532 | `AudioClipTrackItem.isAdjustmentLayer` | `isAdjustmentLayer(): Promise<boolean>;` |
| L537 | `AudioClipTrackItem.isDisabled` | `isDisabled(): Promise<boolean>;` |
| L672 | `AudioTrack.getTrackItems` | `getTrackItems(` |
| L788 | `ClipProjectItemStatic.cast` | `cast(projectItem: ProjectItem): ClipProjectItem;` |
| L1029 | `ClipProjectItem.getMedia` | `getMedia(): Promise<Media>;` |
| L1308 | `CompoundAction.addAction` | `addAction(action: Action): boolean;` |
| L1314 | `CompoundAction.empty` | `readonly empty: boolean;` |
| L1834 | `Guid.toString` | `toString(): string;` |
| L2087 | `Media.getDuration` | `getDuration(): TickTime;` |
| L2414 | `ProjectStatic.getActiveProject` | `getActiveProject(): Promise<Project>;` |
| L2493 | `Project.getActiveSequence` | `getActiveSequence(): Promise<Sequence>;` |
| L2520 | `Project.getSequences` | `getSequences(): Promise<Sequence[]>;` |
| L2590 | `Project.setActiveSequence` | `setActiveSequence(sequence: Sequence): Promise<boolean>;` |
| L2598 | `Project.executeTransaction` | `executeTransaction(` |
| L2608 | `Project.lockedAccess` | `lockedAccess(callback: () => void): void;` |
| L2788 | `ProjectItemStatic.TYPE_CLIP` | `readonly TYPE_CLIP: number;` |
| L2843 | `ProjectItem.getId` | `getId(): string;` |
| L2854 | `ProjectItem.name` | `readonly name: string;` |
| L2860 | `ProjectItem.type` | `readonly type: number;` |
| L3112 | `Sequence.clearSelection` | `clearSelection(): Promise<boolean>;` |
| L3117 | `Sequence.createCloneAction` | `createCloneAction(): Action;` |
| L3159 | `Sequence.getAudioTrack` | `getAudioTrack(trackIndex: number): Promise<AudioTrack>;` |
| L3164 | `Sequence.getAudioTrackCount` | `getAudioTrackCount(): Promise<number>;` |
| L3181 | `Sequence.getEndTime` | `getEndTime(): Promise<TickTime>;` |
| L3211 | `Sequence.getSelection` | `getSelection(): Promise<TrackItemSelection>;` |
| L3238 | `Sequence.getVideoTrack` | `getVideoTrack(trackIndex: number): Promise<VideoTrack>;` |
| L3243 | `Sequence.getVideoTrackCount` | `getVideoTrackCount(): Promise<number>;` |
| L3267 | `Sequence.setSelection` | `setSelection(trackItemSelection: TrackItemSelection): boolean;` |
| L3273 | `Sequence.guid` | `readonly guid: Guid;` |
| L3279 | `Sequence.name` | `readonly name: string;` |
| L3288 | `SequenceEditorStatic.getEditor` | `getEditor(sequenceObject: Sequence): SequenceEditor;` |
| L3305 | `SequenceEditor.createRemoveItemsAction` | `createRemoveItemsAction(` |
| L3321 | `SequenceEditor.createInsertProjectItemAction` | `createInsertProjectItemAction(` |
| L3337 | `SequenceEditor.createOverwriteItemAction` | `createOverwriteItemAction(` |
| L3354 | `SequenceEditor.createCloneTrackItemAction` | `createCloneTrackItemAction(` |
| L3887 | `TickTimeStatic.createWithTicks` | `createWithTicks(ticks: string): TickTime;` |
| L3929 | `TickTimeStatic.TIME_ZERO` | `readonly TIME_ZERO: TickTime;` |
| L3986 | `TickTime.seconds` | `readonly seconds: number;` |
| L3992 | `TickTime.ticks` | `readonly ticks: string;` |
| L4024 | `TrackItemSelection.addItem` | `addItem(` |
| L4034 | `TrackItemSelection.removeItem` | `removeItem(trackItem: VideoClipTrackItem \| AudioClipTrackItem): boolean;` |
| L4039 | `TrackItemSelection.getTrackItems` | `getTrackItems(): Promise<Array<VideoClipTrackItem \| AudioClipTrackItem>>;` |
| L4153 | `VideoClipTrackItem.createSetEndAction` | `createSetEndAction(tickTime: TickTime): Action;` |
| L4160 | `VideoClipTrackItem.createSetInPointAction` | `createSetInPointAction(tickTime: TickTime): Action;` |
| L4174 | `VideoClipTrackItem.createSetOutPointAction` | `createSetOutPointAction(tickTime: TickTime): Action;` |
| L4181 | `VideoClipTrackItem.createSetStartAction` | `createSetStartAction(tickTime: TickTime): Action;` |
| L4191 | `VideoClipTrackItem.getEndTime` | `getEndTime(): Promise<TickTime>;` |
| L4196 | `VideoClipTrackItem.getInPoint` | `getInPoint(): Promise<TickTime>;` |
| L4201 | `VideoClipTrackItem.getIsSelected` | `getIsSelected(): Promise<boolean>;` |
| L4216 | `VideoClipTrackItem.getName` | `getName(): Promise<string>;` |
| L4221 | `VideoClipTrackItem.getOutPoint` | `getOutPoint(): Promise<TickTime>;` |
| L4226 | `VideoClipTrackItem.getProjectItem` | `getProjectItem(): Promise<ProjectItem>;` |
| L4231 | `VideoClipTrackItem.getSpeed` | `getSpeed(): Promise<number>;` |
| L4236 | `VideoClipTrackItem.getStartTime` | `getStartTime(): Promise<TickTime>;` |
| L4241 | `VideoClipTrackItem.getTrackIndex` | `getTrackIndex(): Promise<number>;` |
| L4251 | `VideoClipTrackItem.isAdjustmentLayer` | `isAdjustmentLayer(): Promise<boolean>;` |
| L4256 | `VideoClipTrackItem.isDisabled` | `isDisabled(): Promise<boolean>;` |
| L4392 | `VideoTrack.getTrackItems` | `getTrackItems(` |
| L4692 | `Constants.MediaType` | `export enum MediaType {` |
| L4804 | `Constants.TrackItemType` | `export enum TrackItemType {` |

#### Bilinen belirsizlikler (kullanıcının ilk gerçek koşusunda bakılacaklar)

1. **Tek transaction'da ardışık track açma** (TX-A, V 19 + A 31 yardımcı): ölçülmedi. Çalışmazsa TX-A doğrulaması DURDURUR; asıllar
   güvende (yalnız park edilmiş yardımcılar eklenmiş olur → tek Ctrl+Z). O zaman: track'leri tek tek açan yol (çok adım) ya da
   kullanıcının elle eklemesi (Sequence > Add Tracks) düşünülür.
2. **Overwrite'ın projectItem kaynak işaretlerini (source in/out) kullanması:** proje öğesinde in/out işaretliyse overwrite yalnız o bölümü
   koyabilir → doğrulama (yanlış uzunluk) DURDURUR. O durumda kullanıcı işaretleri temizler.
3. **set In/Out/Start/End'in gerçek kırpmadaki anlamı** ölçülmedi (TX-C). Kullanıcının kameraları büyük ihtimalle kırpılmamış (in=0,
   tam uzunluk) → TX-C hiç çalışmaz. Çalışır ve tutmazsa DUR; rapordaki farklar bir sonraki sürümde sırayı belirler.
4. **Kamera klip efektleri** overwrite'la taşınmaz (onay metninde yazıyor); ham klipler varsayıldı.
5. **Seçim görünmüyor** (kanıtlı) → talimat Ctrl+A ile.

#### Bağımsız alt ajan incelemesi (v0.2.0, salt okuma; tüm spread/ kaynakları okundu, kendi mock senaryolarıyla sınandı)

| İddia | Sonuç |
|---|---|
| Probe değişmedi | **HOLDS** (kaynak farkı yok; `release/spread-probe.ccx` sha256 aynı) |
| 1. Hiçbir klibin zamanı değişmez | **HOLDS WITH CAVEATS** — yanlış "başarı" yolu bulunmadı; hedef düzen doğru; TX-A asıllara dokunamaz |
| 2. Doğrulama atlatılamaz | **HOLDS WITH CAVEATS** — her transaction'dan sonra doğrulama; TX-C sonrası katı |
| 3. Yedek yoksa Spread yok | **HOLDS WITH CAVEATS** — yedekten önce hiçbir düzenleme yok |
| 4. Referans transaction'ı aşmaz | **HOLDS** (katı mock'ta da) |
| 5. Her API d.ts'te | **HOLDS** (74/74) |

Bulgular → düzeltmeler: (1) `executeTransaction` false dönünce Ctrl+Z sayısı fazlaydı (fazla basış yedeği silerdi) → false da ölçülüyor,
yalnız değişiklik varsa sayılıyor; (2) **1 tick'lik kamera sesi farkı kamerayı sessizce bağsız bırakıp "başarı" diyordu** → sert plan hatası;
(3) Probe'da sınanmamış API'ler (ayar katmanı, tür, medya süresi, TYPE_CLIP) ilk koşuyu engelleyebilirdi → isteğe bağlı; (4) yedeğin yalnız
varlığı kontrol ediliyordu → içeriği de; (5) medya süresi bilinmezken kırpılmamış kliplere set action çalışabilirdi → eşitleme adayı yok, DUR;
(6) park yeri yalnız `getEndTime`'dı → en büyük klip sonuyla birlikte; (7) overwrite'ın taşımadıkları (kazanç, keyframe, ad) onayda yazılı +
yeniden adlandırma uyarısı; (8) okuma uyarıları doğrulamada yok sayılıyordu → sorun; (9) adımlar arası kullanıcı Ctrl+Z'si sayıyı bozuyordu →
`expectState`; (10) kullanılmayan `timeKey` silindi; ayrıca kopyası alınmış asılın üstüne aynı transaction'da clone (kanıtsız) → plan hatası.
Düzeltmeler yeni mock senaryolarıyla (falsetx, subframe, badbackup, undobetween, notype, extrach) doğrulandı; ikinci inceleme turu yapılmadı.

#### Graphify

Ortamda **kurulu değil** (PATH'te `graphify` yok, npm global'de yok, Claude skill/komut listesinde yok) → `/graphify .` **atlandı**.

#### Sonraki adım

1. Kullanıcı gerçek projenin **Save As** kopyasında, orijinal sequence'ta SPREAD'i dener; sonucu (başarı ya da DURDU satırları) getirir.
2. Synchronize sonrası **Durum raporu**nu getirir → RE-STACK (interval packing: video V1'den, ses A1'den, zamana dokunmadan) tasarlanır.

---

### Geçmiş: Spread Probe (ADIM 1 / 1b, v0.1.1)

#### ⚠ ADIM 1b bulgusu (Premiere 26.5.1, v0.1.0 gerçek raporu)

> **TrackItem referansları transaction sonrası geçersiz olur. Spread/Re-stack bütün taşımaları TEK transaction'da yapmalı.**

- v0.1.0 T3, bir transaction'dan önce alınmış referansla sonraki transaction'da `createRemoveItemsAction` çağırınca
  `Error: The script object is no longer valid` verdi (timeline.js:216). → **Kural:** hiçbir TrackItem / ProjectItem / seçim nesnesi
  bir transaction'dan sonrakine taşınmaz. Her transaction'dan sonra track'ler baştan okunur ve klip
  **(track tipi, track index, start tick, end tick, kaynak adı)** ile yeniden bulunur (`timeline.ts → locKey/relocate`).
  Tek transaction içinde kullanılacak referanslar o transaction'ın **hemen öncesinde** taze alınır.
- v0.1.0 T5'te `TrackItemSelection.createEmptySelection` ile kurulan seçimde `addItem → [false,false]`, sonra
  `A nullptr was dereferenced`. → Seçim artık Adobe örneğinin kalıbıyla kuruluyor:
  `sel = await sequence.getSelection(); sel.addItem(item, false); sequence.setSelection(sel)`
  (`sample-panels/premiere-api/src/sequence.ts → setSequenceSelection`, `src/sequenceEditor.ts → removeSelectedTrackItems`).
  `createEmptySelection` kodda artık hiç yok.
- v0.1.0 raporundaki **"CEP'e geç" önerisi YANLIŞTI**: iki FAIL de bizim kullanım hatamızdı, API eksikliği değil.
  v0.1.1'de her FAIL sınıflıdır ve CEP yalnızca taze referans + Adobe kalıbıyla denenip yine başarısız olan API için önerilir.
- v0.1.0'da T1, T2, T4 PASS idi; T6/T7 kurulum (harici sesler A2/A3'te) bulunamadığı için çalışmadı → tespit düzeltildi.
- `ppro.Application.version` Premiere 26.5.1'de `undefined` döndü → sürüm UXP host'tan (`require("uxp").host.version`) okunuyor.

**SPREAD/RE-STACK tasarımına etkisi:** her toplu taşıma = tek `executeTransaction` (clone'lar + tek seçimle asılları silme), transaction'dan
önce: sequence'ı baştan oku → seçimi Adobe kalıbıyla kur → setSelection sonrası tekrar oku → o referanslarla action'ları üret. Arada
kullanıcı etkileşimi, Ctrl+Z ya da başka bir transaction olursa her şey baştan okunur.

#### Durum (tek bakışta)

| | |
|---|---|
| Sürüm | **0.1.1** (manifest `version` 0.1.1 → Creative Cloud güncelleme olarak görür; panel başlığında "v0.1.1") |
| Yapılan | 8 test (T1–T8), "Hepsini çalıştır", rapor + sınıflı karar önerisi, "Raporu kopyala". **SPREAD / RE-STACK YAZILMADI.** |
| Paket | `release/spread-probe.ccx` (kökte `manifest.json`, dosyalar 644, klasörler 755; açılıp `dist/` ile birebir karşılaştırıldı) |
| Bulutta doğrulanan | `tsc --strict`, Adobe `@adobe/eslint-plugin-premierepro` kuralları, d.ts satır kontrolü (67 ref), mock Premiere ile 6 senaryo (happy/strict/grim/throw/linked/filter) + kilit aşamaları, `.ccx` yapısı, bağımsız alt ajan incelemesi |
| Doğrulanamayan | Gerçek Premiere davranışı — kullanıcının v0.1.1 raporu bekleniyor ([KURULUM_TR.md](KURULUM_TR.md)) |
| Dal | `claude/sweet-bell-do4j75` |

#### Dosya haritası

```
index.ts               giriş: butonlar, PROBE_ durum çubuğu (1,5 sn'de bir), meşgul kilidi, koşu sabitleme, rapor kopyalama
src/ppro.ts            require("premierepro") + d.ts tipleri (tek giriş)
src/guard.ts           PROBE_ KİLİDİ: requireProbe(pin?), assertStillProbe()
src/timeline.ts        snapshot (kuşaklı), relocate, transact() + TxOps, selectExactly()/readSelection() (Adobe seçim kalıbı), classifyError
src/tests.ts           T1–T8, çalıştırma sırası, tarama
src/report.ts          rapor metni + sınıflı karar mantığı (decide), Premiere sürümü (UXP host)
src/ui.ts              günlük, Evet/Hayır/Atla soruları
public/                manifest.json (v5, 0.1.1, premierepro ≥ 25.6.0, clipboard izni), index.html, ikonlar
scripts/               package-ccx.sh, verify-ccx.py, check-api-refs.mjs
dev/smoke.cjs          sahte premierepro ile dist/'i Node'da uçtan uca çalıştırır (happy/strict/grim/throw/linked/filter)
release/               spread-probe.ccx
```

#### Komutlar

```bash
npm ci
npm run check        # typecheck + lint + check:api + smoke (6 senaryo)
npm run package      # build → release/spread-probe.ccx → verify-ccx.py
npm run api:table    # kullanılan her API'nin d.ts satırı + kullanıldığı yerler
```

#### Mimari kararlar

- **Tek API kaynağı:** `node_modules/@adobe/premierepro/src/premierepro.d.ts` (26.5.0). Her çağrının yanında `// d.ts:L<satır> Tip.üye`;
  `scripts/check-api-refs.mjs` satırın o üyeyi içerdiğini ve o tipin gövdesinde olduğunu kontrol eder. `tsc --strict`, `any` yok.
- **Referans kuşağı (v0.1.1, `timeline.ts`):** her `snapshot()` bir kuşak numarası taşır. `transact()` işlendikten sonra (hata verse bile,
  `finally`) ve her kullanıcı sorusundan sonra (`askUser`) kuşak artar; temkin için `clearSelection`/`setSelection` sonrası da.
  Premiere'e giden her referans `useRef`/`useProj`/`FreshSelection.gen` kontrolünden geçer; eski kuşaktan bir referans Premiere'e hiç
  gitmeden `StaleRefError` ("BAYAT REFERANS") verir. Testler arası tek köprü (`lastT3`) yalnızca **değer** (anahtar listeleri) taşır.
- **Adobe düzenleme kalıbı:** `project.lockedAccess(() => project.executeTransaction(compound => {...}, "PROBE …"))`.
  Action'lar lexically executeTransaction callback'i içinde üretilir (`TxOps`); Adobe lint kuralı `require-action-lock-scope` 0 hata.
- **Adobe seçim kalıbı (`selectExactly`):** `clearSelection` → sequence'ı baştan oku, klipleri `relocate` ile bul → `getSelection` →
  `addItem(taze, false)` → `setSelection` → **geri oku**: `getSelection()` öğeleri (track, start, end, kaynak adı) ile
  `getIsSelected` veren klipler birebir aynı olmalı, istenen her klip seçili olmalı, seçili her klip "istenen ∪ izinli" içinde olmalı
  (izinli = Linked Selection'ın ekleyebileceği, silinmesinde sakınca olmayan klipler; ör. T2'de insert'in kendi partneri).
  Uygun değilse silme **yapılmaz** (yanlış klip silinmesin) ve bu **ölçüm sayılmaz** (FAIL [BELİRSİZ]). Silmeye verilen seçim `setSelection`'dan sonra `getSelection()` ile alınır
  (Adobe `removeSelectedTrackItems` gibi); ardından gelen transaction referanslarını dönen taze `snap`'ten alır.
- **Silme `mediaType`:** yalnız video → VIDEO, yalnız ses → AUDIO, video+ses birlikte (T3, T2 yedek) → VIDEO (Adobe örneğindeki gibi).
  Anlamı (filtre mi hizalama mı) belgelenmemiş → **T7 ölçer**: ses klibini önce VIDEO ile siler; silinmezse filtre demektir, AUDIO ile
  siler (`mediaTypeFilters`). T3'te video gidip ses kalırsa FAIL [KOD] ("V için VIDEO, A için AUDIO ayrı remove gerekir").
- **PROBE_ kilidi (değişmedi):** her test `requireProbe(pin)`; her transaction/seçim öncesi `assertStillProbe()` (tutulan + taze aktif
  sequence adı PROBE_, guid aynı); "Hepsini çalıştır" başladığı sequence'a sabitlenir; T1 yalnız "yeni kopya aktif olduysa" aslına döner,
  kullanıcı başka sequence'a geçtiyse durur.
- **Kurulum tespiti (v0.1.1, kullanıcının gerçek düzeni geçerli):** kamera video = V1'deki ilk klip; kamera sesi = aynı kaynak + aynı
  start/end'li ses klibi (en alttaki); harici ses = kaynağı hiçbir video klibinin kaynağı olmayan ses klibi, **TÜM ses track'lerinde**
  (ör. `260912_133224_Tr1.WAV` A2'de); T7 çifti = aynı track'te arka arkaya iki harici ses (önce A2).
- **FAIL sınıfları (`classifyError`, `Rec.fail`):** yakalanan istisna **asla** `api` değildir (`classifyError` yalnız `kod`/`belirsiz` döndürür;
  "is not a function" bile `belirsiz`). `api` yalnızca test içinde, taze referans + Adobe kalıbıyla yapılmış bir çağrının **ölçülen**
  sonucuna (ya da kullanıcı gözlemine) verilir. Güvenlik iptalleri (seçim uygun değil → silme yapılmadı) `belirsiz`tir.
  **Yalnız `api` sınıfı engel (CEP gerekçesi) olabilir**; `kod`/`belirsiz` kararı "GEÇİCİ" yapar.

#### Testler — v0.1.1

"Hepsini çalıştır" sırası: **T1, T2, T4, T3, T6, T8, T5, T7**. Her test başında sequence'ı baştan okur; önceki testten referans devralmaz.

| Test | Adımlar | PASS ölçütü | facts |
|---|---|---|---|
| **T1 Yedek** | `createCloneAction` → `getSequences` ile yeni sequence aranır; kopya aktif olduysa aslına dönülür | tam 1 yeni sequence | `cloneCreated, cloneName, activeChanged, cloneBecameActive, returnedToOriginal` |
| **T2 Track açma** | kamera videosu ve harici ses, hedef = track sayısı olacak ofsetle clone; açılmazsa yedek: insert → eklenenlerin HEPSİ tek seçimle (partner izinli) sil → kalan varsa kendi türüyle 2. geçiş | V ve A için yeni/boş track elde edildi | `openedV, openedA, fallbackRan, fallbackV, fallbackA, measured` |
| **T3 Taşı (tek transaction)** | TEK `executeTransaction`: kamera videosu → ilk boş V (+kV), kamera sesi → ilk boş A (+kA) clone (ikisi de aynı hedefe; bağlı partner gelirse üst üste yazılır → tek kopya), iki aslı tek seçimle `createRemoveItemsAction(ripple=false)` sil. Sonra: kullanıcı kopya videoya tıklar, panel `getSelection` ile kaç öğe seçili okur | asıllar gitti, 1+1 kopya, tick'ler birebir, başka klip değişmedi | `origVGone, origAGone, copiesV, copiesA, mismatchFields, collateral, linkedAnswer, selectedCount, autoLinked` |
| **T4 Sadakat** | kamera (+bağlı ses) ve harici ses ilk boş track'lere clone; start/end/in/out (tick), speed, disabled, name — tolerans 0 | tüm alanlar eşit | `pairs, mismatchFields` |
| **T5 Seçim** | 3 klip (kamera V, kamera A, 1. harici) Adobe kalıbıyla seçilir; "timeline'da seçili görünüyor mu?" | geri okuma birebir + kullanıcı "Evet" | `programmaticOk, setOk, addResults, readCount, userSees` |
| **T6 Geri alma** | T3'ün hemen ardından: kullanıcı 1 kez Ctrl+Z; panel T3 öncesi anahtar listesiyle birebir karşılaştırır | otomatik karşılaştırma aynı + kullanıcı "Hayır" demedi | `userAnswer, restored, tracksAfterUndo` |
| **T7 Ripple** | aynı track'te (A2) arka arkaya iki harici sesin ilki taze seçimle `ripple=false` silinir: önce `mediaType=VIDEO` (anlam ölçümü), silinmezse `AUDIO`; diğer TÜM kliplerin start'ı karşılaştırılır | hedef gitti, hiçbir klip kaymadı | `targetRemoved, shifted, missing, mediaTypeFilters` |
| **T8 Bağlı doğurma (yeni)** | kamera ProjectItem'ı ile `createOverwriteItemAction(pi, aslın start'ı, boş V, boş A)` → V+A birlikte oluştu mu? Sonra her adım ayrı transaction (öncesi taze okuma; yeni klip = T8 öncesinde olmayan tek klip): sıra 1 `SetIn → SetOut → SetStart → SetEnd`, tutmazsa sıra 2 `SetStart → SetEnd → SetIn → SetOut`; T4 gibi karşılaştır; eski kliplere dokunuldu mu kontrol. Kullanıcı yeni videoya tıklar: ses de seçildi mi | birlikte doğdu + tick'ler birebir + kullanıcı "Evet" | `bornTogether, videoBorn, audioBorn, vTrack, aTrack, orderUsed, mismatchFields, touchedOld, linkedAnswer, autoLinked, selectedCount` |

**Karar (`decide`)**: zorunlu = T2, T3, T4, T7. Engel yalnızca `api` sınıfı FAIL'den doğar. T3/T4'te yalnız zaman alanı farkı: T8 geçtiyse
workaround, geçmediyse belirsiz (asla engel değil). T3 tek-transaction başarısız ama T4+T7 çalışıyorsa "iki adımda taşı" workaround'u.
T3 hedef track yokken başka klip değiştiyse belirsiz (T2'nin bulgusu iki kez sayılmaz). T8'de set* iki sırada da tutmazsa belirsiz.
T1/T5/T6/T8 FAIL → workaround.
`kod`/`belirsiz`/eksik varsa öneri "GEÇİCİ". Rapor ÖZET'inde her FAIL `[API]` / `[KOD]` / `[BELİRSİZ]` etiketlidir.

#### Kullanılan Premiere API'leri (hepsi `premierepro.d.ts` 26.5.0)

`npm run api:table` ile üretildi (67 benzersiz referans, 0 hata). v0.1.0'a göre **çıkanlar:** `TrackItemSelectionStatic.createEmptySelection`,
`Application.version`. **Eklenenler:** `Sequence.clearSelection`, `SequenceEditor.createOverwriteItemAction`, `TickTimeStatic.createWithTicks`,
her iki track item tipinde `createSetInPointAction / createSetOutPointAction / createSetStartAction / createSetEndAction`.

| d.ts satırı | API | d.ts'teki satır |
|---|---|---|
| L14 | `premierepro` | `export declare type premierepro = {` |
| L434 | `AudioClipTrackItem.createSetEndAction` | `createSetEndAction(tickTime: TickTime): Action;` |
| L441 | `AudioClipTrackItem.createSetInPointAction` | `createSetInPointAction(tickTime: TickTime): Action;` |
| L455 | `AudioClipTrackItem.createSetOutPointAction` | `createSetOutPointAction(tickTime: TickTime): Action;` |
| L462 | `AudioClipTrackItem.createSetStartAction` | `createSetStartAction(tickTime: TickTime): Action;` |
| L472 | `AudioClipTrackItem.getEndTime` | `getEndTime(): Promise<TickTime>;` |
| L477 | `AudioClipTrackItem.getInPoint` | `getInPoint(): Promise<TickTime>;` |
| L482 | `AudioClipTrackItem.getIsSelected` | `getIsSelected(): Promise<boolean>;` |
| L497 | `AudioClipTrackItem.getName` | `getName(): Promise<string>;` |
| L502 | `AudioClipTrackItem.getOutPoint` | `getOutPoint(): Promise<TickTime>;` |
| L507 | `AudioClipTrackItem.getProjectItem` | `getProjectItem(): Promise<ProjectItem>;` |
| L512 | `AudioClipTrackItem.getSpeed` | `getSpeed(): Promise<number>;` |
| L517 | `AudioClipTrackItem.getStartTime` | `getStartTime(): Promise<TickTime>;` |
| L522 | `AudioClipTrackItem.getTrackIndex` | `getTrackIndex(): Promise<number>;` |
| L537 | `AudioClipTrackItem.isDisabled` | `isDisabled(): Promise<boolean>;` |
| L672 | `AudioTrack.getTrackItems` | `getTrackItems(` |
| L1308 | `CompoundAction.addAction` | `addAction(action: Action): boolean;` |
| L1314 | `CompoundAction.empty` | `readonly empty: boolean;` |
| L1834 | `Guid.toString` | `toString(): string;` |
| L2414 | `ProjectStatic.getActiveProject` | `getActiveProject(): Promise<Project>;` |
| L2493 | `Project.getActiveSequence` | `getActiveSequence(): Promise<Sequence>;` |
| L2520 | `Project.getSequences` | `getSequences(): Promise<Sequence[]>;` |
| L2590 | `Project.setActiveSequence` | `setActiveSequence(sequence: Sequence): Promise<boolean>;` |
| L2598 | `Project.executeTransaction` | `executeTransaction(` |
| L2608 | `Project.lockedAccess` | `lockedAccess(callback: () => void): void;` |
| L2843 | `ProjectItem.getId` | `getId(): string;` |
| L2854 | `ProjectItem.name` | `readonly name: string;` |
| L3112 | `Sequence.clearSelection` | `clearSelection(): Promise<boolean>;` |
| L3117 | `Sequence.createCloneAction` | `createCloneAction(): Action;` |
| L3159 | `Sequence.getAudioTrack` | `getAudioTrack(trackIndex: number): Promise<AudioTrack>;` |
| L3164 | `Sequence.getAudioTrackCount` | `getAudioTrackCount(): Promise<number>;` |
| L3181 | `Sequence.getEndTime` | `getEndTime(): Promise<TickTime>;` |
| L3211 | `Sequence.getSelection` | `getSelection(): Promise<TrackItemSelection>;` |
| L3238 | `Sequence.getVideoTrack` | `getVideoTrack(trackIndex: number): Promise<VideoTrack>;` |
| L3243 | `Sequence.getVideoTrackCount` | `getVideoTrackCount(): Promise<number>;` |
| L3267 | `Sequence.setSelection` | `setSelection(trackItemSelection: TrackItemSelection): boolean;` |
| L3273 | `Sequence.guid` | `readonly guid: Guid;` |
| L3279 | `Sequence.name` | `readonly name: string;` |
| L3288 | `SequenceEditorStatic.getEditor` | `getEditor(sequenceObject: Sequence): SequenceEditor;` |
| L3305 | `SequenceEditor.createRemoveItemsAction` | `createRemoveItemsAction(` |
| L3321 | `SequenceEditor.createInsertProjectItemAction` | `createInsertProjectItemAction(` |
| L3337 | `SequenceEditor.createOverwriteItemAction` | `createOverwriteItemAction(` |
| L3354 | `SequenceEditor.createCloneTrackItemAction` | `createCloneTrackItemAction(` |
| L3887 | `TickTimeStatic.createWithTicks` | `createWithTicks(ticks: string): TickTime;` |
| L3929 | `TickTimeStatic.TIME_ZERO` | `readonly TIME_ZERO: TickTime;` |
| L3986 | `TickTime.seconds` | `readonly seconds: number;` |
| L3992 | `TickTime.ticks` | `readonly ticks: string;` |
| L4024 | `TrackItemSelection.addItem` | `addItem(` |
| L4034 | `TrackItemSelection.removeItem` | `removeItem(trackItem: VideoClipTrackItem \| AudioClipTrackItem): boolean;` |
| L4039 | `TrackItemSelection.getTrackItems` | `getTrackItems(): Promise<Array<VideoClipTrackItem \| AudioClipTrackItem>>;` |
| L4153 | `VideoClipTrackItem.createSetEndAction` | `createSetEndAction(tickTime: TickTime): Action;` |
| L4160 | `VideoClipTrackItem.createSetInPointAction` | `createSetInPointAction(tickTime: TickTime): Action;` |
| L4174 | `VideoClipTrackItem.createSetOutPointAction` | `createSetOutPointAction(tickTime: TickTime): Action;` |
| L4181 | `VideoClipTrackItem.createSetStartAction` | `createSetStartAction(tickTime: TickTime): Action;` |
| L4191 | `VideoClipTrackItem.getEndTime` | `getEndTime(): Promise<TickTime>;` |
| L4196 | `VideoClipTrackItem.getInPoint` | `getInPoint(): Promise<TickTime>;` |
| L4201 | `VideoClipTrackItem.getIsSelected` | `getIsSelected(): Promise<boolean>;` |
| L4216 | `VideoClipTrackItem.getName` | `getName(): Promise<string>;` |
| L4221 | `VideoClipTrackItem.getOutPoint` | `getOutPoint(): Promise<TickTime>;` |
| L4226 | `VideoClipTrackItem.getProjectItem` | `getProjectItem(): Promise<ProjectItem>;` |
| L4231 | `VideoClipTrackItem.getSpeed` | `getSpeed(): Promise<number>;` |
| L4236 | `VideoClipTrackItem.getStartTime` | `getStartTime(): Promise<TickTime>;` |
| L4241 | `VideoClipTrackItem.getTrackIndex` | `getTrackIndex(): Promise<number>;` |
| L4256 | `VideoClipTrackItem.isDisabled` | `isDisabled(): Promise<boolean>;` |
| L4392 | `VideoTrack.getTrackItems` | `getTrackItems(` |
| L4692 | `Constants.MediaType` | `export enum MediaType {` |
| L4804 | `Constants.TrackItemType` | `export enum TrackItemType {` |

Premiere dışı (UXP): `navigator.clipboard.setContent / writeText` (`@adobe/cc-ext-uxp-types` 7.3.1), `require("uxp").versions.uxp`,
`require("uxp").host.name/version` (rapordaki Premiere sürümü).

#### Doğrulama (bulutta yapılan)

- `npm run typecheck` — strict, 0 hata. `npm run lint` — Adobe premierepro kuralları dahil 0 hata. `npm run check:api` — 67 referans, 0 hata.
- `npm run smoke` — `dev/smoke.cjs`. Mock, 26.5.1'de ölçülen tek kesin davranışı uygular: **işlenen transaction'dan sonra eski
  TrackItem/seçim nesneleri "The script object is no longer valid" verir** (başta öz-sınama ile doğrulanır). `createEmptySelection` çağrılırsa
  mock hata verir.
  - **happy** (kullanıcının gerçek düzeni: V1'de 2 kamera, A1 sesleri, A2'de iki harici ses, A3'te bir harici ses): T1–T8 PASS → "UXP yeterli";
    hiçbir bayat referans kullanılmadı; rapor başlığında "Premiere: 26.5.1"; kilit aşamaları (PROBE_ dışı, test ortasında geçiş,
    kopyanın aktif olması, T1 sırasında çıkış, koşu ortasında başka PROBE_*) geçti.
  - **strict:** happy + `clearSelection`/`setSelection` de referansları geçersiz kılar (en kötü ihtimal) → yine T1–T8 PASS.
  - **grim:** createCloneAction "is not a function" (→ T1 `[BELİRSİZ]`, engel DEĞİL), clone track açmıyor (üst track'e yapışır →
    T2 yedek yolla PASS, T3 `[BELİRSİZ]`), overwrite yalnız video (T8 `[API]`), silme ripple yapıyor (T7 `[API]` → **tek engel**),
    kullanıcı her şeye "Hayır" → öneri "CEP'e geç" yalnız ÖLÇÜLEN T7 davranışından.
  - **throw:** olmayan track'e clone/overwrite sınıflanamayan istisna → FAIL'ler `[BELİRSİZ]`, öneri **"GEÇİCİ: UXP + workaround"**
    (istisna tek başına CEP'e götürmüyor).
  - **linked:** Linked Selection seçimi ve silmeyi bağlı partnere genişletir + clone olmayan track'e istisna → T2 yedek yolu eklenenleri
    tek seçimle siliyor, PASS; CEP yok.
  - **filter:** `mediaType` filtre (VIDEO yalnız videoyu siler) → T3 `[KOD]` ("V/A ayrı remove"), T7 filtreyi ölçüyor, CEP yok.
  - Mock'un diğer davranışları TAHMİNDİR (ör. set In/Out/Start/End'in kırpma anlamı); yalnız panelin akışını ve sınıflamayı test eder.
- `npm run package` — `.ccx` kökte `manifest.json` (version 0.1.1), 644/755, açılıp `dist/` ile birebir aynı olduğu doğrulandı.
- **Bağımsız alt ajan incelemesi (v0.1.1, salt okuma; tüm dosyalar baştan sona okundu, 67 referans kendi betiğiyle doğrulandı,
  kendi mock modlarıyla ("linked", "linkdel") hatalar yeniden üretildi):**
  1. Hiçbir TrackItem referansı transaction sınırını aşmıyor — **HOLDS** (her T1–T8 ve T2 yedek yolu adım adım izlendi; `invalidateRefs`
     hata durumunda da çalışıyor; `lastT3` yalnız değer tutuyor).
  2. Seçim kalıbı Adobe örneğiyle aynı — **HOLDS WITH CAVEATS** (`createEmptySelection` yok; clearSelection + geri okuma güvenli ama
     bağlı partnerlere karşı fazla katıydı) → düzeltildi.
  3. PROBE_ kilidi aynen duruyor — **HOLDS**.  4. Her API d.ts'te var — **HOLDS** (67/67, `Application.version` yalnız yorumda).
  - **Sınıflama — kısmen bozuk** bulundu ve düzeltildi: (a) "is not a function / not supported" istisnası `api` sayılıp tek başına CEP
    üretebiliyordu → `classifyError` artık asla `api` döndürmüyor; (b) güvenlik iptalleri (API hiç çağrılmadan) `api` sayılıyordu →
    `belirsiz`; (c) T5'te "Atla" + uygun olmayan seçim `api` idi → `belirsiz`.
  - Diğer bulgular → düzeltmeler: (1) T2 yedek yolunda Linked Selection partneri tür-tür seçimi bozup yanlış CEP veriyordu → eklenenler
    tek seçimle (partner izinli) siliniyor; (2) video silinince bağlı ses de giderse ses geçişi istisna atıyordu → kalanlar her geçişte
    yeniden hesaplanıyor; (3) T8 aynı track'teki eski kamera klibini kırpabiliyordu → yeni klip "T8 öncesinde olmayan tek klip";
    (4) T8'in sabit set* sırası yanlış engel doğurabiliyordu → iki sıra deneniyor, tutmazsa `belirsiz`, T3/T4 zaman farkı asla engel değil;
    (5) T3 tek VIDEO silme mediaType filtre ise sesi bırakır → T7 mediaType anlamını ölçüyor, T3'te bu durum `[KOD]`;
    (6) hedef track yokken T3 çakışması T2 bulgusunu iki kez sayıyordu → `belirsiz`. Ayrıca geri okumada `getSelection` öğeleri artık
    kimlikleriyle (track, start, end, kaynak) karşılaştırılıyor.
  - Bu düzeltmeler yeni mock modlarıyla (linked, filter, yeniden tanımlanan grim) doğrulandı; ikinci bir alt ajan turu yapılmadı.

#### Önceki tur (v0.1.0) incelemesinden düzeltilenler (özet)

T1'in kullanıcı çıkışını geri zorlaması; "Hepsini çalıştır"ın sequence'ı sabitlememesi; önbellekli ad; kilit kontrolsüz seçim yedek yolu;
paylaşılan canlı seçim; koşular arası kalan sonuçlar; T6'nın track açmayla karışması; `decide()` eksik sayımı — hepsi v0.1.0'da düzeltildi.

#### Bilinen belirsizlikler / riskler

1. **d.ts'te "bağlı mı" (link) sorgusu yok.** Bağ, kullanıcının tıklaması + `getSelection`/`getIsSelected` okumasıyla ölçülür (T3, T8).
2. **`createRemoveItemsAction` `mediaType` anlamı belgelenmemiş.** T3 video+ses birlikte silerken VIDEO veriyor (Adobe örneği); ses silinmezse
   rapor "asıl ses gitti mi: HAYIR" der → o zaman ayrı AUDIO silme gerekir.
3. **set In/Out/Start/End action'larının anlamı** (kırpma mı taşıma mı, hangi kenar sabit) belgelenmemiş → T8 her adımdan sonra
   start/end/in/out'u rapora yazar; eşitleme tutmazsa sıra bu satırlara bakılarak değiştirilir.
4. **Overwrite'ın olmayan track index'i ile davranışı** belgelenmemiş (insert için "yeni track açılır" yazıyor). T8 önce mevcut boş track'i seçer.
5. **Clone hedefinde bağlı partner** davranışı: T3 iki clone'u da aynı hedefe yöneltir; partner gelse de gelmese de sonuç 1+1 kopya olmalı —
   `copiesV/copiesA` facts'i bunu doğrular.
6. **T6 Ctrl+Z odağı:** önce timeline'a tıkla / Edit → Undo. Otomatik karşılaştırma yanlış sayıda geri almayı yakalar.
7. **Autosave:** panel kaydetmez; Premiere autosave'i olabilir → deneme projesi önerisi.
8. `settle()` = 400 ms. Snapshot eski durumu görürse (rapor "(yok)" derken timeline'da varsa) artırılmalı.

#### Graphify

Ortamda **kurulu değil** (PATH'te `graphify` yok, npm global'de yok, Claude skill/komut listesinde yok) → `/graphify .` **atlandı**.

#### Sonraki adım

1. Kullanıcı v0.1.1 raporunu getirir (önce eski sürümü kaldırıp yenisini kurar, V2+/A4+ temizler).
2. Özellikle T3 (tek transaction'da taşı), T6 (tek Ctrl+Z), T8 (bağlı doğurma + set* anlamı) sonuçlarına göre SPREAD'in taşıma yolu seçilir:
   bağ gerekiyorsa overwrite + set*, gerekmiyorsa clone + sil — ikisi de **tek transaction**.
3. Mock'u (`dev/smoke.cjs`) rapordaki gerçek davranışa göre güncelle → SPREAD/RE-STACK mantığı Premiere'siz test edilebilsin.
