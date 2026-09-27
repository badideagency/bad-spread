# Spread 1.2.0 — panelden güncelleme + ↻ Yenile + yeni görünüm

Dağıt / Topla / Bağla mantığı **değişmedi** (v1.1.0 gerçek Premiere'de uçtan uca çalışıyor). **1.2.0 son elle kurulum:** zip'i
çıkart → KUR.cmd. Bundan sonraki sürümler panelden gelir.

## Güncelleme (panelden)

- Spread açılışta ve 6 saatte bir yeni sürüme bakar (Ayarlar → "Güncellemeleri denetle" ile elle de). İnternet yoksa sessizce geçer.
- Yeni sürüm varsa üstte ince şerit **"Yeni sürüm 1.x.x · Güncelle"** → notlar → **[Şimdi değil] [Güncelle]**.
- Güncellemeyi **Spread Helper** yapar (açık olmalı): indirir, **sha256** ile doğrular (tutmazsa hiçbir şeye dokunmaz), kendi klasörünü
  **yedekler** ve yeniler (yarıda kalırsa yedekten geri koyar), Spread panelini Adobe'nin kurucusuyla kurar (kuramazsa Creative Cloud'un
  **Install** penceresini açar).
- **"Projeyi kaydedip Premiere'i yeniden başlatayım mı?" [Sonra] [Yeniden başlat]** → açık projeler **kaydedilir ve dosyadan doğrulanır**; biri bile
  doğrulanamazsa **Premiere kapatılmaz**. Kapanınca aynı projeyle yeniden açılır.
- Yayın yeri herkese açık `badideagency/bad-spread-updates` (yalnız kurulum zip'i + `latest.json`; kaynak kod yok). Her adım
  güncelleme günlüğünde; **Sorun bildir** raporu onu da içerir.

## ↻ Yenile

- Spread'in başlığında: Spread Helper'ı ve Spread'i yeniden yükler, timeline'ı baştan okur. Yarım kalmış bir işlem varsa önce sorar.
- Spread Helper'da da aynı ↻.

## Yeni görünüm (BadIdea tasarım dili)

- Sıcak koyu zemin, krem yazı (saf beyaz yok), **tek vurgu rengi (krem)**: yalnız sıradaki adımın düğmesi ve güncelleme şeridi.
- Tek büyük başlık, soluk ikincil metin, 10–12 px köşeler, ince ayırıcılar, gölge yok, ince çizgi ikonlar. Yerleşim v1.1.0 ile aynı.
- Spread Helper aynı dilde, tek satır.
- **Premiere'in UXP sınırları** (kaynaklar `handoff.md`): panel yazı tipi paketleyemiyor (@font-face yok) → Poppins yerine Premiere'in
  kendi arayüz yazı tipi; CSS geçişleri / animasyon yok → değişimler anlık (CSS'te yazılı, ileride desteklenirse çalışır).

## Ekran görüntüleri — önce (1.1.0) / sonra (1.2.0)

Mock ortamı; Chromium'da çizildi (yazı tipi burada Open Sans, Premiere'de Premiere'in arayüz yazı tipi). "Önce" görüntüleri 1.1.0
sürüm notundaki ekranlar (`e0cdaf1`).

| | Önce (1.1.0) | Sonra (1.2.0) |
|---|---|---|
| Başlangıç | ![](https://raw.githubusercontent.com/badideagency/bad-spread/e0cdaf1573618d8050ba3b5505efcf79b2b5f94f/docs/ekran/01-baslangic-300.png) | ![](ekran/01-baslangic-300.png) |
| Dağıtıldı | ![](https://raw.githubusercontent.com/badideagency/bad-spread/e0cdaf1573618d8050ba3b5505efcf79b2b5f94f/docs/ekran/02-dagitildi-300.png) | ![](ekran/02-dagitildi-300.png) |
| Bağla onayı | ![](https://raw.githubusercontent.com/badideagency/bad-spread/e0cdaf1573618d8050ba3b5505efcf79b2b5f94f/docs/ekran/06-bagla-onay-300.png) | ![](ekran/06-bagla-onay-300.png) |
| Bitti | ![](https://raw.githubusercontent.com/badideagency/bad-spread/e0cdaf1573618d8050ba3b5505efcf79b2b5f94f/docs/ekran/08-bitti-300.png) | ![](ekran/08-bitti-300.png) |
| Hata | ![](https://raw.githubusercontent.com/badideagency/bad-spread/e0cdaf1573618d8050ba3b5505efcf79b2b5f94f/docs/ekran/09-hata-300.png) | ![](ekran/09-hata-300.png) |
| Ayarlar | ![](https://raw.githubusercontent.com/badideagency/bad-spread/e0cdaf1573618d8050ba3b5505efcf79b2b5f94f/docs/ekran/11-ayarlar-300.png) | ![](ekran/11-ayarlar-300.png) |
| Spread Helper | ![](https://raw.githubusercontent.com/badideagency/bad-spread/e0cdaf1573618d8050ba3b5505efcf79b2b5f94f/docs/ekran/21-yardimci-bagla-bekliyor-300.png) | ![](ekran/21-yardimci-bagla-bekliyor-300.png) |

Yeni ekranlar:

| Güncelleme şeridi | Notlar + Güncelle | Yeniden başlat? | Kuruldu |
|---|---|---|---|
| ![](ekran/14-guncelleme-seridi-300.png) | ![](ekran/15-guncelleme-onay-300.png) | ![](ekran/16-yeniden-baslat-onay-300.png) | ![](ekran/17-guncellendi-300.png) |

Diğer durumlar (dar):

| Topla onayı | Topla sürerken | Toplandı | Kırpma ölçülürken |
|---|---|---|---|
| ![](ekran/03-topla-onay-300.png) | ![](ekran/04-topla-ilerleme-300.png) | ![](ekran/05-toplandi-300.png) | ![](ekran/07-bagla-olcum-300.png) |

| Ne yapmalıyım? | Yeniden çalıştır | Yardımcı kapalı |
|---|---|---|
| ![](ekran/10-hata-ne-yapmali-300.png) | ![](ekran/12-yeniden-calistir-300.png) | ![](ekran/13-yardimci-kapali-300.png) |

Geniş panel (560 px):

![](ekran/01-baslangic-560.png)
![](ekran/06-bagla-onay-560.png)
![](ekran/08-bitti-560.png)
![](ekran/14-guncelleme-seridi-560.png)
![](ekran/15-guncelleme-onay-560.png)

Spread Helper:

| Çalışıyor | Bağla bekliyor | Hata | Ayrıntı (tıklayınca) |
|---|---|---|---|
| ![](ekran/20-yardimci-calisiyor-300.png) | ![](ekran/21-yardimci-bagla-bekliyor-300.png) | ![](ekran/22-yardimci-hata-300.png) | ![](ekran/23-yardimci-ayrinti-300.png) |

## Doğrulama

- Bütün mock senaryoları aynen geçer (v1.1.0'ın 91 senaryosu) + güncelleme / yeniden başlatma / ↻ senaryoları (yeni sürüm, aynı sürüm,
  bozuk sha256, internet yok, yardımcı kapalı, kurulum başarısız, yazma hatası → geri yükleme, kaydedip yeniden başlatma, kaydedilemeyen
  proje → kapatma yok, ↻).
- Yeniden başlatıcı Wine'da sahte bir Premiere'le (Windows Node 17.7.1) sınandı: üst süreç kapandıktan sonra da yaşıyor, aynı projeyle
  açıyor; süreç listesi okunamazsa, Premiere listede hiç görülmezse ya da süre dolarsa hiçbir şey açmıyor.
- KUR.cmd / KALDIR.cmd Wine sınaması; bağımsız alt ajan incelemesi (liste: `handoff.md`).
- **Gerçek Premiere'de bakılacak:** ilk panel güncellemesinde (1.2.0 → sonraki) Premiere'in kapanıp aynı projeyle yeniden açılması;
  Adobe kurucusunun paneli güncellemesi; yeni görünüm.
