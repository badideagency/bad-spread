# Spread Probe — Kurulum ve Test (Türkçe, adım adım)

Bu eklenti **sadece bir test paneli**. SPREAD / RE-STACK düğmeleri henüz yok.
Görevi: Premiere'in bize gereken özelliklerinin çalışıp çalışmadığını ölçmek ve bir **rapor** üretmek.
O raporu bana (sohbete) geri getireceksin.

> **Güvenlik:** Panel yalnızca adı `PROBE_` ile başlayan, o an açık (aktif) sequence üzerinde çalışır.
> Başka bir sequence açıkken tüm test düğmeleri kilitlidir. Diske, medyaya ya da proje dosyasına kayıt yapmaz.
> Yine de denemeyi **yeni, boş bir deneme projesinde** yapmanı öneririm (gerçek işin projesinde değil).

---

## 1) Dosyayı indir

- GitHub'da bu dosyayı aç: `release/spread-probe.ccx`
  (dal: `claude/sweet-bell-do4j75`)
  Doğrudan bağlantı: <https://github.com/badideagency/bad-spread/raw/claude/sweet-bell-do4j75/release/spread-probe.ccx>
- Açılan sayfada **Download** (indir) düğmesine bas. Dosya bilgisayarına `spread-probe.ccx` adıyla iner.
- Dosyanın adını ya da uzantısını **değiştirme** (`.zip` yapma, açma).

## 2) Kur

- İnen `spread-probe.ccx` dosyasına **çift tıkla**.
- Creative Cloud uygulaması açılır ve "üçüncü taraf eklenti" (third-party plugin) uyarısı gösterir.
  Bu eklentiyi biz yaptık, Adobe mağazasından gelmediği için bu uyarı normal → **Install / Yükle**'ye bas.
- "Kuruldu" mesajını bekle.
- **Premiere Pro'yu tamamen kapatıp yeniden aç.**

## 3) Paneli bul

- Premiere'de üst menüden: **Window → UXP Plugins → Spread Probe**
- Orada yoksa: **Window → Extensions** altına bak.
- Panel açılınca en üstte kırmızı/yeşil bir durum kutusu görürsün. Şimdilik kırmızı olması normal
  (henüz `PROBE_` sequence'ı açmadın).

## 4) Deneme sequence'ını hazırla (`PROBE_test`)

Gerekenler: **1 kamera klibi** (kendi sesiyle birlikte) + **2 ayrı ses dosyası** (ör. yaka mikrofonu / Zoom kaydı).

- Yeni bir sequence aç: **File → New → Sequence…** Herhangi bir hazır ayar olur.
  Adını **tam olarak** şöyle yaz: `PROBE_test` (büyük harflerle PROBE, altçizgi, test).
- Timeline'ın sol üstündeki **Snap** (mıknatıs) ve **Linked Selection** (zincir) simgeleri **açık** olsun.
- **Kamera klibini** Project panelinden timeline'ın **en başına** (00:00) sürükle.
  Görüntüsü **V1**'e, sesi **A1**'e düşmeli (ikisi bağlı, yani birine tıklayınca ikisi de seçiliyor).
- **1. harici sesi** **A1**'e, kamera klibinin **bittiği yere**, hemen arkasına bırak (mıknatıs yapıştırır).
- **2. harici sesi** yine **A1**'e, 1. harici sesin hemen arkasına bırak.
- Sonuç şöyle görünmeli:

  ```
  V1: [ kamera görüntüsü ]
  A1: [ kamera sesi      ][ harici ses 1 ][ harici ses 2 ]
  V2, V3, A2, A3 … : boş
  ```

- `PROBE_test` timeline'ının açık ve seçili olduğundan emin ol (bir kez üzerine tıkla).
  Paneldeki durum kutusu **yeşil** olmalı: `✓ Aktif sequence "PROBE_test" — testler açık.`

## 5) Testi çalıştır

- Önce **Tara** düğmesine bas. Günlükte `Kurulum uygun görünüyor.` yazmalı.
  Yazmıyorsa 4. adımı kontrol et (klipler V1/A1'de mi, sıraları doğru mu).
- Sonra **Hepsini çalıştır**'a bas. Testler sırayla çalışır; timeline'da üst track'lerde kopyalar belirecek, bu normal.
- Arada panel sana **soru** soracak (sarı kutu). Sorudaki şeyi yap, sonra **Evet / Hayır** ile cevapla.
  Emin değilsen **Atla**.
  - **T5 (Seçim):** Timeline'a bak: sayılan klipler seçili (vurgulu) görünüyor mu?
  - **T6 (Geri alma):** Önce **timeline'a bir kez tıkla**, sonra **Ctrl+Z**'ye (Mac: **Cmd+Z**) **yalnızca BİR kez** bas.
    (Ya da üst menüden **Edit → Undo** seç.) Sonra panele dön ve cevapla: hepsi geri geldi mi?
  - **T3 (Bağlı çift):** Söylenen üst track'teki **kopya videoya** bir kez tıkla, sonra cevapla:
    altındaki kopya ses de kendiliğinden seçildi mi?
- Günlükte `Bitti.` yazınca test tamam.

## 6) Raporu bana getir

- **Raporu kopyala** düğmesine bas. Günlükte `✓ Rapor panoya kopyalandı` yazar.
- Sohbete dön ve **yapıştır** (Ctrl+V / Cmd+V). Bu kadar.
- Kopyalama çalışmazsa: paneldeki en alttaki **Rapor** kutusuna tıkla, **Ctrl+A** (Mac: **Cmd+A**) ile hepsini seç,
  **Ctrl+C** (Mac: **Cmd+C**) ile kopyala, sohbete yapıştır.

---

## Sorun çıkarsa

- **Çift tıklayınca kurulmuyor / "UPI status -160" gibi bir hata veriyor → 2. yol:**
  - aescripts'in ücretsiz **ZXP/UXP Installer** programını indir: <https://aescripts.com/learn/zxp-installer/>
  - Programı aç, `spread-probe.ccx` dosyasını pencerenin üstüne **sürükle-bırak**.
  - Premiere'i yeniden başlat, 3. adımdan devam et.
- **Panel menüde yok:** Premiere Pro'nun güncel olduğundan emin ol (en az 25.6 / Premiere Pro 2025 sonu, önerilen 2026).
  Premiere'i tamamen kapatıp aç.
- **Düğmeler gri / kilitli:** Açık timeline'ın adı `PROBE_` ile başlamıyor ya da timeline seçili değil.
  `PROBE_test`'e bir kez tıkla, 2 saniye bekle.
- **Bir test "BELİRSİZ" çıktı:** Genelde bir önceki test klibi silmiş olabilir. **Edit → Undo** ile geri al
  ya da testin oluşturduğu yedek sequence'ı (`PROBE_test Copy` gibi) kullan. İstersen `PROBE_test`'i silip 4. adımı baştan yap.
- **Testi tekrar çalıştırmak istiyorsan:** En temizi `PROBE_test`'i silip 4. adımı yeniden yapmak.
- **Eklentiyi kaldırmak:** Creative Cloud uygulamasındaki eklentiler (Plugins / Add-ons) bölümünden **Spread Probe** → kaldır.
