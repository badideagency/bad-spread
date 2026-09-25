# Spread — Kurulum ve Kullanım (Türkçe, adım adım)

**Spread v0.2.0** gerçek özelliğin ilk sürümü. Tek bir işi var:

> **SPREAD** — aktif sequence'taki **her klibi kendi track'ine** dağıtır. **Hiçbir klibin zamanı değişmez**, sadece track'i değişir.
> Kameralar kendi sesleriyle **bağlı** kalır. Senkronu sonra **Premiere'in kendi Synchronize'ı** yapar.

Güvenlik: başlamadan onay sorar, **önce yedek sequence** oluşturur (yedek oluşmazsa hiç başlamaz), her adımdan sonra
her klibin zamanını aslıyla karşılaştırır; bir şey tutmazsa **durur** ve ne olduğunu yazar. Kendi başına düzeltme yapmaz.

---

## 1) Eski test panelini (Spread Probe) kaldır

- **Creative Cloud** uygulamasını aç → eklentiler bölümü (**Plugins / Eklentiler**) → **Manage plugins** (Eklentileri yönet).
- **Spread Probe**'u bul → **⋯** ya da **Uninstall / Kaldır**.
- **Premiere Pro'yu kapat.**

## 2) Spread'i indir ve kur

- İndir: <https://github.com/badideagency/bad-spread/raw/claude/sweet-bell-do4j75/release/spread.ccx>
  (GitHub'da `release/spread.ccx` → **Download**). Adını/uzantısını değiştirme.
- `spread.ccx`'e **çift tıkla** → Creative Cloud "üçüncü taraf eklenti" uyarısı → **Install / Yükle**.
- **Premiere Pro'yu kapatıp yeniden aç.**
- Paneli aç: **Window → UXP Plugins → Spread** (yoksa **Window → Extensions**). Başlıkta **"Spread v0.2.0"** yazmalı.

## 3) Testi GÜVENLİ yerde yap

- Gerçek projeni aç → **File → Save As…** → yeni bir adla kaydet (ör. `..._spread_test`). **Bu YENİ kopyada çalış.**
- O kopyada **orijinal sequence**'ı aç (22 kamera + 12 WAV olan). **`PROBE_test`'te DEĞİL** — orada eski test kopyaları var.
- Timeline'ın sol üstündeki **Linked Selection** (zincir) simgesi **açık** olsun.
- Sequence'a bir kez tıkla. Panelde `Aktif sequence: "…"` yeşil görünmeli.

## 4) SPREAD

- **SPREAD**'e bas. Panel önce planı günlüğe yazar (hangi klip hangi track'e gidecek), sonra sorar:
  `22 kamera, 12 ses bulundu, N track açılacak (V …, A …). Önce yedek sequence oluşturulacak. … Devam?`
  - Sayılar yanlışsa **Hayır** → hiçbir şey değişmez.
  - Doğruysa **Evet**.
- Panel sırasıyla: yedek sequence oluşturur (`… Copy`) → gerekli track'leri açar → klipleri dağıtır → (gerekirse) kırpma eşitlemesi →
  her adımdan sonra doğrular.
- Sonunda yeşil `✓ SPREAD tamam …` yazar. Beklenen görüntü: V1, V2, V3 … her birinde **tek** kamera klibi; A1 … A22 kamera sesleri;
  altında A23 … her birinde **tek** WAV. Hiçbir klip sağa/sola kaymamış olmalı.
- **Kırmızı `✗ SPREAD DURDU`** görürsen: panel ne olduğunu ve **kaç kez Ctrl+Z** basman gerektiğini yazar
  (ya da yedek sequence'ı kullan). O satırları kopyalayıp bana getir.

## 5) Synchronize

- Panelin dediği gibi: **Clip → Synchronize**'ı dene.
- Menü gri ise: **timeline'a bir kez tıkla**, **Ctrl+A** (Mac: **Cmd+A**) ile hepsini seç, **sağ tık → Synchronize** → **Audio**.
- Synchronize bitince timeline'a bak: WAV'lar kameralarla hizalandı mı?

## 6) DURUM RAPORU — bana getir (Synchronize'dan SONRA)

- Panelde **Durum raporu**'na bas → **Raporu kopyala** → sohbete **yapıştır**.
  (Kopyalama çalışmazsa: alttaki kutuya tıkla, Ctrl+A / Ctrl+C.)
- Rapor: her track'teki klipler (zamanlar tick + saniye, kaynak adı) ve **hangi WAV hangi kamerayla çakışıyor** (süre).
  **RE-STACK** bu veriyle tasarlanacak (bu sürümde RE-STACK yok).

---

## Sorun çıkarsa

- **Kurulmuyor / "UPI status -160":** aescripts'in ücretsiz **ZXP/UXP Installer**'ı (<https://aescripts.com/learn/zxp-installer/>),
  `spread.ccx`'i pencereye sürükle-bırak, Premiere'i yeniden başlat.
- **Düğmeler gri:** aktif sequence yok → timeline'a bir kez tıkla, 2 sn bekle.
- **"Plan kurulamadı":** panel başlamadan önce bir sorun gördü (ör. hızı değiştirilmiş ya da devre dışı kamera klibi); hiçbir şey
  değişmedi. Günlükteki `HATA:` satırlarını getir.
- **Geri dönmek:** `✓ SPREAD tamam` satırının altında kaç kez Ctrl+Z basacağın yazar; ya da `… Copy` adlı yedek sequence'ı kullan.
- **Not:** Kameralar proje öğesinden yeniden yerleştirilir → kamera klibinin üzerindeki **efektler / ses seviyesi ayarları taşınmaz**
  (bu aşamada ham klipler varsayıldı). Harici WAV'lar birebir kopyalanır.
