# Spread — Premiere Pro çok kameralı çekim düzenleyici (v1.2.0)

**Kurulum:** [`release/Spread_Kurulum_v1.2.0.zip`](release/Spread_Kurulum_v1.2.0.zip) → çıkart → **KUR.cmd** (yönetici izni gerekmez). 1.2.0 son elle
kurulum: sonraki sürümler panelden gelir (yayın: herkese açık `badideagency/bad-spread-updates`, yalnız zip + `latest.json`).
Ayrıntı: **[KURULUM_TR.md](KURULUM_TR.md)** · Ekran görüntüleri: [docs/ekran](docs/ekran) · Sürüm notu: [docs/SURUM_NOTU_v1.2.0.md](docs/SURUM_NOTU_v1.2.0.md)

| Bileşen | Ne yapar |
|---|---|
| **Spread** 1.2.0 (`spread/`, UXP paneli) | **① Dağıt** (SPREAD: her klip kendi track'ine) → Premiere *Clip › Synchronize* → **② Topla** (TOPLA: oturumları senkron sonucundan bulur, çekim sırasıyla dizer; cihaz → V, kaynak → A; çift kopyaları siler) → gözle kontrol → **③ Bağla** (BAĞLA: harici sesi her oturumun kendi kamerasına göre keser, harici sesin olmadığı yerde kamera sesini korur, her grubu tek bağ yapar; Premiere mono + stereo karışık grubu reddederse farklı kanal tipindeki sesleri — silmeden — bağ dışında bırakıp yeniden bağlar). Kırpma komutlarının etkisi sequence başına bir kez **ölçülür** (kalibrasyon; gerçek Premiere 26.5.1'de kanıtlandı). BadIdea koyu tasarım dili: yalnız sıradaki adımın düğmesi (tek vurgu), tek satır sonuç, başlık + 3 satırlık onay, **Ayarlar**, **Sorun bildir**, **↻ Yenile**; yeni sürüm varsa üstte **güncelleme şeridi**. |
| **Spread Helper** 1.2.0 (`cep-helper/`, CEP paneli) | Tek satır "Spread Helper çalışıyor ↻ ●"; Spread panelinin arkasında sekme olarak durabilir. Bağlama köprüsü (localhost:47731, token'lı) — Premiere'in UXP'sinde bağlama ve ExtendScript'e erişim yok. Köprü yoksa Spread'in planıyla **Bağla** (düğme yalnız gerektiğinde). v1.2.0: **güncellemeyi o yapar** (indir → sha256 → yedekle → kur → projeleri kaydedip doğrulayarak Premiere'i yeniden başlat). |
| Spread Probe 0.1.1 (kök `index.ts`, `src/`) | API yoklama paneli (arşiv; yayımlanmaz). |

- Geliştirici devir notu (kanıtlanmış davranışlar, tasarım, kararlar, riskler): **[handoff.md](handoff.md)**

## Geliştirme

```bash
npm ci
npm run check            # typecheck + eslint (Adobe premierepro kuralları) + d.ts / uxp.d.ts satır kontrolü + host.jsx ES3/belge
                         # kontrolü + check:xml + check:core + Probe smoke + Spread smoke (mock Premiere + gerçek yardımcı sunucusu)
                         # + regresyon (v0.3.3 kırpması gerçek set anlamında düşer, güncel kod geçer)
npm run package:kurulum  # release/spread.ccx + release/Spread_Kurulum_v<sürüm>.zip (spread.ccx + SpreadHelper/ + KUR/KALDIR + OKU_BENI)
npm run publish-update   # paketi üretir, sha256, latest.json → herkese açık bad-spread-updates deposuna commit + push (notlar:
                         # scripts/update-notes.json; kaynak kod gitmez; --dry-run)
bash scripts/test-kurulum-wine.sh   # KUR.cmd / KALDIR.cmd sınaması (Wine): HKCU değerleri, kopyalama, geri yükleme
bash scripts/test-restarter-wine.sh # güncelleme sonrası yeniden başlatıcı (Wine + Windows Node 17.7.1 sahte Premiere)
npm run build:spread && node spread/dev/screens.mjs   # ekran görüntüleri (mock + jsdom + Chromium) → docs/ekran
```

Kurallar: Premiere UXP API'si yalnız `node_modules/@adobe/premierepro/src/premierepro.d.ts` (26.5.0) dosyasından kullanılır
(her çağrıda `// d.ts:L<satır> Tip.üye`); UXP modülleri `// uxp.d.ts:L<satır> Sınıf.üye`; ExtendScript DOM üyeleri
`// docs: <Premiere Pro Scripting Guide adresi>` — hepsi `npm run check` ile doğrulanır.
TrackItem referansları transaction sınırını aşmaz (kuşak koruması, `spread/src/model.ts`). Bağlama tek modülde izole: `spread/src/linker.ts`.
