# Spread — Premiere Pro UXP eklentisi

İki eklenti:

| Eklenti | Durum | Paket |
|---|---|---|
| **Spread** v0.2.0 (`spread/`) | **SPREAD**: aktif sequence'taki her klibi kendi track'ine dağıtır, hiçbir klibin zamanı değişmez (kameralar bağlı kalır) → sonra Premiere Synchronize. **Durum raporu**: RE-STACK tasarımı için döküm. | [`release/spread.ccx`](release/spread.ccx) |
| Spread Probe v0.1.1 (kök `index.ts`, `src/`, `public/`) | API yoklama paneli (T1–T8). Bitti; repoda arşiv olarak duruyor. | [`release/spread-probe.ccx`](release/spread-probe.ccx) |

- Kurulum ve kullanım: **[KURULUM_TR.md](KURULUM_TR.md)**
- Geliştirici devir notu (kanıtlanmış API davranışları, tasarım, doğrulama, riskler): **[handoff.md](handoff.md)**

## Geliştirme

```bash
npm ci
npm run check            # iki eklenti: typecheck + eslint (Adobe premierepro kuralları) + d.ts satır kontrolü + mock smoke testleri
npm run package:spread   # build → release/spread.ccx (+ zip kontrolü)
npm run package          # Probe → release/spread-probe.ccx
```

Kurallar: Premiere API'si yalnızca `node_modules/@adobe/premierepro/src/premierepro.d.ts` (26.5.0) dosyasından kullanılır;
her çağrının yanında `// d.ts:L<satır> Tip.üye` yorumu vardır ve `npm run check:api` bunları doğrular.
TrackItem referansları transaction sınırını aşmaz (kuşak koruması, `spread/src/model.ts`).
