# handoff — Spread Probe (ADIM 1: API yoklama paneli)

## Durum (tek bakışta)

| | |
|---|---|
| Yapılan | Premiere Pro UXP yoklama paneli: 7 test (T1–T7), "Hepsini çalıştır", panelde rapor + karar önerisi, "Raporu kopyala". **SPREAD / RE-STACK YAZILMADI** (bilinçli). |
| Paket | `release/spread-probe.ccx` (kökte `manifest.json`, dosyalar 644, klasörler 755; zip açılıp kontrol edildi) |
| Bulutta doğrulanan | `tsc --strict`, Adobe'nin `@adobe/eslint-plugin-premierepro` kuralları, d.ts satır referans kontrolü, mock Premiere ile 3 senaryoluk smoke testi, `.ccx` yapısı. Ayrıntı: [Doğrulama](#doğrulama-bulutta-yapılan) |
| Doğrulanamayan | **Gerçek Premiere davranışı.** Buluttaki ortamda Premiere yok. Asıl cevap kullanıcının raporundan gelecek. |
| Bekleyen | Kullanıcı [KURULUM_TR.md](KURULUM_TR.md) adımlarını izleyip raporu sohbete yapıştıracak → karar (UXP yeterli / UXP + workaround / CEP). |
| Dal | `claude/sweet-bell-do4j75` |

## Dosya haritası

```
index.ts               giriş: butonlar, PROBE_ durum çubuğu (1,5 sn'de bir), meşgul kilidi, rapor kopyalama
src/ppro.ts            require("premierepro") + d.ts tipleri (tek giriş)
src/guard.ts           PROBE_ KİLİDİ: requireProbe(), assertStillProbe()
src/timeline.ts        snapshot/diff, probe setini bulma, transact() (Adobe kalıbı), seçim kurma
src/tests.ts           T1–T7, çalıştırma sırası, tarama
src/report.ts          rapor metni + karar mantığı (decide)
src/ui.ts              günlük, Evet/Hayır/Atla soruları
public/                manifest.json (v5, premierepro ≥ 25.6.0, clipboard izni), index.html, ikonlar
scripts/               package-ccx.sh, verify-ccx.py, check-api-refs.mjs
dev/smoke.cjs          sahte premierepro ile dist/'i Node'da uçtan uca çalıştırır (3 senaryo)
release/               spread-probe.ccx
```

## Komutlar

```bash
npm ci
npm run check        # typecheck + lint + check:api + smoke (happy/grim/throw)
npm run package      # build → release/spread-probe.ccx → verify-ccx.py
npm run api:table    # kullanılan her API'nin d.ts satırı + kullanıldığı yerler
```

## Mimari kararlar

- **Tek API kaynağı:** `node_modules/@adobe/premierepro/src/premierepro.d.ts` (26.5.0, `npm i -D @adobe/premierepro` ile gelen "latest").
  Her çağrının yanında `// d.ts:L<satır> Tip.üye`. `scripts/check-api-refs.mjs` her yorumun satırında o üyenin
  gerçekten bulunduğunu **ve** satırın o tipin gövdesinde olduğunu kontrol eder; yorumsuz API çağrısını da yakalar.
  `tsc --strict` + `any` yok → d.ts'te olmayan bir metot derlenmez (denendi: sahte `createMoveTrackAction` → TS2339).
- **Adobe kalıbı:** tüm düzenlemeler `transact()` içinde:
  `project.lockedAccess(() => project.executeTransaction(compound => {...}, "PROBE …"))`.
  Action'lar **lexically** executeTransaction callback'inin içinde üretilir (`TxOps.clone/remove/insert/cloneSequence`).
  Adobe'nin lint kuralı `require-action-lock-scope` bunu zorunlu tutuyor ("kilit dışında üretilen Action runtime'da hata verir")
  ve kod bu kurala 0 hata ile uyuyor. Kural dışı bırakma (eslint-disable) yok.
- **PROBE_ kilidi (iki katman):**
  1. Görsel: durum çubuğu + butonlar 1,5 sn'de bir güncellenir; `exclusive()` kilitliyken hiç çalıştırmaz.
  2. Asıl kilit (`src/guard.ts`): her test `requireProbe()` ile başlar (aktif sequence adı `startsWith("PROBE_")`, büyük/küçük harf duyarlı).
     Her transaction, `setSelection` ve seçim kurma öncesi `assertStillProbe()`: elimizdeki **ve** taze okunan aktif sequence'ın adı
     hâlâ PROBE_ mi, aktif sequence'ın guid'i hâlâ aynı mı. Değilse `ProbeLockError` → test durur; "Hepsini çalıştır" kalan testleri iptal eder.
     "Hepsini çalıştır" koşuyu başladığı sequence'ın guid'ine **sabitler** (`requireProbe(pin)`): koşu ortasında başka bir PROBE_*
     sequence (ör. T1'in yedeği) aktif olursa durur. Her koşu eski sonuçları temizler.
     Tüm düzenlemeler `SequenceEditor.getEditor(ctx.sequence)` ile ve yalnız `ctx.sequence` track'lerinden okunan kliplerle yapılır.
- **Klip seçimi (şartnameden bilinçli sapma):** Şartname "seçili klip" diyor; panel ise PROBE_test yapısını **kendisi buluyor**
  (V1'deki ilk video = kamera, A1'de aynı kaynak+aynı başlangıç = kamera sesi, A1'deki diğer kaynaklar = harici sesler).
  Neden: teknik olmayan kullanıcı her testten önce doğru klibi seçmek zorunda kalmasın, "Hepsini çalıştır" tek tıkla yürüsün.
  Kopyalar hep yeni/üst track'lere gittiği için asıllar V1/A1'de kalır ve tekrar bulunabilir. Tarama sonucu rapora yazılır.
- **Klip kimliği:** d.ts'te track item id'si yok. Kimlik = `tür|track|start|end|in|out|projectItemId|ad` (tick string'leri).
  Önce/sonra snapshot'ları çoklu küme farkıyla karşılaştırılır (`added/removed`). Ripple ölçümü zamandan bağımsız anahtarla yapılır.
- **Clone parametreleri:** `timeOffset = TIME_ZERO`, `alignToVideo = false` (kare hizalaması sadakati bozmasın),
  `isInsert = false` (overwrite; insert diğer track'leri kaydırabilir). Hedef track = track sayısı (henüz olmayan ilk track).
  Video klonlanırken `aOffset` bağlı ses A1'deki aslını ezmesin diye yeni A track'e ayarlanır.
- **Silme:** `createRemoveItemsAction(sel, ripple=false, mediaType)`; `mediaType` silinen kliplerin türüyle aynı verilir
  (VIDEO ve AUDIO ayrı action). Parametrenin anlamı d.ts'te açıklanmıyor (örnek "hizalama" diyor); iki yorumda da doğru çalışsın diye.

## Testler — tam olarak ne yapıyor

"Hepsini çalıştır" sırası: **T1, T2, T4, T5, T6, T3, T7** (silen testler sona; T6 geri alındığı için T3'ten önce). Rapor T1…T7 sırasıyla yazılır.

| Test | Adımlar | PASS ölçütü | Rapora giden "facts" |
|---|---|---|---|
| **T1 Yedek** | `sequence.createCloneAction()` → `getSequences()` 3 sn'ye kadar yoklanır, yeni guid aranır. Aktif olan **yeni kopya** ise `setActiveSequence(asıl)` ile aslına dönülür; kullanıcı **başka** bir sequence'a geçtiyse geri çekilmez, koşu durur. | tam 1 yeni sequence | `cloneCreated, cloneName, activeChanged, cloneBecameActive, returnedToOriginal` |
| **T2 Track açma** | Kamera videosu: `vOffset = vCount − track` ile clone (hedef = olmayan ilk V). Harici ses: aynısı A için. İkisinden biri açmazsa (ya da **istisna** atarsa) **yedek:** `createInsertProjectItemAction(kameraProjectItem, sequenceSonu, vCount, aCount, limitShift=true)` → eklenenleri `ripple=false` sil → boş track kaldı mı? | clone ile V ve A track açıldı; ya da yedek yolla boş track kaldı | `openedV, openedA, fallbackRan, fallbackV, fallbackA` |
| **T3 Bağlı çift** | Sadece kamera **videosu** clone (önce mevcut boş track, yoksa yeni). Bağlı ses geldi mi (diff). Geldiyse kullanıcı kopya videoya tıklar → "ses de seçildi mi?" + panel `getIsSelected` ile okur. Sonra **asıl** video `ripple=false` silinir → A1'deki asıl ses duruyor mu (yetim)? | asıl silindi + ölçümler alındı | `cloneOk, linkedAudioCame, copyLinked, camVRemoved, orphanAudio, collateral` |
| **T4 Sadakat** | Kamera videosu (+bağlı gelen ses) ve harici ses mevcut boş track'lere clone; asıl↔kopya: start, end, inPoint, outPoint (tick string eşitliği), speed, disabled, name. Tolerans 0. | tüm çiftlerde tüm alanlar eşit | `pairs, mismatchFields` |
| **T5 Seçim** | `createEmptySelection` (+ yedek: `getSelection`+`removeItem`) → 4 klibi `addItem` → `setSelection` → `getSelection().getTrackItems()` ve her klipte `getIsSelected()` okunur → kullanıcıya "timeline'da seçili görünüyor mu?" | programla okunan doğru **ve** kullanıcı "Evet" | `programmaticOk, userSees, method, readCount` |
| **T6 Geri alma** | TEK transaction: kamera videosu clone + harici ses clone + asıl video sil. Hedefler önce **mevcut boş** track'ler (yoksa yeni) — geri alma, track açmaktan bağımsız ölçülsün; harici ses kamera sesi kopyasıyla çakışmıyorsa aynı track'e. Ctrl+Z istemeden önce kilit tekrar kontrol edilir. Kullanıcı timeline'a tıklayıp 1 kez Ctrl+Z → panel önceki snapshot ile birebir karşılaştırır. | otomatik karşılaştırma aynı + kullanıcı "Hayır" demedi | `txOk, changed, tracksAddedInOneTx, extCopyTrack, userAnswer, restored, tracksAfterUndo` |
| **T7 Ripple** | Arkasında klip olan harici sesi (A1'deki 1. harici ses) `ripple=false` sil; diğer tüm kliplerin start'ı önce/sonra karşılaştırılır. | hedef silindi, hiçbir klip kaymadı/kaybolmadı | `targetRemoved, shifted, missing` |

**Karar mantığı** (`src/report.ts` → `decide`): Zorunlu = T2, T4, T7, T3 (silme). Zorunlu bir testte çözümsüz FAIL → **"CEP'e geç"**.
Yalnızca workaround gerekenler (T2 yedek yolu, T4 zaman farkı düzeltmesi, T5 elle seçim, T6/T1 yedek) → **"UXP + workaround"**.
Hepsi temiz → **"UXP yeterli"**. Eksik/BELİRSİZ test varsa öneri "GEÇİCİ" diye işaretlenir. İstisnayla düşen testler ilk hata satırıyla listelenir.

## Kullanılan Premiere API'leri (hepsi `premierepro.d.ts` 26.5.0)

`npm run api:table` ile üretildi (58 benzersiz referans, 0 hata):

| d.ts satırı | API | d.ts'teki satır |
|---|---|---|
| L14 | `premierepro` | `export declare type premierepro = {` |
| L379 | `Application.version` | `readonly version: Promise<string>;` |
| L472 | `AudioClipTrackItem.getEndTime` | `getEndTime(): Promise<TickTime>;` |
| L477 | `AudioClipTrackItem.getInPoint` | `getInPoint(): Promise<TickTime>;` |
| L482 | `AudioClipTrackItem.getIsSelected` | `getIsSelected(): Promise<boolean>;` |
| L497 | `AudioClipTrackItem.getName` | `getName(): Promise<string>;` |
| L502 | `AudioClipTrackItem.getOutPoint` | `getOutPoint(): Promise<TickTime>;` |
| L507 | `AudioClipTrackItem.getProjectItem` | `getProjectItem(): Promise<ProjectItem>;` |
| L512 | `AudioClipTrackItem.getSpeed` | `getSpeed(): Promise<number>;` |
| L517 | `AudioClipTrackItem.getStartTime` | `getStartTime(): Promise<TickTime>;` |
| L522 | `AudioClipTrackItem.getTrackIndex` | `getTrackIndex(): Promise<number>;` |
| L537 | `AudioClipTrackItem.isDisabled` | `isDisabled(): Promise<boolean>;` |
| L672 | `AudioTrack.getTrackItems` | `getTrackItems(` |
| L1308 | `CompoundAction.addAction` | `addAction(action: Action): boolean;` |
| L1314 | `CompoundAction.empty` | `readonly empty: boolean;` |
| L1834 | `Guid.toString` | `toString(): string;` |
| L2414 | `ProjectStatic.getActiveProject` | `getActiveProject(): Promise<Project>;` |
| L2493 | `Project.getActiveSequence` | `getActiveSequence(): Promise<Sequence>;` |
| L2520 | `Project.getSequences` | `getSequences(): Promise<Sequence[]>;` |
| L2590 | `Project.setActiveSequence` | `setActiveSequence(sequence: Sequence): Promise<boolean>;` |
| L2598 | `Project.executeTransaction` | `executeTransaction(` |
| L2608 | `Project.lockedAccess` | `lockedAccess(callback: () => void): void;` |
| L2843 | `ProjectItem.getId` | `getId(): string;` |
| L2854 | `ProjectItem.name` | `readonly name: string;` |
| L3117 | `Sequence.createCloneAction` | `createCloneAction(): Action;` |
| L3159 | `Sequence.getAudioTrack` | `getAudioTrack(trackIndex: number): Promise<AudioTrack>;` |
| L3164 | `Sequence.getAudioTrackCount` | `getAudioTrackCount(): Promise<number>;` |
| L3181 | `Sequence.getEndTime` | `getEndTime(): Promise<TickTime>;` |
| L3211 | `Sequence.getSelection` | `getSelection(): Promise<TrackItemSelection>;` |
| L3238 | `Sequence.getVideoTrack` | `getVideoTrack(trackIndex: number): Promise<VideoTrack>;` |
| L3243 | `Sequence.getVideoTrackCount` | `getVideoTrackCount(): Promise<number>;` |
| L3267 | `Sequence.setSelection` | `setSelection(trackItemSelection: TrackItemSelection): boolean;` |
| L3273 | `Sequence.guid` | `readonly guid: Guid;` |
| L3279 | `Sequence.name` | `readonly name: string;` |
| L3288 | `SequenceEditorStatic.getEditor` | `getEditor(sequenceObject: Sequence): SequenceEditor;` |
| L3305 | `SequenceEditor.createRemoveItemsAction` | `createRemoveItemsAction(` |
| L3321 | `SequenceEditor.createInsertProjectItemAction` | `createInsertProjectItemAction(` |
| L3354 | `SequenceEditor.createCloneTrackItemAction` | `createCloneTrackItemAction(` |
| L3929 | `TickTimeStatic.TIME_ZERO` | `readonly TIME_ZERO: TickTime;` |
| L3986 | `TickTime.seconds` | `readonly seconds: number;` |
| L3992 | `TickTime.ticks` | `readonly ticks: string;` |
| L4014 | `TrackItemSelectionStatic.createEmptySelection` | `createEmptySelection(callback0: (selection: TrackItemSelection) => void): boolean;` |
| L4024 | `TrackItemSelection.addItem` | `addItem(` |
| L4034 | `TrackItemSelection.removeItem` | `removeItem(trackItem: VideoClipTrackItem \| AudioClipTrackItem): boolean;` |
| L4039 | `TrackItemSelection.getTrackItems` | `getTrackItems(): Promise<Array<VideoClipTrackItem \| AudioClipTrackItem>>;` |
| L4191 | `VideoClipTrackItem.getEndTime` | `getEndTime(): Promise<TickTime>;` |
| L4196 | `VideoClipTrackItem.getInPoint` | `getInPoint(): Promise<TickTime>;` |
| L4201 | `VideoClipTrackItem.getIsSelected` | `getIsSelected(): Promise<boolean>;` |
| L4216 | `VideoClipTrackItem.getName` | `getName(): Promise<string>;` |
| L4221 | `VideoClipTrackItem.getOutPoint` | `getOutPoint(): Promise<TickTime>;` |
| L4226 | `VideoClipTrackItem.getProjectItem` | `getProjectItem(): Promise<ProjectItem>;` |
| L4231 | `VideoClipTrackItem.getSpeed` | `getSpeed(): Promise<number>;` |
| L4236 | `VideoClipTrackItem.getStartTime` | `getStartTime(): Promise<TickTime>;` |
| L4241 | `VideoClipTrackItem.getTrackIndex` | `getTrackIndex(): Promise<number>;` |
| L4256 | `VideoClipTrackItem.isDisabled` | `isDisabled(): Promise<boolean>;` |
| L4392 | `VideoTrack.getTrackItems` | `getTrackItems(` |
| L4692 | `Constants.MediaType` | `export enum MediaType {` |
| L4804 | `Constants.TrackItemType` | `export enum TrackItemType {` |

Premiere dışı (UXP) çağrılar: `navigator.clipboard.setContent({"text/plain"})` → olmazsa `writeText(string)` → `writeText({"text/plain"})`
(tipler: `@adobe/cc-ext-uxp-types` 7.3.1 `Clipboard`); `require("uxp").versions.uxp`, `require("uxp").host` (yalnız rapor başlığı için).

## Doğrulama (bulutta yapılan)

- `npm run typecheck` — strict, 0 hata. d.ts'te olmayan metot derlenmiyor (sahte metotla denendi).
- `npm run lint` — `@adobe/eslint-plugin-premierepro` `recommendedTypeChecked` (Adobe örneğiyle aynı yapılandırma): 0 hata.
  İlk sürümde 7 `require-action-lock-scope` hatası vardı (Action'lar yardımcı fonksiyonlarda üretiliyordu, runtime'da doğru ama
  lexical olarak kilit dışında) → `TxOps` ile hepsi executeTransaction callback'inin içine taşındı.
- `npm run check:api` — 58 referans, 0 hatalı satır, 0 yorumsuz çağrı. (Yanlış satırı yakaladığı denendi.)
- `npm run smoke` — `dev/smoke.cjs`, dist/'i sahte bir `premierepro` modülüyle Node'da çalıştırır:
  - **happy:** hepsi PASS → "UXP yeterli"; PROBE_ dışı sequence'ta butonlar kilitli ve timeline değişmiyor;
    test ortasında kullanıcı başka sequence'a geçerse test ilk düzenlemeden önce duruyor, hiçbir sequence değişmiyor; rapor panoya gidiyor;
    Premiere kopyayı aktif yaparsa T1 aslına dönüyor ve T2–T7 aslında koşuyor (yedeğe dokunulmuyor); kullanıcı T1 sırasında
    Main Edit'e geçerse panel geri çekmiyor, koşu duruyor, eski sonuçlar rapordan siliniyor; T1–T2 arasında başka bir PROBE_*
    sequence aktif olursa sabitleme (pin) kilidi koşuyu durduruyor ve o sequence değişmiyor.
  - **grim:** createCloneAction istisna, clone track açmıyor (en üste yapışıyor), createEmptySelection istisna, setSelection false,
    silme ripple yapıyor, kullanıcı her şeye "Hayır" → hatalar panelde görünüyor, yedek yollar çalışıyor, öneri "CEP'e geç".
  - **throw:** olmayan track'e clone istisna atıyor → T2 yedek yola geçiyor, T4/T3/T6 mevcut boş track'lere düşüyor, öneri "UXP + workaround".
  - **UYARI:** mock'un davranışları TAHMİNDİR; sadece panel kodunun akışını/hata yakalamayı test eder, Premiere'in cevabını değil.
- `npm run package` — `.ccx`: kökte `manifest.json`, dosyalar 644 / klasörler 755 (Unix öznitelikli), `unzip -Z` ve gerçek açma ile
  kontrol edildi; sabit zaman damgası sayesinde tekrar üretilebilir (aynı sha256).
- **Bağımsız alt ajan incelemesi** (salt okuma; tüm kaynaklar baştan sona okundu, 58 referans kendi betiğiyle ayrıca doğrulandı):
  - İddia 1 — PROBE_ kilidi atlatılamıyor: **HOLDS WITH CAVEATS** → caveat'ler düzeltildi (aşağıda).
  - İddia 2 — PROBE_ dışı sequence'a dokunulmuyor: **HOLDS WITH CAVEATS** → caveat'ler düzeltildi.
  - İddia 3 — her API d.ts'te var, satır yorumları doğru: **HOLDS** (58/58, imzalar ve await kullanımı uyumlu).
  - Bulunan ve düzeltilenler:
    1. T1'deki `setActiveSequence` korumasızdı: kullanıcı T1 sırasında bilerek çıkarsa PROBE_test'i geri zorluyordu →
       artık yalnız **yeni kopya** aktif olduysa geri dönüyor; başka sequence'a geçildiyse `ProbeLockError` ile duruyor.
    2. "Hepsini çalıştır" sequence'ı sabitlemiyordu (T1 yedeği `PROBE_test Copy` sonraki testlerce düzenlenebilirdi) → `requireProbe(pin)`.
    3. Ad kontrolü yalnız elde tutulan nesnede yapılıyordu (ad önbellekli olabilir) → taze aktif nesnenin adı da kontrol ediliyor.
    4. `buildSelection` yedek yolu (getSelection+removeItem) kilit kontrolsüzdü → başına `assertStillProbe`.
    5. T2 yedek yolunda iki seçim aynı canlı nesneyi paylaşabilirdi → her tür için seçim kur + ayrı transaction'da sil.
    6. Sonuç tablosu koşular arasında temizlenmiyordu → her "Hepsini çalıştır" temizliyor.
    7. T6, geri almayı track açmayla karıştırıyordu → önce mevcut boş track'ler; Ctrl+Z sorusundan önce kilit + cevaptan sonra aktif sequence kontrolü.
    8. `decide()` T1/T6 BELİRSİZ'i eksik saymıyordu → `need()`; T3 "yetim ses" gerekçesi yalnız ölçülen çağrıya daraltıldı.
    9. "Paket eski" bulgusu: inceleme, paket yeniden üretilmeden önceki dosyaya bakmıştı; paket bu düzeltmelerden sonra yeniden üretildi.
  - Kalan not: `check-api-refs.mjs`'in "yorumsuz çağrı" taraması yalnız `.ad(` çağrılarını görür; özellik okumaları
    (`guid`, `name`, `ticks`, `seconds`, `empty`, `TIME_ZERO`) elle kontrol edildi, hepsinin yorumu var.

## Bilinen belirsizlikler / riskler (rapor gelince bakılacaklar)

1. **d.ts'te "bağlı mı" (link) sorgusu yok.** T3'teki "kopya bağlı mı" yalnızca kullanıcının tıklaması + `getIsSelected` okumasıyla ölçülür.
   SPREAD için bağ durumunu programla okuyamayacağız; strateji T3'ün "bağlı ses de geliyor mu / yetim kalıyor mu" cevaplarına göre kurulacak.
2. **`createRemoveItemsAction`'ın `mediaType` parametresi** belgelenmemiş. Silinen türe göre VIDEO/AUDIO veriliyor; rapordaki
   "silindi mi" satırları bunu doğrulayacak.
3. **`createEmptySelection` callback'i** senkron mu asenkron mu belirsiz → 3 sn zaman aşımı + `lockedAccess` içinde tekrar + `getSelection` yedeği.
   Hangi yolun çalıştığı rapora yazılıyor.
4. **Clone hedefi track sayısını aşınca** Premiere'in ne yaptığı (açar / en üste yapıştırır / hata) tam da T2'nin ölçtüğü şey.
   "En üste yapıştırır" durumunda kopya mevcut boş bir track'e düşer; rapor bunu "kopya mevcut bir track'e düştü" diye yazar.
5. **T1 clone'u aktif sequence yapabilir** → T1 `setActiveSequence` ile aslına geri döner (sonuç rapora yazılır). Kopyanın adı PROBE_ ile başlamazsa
   kilit onu da korur.
6. **T6'da Ctrl+Z odağı:** panel odaktayken Ctrl+Z Premiere'e gitmeyebilir → talimat "önce timeline'a tıkla" ve "Edit → Undo" alternatifi.
   Kullanıcı yanlışlıkla 2 kez basarsa otomatik karşılaştırma farkı gösterir.
7. **Autosave:** Panel `save()` çağırmaz, diske yazmaz; ama Premiere kendi autosave'ini yapabilir → KURULUM'da "deneme projesinde çalış" önerisi.
8. **minVersion 25.6.0 / tipler 26.5.0:** kullanılan hiçbir API'de d.ts'te `@since` etiketi yok (etiketliler: AAF 26.3, C2PA 26.5, MarkerColor 25.6 — kullanılmıyor).
   Kullanıcı Premiere 2026 (26.x) kullanıyor.
9. **Manifest id** `com.badideagency.spreadprobe` — yan yükleme (.ccx çift tıklama) için yeterli; Adobe Exchange/Developer Distribution'a
   çıkılırsa konsoldan alınan id ile değişmeli.
10. `settle()` = transaction sonrası 400 ms bekleme. Premiere modeli daha geç güncellerse snapshot eski durumu görebilir → rapordaki
    "yeni klipler: (yok)" + kullanıcının timeline'da gördüğü çelişirse bu süre artırılmalı.

## Rapor geldiğinde — nasıl okunur, SPREAD/RE-STACK'e etkisi

- **T2** `openedV/openedA=true` → SPREAD her klibi `vCount/aCount` ofsetle clone ederek kendi track'ine taşır.
  `fallbackV/A=true` → önce insert+sil ile yeterli boş track aç, sonra clone. İkisi de false → track'leri kullanıcı açar ya da CEP.
- **T6** tek Ctrl+Z tüm bileşik işlemi geri alıyor mu → SPREAD tek transaction'da yapılırsa tek adımda geri alınabilir.
  `tracksAddedInOneTx` → boş track yoksa bu transaction'da kaç yeni track açıldı (bilgi).
- **T3** `linkedAudioCame=true` → kamera klibi tek clone ile V+A taşınır; `false` → V ve A ayrı clone. `orphanAudio=true` → aslı silerken sesi de ayrıca sil;
  `false` → sesi ayrıca silme (çift silme). **Dikkat:** `orphanAudio` yalnız "seçimde sadece video + `mediaType=VIDEO`" çağrısı için geçerli.
- **T4** fark varsa hangi alan: zaman alanları → `createSetStart/End/InPoint/OutPointAction` ile düzelt; `speed` → UXP'de düzeltilemez.
- **T5** `userSees=Evet` → SPREAD sonunda her şeyi seçili bırakır; değilse kullanıcı elle seçer.
- **T7** kayma yoksa RE-STACK de `ripple=false` silme + clone ile "zamana dokunmadan" taşıma yapabilir.

## Graphify

Ortamda **kurulu değil** (PATH'te `graphify` yok, npm global'de yok, Claude skill/komut listesinde yok) → `/graphify .` **atlandı**.

## Sonraki adım

1. Kullanıcı raporu getirir → `decide()` önerisini ölçümlerle birlikte gözden geçir.
2. UXP yeterliyse ADIM 2: SPREAD (bu paneldeki `transact/TxOps`, snapshot/diff ve `guard` aynen kullanılabilir), sonra RE-STACK (interval packing).
3. Mock'u (`dev/smoke.cjs`) rapordaki gerçek davranışa göre ayarla → SPREAD/RE-STACK mantığı Premiere'siz test edilebilsin.
