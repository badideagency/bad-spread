# Spread 1.2.1 — yanlış "kırpılmış klip" uyarısı düzeltildi · Ctrl+Z sonrası yeniden Dağıt / Topla

Panelden gelir: üstteki şerit **"Yeni sürüm 1.2.1 · Güncelle"** → Güncelle → "Projeyi kaydedip Premiere'i yeniden başlatayım mı?" →
Yeniden başlat. Başlıkta **1.2.1** görünür.

## 1 — Tek kamera / 29.97 fps: yanlış "kırpılmış kamera klibi" uyarısı

- Neden: Premiere klibin sonunu tam kareye yuvarlar (out = tam kare sayısı), medya süresi ise milisaniyedir. Aradaki fark hep
  1 kareden küçüktür (Emre'nin 12 klibinde 0.03–0.94 kare). 1.2.0 bu farkı "kırpılmış" sayıp Dağıt'ı başlatmıyordu.
- Artık: klip **kırpılmamış** sayılır ⇔ başı kırpılmamış (in = 0) VE medya sonu ile out arasındaki fark 0 ile 1 kare arasında.
  Kare = klibin kendi kare hızı (okunamazsa sequence'ınki, o da yoksa 23.976). Gerçekten kırpılmış klip (baştan kırpık ya da
  sonundan ≥ 1 kare kırpık) yine reddedilir; uyarı farkı tick, milisaniye ve kare olarak yazar.
- Dağıt artık ilk kamerayı **tek başına** yerleştirip aslıyla tick düzeyinde karşılaştırır (ölçüm):
  - birebir → kalanlar aynı yolla;
  - yalnız sonunda 1 kareden küçük fark varsa (Premiere klibi medya sonuna uzattıysa) → ayrı bir adımda klibin sonu aslına çekilir
    (yalnız "Out point"; "End" kullanılmaz), yeniden doğrulanır;
  - başka her fark → Dağıt durur, kalan kameralara dokunmaz; farkı, Ctrl+Z sayısını ve yedek sequence adını yazar.

## 2 — Ctrl+Z sonrası Dağıt / Topla yeniden yapılabilir; ↻ bu sequence'ın kayıtlarını temizler

- Panelin kayıtları (adım ✓'leri, yarım iş kaydı, Topla / Bağla kaydı) artık **ipucu, kilit değil**. Her kayıt işlem bittiğinde
  timeline'ın parmak izini saklar; panel açılınca, sequence değişince, timeline'ın şekli değişince (ör. Ctrl+Z) ve her işlemden önce
  canlı timeline'la karşılaştırır:
  - tutmuyorsa kayıt silinir, günlüğe "Timeline değişmiş (geri alma/elle düzenleme) — önceki Dağıt kaydı unutuldu." yazılır ve işlem
    normal çalışır (sıradaki adım göstergesi de kendiliğinden düzelir);
  - tutuyorsa kilit yok, yalnız soru: "Bu sequence'ta Dağıt zaten yapılmış görünüyor. Yine de çalıştırılsın mı?"
- Clip › Synchronize (klipleri yalnız zamanda kaydırır) Dağıt ✓'ünü silmez.
- **↻** açık sequence'ın bütün kayıtlarını siler (adım işaretleri, yarım iş kaydı, Topla / Bağla kaydı, eski Bağla planı), sonra
  panelleri yeniden yükler: "Bu sequence'ın kayıtları temizlendi." Başka sequence'ların kayıtları ve kırpma ölçümü kalır.
- Ctrl+Z'nin bıraktığı boş track'ler Dağıt'ta yeniden kullanılır (önce onlar dolar, yeni track gerekirse sonra açılır).

## Emre için 5 adımlık sınama

1. Premiere'i aç → Spread panelinin üstünde "Yeni sürüm 1.2.1 · Güncelle" şeridi → tıkla.
2. **Güncelle** → "Projeyi kaydedip Premiere'i yeniden başlatayım mı?" → **Yeniden başlat** (proje kaydedilir, Premiere aynı projeyle açılır).
3. Spread'in başlığında **1.2.1** yazdığını gör.
4. "A027C012_260803UH" sequence'ında **Dağıt** → "kırpılmış" uyarısı çıkmadan dağıtmalı (günlükte "ölçüm … birebir" ya da "yalnız
   kuyruk … → SetOutPoint"). Sonra timeline'a tıkla, panelin yazdığı kadar **Ctrl+Z** → Dağıt düğmesi kendiliğinden geri gelir →
   **Dağıt** yeniden çalışır.
5. **↻** → "Bu sequence'ın kayıtları temizlendi." → **Dağıt** yine çalışır (timeline zaten dağıtılmışsa "Zaten dağıtılmış").
   Bir şey tutmazsa **Sorun bildir** raporunu gönder.

## Doğrulama

- Mock: 102 → 114 senaryo (316 → 365 denetim). Yeniler: gerçek 12 kliplik veri (red yok, plan kurulur, 0 yeni track), gerçekten
  kırpılmış klip (red sürer), overwrite ölçümü (birebir; sonu medya sonuna uzamış → ayrı SetOutPoint; bağlı ses izliyor / izlemiyor;
  baş kayması → DUR; ≥ 1 kare → DUR), Dağıt → Ctrl+Z → Dağıt, Dağıt → ↻ → Dağıt, Topla → Ctrl+Z → Topla, ↻ başka sequence'a dokunmaz,
  değişmemiş timeline → soru. 12 Eylül verisiyle çalışan senaryolar aynen geçer.
- Gerçek Premiere'de bakılacak: overwrite'ın klibi tam kare mi yoksa medya sonuna kadar mı yerleştirdiği (ölçüm satırı söyler), bağlı
  sesin video "Out point"unu izleyip izlemediği (ölçülür), klibin kare hızının okunabildiği (Durum raporunda "kare kaynağı").
