# Spread 1.2.0 — Kurulum ve Kullanım (Türkçe)

Spread, çok kameralı çekimleri Premiere Pro'da düzenler. Sıra hep aynı:

1. **Dağıt** (SPREAD) — her klibi kendi track'ine dağıtır. Zamanlar değişmez.
2. **Clip → Synchronize** — senkronu Premiere yapar.
3. **Topla** (TOPLA) — oturumları (aynı anda kaydedilmiş kameralar ve sesler) bulur. Onları çekim sırasıyla sequence'ın başından
   dizer; kameraları ve sesleri kendi track'lerine koyar.
4. **Gözle kontrol** — tek elle adım bu.
5. **Bağla** (BAĞLA) — harici sesleri (Zoom, DJI…) her oturumun kendi kamerasına göre keser ve her grubu tek bağ yapar.

Her işlem önce kısa bir onay ister ve **önce yedek sequence** alır. Her adımdan sonra her klibi tick düzeyinde denetler. Bir şey
tutmazsa **durur** ve ne yapacağını tek cümleyle söyler. Kendi başına düzeltme yapmaz. (Günlükte ve raporlarda işlemlerin eski
adları geçer: SPREAD = Dağıt, TOPLA = Topla, BAĞLA = Bağla.)

Ekran görüntüleri: [docs/ekran](docs/ekran) (mock ortamında üretildi).

---

## 1) Kurulum (bir kez) — `Spread_Kurulum_v1.2.0.zip`

**1.2.0 son elle kurulumdur:** bundan sonraki sürümler panelden gelir (bkz. 2a).

1. İndir: <https://github.com/badideagency/bad-spread/raw/main/release/Spread_Kurulum_v1.2.0.zip>
2. Zip'i bir klasöre **çıkart** (sağ tık → Tümünü ayıkla).
3. **KUR.cmd**'ye çift tıkla. **Yönetici olarak çalıştırma.** Yönetici izni gerekmez. Betik şunları yapar:
   - CEP geliştirici kipini açar: `HKCU\Software\Adobe\CSXS.12` ve `CSXS.11` altında `PlayerDebugMode = "1"`. Spread Helper
     imzasız olduğu için bu gerekli. Önceki değerler saklanır; KALDIR.cmd onları geri yükler.
   - **Spread Helper**'ı `%APPDATA%\Adobe\CEP\extensions\com.badideagency.spread.helper` altına kopyalar (eskisinin üstüne).
   - **Spread panelini** (`spread.ccx`) Adobe'nin kurucusuyla (UnifiedPluginInstallerAgent) kurar.
   - Sonunda tek ekranlık bir özet gösterir.
4. Özette **"[ !! ] … spread.ccx dosyasına çift tıkla"** yazarsa, klasördeki `spread.ccx`'e çift tıkla. Creative Cloud kurar;
   "güvenilir kaynak" uyarısına **Yükle** de.
5. **Premiere Pro'yu kapatıp aç.**
6. **Window → UXP Plugins → Spread**: ana panel.
7. **Window → Extensions (Legacy) → Spread Helper**: tek satırlık küçük panel (**"Spread Helper çalışıyor ↻ ●"**).
   - Onu **Spread panelinin arkasına sekme olarak sürükle**, sonra çalışma alanını kaydet: **Window → Workspaces → Save as New
     Workspace**. Ekranda tek panel kalır. Panel görünmezken de bellekte kalması için Premiere'e "kalıcı" denir (Adobe'nin
     `app.setExtensionPersistent` komutu); gerçek Premiere'de arka sekmede çalışmaya devam ettiği henüz doğrulanmadı — kontrol:
     Spread'in üstündeki nokta yeşil kalmalı (Ayarlar → Spread Helper → **Yeniden dene**).
   - Spread'in üstündeki nokta **yeşil** olmalı (üstüne gelince ayrıntı).

**Kaldırmak:** **KALDIR.cmd**'ye çift tıkla. Kurulumun yaptığı her şeyi geri alır:
- paneli ve yardımcıyı kaldırır;
- PlayerDebugMode'u kurulumdan önceki hâline döndürür;
- Spread'in kayıtlarını siler. Masaüstündeki `SpreadRapor_…txt` dosyaları kalır; masaüstüne yazılamadığı için
  `%APPDATA%\BadIdeaAgency\Spread\` altına düşmüş raporlar kayıtlarla birlikte silinir.

## 2) Panel

- **En üstte (yalnız yeni sürüm varsa):** ince krem şerit **"Yeni sürüm 1.x.x · Güncelle"** (bkz. 2a).
- **Üstte:** "Spread", sürüm, **↻** (Yenile) ve yardımcı noktası (yeşil = hazır, gri = kapalı; ayrıntı noktanın ipucunda). Altında
  soluk harfle aktif sequence'ın adı.
  - **↻ Yenile:** Spread Helper'ı ve Spread'i yeniden yükler, timeline'ı baştan okur (panel takılırsa). İşlem sürerken çalışmaz;
    yarım kalmış bir işlem varsa önce sorar.
  - Yardımcı kapalıysa tek satır: **"Spread Helper paneli kapalı: Window › Extensions (Legacy) › Spread Helper"**. Dağıt ve Topla
    yardımcısız da çalışır.
- **Üç adım:** 1 Dağıt, 2 Topla, 3 Bağla.
  - Yalnız **sıradaki** adımın düğmesi görünür (krem, paneldeki tek vurgu). Biten adımda **✓** (uyarılıysa **!**); gelecektekiler soluk.
  - Biten bir adımı yeniden yapmak için **adının üstüne tıkla → "Yeniden çalıştır"**.
  - Adım işaretleri yanlışsa (başka bilgisayar, silinmiş panel verisi, Dağıt'ı atlaman gerekiyorsa): **Ayarlar → Adımı elle
    çalıştır** (Dağıt / Topla / Bağla). İşlemler kendi denetimlerini yine yapar.
  - Dağıt'tan sonra "Sonra: Clip › Synchronize" hatırlatması çıkar.
  - ✓ işaretleri bu panelin bu sequence'ta yaptığı işlere göredir. Bir işlemi elle geri aldıysan ✓ kalabilir; işlemler yine kendi
    denetimlerini yapar.
- **Altta tek satır:** işlem sırasında ilerleme çubuğu ve ne yapıldığı ("Oturum 2–4/4 yerine taşınıyor…"); bitince sonuç ("4 oturum
  toplandı."). Hata **kırmızı** tek satırdır; altındaki **"Ne yapmalıyım?"** ne yapılacağını söyler ("Ctrl+Z × 5 ya da yedek
  sequence …"). Teknik ayrıntı ana ekranda yok — günlükte ve Sorun bildir raporunda.
- **Onay:** başlık + en çok 3 satır + **[Vazgeç] [Devam]**. Dikkat gerektiren şeyler (ÇİFT KOPYA, VETO, ŞÜPHELİ, KAMERA SESİ
  KORUNACAK, SESSİZ KALACAK, KARIŞIK KANAL, EKSİK…) kalın; birden çoksa tek "DİKKAT — … · …" satırında. Silinecekler ve yedek
  satırı önceliklidir; sığmayan satır "(+N satır Sorun bildir raporunda)" diye belirtilir. Tam metin günlükte (→ Sorun bildir).
  - **"Şüpheli klipler"** sorusunda düğmeler **[Oturumda kalsın] [Park'a al]**: "Oturumda kalsın" işlemi sürdürür.
- **Sorun bildir** (sağ altta): tek bir rapor hazırlar. İçinde sürümler, Durum raporu, son Topla/Bağla günlükleri, kalibrasyon
  sonucu, yardımcı durumu ve son hata vardır.
  - Rapor panoya kopyalanır ve masaüstüne `SpreadRapor_<tarih>.txt` olarak kaydedilir. Masaüstüne yazılamazsa
    `%APPDATA%\BadIdeaAgency\Spread\` altına kaydedilir.
  - Bir şey ters gittiğinde bunu bana gönder. Düğme işlem sürerken de (ör. onay beklerken) çalışır.
  - Premiere çöktüyse ya da panel yeniden açıldıysa rapor **önceki oturumların günlüğünü** de içerir: günlük dosyası
    önceki açılışları da tutar (son ~4000 satır).
- **Ayarlar** (sol altta, dişli simgesi; ayrı görünüm, **← Geri** ile dönülür):
  - ses kaynakları → A track (hangi ses hangi A track'e, "Sil");
  - güçlü bağ eşiği ve oturum arası boşluk;
  - Spread Helper ayrıntısı (gerçek hata metni) ve **Yeniden dene**;
  - **Güncellemeleri denetle**;
  - Durum raporu (+ **Raporu kopyala**);
  - ayrıntılı günlük.
- Ayrıntılı günlük her zaman arka planda da tutulur: `%APPDATA%\BadIdeaAgency\Spread\spread-gunluk.txt`.
- Görünüm (1.2.0): BadIdea koyu teması — sıcak koyu zemin, krem yazı, tek vurgu rengi (krem), yumuşak köşeler, gölge yok.
  Premiere açık temadayken de koyu kalır. Yazı tipi Premiere'in kendi arayüz yazı tipidir (UXP panele yazı tipi paketlemeye izin
  vermiyor). Spread Helper aynı dilde.

## 2a) Güncelleme (1.2.0'dan sonra panelden)

- Spread açılışta ve 6 saatte bir yeni sürüm var mı diye bakar (Ayarlar → **Güncellemeleri denetle** ile elle de). İnternet
  yoksa sessizce geçer.
- Yeni sürüm varsa üstte **"Yeni sürüm 1.x.x · Güncelle"** şeridi → tıkla → notlar (1–3 madde) → **[Şimdi değil] [Güncelle]**.
- Güncellemeyi **Spread Helper** yapar (açık olmalı; kapalıysa şerit "Güncellemek için Spread Helper açık olmalı" der):
  1. paketi indirir ve **sha256** ile doğrular — tutmazsa hiçbir şeye dokunmaz;
  2. Spread Helper klasörünü **yedekler**, yenisini yazar — yarıda kalırsa yedeği geri koyar (eski sürüm yerinde);
  3. Spread panelini Adobe'nin kurucusuyla kurar; kuramazsa Creative Cloud'un **Install** penceresini açar → **Install**'a bas.
- Sonra **"Projeyi kaydedip Premiere'i yeniden başlatayım mı?" [Sonra] [Yeniden başlat]**. "Yeniden başlat": açık projelerin hepsi **kaydedilir** ve
  kaydedildiği dosyadan doğrulanır; biri bile doğrulanamazsa (ör. hiç kaydedilmemiş "Adsız" proje) **Premiere kapatılmaz**.
  Kapanınca birkaç saniye içinde aynı projeyle yeniden açılır.
- Güncelleme günlüğü Sorun bildir raporuna eklenir.

## 3) Günlük kullanım

- Gerçek projenin bir kopyasında çalışmak her zaman iyi fikir: **File → Save As…**
- Timeline'da **Linked Selection** (zincir simgesi) **açık** olsun.

### a) Dağıt → Synchronize (bu kopyada daha önce yapmadıysan)

- **Dağıt** → **Devam**. Sonra **Clip → Synchronize**. Menü gri ise: timeline'a tıkla, **Ctrl+A**, sağ tık → **Synchronize → Audio**.
- **"N kamera klibi kırpılmış … Spread BAŞLAMADI"** derse, o kamera kliplerinin başı ya da sonu kesilmiş demektir. Hiçbir şey değişmedi.
  - Kırpmayı kaldır: klibi tam boy yap.
  - Ya da o kameraları SPREAD'den ayrı tut.

### b) Ses kaynakları ve ayarlar (Topla'dan ÖNCE)

- **Ayarlar** altında **"Ses kaynakları → A track"** listesinde sequence'taki kaynaklar görünür: "Zoom Tr1", "Zoom Tr2",
  "Zoom TrLR", "DJI"… Görünmezse **Kaynakları tara**'ya bas.
- Her kaynağa bir **A track** seç ya da **"Sil"** de (ör. TrLR'yi istemiyorsan). Panel seçimini hatırlar.
  Bu seçimi **TOPLA'dan önce** yap. TOPLA kullandığı eşlemeyi ve eşiği **hatırlar**. Sonradan değiştirirsen BAĞLA hiçbir şeye
  dokunmadan **"Ayar TOPLA'dan sonra değişti — TOPLA'ya tekrar bas"** der ve neyin değiştiğini yazar. TOPLA'ya bir kez daha basman yeter.
- **Güçlü bağ eşiği (%)**: varsayılan 90, dokunma. İki kayıt, kısa olanın en az bu kadarı üst üste geliyorsa aynı oturum sayılır.
  12 Eylül verinde doğru eşleşmelerin en düşüğü %97.96, yanlış çakışmaların en yükseği %49 çıktı.
- **Oturum arası boşluk (sn)**: TOPLA'da oturumların arasına konan boşluk; varsayılan 2.

### c) Topla

- **Topla**'ya bas. Panel önce bulduklarını ayrıntılı günlüğe yazar: güçlü bağlar (yüzdeleriyle), oturumlar, sahipsiz kayıtlar.
- Sonra onay ister. Özette oturum ve klip sayısı, silinecek çiftler ve dikkat gerektiren satırlar görünür. Tam metin
  günlükte (Ayarlar ▸ Günlük, Sorun bildir raporu); örnek:
  ```
  TOPLA — 4 oturum, sırayla sequence başından (aralarında 2.000 sn):
    O1  Zoom 260912_133224 + A: A038C001_260912BD + Sony: C0142  → 0.000 s'den başlar
    O2  Zoom 260912_141513 + A: A038C002_260912RQ + Sony: C0143  → 1557.320 s'den başlar
    …
  ÇİFT KOPYA — ilk adımda silinecek (…): A27 "260912_133224_Tr1.WAV" (A26 kalır); A30 "260912_133224_Tr2.WAV" (A29 kalır)
  Track'ler: A → V1, Sony → V2; Zoom Tr1 → A1; Zoom Tr2 → A2; korunan kamera sesi (BAĞLA'da, harici sesin olmadığı aralıklar) → A3; Zoom TrLR → A4 (sil); kılavuz sesler → A5–A6.
  ```
  Oturumların sırası kamera sayaçlarından (A038C001, C0142…) ve Zoom saatlerinden (133224…) gelir. Hepsi aynı sırayı vermezse panel sorar.
- **Çift kopya** = aynı dosya, aynı start/end/in/out, iki ayrı track'te.
  - **Harici ses** çiftinde (Zoom, DJI…) panel en küçük numaralı track'tekini tutar. Ötekileri **ilk adımda** siler (yedekten hemen
    sonra; diğer klipler kaymaz).
  - Onay penceresinde "ÇİFT KOPYA — ilk adımda silinecek" satırında hangisinin silinip hangisinin kaldığı yazar.
  - 12 Eylül verinde A27 ve A30 silinir; A26 ve A29 kalır.
  - Aynı dosyanın **başka bir yerdeki** kopyası çift sayılmaz.
  - **Kamera klibi** çiftinde TOPLA **başlamaz**: "KAMERA klibinin çift kopyası var … elle sil" der, hiçbir şey değişmez.
    - Neden: kopyalanan kamera klibinin sesi, aslının sesiyle aynı dosya ve aynı zamanda. Panel hangi sesin hangi kopyaya ait olduğunu
      okuyamaz. Yanlış sesi silebilir ya da sesi iki kez tutabilir.
    - Yapılacak: fazla kopyayı **videosu ve sesiyle birlikte** elle sil, sonra TOPLA'ya tekrar bas.
- **Sahipsiz** kayıt, hiçbir şeyle eşleşmeyen kayıttır (ör. 1 sn'lik tek kamera klibi). Silinmez: en alttaki "park" track'lerine konur, zamanı değişmez.
  Panel park ettiklerini **hatırlar**. Sonraki TOPLA ve BAĞLA onları oturumlara karıştırmaz, yeni düzende uzun bir kaydın altına denk gelseler bile.
- **"PARK KAYDI"** sorusu: son TOPLA'dan sonra düzeni elle değiştirmişsin ve panel, park ettiği klipleri hâlâ park'ta tutup tutmayacağını soruyor.
  - **Evet**: park'ta kalırlar, oturumlara karışmazlar.
  - **Hayır**: hiçbir şey değişmez.
  - TOPLA'yı Ctrl+Z ile **tamamen** geri aldıysan panel bunu kendisi tanır ve sormaz; her şeyi senkron sonucundan yeniden bulur.
- **"AYNI KAYIT BÖLÜNMÜŞ"** sorusu: bir kaydın (ör. aynı Zoom dosyası) bir parçası park'ta, bir parçası bir oturumda.
  - **Evet**: park'taki parça oturumuyla birlikte, aynı kaymayla taşınır.
  - **Hayır**: hiçbir şey değişmez.
- **"ŞÜPHELİ ÜYE"** sorusu: kısa bir klip (ör. 1 sn) bir oturuma yalnız çok uzun bir kaydın **içine düştüğü** için bağlı görünüyor.
  Senkron onu eşleyememiş ve rastgele bir yere bırakmış olabilir.
  - **Evet**: o klip park track'lerine gider, zamanı değişmez. BAĞLA ona dokunmaz.
  - **Hayır**: oturumda kalır, BAĞLA ona da ses keser.
- **"AYRILAMAYAN OTURUM"** sorusu: iki ilgisiz grup iç içe gelmiş ve panel hangisinin hangisi olduğunu kesin bilemiyor, tahmin de etmiyor.
  - **Hayır**: hiçbir şey değişmez. Bu grupları Premiere'de ayrı ayrı senkronlamak iyi bir çözüm.
  - **Evet**: o kayıtlar zamanı değişmeden park track'lerine gider, diğer oturumlar dizilir.
- **"VETO: …"** satırı (TOPLA onayında): aynı cihazın iki kaydı üst üste geldiği için panel bir bileşeni oturumlara ayırdı.
  **İki Sony gövdesi** (ikisi de C0xxx) panel için tek cihazdır. Aynı anda kayıt yaptılarsa bu satır gerçek bir oturumu ikiye bölüyor olabilir.
  Böyle bir satır görürsen **Hayır** de ve bana getir.
- **ÖNEMLİ — aynı adlandırmayla kaydeden iki gövde:** Aynı çekimde, dosyaları aynı biçimde adlandıran iki kamera kullanacaksan (ör. iki
  Sony gövdesi, ikisi de `C0001, C0002…`), **çekimden ÖNCE birinin dosya adı önekini kamerada değiştir.** Nasıl yapılacağını kameranın
  kılavuzunda "dosya adı / başlık / clip name" ayarı altında bul.
  - Neden: panel cihazı dosya adından tanır.
    - Aynı adlandırmayı kullanan iki gövde onun için **tek cihazdır**. Üst üste kayıtları "aynı cihazın iki kaydı çakışıyor" sayılır ve
      gerçek bir oturum ikiye bölünebilir.
    - İki gövde **aynı dosya adını** üretirse (ikisinde de `C0001`), panel ikisini aynı kaydın parçası sanır. TOPLA "aynı kaydın klipleri
      farklı senkron konumunda" deyip durur.
  - Önek nasıl olmalı: panel, adın **rakamlar atılmış hâlini** cihaz, sondaki sayıyı sayaç sayar.
    - Önekler **harflerle** ayrılmalı. `CAM1_`/`CAM2_` ya da `FX3_`/`FX30_` gibi yalnız rakamla ayrılan önekler yine aynı cihaz olur.
    - Önek **tek harf olmamalı**. `B0001` gibi bir ad, sinema kamerası B'yle (`B001C001_…`) aynı cihaz sayılır.
    - İyi örnek: bir gövde `C0001…` (Sony) olarak kalır, diğeri `SONYB_0001…` olur. Her dosyada önek aynı kalmalı, sayaç artmalı.
- **"OTURUM SIRASI ÇELİŞKİLİ"** sorusu: kameraların sayaçları farklı sıra söylüyor.
  - **Hayır**: hiçbir şey değişmez.
  - **Evet**: oturumlar senkronun bıraktığı sırayla dizilir.
- **"OTURUM SIRASI … BELİRLENEMEDİ"** sorusu: bazı oturumların ortak cihazı yok, sayaçlardan sıraları çıkmıyor.
  Panel kullanacağı sırayı gösterir. Bu sıra, sayaçların bildiği bütün kısıtlara uyar; bilinmeyen yerde senkronun bıraktığı sıra kullanılır.
  - **Hayır**: hiçbir şey değişmez.
  - **Evet**: gösterilen sırayla dizilir.
- **Evet** dersen panel önce yedek sequence alır, sonra şu sırayla ilerler:
  1. İlk oturumu **tek başına** park eder ve ölçer.
  2. Diğer oturumları park eder.
  3. İlk oturumu **tek başına** yerine koyar ve ölçer.
  4. Diğer oturumları yerine koyar.

  Her adımdan sonra her klibi tick düzeyinde karşılaştırır.
- **"İLK TAŞIMA TUTMADI"** yazarsa Premiere kaydırmayı beklenen biçimde yapmamıştır. Panel yazdığı kadar Ctrl+Z bas (ya da yedeği kullan) ve raporu getir.
- Sonunda yeşil **"✓ 4 oturum toplandı."** ve **"Şimdi timeline'ı gözle kontrol et, sonra BAĞLA."**

### d) Gözle kontrol (tek elle adım)

- Oturumlar çekim sırasıyla, sequence'ın başından, aralarında 2 sn boşlukla dizilmiş olmalı. Hiçbir oturum diğerine binmemeli.
- **V1**: A kamera, **V2**: B kamera (toplam süreler eşitse ada göre).
- **A1, A2, …**: seçtiğin kaynaklar.
  - Altında **boş** bir "korunan kamera sesi" track'i durur. Kamera birden çok ses kanalı kaydediyorsa kanal başına bir track olur.
    BAĞLA, harici sesin olmadığı yerlerde kamera sesini buraya koyar.
  - Onun altında "Sil" dediğin kaynaklar, en altta kamera kılavuz sesleri durur. İkisi de kontrol için orada; BAĞLA siler.
    BAĞLA'dan sonra boşalan bu track'ler en altta kalır.
- En altta park track'lerinde sahipsizler, zamanları değişmeden.
- Oturum içinde Zoom ile kamera, senkronun bıraktığı gibi hizalı kalmalı.
- Beğenmezsen: panelde yazan sayıda **Ctrl+Z** bas ya da yedek sequence'ı kullan. Genelde 4 kez; çift kopya silindiyse 5 kez.

### e) Bağla (KES + bağla)

- Spread panelinde **Bağla**'ya bas.
  - Önce yardımcıya (köprü) bakar. Köprü yoksa **durmaz**: günlüğe gerçek hatayı yazar ve yalnız KES yapacağını söyler.
  - Sonra planı yazar: oturumlar, her oturumun grupları, çapalar (grubun en uzun kamera klibi) ve ses parçaları. Ardından sorar.
  - Kesim **yalnız oturum içinde**: bir Zoom/DJI kaydı sadece kendi oturumundaki kameraların çapasına göre kesilir.
  - Oturumda harici ses yoksa (ör. sadece iki kamera) kamera sesi **korunur** ve kameralarla bağlanır.
  - Oturumda hiç kamera yoksa (ör. yalnız Zoom + DJI) o oturumun seslerine **dokunulmaz**: kesilmez, silinmez, bağlanmaz.
  - Onay penceresinde **"KAMERA SESİ KORUNACAK"** satırları çıkabilir. Bunlar, BAĞLA'dan sonra 1 sn'den uzun süre Zoom/DJI **parçası
    olmayacak** yerlerdir. İki tür vardır:
    - çapanın içindeki boşluklar: orada harici ses hiç yok, satırda "çapa içinde harici ses yok" yazar;
    - çapadan taşan kamera kısımları: harici ses çapaya göre kesildiği için oraya ulaşmaz, Zoom orada kayıt yapıyor olsa bile. Satırda
      "çapa dışında" yazar.
    - Oralarda kamera sesi silinmez. Kamera sesi **yalnız o aralığa** kesilir, "korunan kamera sesi" track'ine konur ve gruba bağlanır.
    - Aralığı birden çok kamera kapsıyorsa grubun en uzun kamerasının sesi kullanılır.
    - **1 kare ya da daha kısa** parça olmaz. Böyle bir parça, yanındaki kameranın sesine katılır. Yanındaki kamera orayı kapsamıyorsa atlanır ve
      günlüğe "≤ 1 kare → korunan kamera sesi parçası OLUŞTURULMADI" diye yazılır.
    - 12 Eylül verinde iki satır çıkar:
      - A038C001'in başı, 2.3 sn;
      - A038C002'nin sonu, 41.8 sn.

      C0143, çapadan 1 kare (0.04 sn) sonra bitiyor. Bu son kare atlanır ve günlükte uyarı olarak görünür.
  - **"SESSİZ KALACAK"** satırı iki durumda çıkar. BAĞLA'dan sonra orada ses kalmaz; kabul etmiyorsan **Hayır** de, hiçbir şey değişmez.
    - O aralıkta sesi olan hiçbir kamera yoktur (ör. sessiz kaydeden bir kamera).
    - Her biri 1 sn'den kısa boşlukların toplamı 1 sn'yi geçer. Bunlar senkron kenar payı sayılır ve kamera sesi korunmaz.
  - **"KES'ten sonra üst üste binecek: …"** derse: bir track'te, örneğin boş olması gereken "korunan kamera sesi" track'inde başka bir
    klip duruyor. Hiçbir şey değişmedi; o klibi başka bir track'e al ve tekrar bas.
  - **"TOPLA'ya tekrar bas (v0.3.3 track çerçevesi)"** derse: sequence eski sürümle toplanmış ve korunan kamera sesi track'i yok.
    TOPLA'ya bir kez bas (track'leri düzenler), sonra BAĞLA'ya.
- **Evet** → yedek sequence → sırasıyla:
  - **KALİBRASYON**: yalnız bu sequence'taki ilk kesimde yapılır; ayrıntısı aşağıda;
  - **kesim hazırlığı**: kılavuz sesler (harici sesi olan gruplarda; korunacak aralıklar kesilmek üzere ayrılır) ve "Sil" dediğin kaynaklar silinir;
  - **ilk parça**: bir ölçüm, bkz. aşağı;
  - **parçalar**;
  - **yerleştir**;
  - **KES planı** yazılır: yardımcının klasöründeki `link-plan.json`.
- Sonra:
  - **Yardımcı hazırsa** gruplar hemen bağlanır. Sonuç: **"✓ N grup bağlandı."**
  - **Yardımcıya köprü yoksa** sonuç sarı olur: **"⚠ Kesim tamam; N grup bağlanmayı bekliyor"** ve
    "**Spread Helper panelinde BAĞLA'ya bas**". Spread Helper panelinde BAĞLA bölümü kendiliğinden belirir.
- **Spread Helper panelindeki BAĞLA**:
  - KES planını okur ve aktif sequence'ı kendisi okur.
  - Grupları Spread'in **aynı** kuralıyla bulur: zamanda çakışan kameralar + çapanın içindeki ses parçaları.
  - Planla **birebir** karşılaştırır (tick düzeyinde). Aynıysa bağlar ve grup grup sonucu yazar: ✓ tamam / ⚠ doğrulanamadı / ✗ neden.
  - Aynı değilse **hiçbir şey yapmaz** ve farkı yazar. Örnekler: KES'ten sonra bir parça kaydırılmış ya da silinmiş, başka bir sequence açık, KES geri alınmış.
  - Bir kısım grup bağlanamazsa hangilerinin bağlandığını tek tek yazar. Yeniden basmak güvenlidir.
  - Spread'in **Durum raporu** panelde yapılan bağlamayı da gösterir.
  - Plan dosyası yazılamadıysa Spread bunu söyler ve planı **Ayarlar ▸ Durum raporu** kutusuna koyar. **Raporu kopyala** →
    Spread Helper panelinde **durum satırına tıkla** → **Planı yapıştır** kutusuna yapıştır → altındaki **Bağla**.
- **KALİBRASYON** nedir: panel, Premiere'in dört kırpma komutunun (SetOutPoint, SetEnd, SetInPoint, SetStart) ne yaptığını
  tahmin etmez, **ölçer**.
  - Nasıl:
    - Kesilecek ilk sesin 5 geçici kopyasını sequence sonunun ötesine koyar.
    - Her kopyada **tek** komutu **ayrı bir adımda** dener ve sonucu okur.
    - Kopyaları siler. Düzenin eskisiyle birebir aynı olduğunu doğrular.
    - Sonra seçtiği kuralın baş ve kuyruk komutlarını 5. kopyada **aynı adımda birlikte** dener. Gerçek parçalarda iki kenar birlikte
      kırpılır; bu yüzden "birlikte" de ölçülür.
  - Toplam **7 adım** sürer ve geri alma geçmişine 7 kayıt ekler. Düzeni değiştirmez.
  - Sonuç bu sequence için saklanır. Sonraki BAĞLA'lar yeniden ölçmez; Premiere sürümü değişirse yeniden ölçer.
    Premiere sürümü okunamıyorsa sonuç saklanmaz ve her BAĞLA'da yeniden ölçülür.
  - Ayrıntılı günlükte (Ayarlar ▸ Günlük) **"KALİBRASYON SONUCU (kanıtlanmış — Premiere …)"**
    bloğu çıkar. **Sorun bildir** raporu da bunu içerir. **Bu bloğu bana getir**; handoff'a gerçek ölçüm
    olarak işleyeceğim. Aynı bilgi Durum raporunda da var.
  - Sonra kırpma, ölçülen kurala göre yapılır:
    - kuyruk için tek komut (SetOutPoint ya da SetEnd);
    - baş için tek komut (SetInPoint ya da SetStart; ikisi de tek başına işe yaramıyorsa ikisi birlikte);
    - değişmeyen kenara hiç komut gitmez.
- **"KALİBRASYON TUTARLI BİR KURAL VERMEDİ"** yazarsa hiçbir kesim yapılmamıştır.
  - Geçici kopyalar silinmiş, timeline BAĞLA öncesiyle birebir aynıdır. Geri alman gerekmez.
  - Mesaj **yedek planın** (Spread Helper'da QE razor) gerektiğini yazar. Bu sürüm yedek planı **çalıştırmaz**: o komut Adobe
    belgelerinde yok ve gerçek Premiere'de ölçülmedi. Tahminle kesim yapılmaz.
  - Yedek planın önce bir yoklamayla ölçülüp ölçülmeyeceği **senin kararın**.
  - Tekrar basmak büyük olasılıkla aynı sonucu verir. Mesajdaki ölçümleri bana getir.
- **"İLK PARÇA TUTMADI"** yazarsa: ölçülen kural ilk parçada tutmamıştır ve panel orada durmuştur.
  - Panelin yazdığı kadar **Ctrl+Z** bas (ya da yedek sequence'ı kullan) ve raporu bana getir. Bu sayıya kalibrasyonun 7 adımı da dahil.
  - Kalibrasyon kaydı silinir; bir sonraki BAĞLA yeniden ölçer.
- Sarı **`⚠ BAĞLA bitti ama … bağı DOĞRULANAMADI`** görürsen: Premiere "bağlandı" dedi ama panel bunu okuyarak teyit edemedi.
  Bu durumda aşağıdaki kontrol yeterli; bağ yoksa satırları bana getir.
- **"Önce TOPLA'ya bas: bu sequence için TOPLA kaydı yok"** derse: BAĞLA yalnız TOPLA'nın bu panelde, **bu sequence'ta** tamamladığı
  düzende çalışır. Yedek sequence'ta çalışıyorsan orada da önce TOPLA'ya bas.
- **"düzen TOPLA düzeninde değil"** ya da **"Ayar TOPLA'dan sonra değişti"** derse: TOPLA'dan sonra bir klip yer değiştirmiş, eşleme
  ya da eşik değişmiş. Hiçbir şey değişmedi. TOPLA'ya bas, sonra BAĞLA'ya.
- **Mono + stereo (v1.1.0):** Premiere bir bağda farklı kanal tipindeki sesleri kabul etmiyor (Adobe: bağdaki bütün ses klipleri
  aynı kanal tipinde olmalı). Bu yüzden:
  - **Zoom TrLR** (stereo karışım) için seçim yapmadıysan varsayılan **"Sil"**dir (Ayarlar'dan değiştirilebilir). 1.0.0'dan
    yükseltmede kayıtlı TrLR seçimi bir kez "Sil"e çevrilir (1.0.0 her eşlemeyi kendiliğinden kaydettiği için seçimin senin mi
    otomatik mi olduğu bilinemiyor); böyle toplanmış bir sequence'ta Bağla "Topla'ya tekrar bas" der.
  - Onayda bir grupta mono + stereo varsa tek satır: **"KARIŞIK KANAL: N grupta mono + stereo…"** (tipler Spread Helper'dan okunur).
  - Premiere grubu reddederse yardımcı, grubun asıl tipinden (en çok sesin tipi; eşitse en üstteki A track'inki) farklı sesleri
    **çıkarıp grubu yeniden bağlar**. Çıkarılanlar **bağ dışında, yerinde** kalır — **hiçbir klip silinmez**; sonuç satırında
    "N ses bağ dışında kaldı" yazar, hangileri olduğu günlükte / Sorun bildir raporunda.
  - Stereo kamera sesinin korunan parçası da buna dahil. Onu tek kanala (mono) çevirmenin belgelenmiş bir yolu yok (Premiere'in
    Modify › Audio Channels'ı timeline'daki kliplere etki etmiyor) → bağ dışında kalır.
- **Kesimden sonra bir parçayı elle sildiysen** ve Bağla'ya yeniden bastıysan: Spread durmaz, **var olanları bağlar**, eksikleri yazar
  (onayda "EKSİK: N öğe"). Bir grubun **çapa kamerası** silindiyse gruplar değiştiği için hiçbir şey yapmadan durur. Kesimi
  **Ctrl+Z** ile (kısmen) geri aldıysan bu "elle silinmiş" sayılmaz: Bağla durur (önce kalanını da geri al ya da yedeği aç).
- Bağlama adımında yardımcı düşerse (**"… grup bağlanamadı (kesme/silme doğru ve yerinde)"**), yardımcıyı düzelt ve **BAĞLA'ya tekrar bas**,
  ya da Spread Helper panelinde durum satırına tıkla → **Bağla**. Panel kesimi hatırlar; bu kez **yalnız bağlar**. Yeniden kesmez, yedek almaz.
- **BAĞLA'dan sonra TOPLA** çalışmaz. Harici sesler kesildiği için oturumları bulduran tam kayıtlar artık yok; panel tahmin etmez.
  Yeniden toplamak istersen BAĞLA öncesi yedek sequence'ı kullan ya da BAĞLA'yı Ctrl+Z ile tamamen geri al.
- **"… YARIM hâlde"** derse: önceki bir TOPLA ya da BAĞLA durmuş ve geri alınmamış. Önce o mesajdaki kadar Ctrl+Z bas (ya da yedeği kullan).
- Kontrol: bir kamera klibine tıkla. O grubun kameraları ve ses parçaları birlikte seçilmeli (Linked Selection açıkken). Başka oturumun sesi seçilmemeli.

## 4) Bir şey ters giderse

- **Beğenmediğin bir sonuç:** sonuç satırında kaç kez **Ctrl+Z** basacağın yazar (önce timeline'a tıkla). Ya da işlemin aldığı
  yedek sequence'ı kullan. Bağlama adımı Premiere'in geri alma geçmişine ayrıca kayıt ekleyebilir (ölçülmedi); en güvenli dönüş yedek
  sequence'tır.
- **Panel durdu ya da tuhaf bir şey oldu:** **Sorun bildir**'e bas ve raporu gönder.
- **Düğmeler gri:** aktif sequence yok → timeline'a bir kez tıkla, 2 sn bekle.
- **"Spread Helper paneli kapalı":** Window → Extensions (Legacy) → Spread Helper panelini aç. Hâlâ kapalıysa: **Ayarlar ▸ Spread Helper**'daki
  gerçek hata metnini getir. Bu arada bağlama için Spread Helper panelindeki **BAĞLA**'yı kullanabilirsin; köprü gerekmez.
- **Spread Helper menüde yok:** KUR.cmd'yi yeniden çalıştır ve Premiere'i yeniden başlat. Hâlâ yoksa: CEP günlüğü ile bakarız
  (Sorun bildir + haber ver).
- **Panel kurulmuyor / "UPI status -160":** `spread.ccx`'e çift tıkla. Olmazsa aescripts ZXP/UXP Installer'a sürükle-bırak, Premiere'i
  yeniden başlat.
