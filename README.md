# Spread — Premiere Pro UXP eklentisi

| Bileşen | Durum | Paket |
|---|---|---|
| **Spread** v0.3.2 (`spread/`) | **SPREAD** (her klip kendi track'ine) → Premiere *Clip > Synchronize* → **TOPLA** (oturumları senkron sonucundan bulur: güçlü bağ + cihaz vetosu; çekim sırasıyla sequence başından dizer; cihaz → V, kaynak → A) → gözle kontrol → **BAĞLA** = **KES** (oturum içinde harici sesi çapaya göre kes, kılavuz sesleri sil) + bağla (köprüyle tek tık ya da yardımcı paneldeki BAĞLA). **Durum raporu** (oturumlar dahil) + kaynak eşleme + eşik/boşluk ayarı; yardımcı bağlantısında gerçek hata. | [`release/spread.ccx`](release/spread.ccx) |
| **Spread Helper** v0.3.2 (`cep-helper/`) | GÖRÜNÜR CEP paneli (Window → Extensions (Legacy) → Spread Helper): sunucu durumu, son istek, Premiere sürümü; köprü (localhost:47731, token'lı) ve köprüsüz **BAĞLA** düğmesi (KES planı + aktif sequence → Spread'in AYNI modülüyle grupla → ExtendScript `linkSelection`). | [`release/spread-helper-klasor.zip`](release/spread-helper-klasor.zip) (imzasız klasör + `KUR.cmd` + PlayerDebugMode `.reg`) |
| Spread Probe v0.1.1 (kök `index.ts`, `src/`, `public/`) | API yoklama paneli (T1–T8). Bitti; arşiv. | [`release/spread-probe.ccx`](release/spread-probe.ccx) |

- Kurulum ve kullanım: **[KURULUM_TR.md](KURULUM_TR.md)**
- Geliştirici devir notu (kanıtlanmış davranışlar, tasarım, kararlar, riskler): **[handoff.md](handoff.md)**

## Geliştirme

```bash
npm ci
npm run check            # typecheck + eslint (Adobe premierepro kuralları) + d.ts / uxp.d.ts satır kontrolü
                         # + host.jsx ES3/belge kontrolü + check:core (yardımcıdaki derlenmiş modül = kaynak)
                         # + Probe smoke + Spread smoke (mock Premiere + gerçek yardımcı sunucusu + yardımcı paneldeki BAĞLA)
npm run package:spread   # build → release/spread.ccx (+ zip kontrolü)
npm run build:core       # spread/src/helper-core.ts → cep-helper/js/spread-core.js (TEK modül, yardımcı panele)
npm run package:helper   # release/spread-helper-klasor.zip (imzasız); ZXPSIGNCMD=… verilirse ve zaman damgası alınırsa .zxp
```

Kurallar: Premiere UXP API'si yalnız `node_modules/@adobe/premierepro/src/premierepro.d.ts` (26.5.0) dosyasından kullanılır
(her çağrıda `// d.ts:L<satır> Tip.üye`); UXP modülleri `// uxp.d.ts:L<satır> Sınıf.üye`; ExtendScript DOM üyeleri
`// docs: <Premiere Pro Scripting Guide adresi>` — hepsi `npm run check` ile doğrulanır.
TrackItem referansları transaction sınırını aşmaz (kuşak koruması, `spread/src/model.ts`). Bağlama tek modülde izole: `spread/src/linker.ts`.
