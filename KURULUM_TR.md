# Spread v0.3.0 — Kurulum ve Kullanım (Türkçe, adım adım)

**Spread v0.3.0** üç iş yapar. Sıra hep aynı:

1. **SPREAD**: her klibi kendi track'ine dağıtır. Zamanlar değişmez.
2. **Clip → Synchronize**: senkronu Premiere yapar.
3. **TOPLA**: klipleri cihaz ve kanal track'lerine **yalnız dikey** toplar. Zamanlar değişmez.
4. **Gözle kontrol**: tek elle adım bu.
5. **BAĞLA**: harici sesleri her grubun en uzun kamera klibine göre keser; kamera kılavuz seslerini ve kapattığın kanalları siler. Sonra her grubu (kameralar + ses parçaları) **tek bağ** yapar.

Bağlama için Premiere'in UXP'sinde komut yok. Bu yüzden bir kez **görünmez bir yardımcı (Spread Helper)** kuracaksın. Yardımcının penceresi yok; Premiere açılınca arka planda kendiliğinden başlar. Sen yalnız paneldeki **BAĞLA**'ya basarsın.

Her işlem önce onay sorar ve **önce yedek sequence** alır. Her adımdan sonra her klibin zamanını tek tek karşılaştırır. Bir şey tutmazsa **durur**, ne olduğunu ve **kaç kez Ctrl+Z** basacağını yazar. Kendi başına düzeltme yapmaz.

---

## 1) Spread panelini güncelle (v0.3.0)

- İndir: <https://github.com/badideagency/bad-spread/raw/claude/sweet-bell-do4j75/release/spread.ccx>
- `spread.ccx`'e **çift tıkla**, Creative Cloud'da **Install / Yükle**'ye bas. Eski Spread'in üstüne kurulur.
  Hata verirse: önce Creative Cloud → **Manage plugins** → Spread → **Uninstall**, sonra tekrar çift tıkla.
- **Premiere Pro'yu kapatıp aç.** Paneli aç: **Window → UXP Plugins → Spread**. Başlıkta **"Spread v0.3.0"** yazmalı.
- Kurulumda "dosya sistemi / ağ izni" sorulursa **izin ver**. Panel yalnız bilgisayarın içindeki yardımcıyla konuşur (127.0.0.1), internete çıkmaz.

## 2) Yardımcıyı kur (bir kez)

**Yol A (en kolay):**
- İndir: <https://github.com/badideagency/bad-spread/raw/claude/sweet-bell-do4j75/release/spread-helper.zxp>
- aescripts **ZXP/UXP Installer**'ı aç (<https://aescripts.com/learn/zxp-installer/>). `spread-helper.zxp`'i penceresine **sürükle-bırak**.

**Yol B (ZXP Installer yoksa):**
- İndir: <https://github.com/badideagency/bad-spread/raw/claude/sweet-bell-do4j75/release/spread-helper-klasor.zip>
- Zip'i bir klasöre **çıkart**, içindeki **`KUR.cmd`**'ye çift tıkla. Windows "bilinmeyen yayıncı" derse: **Ek bilgi → Yine de çalıştır**.
  Betik, yardımcıyı `%APPDATA%\Adobe\CEP\extensions\` altına kopyalar.

Sonra:
- **Premiere Pro'yu kapatıp aç.**
- Spread panelinin üstünde yeşil **"Yardımcı: bağlı — (yardımcı 0.3.0, Premiere …)"** yazmalı. Yazmıyorsa **Yardımcıyı kontrol et**'e bas.
- Hâlâ **"bağlı değil"** diyorsa:
  - Zip'teki **`PlayerDebugMode_CSXS12.reg`**'e çift tıkla → **Evet**. Premiere'i kapatıp aç.
  - Yine olmazsa panelde yazan satırı ve `%TEMP%\spread-helper.log` dosyasını bana getir.

## 3) Testi GÜVENLİ yerde yap

- Gerçek projeni aç → **File → Save As…** → yeni bir adla kaydet. **Bu YENİ kopyada çalış.**
- **Orijinal sequence**'ı aç. `PROBE_test`'i değil.
- Timeline'da **Linked Selection** (zincir simgesi) **açık** olsun.

### a) SPREAD → Synchronize (bu kopyada daha önce yapmadıysan)

- **SPREAD** → **Evet**. Sonra **Clip → Synchronize**. Menü gri ise: timeline'a tıkla, **Ctrl+A**, sağ tık → **Synchronize → Audio**.

### b) Tutulacak harici kanallar

- Panelde **"Tutulacak harici kanallar"** altında sequence'taki kanallar onay kutusu olarak görünür (Tr1, Tr2, TrLR…). Görünmezse **Kanalları tara**'ya bas.
- İstemediğin kanalın kutusunu kaldır (ör. **TrLR**). Panel bunu hatırlar.
  Kapattığın kanal TOPLA'da en alta konur, BAĞLA'da silinir.

### c) TOPLA

- **TOPLA**'ya bas. Panel planı yazar, sonra sorar. Örnek:
  `TOPLA: 2 cihaz (A 11 klip → V1, C 11 klip → V2); 3 harici kanal (Tr1 → A1, Tr2 → A2, TrLR → A3); kamera kılavuz sesleri → A4–A5 … Devam?`
  - Cihaz, dosya adının başıdır: `A038C0xx…` → **A**, `C01xx` → **C**. Toplam süresi uzun olan cihaz **V1**'e gider.
- **Evet** → yedek sequence → iki adım (park, yerleştir) → her klip doğrulanır.
- **Kırmızı `✗ TOPLA DURDU: … zaman çakışması`** görürsen: senkron iki ilgisiz çekimi üst üste bindirmiş olabilir ya da hedef yerde bir grafik var. Panel hangi kliplerin çakıştığını yazar. **Hiçbir şey değişmemiştir.** Bu satırları bana getir.
- Sonunda yeşil **`✓ TOPLA tamam`** ve **"Kontrol et, sonra BAĞLA'ya bas."** yazar.

### d) Gözle kontrol (tek elle adım)

- **V1**: A kamera, **V2**: B kamera.
- **A1**: Tr1, **A2**: Tr2 (**A3**: TrLR).
- Altında kamera kılavuz sesleri: kontrol için duruyor, BAĞLA silecek.
- Hiçbir klip sağa ya da sola kaymamış olmalı. Grafik (ör. yeşil "YAĞ…") yerinde olmalı.
- Beğenmezsen: panelde yazan sayıda **Ctrl+Z** bas (genelde 2) ya da yedek sequence'ı kullan.

### e) BAĞLA

- **BAĞLA**'ya bas.
  - Önce yardımcıya bakar. Yardımcı yoksa **hiçbir şeye dokunmadan** durur ve kurulumu anlatır.
  - Sonra planı yazar: gruplar, çapalar (her grubun en uzun kamera klibi) ve ses parçaları. Ardından sorar.
- **Evet** → yedek sequence → sırasıyla:
  - **kesim hazırlığı**: kılavuz sesler ve kapalı kanallar silinir;
  - **ilk parça**: bir ölçüm, bkz. aşağı;
  - **parçalar**;
  - **yerleştir**;
  - **bağla**.
- **"İLK PARÇA TUTMADI"** yazarsa: Premiere kırpmayı beklenen biçimde yapmamıştır ve panel orada durmuştur. **Ctrl+Z × 2** (ya da yedek sequence) ile geri dön ve raporu bana getir. Kesme için yedek yöntem hazırlanacak.
- Sonunda yeşil **`✓ BAĞLA tamam: N grup bağlandı …`**.
- Kontrol: bir kamera klibine tıkla. O grubun iki kamerası ve ses parçaları birlikte seçilmeli (Linked Selection açıkken).

## 4) DURUM RAPORU — bana getir

- **Durum raporu** → **Raporu kopyala** → sohbete **yapıştır**. Kopyalama çalışmazsa kutuya tıkla, Ctrl+A / Ctrl+C.
- En değerli an: **Synchronize'dan SONRA, TOPLA'dan ÖNCE**. Senkron sonucunu bu raporla sınıyorum.
  Rapor sınıflamayı da gösterir: cihazlar, kanallar, dokunulmayan öğeler, gruplar ve çapalar.

---

## Sorun çıkarsa

- **Panel kurulmuyor / "UPI status -160":** aescripts ZXP/UXP Installer'a `spread.ccx`'i sürükle-bırak, Premiere'i yeniden başlat.
- **Düğmeler gri:** aktif sequence yok → timeline'a bir kez tıkla, 2 sn bekle.
- **"Plan kurulamadı":** panel başlamadan önce bir sorun gördü; hiçbir şey değişmedi. `HATA:` satırlarını getir.
- **"Yardımcı: bağlı değil — … Permission denied / izin":** Premiere, panelin 127.0.0.1'e bağlanmasına izin vermedi. Satırı aynen getir, izin ayarını düzelteceğim.
- **Geri dönmek:** her `✓ … tamam` ya da `✗ … DURDU` satırının altında kaç kez Ctrl+Z basacağın yazar. Ya da `… Copy` adlı yedek sequence'ı kullan.
  Bağlama adımı Premiere'in geri alma geçmişine ayrıca kayıt ekleyebilir (ölçülmedi). En güvenli dönüş yedek sequence'tır.
- **Yardımcıyı kaldırmak:** `%APPDATA%\Adobe\CEP\extensions\com.badideagency.spread.helper` klasörünü sil (ZXP Installer ile kurduysan oradan kaldır).
