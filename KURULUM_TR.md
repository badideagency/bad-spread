# Spread 1.0.0 — Kurulum ve Kullanım (Türkçe)

Spread, çok kameralı çekimleri Premiere Pro'da düzenler. Sıra hep aynı:

1. **SPREAD** — her klibi kendi track'ine dağıtır. Zamanlar değişmez.
2. **Clip → Synchronize** — senkronu Premiere yapar.
3. **TOPLA** — oturumları (aynı anda kaydedilmiş kameralar ve sesler) bulur. Onları çekim sırasıyla sequence'ın başından dizer;
   kameraları ve sesleri kendi track'lerine koyar.
4. **Gözle kontrol** — tek elle adım bu.
5. **BAĞLA** — harici sesleri (Zoom, DJI…) her oturumun kendi kamerasına göre keser ve her grubu tek bağ yapar.

Her işlem önce kısa bir özet gösterip onay ister ve **önce yedek sequence** alır. Her adımdan sonra her klibi tick düzeyinde
denetler. Bir şey tutmazsa **durur** ve ne yapacağını tek cümleyle söyler. Kendi başına düzeltme yapmaz.

Ekran görüntüleri: [docs/ekran](docs/ekran) (mock ortamında üretildi).

---

## 1) Kurulum (bir kez) — `Spread_Kurulum_v1.0.0.zip`

1. İndir: <https://github.com/badideagency/bad-spread/raw/main/release/Spread_Kurulum_v1.0.0.zip>
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
6. **Window → Extensions (Legacy) → Spread Helper**: küçük paneli aç ve bir köşede açık bırak. Premiere onu çalışma alanında hatırlar.
   Yeşil **"● Spread Helper çalışıyor"** yazmalı.
7. **Window → UXP Plugins → Spread**: ana panel. Başlıkta **"Spread 1.0.0"** yazar. Sağ üstte yeşil **"● yardımcı hazır"**
   görünmeli.

**Kaldırmak:** **KALDIR.cmd**'ye çift tıkla. Kurulumun yaptığı her şeyi geri alır:
- paneli ve yardımcıyı kaldırır;
- PlayerDebugMode'u kurulumdan önceki hâline döndürür;
- Spread'in kayıtlarını siler. Masaüstündeki `SpreadRapor_…txt` dosyaları kalır; masaüstüne yazılamadığı için
  `%APPDATA%\BadIdeaAgency\Spread\` altına düşmüş raporlar kayıtlarla birlikte silinir.

## 2) Panel

- **Üst satır:** aktif sequence'ın adı ve yardımcı göstergesi.
  - Yeşil ● **hazır**.
  - Kırmızı ● **kapalı: Window → Extensions (Legacy) → Spread Helper'ı aç**.
- **Üç adım:** her birinde büyük bir düğme var.
  - Sıradaki adım **mavi çerçeveyle** gösterilir.
  - Biten adımda **✓** ve kısa sonuç yazar ("4 oturum toplandı").
  - SPREAD ile TOPLA arasında "Sonra Premiere'de: Clip › Synchronize" hatırlatması durur.
  - ✓ işaretleri bu panelin bu sequence'ta yaptığı işlere göredir. Bir işlemi elle geri aldıysan ✓ kalabilir; işlemler yine kendi
    denetimlerini yapar.
- **İşlem sırasında:** ilerleme çubuğu ve tek satır ne yapıldığı ("Oturum 2–4/4 yerine taşınıyor…").
- **Onay penceresi:** en çok 5 satırlık özet. Dikkat gerektiren satırlar **sarı** yazılır: ÇİFT KOPYA, VETO, ŞÜPHELİ, KAMERA SESİ
  KORUNACAK, SESSİZ KALACAK… Tam metin **"Ayrıntı ▸"** altında.
- **Sonuç:** tek cümle ve ne yapılacağı ("Beğenmezsen Ctrl+Z × 5 ya da yedek sequence …"). Teknik ayrıntı **"Ayrıntı ▸"** altında.
- **Sorun bildir:** tek bir rapor hazırlar. İçinde sürümler, Durum raporu, son TOPLA/BAĞLA günlükleri, kalibrasyon sonucu, yardımcı
  durumu ve son hata vardır.
  - Rapor panoya kopyalanır ve masaüstüne `SpreadRapor_<tarih>.txt` olarak kaydedilir. Masaüstüne yazılamazsa
    `%APPDATA%\BadIdeaAgency\Spread\` altına kaydedilir.
  - Bir şey ters gittiğinde bunu bana gönder. Düğme işlem sürerken de (ör. onay beklerken) çalışır.
  - Premiere çöktüyse ya da panel yeniden açıldıysa rapor **önceki oturumların günlüğünü** de içerir: günlük dosyası
    önceki açılışları da tutar (son ~4000 satır).
- **Gelişmiş ▸** (varsayılan kapalı):
  - kaynak eşleme (hangi ses hangi A track'e, "Sil");
  - güçlü bağ eşiği ve oturum arası boşluk;
  - yardımcı ayrıntısı (gerçek hata metni);
  - Durum raporu;
  - ayrıntılı günlük.
- Ayrıntılı günlük her zaman arka planda da tutulur: `%APPDATA%\BadIdeaAgency\Spread\spread-gunluk.txt`.

## 3) Günlük kullanım

- Gerçek projenin bir kopyasında çalışmak her zaman iyi fikir: **File → Save As…**
- Timeline'da **Linked Selection** (zincir simgesi) **açık** olsun.

### a) SPREAD → Synchronize (bu kopyada daha önce yapmadıysan)

- **SPREAD** → **Evet**. Sonra **Clip → Synchronize**. Menü gri ise: timeline'a tıkla, **Ctrl+A**, sağ tık → **Synchronize → Audio**.
- **"N kamera klibi kırpılmış … Spread BAŞLAMADI"** derse, o kamera kliplerinin başı ya da sonu kesilmiş demektir. Hiçbir şey değişmedi.
  - Kırpmayı kaldır: klibi tam boy yap.
  - Ya da o kameraları SPREAD'den ayrı tut.

### b) Ses kaynakları ve ayarlar (TOPLA'dan ÖNCE)

- **Gelişmiş ▸** altında **"Harici ses kaynakları → A track"** listesinde sequence'taki kaynaklar görünür: "Zoom Tr1", "Zoom Tr2",
  "Zoom TrLR", "DJI"… Görünmezse **Kaynakları tara**'ya bas.
- Her kaynağa bir **A track** seç ya da **"Sil"** de (ör. TrLR'yi istemiyorsan). Panel seçimini hatırlar.
  Bu seçimi **TOPLA'dan önce** yap. TOPLA kullandığı eşlemeyi ve eşiği **hatırlar**. Sonradan değiştirirsen BAĞLA hiçbir şeye
  dokunmadan **"Ayar TOPLA'dan sonra değişti — TOPLA'ya tekrar bas"** der ve neyin değiştiğini yazar. TOPLA'ya bir kez daha basman yeter.
- **Güçlü bağ eşiği (%)**: varsayılan 90, dokunma. İki kayıt, kısa olanın en az bu kadarı üst üste geliyorsa aynı oturum sayılır.
  12 Eylül verinde doğru eşleşmelerin en düşüğü %97.96, yanlış çakışmaların en yükseği %49 çıktı.
- **Oturum arası boşluk (sn)**: TOPLA'da oturumların arasına konan boşluk; varsayılan 2.

### c) TOPLA

- **TOPLA**'ya bas. Panel önce bulduklarını ayrıntılı günlüğe yazar: güçlü bağlar (yüzdeleriyle), oturumlar, sahipsiz kayıtlar.
- Sonra onay ister. Özette oturum ve klip sayısı, silinecek çiftler ve dikkat gerektiren satırlar görünür. Tam metin
  **"Ayrıntı ▸"** altında; örnek:
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
  - Plan dosyası yazılamadıysa Spread bunu söyler ve planı **Gelişmiş ▸ Durum raporu** kutusuna koyar. **Raporu kopyala** → Spread
    Helper panelinde **Ayrıntı ▸** → **Planı yapıştır** kutusuna yapıştır → altındaki **BAĞLA**.
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
  - Ayrıntılı günlükte (Gelişmiş ▸ Günlük ya da sonucun "Ayrıntı ▸"ı) yeşil **"KALİBRASYON SONUCU (kanıtlanmış — Premiere …)"**
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
- Bağlama adımında yardımcı düşerse (**"… grup bağlanamadı (kesme/silme doğru ve yerinde)"**), yardımcıyı düzelt ve **BAĞLA'ya tekrar bas**,
  ya da Spread Helper panelinde **Ayrıntı ▸ → BAĞLA**'ya bas. Panel kesimi hatırlar; bu kez **yalnız bağlar**. Yeniden kesmez, yedek almaz.
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
- **"yardımcı kapalı":** Window → Extensions (Legacy) → Spread Helper panelini aç. Hâlâ kapalıysa: **Gelişmiş ▸ Yardımcı**'daki
  gerçek hata metnini getir. Bu arada bağlama için Spread Helper panelindeki **BAĞLA**'yı kullanabilirsin; köprü gerekmez.
- **Spread Helper menüde yok:** KUR.cmd'yi yeniden çalıştır ve Premiere'i yeniden başlat. Hâlâ yoksa: CEP günlüğü ile bakarız
  (Sorun bildir + haber ver).
- **Panel kurulmuyor / "UPI status -160":** `spread.ccx`'e çift tıkla. Olmazsa aescripts ZXP/UXP Installer'a sürükle-bırak, Premiere'i
  yeniden başlat.
