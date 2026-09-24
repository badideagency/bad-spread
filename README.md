# Spread — Premiere Pro UXP eklentisi

**ADIM 1: API yoklama paneli (Spread Probe).** Özellik yok; SPREAD / RE-STACK için gereken Premiere UXP
API'lerinin gerçekten çalışıp çalışmadığını ölçen 8 test (T1–T8) ve bir rapor + sınıflı karar önerisi üretir (v0.1.1).

- Kullanıcı kurulumu ve test adımları: **[KURULUM_TR.md](KURULUM_TR.md)**
- Geliştirici devir notu (tasarım, API tablosu, riskler, sonraki adım): **[handoff.md](handoff.md)**
- Kurulacak paket: [`release/spread-probe.ccx`](release/spread-probe.ccx)

## Geliştirme

```bash
npm ci
npm run check      # typecheck + eslint (Adobe premierepro kuralları) + d.ts satır kontrolü + mock smoke testleri
npm run package    # build → release/spread-probe.ccx (+ zip kontrolü)
```

Kurallar: Premiere API'si yalnızca `node_modules/@adobe/premierepro/src/premierepro.d.ts` (26.5.0) dosyasından kullanılır;
her çağrının yanında `// d.ts:L<satır> Tip.üye` yorumu vardır ve `npm run check:api` bunları doğrular.
Panel yalnızca adı `PROBE_` ile başlayan aktif sequence üzerinde çalışır (`src/guard.ts`).
