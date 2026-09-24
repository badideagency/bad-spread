# Spread Probe — Kurulum ve Test (Türkçe, adım adım)

Bu eklenti **sadece bir test paneli** (sürüm **0.1.1**). SPREAD / RE-STACK düğmeleri henüz yok.
Görevi: Premiere'in bize gereken özelliklerinin çalışıp çalışmadığını ölçmek ve bir **rapor** üretmek.
O raporu bana (sohbete) geri getireceksin.

> **Güvenlik:** Panel yalnızca adı `PROBE_` ile başlayan, o an açık (aktif) sequence üzerinde çalışır.
> Başka bir sequence açıkken tüm test düğmeleri kilitlidir. Diske, medyaya ya da proje dosyasına kayıt yapmaz.
> Yine de denemeyi **deneme projesinde** yap (gerçek işin projesinde değil).

---

## 0) Eski sürüm (0.1.0) kuruluysa — önce kaldır

- **Creative Cloud** uygulamasını aç → eklentiler bölümü (**Plugins / Eklentiler**) → **Manage plugins** (Eklentileri yönet).
- Listede **Spread Probe**'u bul → **⋯** ya da **Uninstall / Kaldır**.
- **Premiere Pro'yu kapat.**

## 1) Yeni dosyayı indir

- GitHub'da bu dosyayı aç: `release/spread-probe.ccx` (dal: `claude/sweet-bell-do4j75`)
  Doğrudan bağlantı: <https://github.com/badideagency/bad-spread/raw/claude/sweet-bell-do4j75/release/spread-probe.ccx>
- **Download** (indir) düğmesine bas. Dosya `spread-probe.ccx` adıyla iner.
  Eski indirdiğin dosya duruyorsa onu sil ya da üzerine yaz — **yenisini** kullan.
- Dosyanın adını ya da uzantısını **değiştirme** (`.zip` yapma, açma).

## 2) Kur

- İnen `spread-probe.ccx` dosyasına **çift tıkla**.
- Creative Cloud "üçüncü taraf eklenti" (third-party plugin) uyarısı gösterir → **Install / Yükle**.
- "Kuruldu" mesajını bekle.
- **Premiere Pro'yu tamamen kapatıp yeniden aç.**

## 3) Paneli bul ve sürümü kontrol et

- Premiere'de üst menüden: **Window → UXP Plugins → Spread Probe** (orada yoksa **Window → Extensions**).
- Panelin en üstünde **"Spread Probe v0.1.1"** yazmalı. **0.1.0** görüyorsan eski sürüm açık: 0. adımı tekrarla.

## 4) Deneme sequence'ı (`PROBE_test`) — senin gerçek düzenin geçerli

Adı **tam olarak** `PROBE_` ile başlayan bir sequence (ör. `PROBE_test`). Düzen:

```
V1: [ kamera 1 ][ kamera 2 ] …        ← kameralar arka arkaya
A1: [ kamera 1 sesi ][ kamera 2 sesi ] ← kameraların kendi sesleri (bağlı)
A2: [ harici ses 1 ][ harici ses 2 ] … ← harici ses kayıtları (ör. 260912_133224_Tr1.WAV) arka arkaya
A3: [ harici ses … ]                   ← varsa diğer harici sesler
V2 ve üstü, A4 ve üstü: BOŞ
```

- **Kamera** = V1'deki **ilk** klip ve onun kendi sesi (aynı dosya, aynı başlangıç/bitiş).
- **Harici ses** = hiçbir kamera videosuyla aynı dosyadan gelmeyen ses klibi (hangi ses track'inde olursa olsun).
- T7 için **aynı track'te arka arkaya en az iki harici ses** gerekli (ör. A2'de iki tane).
- Timeline'ın sol üstündeki **Linked Selection** (zincir) simgesi **açık** olsun.

### Testten önce TEMİZLİK (önemli)

- Önceki test turundan kalan kopyaları sil: **V2 ve üstündeki**, **A4 ve üstündeki** bütün klipler.
  (Klibe tıkla → Delete. Boş kalan track'ler sorun değil.)
- İstersen önceki turdan kalan `PROBE_test Copy` sequence'larını da Project panelinden silebilirsin.
- `PROBE_test` timeline'ına bir kez tıkla. Paneldeki durum kutusu **yeşil** olmalı:
  `✓ Aktif sequence "PROBE_test" — testler açık.`

## 5) Testi çalıştır

- Önce **Tara**'ya bas. Günlükte `Kurulum uygun görünüyor.` yazmalı. (V2+/A4+ uyarısı çıkarsa temizliği yap.)
- Sonra **Hepsini çalıştır**'a bas. Sıra: T1, T2, T4, T3, T6, T8, T5, T7. Timeline'da üst track'lerde kopyalar belirecek, bu normal.
- Arada panel sana **soru** soracak (sarı kutu). Sorudaki şeyi yap, sonra **Evet / Hayır** ile cevapla. Emin değilsen **Atla**.
  - **T3 (Taşı):** Söylenen üst track'teki **kopya videoya** bir kez tıkla → altındaki kopya ses de seçildi mi?
  - **T6 (Geri alma):** Önce **timeline'a bir kez tıkla**, sonra **Ctrl+Z**'ye (Mac: **Cmd+Z**) **yalnızca BİR kez** bas
    (ya da **Edit → Undo**). Soru: T3'ün yaptığı her şey geri geldi mi (kopyalar gitti, kamera klibi ve sesi yerine döndü)?
  - **T8 (Bağlı doğurma):** Söylenen üst track'teki **yeni videoya** bir kez tıkla → sesi de seçildi mi?
  - **T5 (Seçim):** Timeline'a bak: sayılan klipler seçili (vurgulu) görünüyor mu?
- Günlükte `Bitti.` yazınca test tamam.

## 6) Raporu bana getir

- **Raporu kopyala**'ya bas. Günlükte `✓ Rapor panoya kopyalandı` yazar.
- Sohbete dön ve **yapıştır** (Ctrl+V / Cmd+V).
- Kopyalama çalışmazsa: en alttaki **Rapor** kutusuna tıkla, **Ctrl+A** (Mac: **Cmd+A**) → **Ctrl+C** (Mac: **Cmd+C**) → yapıştır.

---

## Sorun çıkarsa

- **Çift tıklayınca kurulmuyor / "UPI status -160" gibi bir hata → 2. yol:**
  aescripts'in ücretsiz **ZXP/UXP Installer**'ını indir (<https://aescripts.com/learn/zxp-installer/>), aç,
  `spread-probe.ccx`'i pencereye **sürükle-bırak**, Premiere'i yeniden başlat.
- **"Zaten kurulu" / eski sürüm açılıyor:** 0. adımla eskisini kaldır, Premiere'i kapat, sonra yeniden kur.
- **Düğmeler gri / kilitli:** Açık timeline'ın adı `PROBE_` ile başlamıyor ya da timeline seçili değil → `PROBE_test`'e tıkla, 2 sn bekle.
- **Bir test "BELİRSİZ":** Genelde önceki bir test klibi silmiştir (ör. T6'da Ctrl+Z yapılmadıysa T3 kamerayı taşımış kalır).
  **Edit → Undo** ile geri al, temizliği yap, tekrar çalıştır.
- **Testi baştan tekrarlamak için:** temizlik adımını yap (V2+, A4+ sil), gerekirse kamera klibi ve sesini V1/A1'e geri koy.
