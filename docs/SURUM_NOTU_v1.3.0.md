# Spread 1.3.0 — Premiere senkronu bozuksa Topla fark ediyor · eşzamanlı DJI mikrofonları

Panelden gelir: üstteki şerit **"Yeni sürüm 1.3.0 · Güncelle"** → Güncelle → "Projeyi kaydedip Premiere'i yeniden başlatayım mı?" →
Yeniden başlat. Başlıkta **1.3.0** görünür.

## 1 — Senkron sağlığı (Topla'dan önce)

Premiere Clip › Synchronize bazen klipleri yanlış yere koyar (A043 çekimi: C002–C009 rastgele, C001 / C013'ün üstüne). Bir kamera aynı
anda iki kayıt alamaz, kayıtlarını da sırayla alır. Topla artık bu imkânsız durumları arar:

- aynı kameranın iki klibi ≥ 1 kare üst üste;
- aynı kamerada dosya sırası ile zaman sırası ters (ör. C0003, C0001'den önce) — yalnız dosya sayacı güvenle okunabiliyorsa
  (A043C001, C0001, Zoom tarih_saat);
- aynı Zoom'un iki kaydı üst üste.

Bulursa dosya sırasına ve çoğunluğa uyan en uzun klip dizisini doğru sayar (eşit seçenekler arasında: kayıtların fiziksel olarak sırayla
sığdığı dizi); gerisini **şüpheli** işaretler. Onayda, günlükte ve Durum raporunda açıkça yazar:

> SENKRON SAĞLIĞI: Premiere senkronu 8 klipte bozuk: C002…C009 (aynı kameranın C001, C010…C014 klipleriyle çakışıyor / sırası ters).
> Bunlar oturuma alınmadı; park track'ine gider (zamanı değişmez, silinmez). → Elle düzelt ya da yeniden senkronla.

- Şüpheli klipler oturum kurmaz, sesleri bağlamaz; park track'ine gider, zamanı değişmez, **silinmez**. Bağla onlara dokunmaz.
- Hangisinin doğru olduğu çıkarılamıyorsa tahmin yok: o klipler **belirsiz** olarak park'a. Hiçbir sıra tutmuyorsa (ör. aynı adla
  kaydeden iki kamera, ya da Premiere ilişkisiz grupları üst üste koymuş) ya da kameranın dosya sayacı okunamıyorsa (GoPro, Canon MVI_)
  Topla eskisi gibi **sorar**.
- DJI dışında adı tanınmayan ses kayıtlarında (ör. REC0001) davranış 1.2.1 ile aynı.
- Önce düzeltmek istersen onayda **Vazgeç** — hiçbir şey değişmez.
- Sorun yoksa Topla eskisi gibi çalışır; Durum raporunda "SENKRON SAĞLIĞI — sorun yok".

## 2 — Aynı anda kayıt yapan birden çok DJI mikrofonu

- DJI dosya adından mikrofonun kim olduğu kesin okunamıyor (DJI_01 / DJI_02 farklı mikrofon da olabilir). Bu yüzden DJI dosyalarının
  üst üste olması artık **hata sayılmaz**.
- Eskiden bütün DJI dosyaları tek track'e düşüp Topla'yı "çakışma" ile durduruyordu. Artık aynı anda kayıtta olan dosyalar yan yana
  track'lere (şerit) konur: kaynak eşlemendeki track aynen kalır, ek şeritler eşlenen track'lerin hemen altına açılır.
  Onayda: "DJI → A1 (+ A2, A3: eşzamanlı dosyalar, 3 şerit)".

## Emre için sınama

1. Güncelle → başlıkta **1.3.0**.
2. A043 çekiminin **bozuk senkronlu** hâlinde (Clip › Synchronize'dan sonra) **Durum** → raporda "SENKRON SAĞLIĞI" bölümü.
3. **Topla** → onayda "Premiere senkronu … klipte bozuk: …" satırı. Devam dersen doğru klipler dizilir, bozuklar park'ta kalır
   (zamanı aynı). Vazgeç dersen hiçbir şey değişmez. Beklenmedik bir şey olursa **Sorun bildir** raporunu gönder.

## Doğrulama

- Mock: 119 → 127 senaryo. Yeniler: seçim birimi (eşit seçenek → belirsiz; sığma; iki gövde → sorulur; kurallar ayrışınca belirsiz),
  A043 şeklinde fixture (15 tek-kamera klip, 8'i yanlış yerde: doğru 7 seçilir, 8 şüpheli park edilir; üç eşzamanlı DJI mikrofonu hata
  sayılmaz ve şeritlere dağılır; Bağla şeritli düzende çalışır ve park'takilere dokunmaz; gerçek yerleşimde "sorun yok" ve Topla eski
  akış), aynı çekimin başka bir bozuk yerleşimi (belirsizler), üst üste ilişkisiz gruplar (sorulur), adı tanınmayan ses (1.2.1 gibi),
  oturum içinde ters sayaç. 12 Eylül / A042 / A027 verisiyle çalışan eski senaryoların hiçbiri değişmedi. Bağımsız inceleme #14'ün
  bulguları düzeltildi.
- Fixture sentetik (gerçek tick'ler raporda yoktu); gerçek A043 projesinde sonuç Durum raporunda görünür.
