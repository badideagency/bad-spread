# Spread 1.0.0 — tam sürüm (ürünleştirme)

**Mantık değişmedi.** Bütün güvenlik kilitleri, tick düzeyinde doğrulamalar, kırpma kalibrasyonu ve yedek sequence v0.3.4'teki gibi.
Bu sürümde yalnız arayüz, kurulum ve paketleme değişti.

**Açık risk:** kırpma kalibrasyonu gerçek Premiere'de ilk BAĞLA'da ölçülecek. Tutarlı bir kural çıkmazsa BAĞLA hiçbir şey kesmeden
durur ve bunu tek cümleyle söyler.

## Kurulum

`Spread_Kurulum_v1.0.0.zip` → çıkart → **KUR.cmd** (yönetici izni gerekmez) → Premiere'i yeniden başlat →
**Window → Extensions (Legacy) → Spread Helper** (küçük panel, açık bırak) → **Window → UXP Plugins → Spread**.
Kaldırmak: **KALDIR.cmd** (PlayerDebugMode dahil her şeyi kurulum öncesine döndürür). Ayrıntı: `OKU_BENI.txt`, `KURULUM_TR.md`.

## Yenilikler

- **Sade panel:**
  - Üstte sequence adı ve yardımcı göstergesi (● hazır / ● kapalı).
  - Numaralı üç adım, büyük düğmeler. Biten adımda ✓ ve kısa sonuç; sıradaki adım vurgulu.
  - İşlem sırasında ilerleme çubuğu. Sonuç tek cümle; teknik ayrıntı "Ayrıntı ▸" altında.
  - Onay penceresi 3–5 satırlık özet; dikkat gerektiren satırlar sarı.
  - "Gelişmiş ▸" altında kaynak eşleme, eşik, boşluk, Durum raporu ve günlük.
- **Sorun bildir:** tek bir metin paketi hazırlar (sürümler, Durum raporu, son TOPLA/BAĞLA günlükleri, kalibrasyon sonucu, yardımcı
  durumu, son hata). Panoya kopyalar ve masaüstüne `SpreadRapor_<tarih>.txt` olarak kaydeder. Ayrıntılı günlük her zaman arka planda
  tutulur (bellek + dosya).
- **Spread Helper:** tek durum satırı. Köprüsüz BAĞLA bölümü yalnız Spread "yardımcı panelinden bağla" dediğinde görünür.
- **Tek tık kurulum:** `KUR.cmd` / `KALDIR.cmd` / `OKU_BENI.txt`. Probe yayından çıkarıldı (repoda duruyor).

## Ekran görüntüleri (mock ortamı, 300 px ve 560 px panel)

Mock ortamı: jsdom'da gerçek panel HTML'i + sahte Premiere + gerçek yardımcı sunucusu; Chromium'da çizildi. Premiere'de düğmeler
Spectrum stilinde çizilir.

| Hazır (sıradaki: TOPLA) | TOPLA onayı (çift kopya uyarısı) | TOPLA sürerken |
|---|---|---|
| ![](ekran/01-hazir-300.png) | ![](ekran/02-topla-onay-300.png) | ![](ekran/03-topla-ilerleme-300.png) |

| TOPLA bitti | BAĞLA onayı | Kırpma ölçülürken |
|---|---|---|
| ![](ekran/04-topla-tamam-300.png) | ![](ekran/05-bagla-onay-300.png) | ![](ekran/06-bagla-olcum-300.png) |

| BAĞLA bitti | Hata (tek cümle) | Hata — Ayrıntı ▸ |
|---|---|---|
| ![](ekran/07-bagla-tamam-300.png) | ![](ekran/08-hata-300.png) | ![](ekran/09-hata-ayrinti-300.png) |

| Gelişmiş ▸ + Sorun bildir | Yardımcı kapalı |
|---|---|
| ![](ekran/10-gelismis-sorun-bildir-300.png) | ![](ekran/11-yardimci-kapali-300.png) |

Geniş panel:

![](ekran/01-hazir-560.png)
![](ekran/05-bagla-onay-560.png)
![](ekran/07-bagla-tamam-560.png)

Spread Helper:

| Çalışıyor | BAĞLA bekliyor | Hata |
|---|---|---|
| ![](ekran/20-yardimci-calisiyor-300.png) | ![](ekran/21-yardimci-bagla-bekliyor-300.png) | ![](ekran/22-yardimci-hata-300.png) |

## Doğrulama

- Bütün mock senaryoları değişmeden geçer (mantık değişmediğinin kanıtı).
- Regresyon: v0.3.3 kırpması gerçek set anlamında düşer, güncel kod geçer.
- KUR.cmd / KALDIR.cmd Wine'da sınandı (`scripts/test-kurulum-wine.sh`):
  - yalnız HKCU ve %APPDATA%'ya yazılır;
  - KALDIR PlayerDebugMode'u kurulum öncesi değerlerine döndürür;
  - yönetici olarak çalıştırılınca hiçbir şey yazılmaz.
