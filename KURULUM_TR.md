# Spread v0.3.3 — Kurulum ve Kullanım (Türkçe, adım adım)

**Spread v0.3.3**'ün işleri. Sıra hep aynı:

1. **SPREAD**: her klibi kendi track'ine dağıtır. Zamanlar değişmez.
2. **Clip → Synchronize**: senkronu Premiere yapar.
   Premiere birbiriyle ilgili klipleri doğru hizalar, ama ilgisiz grupları rastgele ve üst üste koyar. Bu normal; TOPLA düzeltir.
3. **TOPLA**:
   - Önce **oturumları** bulur: aynı anda kaydedilmiş kameralar ve sesler. Bunu senkronun sonucundan yapar, dosya adından değil.
   - Oturumları **çekim sırasıyla** sequence'ın başından dizer; aralarında 2 sn boşluk bırakır.
   - Bir oturumun içindeki klipler birbirine göre hiç kaymaz.
   - Kameraları kendi V track'lerine, sesleri seçtiğin A track'lerine koyar.
4. **Gözle kontrol**: tek elle adım bu.
5. **BAĞLA** iki aşamadır:
   - **KES** (Spread paneli): her oturumun içinde harici sesleri o oturumun kamerasına göre keser. Bir oturumun sesi başka oturumun
     kamerasına asla kesilmez. Kamera seslerini ve "Sil" dediğin kaynakları siler. Oturumda harici ses yoksa kamera sesini korur.
   - **BAĞLA**: her grubu (kameralar + ses parçaları) **tek bağ** yapar. Bunu yardımcı yapar (Premiere'in UXP'sinde bağlama komutu yok).
     Yardımcıya köprü çalışıyorsa Spread'deki BAĞLA ikisini **tek tıkla** yapar. Çalışmıyorsa Spread KES'i yapar ve
     "**Spread Helper panelindeki BAĞLA'ya bas**" der.

**Spread Helper** artık **görünür, küçük bir panel**: **Window → Extensions (Legacy) → Spread Helper**. Bir kez kurarsın, açarsın,
açık bırakırsın; Premiere onu çalışma alanında hatırlar. Panel neyin çalışıp neyin çalışmadığını açıkça gösterir.

Her işlem önce onay sorar ve **önce yedek sequence** alır. Her adımdan sonra her klibin zamanını tek tek karşılaştırır. Bir şey tutmazsa **durur**, ne olduğunu ve **kaç kez Ctrl+Z** basacağını yazar. Kendi başına düzeltme yapmaz.

---

## 1) Spread panelini güncelle (v0.3.3)

- İndir: <https://github.com/badideagency/bad-spread/raw/claude/sweet-bell-do4j75/release/spread.ccx>
- `spread.ccx`'e **çift tıkla**, Creative Cloud'da **Install / Yükle**'ye bas. Eski Spread'in üstüne kurulur.
  Hata verirse: önce Creative Cloud → **Manage plugins** → Spread → **Uninstall**, sonra tekrar çift tıkla.
- **Premiere Pro'yu kapatıp aç.** Paneli aç: **Window → UXP Plugins → Spread**. Başlıkta **"Spread v0.3.3"** yazmalı.
- Kurulumda "dosya sistemi / ağ izni" sorulursa **izin ver**. Panel yalnız bilgisayarın içindeki yardımcıyla konuşur
  (`localhost:47731`), internete çıkmaz.

## 2) Yardımcıyı kur (bir kez) — Spread Helper paneli

`.zxp` bu sürümde YOK. ZXP Installer'ın reddettiği önceki paketin iki kusuru vardı:
- yardımcının `manifest.xml` dosyası **geçerli XML değildi**, bu sürümde düzeltildi;
- imzasında zaman damgası yoktu. Adobe'nin imzalama aracı böyle paketin "diğer araçlarca büyük ihtimalle reddedileceğini" söylüyor.

Ana yol **klasör kurulumu**:

1. İndir: <https://github.com/badideagency/bad-spread/raw/claude/sweet-bell-do4j75/release/spread-helper-klasor.zip>
   ve bir klasöre **çıkart**.
2. **`PlayerDebugMode_CSXS12.reg`**'e çift tıkla → **Evet**. Bunu daha önce yaptıysan tekrar yapman zararsız.
   - Bu adım artık **gerekli**, çünkü yardımcı imzasız.
   - Bu ayar senin hesabındaki bütün CEP eklentilerinin imza denetimini gevşetir. Nasıl geri alınacağı BENIOKU.txt'te.
3. **`KUR.cmd`**'ye çift tıkla. Windows "bilinmeyen yayıncı" derse **Ek bilgi → Yine de çalıştır**'a bas.
   - Betik, eski yardımcıyı siler ve yenisini `%APPDATA%\Adobe\CEP\extensions\com.badideagency.spread.helper` altına kopyalar.
   - PlayerDebugMode'u da kontrol eder: "DIKKAT" yazarsa adım 2'yi yap.
4. **Premiere Pro'yu tamamen kapatıp aç.**
5. **Window → Extensions (Legacy) → Spread Helper**'ı aç. Paneli açık bırak ya da bir yere yerleştir; Premiere çalışma alanıyla birlikte
   hatırlar. **Panel kapanınca sunucusu da durur.** Panelde şunlar görünmeli:
   - yeşil **"● dinliyor: localhost:47731 (127.0.0.1 …)"**;
   - Premiere sürümü, yardımcı sürümü (0.3.3), Node sürümü;
   - **son istek**: Spread panelinden gelen son istek. Spread'de **Yardımcıyı kontrol et**'e basınca burada `POST /v1/ping → 200` görünür.
6. Spread panelinin üstünde **"Yardımcı: bağlı — (yardımcı 0.3.3, Premiere …)"** yazmalı.

**Çalışmazsa** panel artık gerçek hatayı yazar. Satırı aynen bana getir:
- **Menüde Spread Helper yok** ya da panel boş → yardımcı yüklenmemiş.
  - Önce PlayerDebugMode'a (adım 2) bak ve Premiere'i tamamen kapatıp açtığından emin ol.
  - Sonra zip'teki **`CEP_GUNLUK_AC.reg`**'e çift tıkla → Evet ve Premiere'i kapatıp aç.
  - `%TEMP%` klasöründeki **`CEP12-PPRO.log`** dosyasını bana getir. Neden yüklenmediğini yazar, ör. "Signature verification failed".
- Panel açık ama **"✗ SUNUCU BAŞLAMADI: …"** → oradaki hatayı getir.
  - Örneğin "EADDRINUSE" portun kullanımda olduğunu gösterir: ikinci bir Spread Helper paneli açıktır ya da başka bir program 47731'i kullanıyordur.
  - "[::1]:47731 başka bir program tarafından kullanılıyor — … DURDURULDU" ise yardımcı, güvenlik anahtarı başka bir programa gitmesin diye kendini kapatmıştır.
- Panel **"Node.js bu panelde kapalı"** diyor → satırı getir.
- Spread'de **"Yardımcı: bağlı değil — [bilgi dosyası] …"** → yardımcı hiç başlamamış. Spread Helper panelini aç.
- Spread'de **"[bağlantı] UXP İZİN REDDİ …"** → Spread'in ağ izni sorunu. Satırı getir.
- Spread'de **"[bağlantı] … Ham hata …"** → yardımcı paneldeki "son istek" değişmediyse istek hiç ulaşmamıştır. Satırı getir.
- **Uzaktan konsol**: Spread Helper paneli açıkken Chrome ya da Edge'de **<http://localhost:8098>** adresini aç, "Spread Helper"a tıkla
  ve Console sekmesine bak.
- **Köprü hiç çalışmasa da BAĞLA yapılabilir**: Spread'de BAĞLA KES'i yapar, sonra Spread Helper panelindeki **BAĞLA**'ya basarsın (bkz. 3e).
- Tarayıcıyla hızlı deneme: <http://localhost:47731/> açılıyorsa ve `{"ok":false,"error":"yalnız POST","helper":"Spread Helper 0.3.3"}`
  yazıyorsa sunucu çalışıyor. Hiç açılmıyorsa yardımcı başlamamıştır.

## 3) Testi GÜVENLİ yerde yap

- Gerçek projeni aç → **File → Save As…** → yeni bir adla kaydet. **Bu YENİ kopyada çalış.**
- **Orijinal sequence**'ı aç. `PROBE_test`'i değil.
- Timeline'da **Linked Selection** (zincir simgesi) **açık** olsun.

### a) SPREAD → Synchronize (bu kopyada daha önce yapmadıysan)

- **SPREAD** → **Evet**. Sonra **Clip → Synchronize**. Menü gri ise: timeline'a tıkla, **Ctrl+A**, sağ tık → **Synchronize → Audio**.

### b) Ses kaynakları ve ayarlar (TOPLA'dan ÖNCE)

- Panelde **"Harici ses kaynakları → A track"** altında sequence'taki kaynaklar görünür: "Zoom Tr1", "Zoom Tr2", "Zoom TrLR", "DJI"…
  Görünmezse **Kaynakları tara**'ya bas.
- Her kaynağa bir **A track** seç ya da **"Sil"** de (ör. TrLR'yi istemiyorsan). Panel seçimini hatırlar.
  Bu seçimi **TOPLA'dan önce** yap. TOPLA kullandığı eşlemeyi ve eşiği **hatırlar**. Sonradan değiştirirsen BAĞLA hiçbir şeye
  dokunmadan **"Ayar TOPLA'dan sonra değişti — TOPLA'ya tekrar bas"** der ve neyin değiştiğini yazar. TOPLA'ya bir kez daha basman yeter.
- **Güçlü bağ eşiği (%)**: varsayılan 90, dokunma. İki kayıt, kısa olanın en az bu kadarı üst üste geliyorsa aynı oturum sayılır.
  12 Eylül verinde doğru eşleşmelerin en düşüğü %97.96, yanlış çakışmaların en yükseği %49 çıktı.
- **Oturum arası boşluk (sn)**: TOPLA'da oturumların arasına konan boşluk; varsayılan 2.

### c) TOPLA

- **TOPLA**'ya bas. Panel önce bulduklarını günlüğe yazar: güçlü bağlar (yüzdeleriyle), oturumlar, sahipsiz kayıtlar.
- Sonra sorar. Örnek:
  ```
  TOPLA — 4 oturum, sırayla sequence başından (aralarında 2.000 sn):
    O1  Zoom 260912_133224 + A: A038C001_260912BD + Sony: C0142  → 0.000 s'den başlar
    O2  Zoom 260912_141513 + A: A038C002_260912RQ + Sony: C0143  → 1557.320 s'den başlar
    …
  Track'ler: A → V1, Sony → V2; Zoom Tr1 → A1, Zoom Tr2 → A2, Zoom TrLR → A6 (sil); korunan kamera sesi (BAĞLA'da, harici sesin olmadığı aralıklar) → A3; kılavuz sesler → A4–A5.
  ```
  Oturumların sırası kamera sayaçlarından (A038C001, C0142…) ve Zoom saatlerinden (133224…) gelir. Hepsi aynı sırayı vermezse panel sorar.
- **Çift kopya** varsa (aynı dosya aynı yerde iki kez) panel hiçbir şeye dokunmadan durur ve hangi track'ler olduğunu yazar.
  Fazla olanı sil, sonra tekrar bas. 12 Eylül verinde A26/A27 ve A29/A30 böyle.
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
- Sonunda yeşil **`✓ TOPLA tamam`** ve **"Kontrol et, sonra BAĞLA'ya bas."**

### d) Gözle kontrol (tek elle adım)

- Oturumlar çekim sırasıyla, sequence'ın başından, aralarında 2 sn boşlukla dizilmiş olmalı. Hiçbir oturum diğerine binmemeli.
- **V1**: A kamera, **V2**: B kamera (toplam süreler eşitse ada göre).
- **A1, A2, …**: seçtiğin kaynaklar.
  - Altında **boş** bir "korunan kamera sesi" track'i durur. Kamera birden çok ses kanalı kaydediyorsa kanal başına bir track olur.
    BAĞLA, harici sesin olmadığı yerlerde kamera sesini buraya koyar.
  - Onun altında kamera kılavuz sesleri durur (kontrol için; BAĞLA siler), en altta da "Sil" dediğin kaynaklar.
- En altta park track'lerinde sahipsizler, zamanları değişmeden.
- Oturum içinde Zoom ile kamera, senkronun bıraktığı gibi hizalı kalmalı.
- Beğenmezsen: panelde yazan sayıda **Ctrl+Z** bas (genelde 4) ya da yedek sequence'ı kullan.

### e) BAĞLA (KES + bağla)

- Spread panelinde **BAĞLA**'ya bas.
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
    - 12 Eylül verinde üç satır çıkar:
      - A038C001'in başı, 2.3 sn;
      - A038C002'nin sonu, 41.8 sn;
      - C0143'ün çapadan 1 kare (0.04 sn) sonra bitmesi. O son kareyi yalnız C0143 kapsadığı için oradaki ses onun kamera sesinden gelir.
  - **"SESSİZ KALACAK"** satırı iki durumda çıkar. BAĞLA'dan sonra orada ses kalmaz; kabul etmiyorsan **Hayır** de, hiçbir şey değişmez.
    - O aralıkta sesi olan hiçbir kamera yoktur (ör. sessiz kaydeden bir kamera).
    - Her biri 1 sn'den kısa boşlukların toplamı 1 sn'yi geçer. Bunlar senkron kenar payı sayılır ve kamera sesi korunmaz.
  - **"KES'ten sonra üst üste binecek: …"** derse: bir track'te, örneğin boş olması gereken "korunan kamera sesi" track'inde başka bir
    klip duruyor. Hiçbir şey değişmedi; o klibi başka bir track'e al ve tekrar bas.
  - **"TOPLA'ya tekrar bas (v0.3.3 track çerçevesi)"** derse: sequence eski sürümle toplanmış ve korunan kamera sesi track'i yok.
    TOPLA'ya bir kez bas (track'leri düzenler), sonra BAĞLA'ya.
- **Evet** → yedek sequence → sırasıyla:
  - **kesim hazırlığı**: kılavuz sesler (harici sesi olan gruplarda; korunacak aralıklar kesilmek üzere ayrılır) ve "Sil" dediğin kaynaklar silinir;
  - **ilk parça**: bir ölçüm, bkz. aşağı;
  - **parçalar**;
  - **yerleştir**;
  - **KES planı** yazılır: yardımcının klasöründeki `link-plan.json`.
- Sonra:
  - **Köprü çalışıyorsa** gruplar hemen bağlanır, sonuç yeşil **`✓ BAĞLA tamam: N grup bağlandı …`**.
  - **Köprü çalışmıyorsa** yeşil **`✓ KES tamam … N grup bağlanmayı bekliyor`** ve "**Spread Helper panelini aç ve oradaki BAĞLA'ya bas**" yazar.
- **Spread Helper panelindeki BAĞLA**:
  - KES planını okur ve aktif sequence'ı kendisi okur.
  - Grupları Spread'in **aynı** kuralıyla bulur: zamanda çakışan kameralar + çapanın içindeki ses parçaları.
  - Planla **birebir** karşılaştırır (tick düzeyinde). Aynıysa bağlar ve grup grup sonucu yazar: ✓ tamam / ⚠ doğrulanamadı / ✗ neden.
  - Aynı değilse **hiçbir şey yapmaz** ve farkı yazar. Örnekler: KES'ten sonra bir parça kaydırılmış ya da silinmiş, başka bir sequence açık, KES geri alınmış.
  - Bir kısım grup bağlanamazsa hangilerinin bağlandığını tek tek yazar. Yeniden basmak güvenlidir.
  - Spread'in **Durum raporu** panelde yapılan bağlamayı da gösterir.
  - Plan dosyası yazılamadıysa Spread bunu söyler ve planı rapor kutusuna koyar. **Raporu kopyala** → Spread Helper panelinde
    **"Plan dosyası okunamıyorsa: planı yapıştır"** → yapıştır → **BAĞLA**.
- **"İLK PARÇA TUTMADI"** yazarsa: Premiere kırpmayı beklenen biçimde yapmamıştır ve panel orada durmuştur. **Ctrl+Z × 2** (ya da yedek sequence) ile geri dön ve raporu bana getir. Kesme için yedek yöntem hazırlanacak.
- Sarı **`⚠ BAĞLA bitti ama … bağı DOĞRULANAMADI`** görürsen: Premiere "bağlandı" dedi ama panel bunu okuyarak teyit edemedi.
  Bu durumda aşağıdaki kontrol yeterli; bağ yoksa satırları bana getir.
- **"Önce TOPLA'ya bas: bu sequence için TOPLA kaydı yok"** derse: BAĞLA yalnız TOPLA'nın bu panelde, **bu sequence'ta** tamamladığı
  düzende çalışır. Yedek sequence'ta çalışıyorsan orada da önce TOPLA'ya bas.
- **"düzen TOPLA düzeninde değil"** ya da **"Ayar TOPLA'dan sonra değişti"** derse: TOPLA'dan sonra bir klip yer değiştirmiş, eşleme
  ya da eşik değişmiş. Hiçbir şey değişmedi. TOPLA'ya bas, sonra BAĞLA'ya.
- Bağlama adımında yardımcı düşerse (**"… grup bağlanamadı (kesme/silme doğru ve yerinde)"**), yardımcıyı düzelt ve **BAĞLA'ya tekrar bas**,
  ya da Spread Helper panelindeki BAĞLA'ya bas. Panel kesimi hatırlar; bu kez **yalnız bağlar**. Yeniden kesmez, yedek almaz.
- **BAĞLA'dan sonra TOPLA** çalışmaz. Harici sesler kesildiği için oturumları bulduran tam kayıtlar artık yok; panel tahmin etmez.
  Yeniden toplamak istersen BAĞLA öncesi yedek sequence'ı kullan ya da BAĞLA'yı Ctrl+Z ile tamamen geri al.
- **"… YARIM hâlde"** derse: önceki bir TOPLA ya da BAĞLA durmuş ve geri alınmamış. Önce o mesajdaki kadar Ctrl+Z bas (ya da yedeği kullan).
- Kontrol: bir kamera klibine tıkla. O grubun kameraları ve ses parçaları birlikte seçilmeli (Linked Selection açıkken). Başka oturumun sesi seçilmemeli.

## 4) DURUM RAPORU — bana getir

- **Durum raporu** → **Raporu kopyala** → sohbete **yapıştır**. Kopyalama çalışmazsa kutuya tıkla, Ctrl+A / Ctrl+C.
- En değerli an: **Synchronize'dan SONRA, TOPLA'dan ÖNCE**. Senkron sonucunu bu raporla sınıyorum.
  Rapor artık **oturumları** da gösterir: güçlü bağlar (yüzdeleriyle), oturumlar ve grupları, sahipsizler, çift kopyalar, veto ve sıra sorunları.

---

## Sorun çıkarsa

- **Panel kurulmuyor / "UPI status -160":** aescripts ZXP/UXP Installer'a `spread.ccx`'i sürükle-bırak, Premiere'i yeniden başlat.
- **Düğmeler gri:** aktif sequence yok → timeline'a bir kez tıkla, 2 sn bekle.
- **"Plan kurulamadı":** panel başlamadan önce bir sorun gördü; hiçbir şey değişmedi. `HATA:` satırlarını getir.
- **"Yardımcı: bağlı değil — [bağlantı] UXP İZİN REDDİ …":** Premiere, panelin `localhost:47731`'e bağlanmasına izin vermedi. Satırı aynen getir, izin ayarını düzelteceğim.
  Bu arada bağlama için Spread Helper panelindeki **BAĞLA**'yı kullan; köprü gerekmez.
- **Geri dönmek:** her `✓ … tamam` ya da `✗ … DURDU` satırının altında kaç kez Ctrl+Z basacağın yazar. Ya da `… Copy` adlı yedek sequence'ı kullan.
  Bağlama adımı Premiere'in geri alma geçmişine ayrıca kayıt ekleyebilir (ölçülmedi). En güvenli dönüş yedek sequence'tır.
- **Yardımcıyı kaldırmak:** `%APPDATA%\Adobe\CEP\extensions\com.badideagency.spread.helper` klasörünü sil. Eskiden ZXP Installer ile kurduysan oradan da kaldır.
