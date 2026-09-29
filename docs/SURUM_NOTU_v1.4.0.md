# Spread 1.4.0 — Yeni: SENKRON (sesleri Spread kendisi eşleştirir) · şimdilik "Dene"

Panelden gelir: üstteki şerit **"Yeni sürüm 1.4.0 · Güncelle"** → Güncelle → "Projeyi kaydedip Premiere'i yeniden başlatayım mı?" →
Yeniden başlat. Başlıkta **1.4.0** görünür.

## SENKRON

Akış: **Dağıt → Senkron → Topla → Bağla** (Clip › Synchronize alternatif olarak kalır). Dağıt bitince altında "Sonra: Senkron …"
satırı ve **Senkron** düğmesi çıkar (Ayarlar › DENEYSEL › "Senkron · Dene" ile her an çalışır).

- **Dene** (varsayılan): timeline'a **dokunmaz**. Kamera ve harici ses dosyalarını okur, sesleri eşleştirir, rapor verir:
  `%APPDATA%\BadIdeaAgency\Spread\senkron-deneme.txt` + **Sorun bildir** raporunda "SON SENKRON DENEMESİ" bölümü. Her dosya için:
  bulunan konum, güven, hangi dosyayla eşleştiği, dosya adındaki / kayıttaki saatin beklediği konum ve fark, timeline'daki yerine göre
  fark; grup (oturum) özeti; "emin değil" listesi.
- **Uygula** (deneysel, varsayılan KAPALI): Ayarlar › DENEYSEL › "SENKRON uygula: Açık" → Dene'den sonra sorar. Yalnız Dağıt düzeninde;
  önce yedek sequence; klipleri yalnız **zamanda** taşır (track'ler aynı, Clip › Synchronize'ın çıktısıyla aynı biçim); ilk dosya tek
  başına taşınıp ölçülür, her adım doğrulanır. Emin olunmayan dosyalar en sona, tek tek konur (Topla onları park eder).
- Hesap **Spread Helper**'da yapılır (açık olmalı); Premiere donmaz, ilerleme ("ses okunuyor 3/23", "eşleştiriliyor …") görünür,
  **İptal** düğmesi işi durdurur.
- **ffmpeg**: ilk kullanımda bir kez indirilir (resmî Windows derlemesi, gyan.dev 7.1.1 "essentials", ~88 MB, GPL v3), önce sorulur;
  dosyanın bozulmadığı sha256 ile doğrulanır, `%APPDATA%\BadIdeaAgency\Spread\ffmpeg\` altına kurulur. İndirilemezse açık hata ve
  zip'i elle o klasöre koyma yolu. Çözülen sesler önbelleğe alınır (aynı dosya ikinci kez çözülmez). KALDIR.cmd bu klasörü de siler.
- Eşleştirme: önce ses zarfıyla kaba arama (bütün kaymalar), sonra 8 kHz sinyalde ±1 sn içinde ince ayar (GCC-PHAT) → milisaniyenin
  altında. Güven: dalga biçimi uyumu (tepe) ve birinci / ikinci aday oranı; eşik altı → "emin değil" (tahmin yok). Aynı kamera
  kendisiyle üst üste olamaz, dosya sırası korunur; çelişen eşleşme düşer. Hiçbir sesle eşleşmeyen / sessiz klip "emin değil".
  Birbirine bağlanmayan kümeler ayrı grup (oturum); aralarındaki mesafe dosya adındaki saatten, yoksa boşluk.
- Topla'nın senkron sağlığı uyarısı artık "→ SENKRON (Spread) ile yeniden hizala ya da elle düzelt" der.

## Emre için sınama

1. **Güncelle** → başlıkta **1.4.0**.
2. A043 çekiminin **Dağıt'tan hemen sonraki** hâlinde (Clip › Synchronize YAPMADAN) Dağıt'ın altındaki **Senkron**'a bas
   (Spread Helper açık olsun; ilk seferde "ffmpeg indirilsin mi?" → İndir). İlerleme bitince "SENKRON denemesi: … dosya … grupta
   yerleşti" yazar; timeline değişmez.
3. `%APPDATA%\BadIdeaAgency\Spread\senkron-deneme.txt` dosyasını ya da **Sorun bildir** raporunu gönder.

## Doğrulama

- Sentetik sınama (`spread/dev/senkron-smoke.cjs`, 8 senaryo): 1 kamera + 3 eşzamanlı mikrofon (10/10, en büyük hata 0.029 ms);
  hiçbir harici sesle örtüşmeyen klip ve sessiz klip → "emin değil"; 2 kamera + Zoom, iki çekim (~128 dk ses, 19/19, en büyük hata
  0.008 ms, ~45 sn); uzun kayda karşı 12 kısa ilişkisiz klip → hepsi "emin değil"; yanlış yerleşim 0. Yardımcı: istek denetimi, zip,
  sha256, iş / ilerleme / önbellek / iptal.
- Gerçek ffmpeg (Wine, `scripts/test-senkron-wine.sh`): sabit derleme indirilir + sha256 + çıkarma; WAV (48 kHz stereo), MP4 (H.264 +
  AAC), MOV (PCM) çözülür; bilinen ofsetler ≤ 0.02 ms.
- Panel (mock Premiere, `spread/dev/smoke.cjs`): Dene timeline'a dokunmaz, rapor dosyası ve Sorun bildir bölümü; Uygula (yedek → ölçüm
  → park → yerleştir, tick düzeyinde) ve ardından Topla tek oturum; İptal; yardımcı yok / Dağıt düzeni değil / ffmpeg indirilemedi →
  açık hata.
