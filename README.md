# Spread — Premiere Pro UXP eklentisi

| Bileşen | Durum | Paket |
|---|---|---|
| **Spread** v0.3.1 (`spread/`) | **SPREAD** (her klip kendi track'ine) → Premiere *Clip > Synchronize* → **TOPLA** (oturumları senkron sonucundan bulur: güçlü bağ + cihaz vetosu; çekim sırasıyla sequence başından dizer; cihaz → V, kaynak → A) → gözle kontrol → **BAĞLA** (oturum içinde harici sesi çapaya göre kes, kılavuz sesleri sil, her grubu tek bağ yap). **Durum raporu** (oturumlar dahil) + kaynak eşleme + eşik/boşluk ayarı. | [`release/spread.ccx`](release/spread.ccx) |
| **Spread Helper** v0.3.0 (`cep-helper/`) | Görünmez CEP yardımcısı: BAĞLA için ExtendScript `Sequence.linkSelection()` (UXP'de link API'si yok). Yalnız 127.0.0.1:47731, token'lı. | [`release/spread-helper.zxp`](release/spread-helper.zxp) (kendinden imzalı) · [`release/spread-helper-klasor.zip`](release/spread-helper-klasor.zip) (yedek kurulum) |
| Spread Probe v0.1.1 (kök `index.ts`, `src/`, `public/`) | API yoklama paneli (T1–T8). Bitti; arşiv. | [`release/spread-probe.ccx`](release/spread-probe.ccx) |

- Kurulum ve kullanım: **[KURULUM_TR.md](KURULUM_TR.md)**
- Geliştirici devir notu (kanıtlanmış davranışlar, tasarım, kararlar, riskler): **[handoff.md](handoff.md)**

## Geliştirme

```bash
npm ci
npm run check            # typecheck + eslint (Adobe premierepro kuralları) + d.ts / uxp.d.ts satır kontrolü
                         # + host.jsx ES3/belge kontrolü + Probe smoke + Spread smoke (mock Premiere + gerçek yardımcı sunucusu)
npm run package:spread   # build → release/spread.ccx (+ zip kontrolü)
ZXPSIGNCMD=/yol/ZXPSignCmd.exe npm run package:helper   # release/spread-helper.zxp (+ yedek zip); Linux'ta Wine gerekir
```

Kurallar: Premiere UXP API'si yalnız `node_modules/@adobe/premierepro/src/premierepro.d.ts` (26.5.0) dosyasından kullanılır
(her çağrıda `// d.ts:L<satır> Tip.üye`); UXP modülleri `// uxp.d.ts:L<satır> Sınıf.üye`; ExtendScript DOM üyeleri
`// docs: <Premiere Pro Scripting Guide adresi>` — hepsi `npm run check` ile doğrulanır.
TrackItem referansları transaction sınırını aşmaz (kuşak koruması, `spread/src/model.ts`). Bağlama tek modülde izole: `spread/src/linker.ts`.
