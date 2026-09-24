# handoff — Spread Probe (ADIM 1 / 1b: API yoklama paneli, v0.1.1)

## ⚠ ADIM 1b bulgusu (Premiere 26.5.1, v0.1.0 gerçek raporu)

> **TrackItem referansları transaction sonrası geçersiz olur. Spread/Re-stack bütün taşımaları TEK transaction'da yapmalı.**

- v0.1.0 T3, bir transaction'dan önce alınmış referansla sonraki transaction'da `createRemoveItemsAction` çağırınca
  `Error: The script object is no longer valid` verdi (timeline.js:216). → **Kural:** hiçbir TrackItem / ProjectItem / seçim nesnesi
  bir transaction'dan sonrakine taşınmaz. Her transaction'dan sonra track'ler baştan okunur ve klip
  **(track tipi, track index, start tick, end tick, kaynak adı)** ile yeniden bulunur (`timeline.ts → locKey/relocate`).
  Tek transaction içinde kullanılacak referanslar o transaction'ın **hemen öncesinde** taze alınır.
- v0.1.0 T5'te `TrackItemSelection.createEmptySelection` ile kurulan seçimde `addItem → [false,false]`, sonra
  `A nullptr was dereferenced`. → Seçim artık Adobe örneğinin kalıbıyla kuruluyor:
  `sel = await sequence.getSelection(); sel.addItem(item, false); sequence.setSelection(sel)`
  (`sample-panels/premiere-api/src/sequence.ts → setSequenceSelection`, `src/sequenceEditor.ts → removeSelectedTrackItems`).
  `createEmptySelection` kodda artık hiç yok.
- v0.1.0 raporundaki **"CEP'e geç" önerisi YANLIŞTI**: iki FAIL de bizim kullanım hatamızdı, API eksikliği değil.
  v0.1.1'de her FAIL sınıflıdır ve CEP yalnızca taze referans + Adobe kalıbıyla denenip yine başarısız olan API için önerilir.
- v0.1.0'da T1, T2, T4 PASS idi; T6/T7 kurulum (harici sesler A2/A3'te) bulunamadığı için çalışmadı → tespit düzeltildi.
- `ppro.Application.version` Premiere 26.5.1'de `undefined` döndü → sürüm UXP host'tan (`require("uxp").host.version`) okunuyor.

**SPREAD/RE-STACK tasarımına etkisi:** her toplu taşıma = tek `executeTransaction` (clone'lar + tek seçimle asılları silme), transaction'dan
önce: sequence'ı baştan oku → seçimi Adobe kalıbıyla kur → setSelection sonrası tekrar oku → o referanslarla action'ları üret. Arada
kullanıcı etkileşimi, Ctrl+Z ya da başka bir transaction olursa her şey baştan okunur.

## Durum (tek bakışta)

| | |
|---|---|
| Sürüm | **0.1.1** (manifest `version` 0.1.1 → Creative Cloud güncelleme olarak görür; panel başlığında "v0.1.1") |
| Yapılan | 8 test (T1–T8), "Hepsini çalıştır", rapor + sınıflı karar önerisi, "Raporu kopyala". **SPREAD / RE-STACK YAZILMADI.** |
| Paket | `release/spread-probe.ccx` (kökte `manifest.json`, dosyalar 644, klasörler 755; açılıp `dist/` ile birebir karşılaştırıldı) |
| Bulutta doğrulanan | `tsc --strict`, Adobe `@adobe/eslint-plugin-premierepro` kuralları, d.ts satır kontrolü (67 ref), mock Premiere ile 4 senaryo (happy/grim/throw/strict) + kilit aşamaları, `.ccx` yapısı |
| Doğrulanamayan | Gerçek Premiere davranışı — kullanıcının v0.1.1 raporu bekleniyor ([KURULUM_TR.md](KURULUM_TR.md)) |
| Dal | `claude/sweet-bell-do4j75` |

## Dosya haritası

```
index.ts               giriş: butonlar, PROBE_ durum çubuğu (1,5 sn'de bir), meşgul kilidi, koşu sabitleme, rapor kopyalama
src/ppro.ts            require("premierepro") + d.ts tipleri (tek giriş)
src/guard.ts           PROBE_ KİLİDİ: requireProbe(pin?), assertStillProbe()
src/timeline.ts        snapshot (kuşaklı), relocate, transact() + TxOps, selectExactly()/readSelection() (Adobe seçim kalıbı), classifyError
src/tests.ts           T1–T8, çalıştırma sırası, tarama
src/report.ts          rapor metni + sınıflı karar mantığı (decide), Premiere sürümü (UXP host)
src/ui.ts              günlük, Evet/Hayır/Atla soruları
public/                manifest.json (v5, 0.1.1, premierepro ≥ 25.6.0, clipboard izni), index.html, ikonlar
scripts/               package-ccx.sh, verify-ccx.py, check-api-refs.mjs
dev/smoke.cjs          sahte premierepro ile dist/'i Node'da uçtan uca çalıştırır (happy/grim/throw/strict)
release/               spread-probe.ccx
```

## Komutlar

```bash
npm ci
npm run check        # typecheck + lint + check:api + smoke (happy/grim/throw/strict)
npm run package      # build → release/spread-probe.ccx → verify-ccx.py
npm run api:table    # kullanılan her API'nin d.ts satırı + kullanıldığı yerler
```

## Mimari kararlar

- **Tek API kaynağı:** `node_modules/@adobe/premierepro/src/premierepro.d.ts` (26.5.0). Her çağrının yanında `// d.ts:L<satır> Tip.üye`;
  `scripts/check-api-refs.mjs` satırın o üyeyi içerdiğini ve o tipin gövdesinde olduğunu kontrol eder. `tsc --strict`, `any` yok.
- **Referans kuşağı (v0.1.1, `timeline.ts`):** her `snapshot()` bir kuşak numarası taşır. `transact()` işlendikten sonra (hata verse bile,
  `finally`) ve her kullanıcı sorusundan sonra (`askUser`) kuşak artar; temkin için `clearSelection`/`setSelection` sonrası da.
  Premiere'e giden her referans `useRef`/`useProj`/`FreshSelection.gen` kontrolünden geçer; eski kuşaktan bir referans Premiere'e hiç
  gitmeden `StaleRefError` ("BAYAT REFERANS") verir. Testler arası tek köprü (`lastT3`) yalnızca **değer** (anahtar listeleri) taşır.
- **Adobe düzenleme kalıbı:** `project.lockedAccess(() => project.executeTransaction(compound => {...}, "PROBE …"))`.
  Action'lar lexically executeTransaction callback'i içinde üretilir (`TxOps`); Adobe lint kuralı `require-action-lock-scope` 0 hata.
- **Adobe seçim kalıbı (`selectExactly`):** `clearSelection` → sequence'ı baştan oku, klipleri `relocate` ile bul → `getSelection` →
  `addItem(taze, false)` → `setSelection` → **geri oku** (`getSelection().getTrackItems()` sayısı + her klipte `getIsSelected`).
  Birebir değilse silme **yapılmaz** (yanlış klip silinmesin). Silmeye verilen seçim `setSelection`'dan sonra `getSelection()` ile alınır
  (Adobe `removeSelectedTrackItems` gibi); ardından gelen transaction referanslarını dönen taze `snap`'ten alır.
- **Silme `mediaType`:** yalnız video → VIDEO, yalnız ses → AUDIO, video+ses birlikte (T3) → VIDEO (Adobe örneğindeki gibi).
- **PROBE_ kilidi (değişmedi):** her test `requireProbe(pin)`; her transaction/seçim öncesi `assertStillProbe()` (tutulan + taze aktif
  sequence adı PROBE_, guid aynı); "Hepsini çalıştır" başladığı sequence'a sabitlenir; T1 yalnız "yeni kopya aktif olduysa" aslına döner,
  kullanıcı başka sequence'a geçtiyse durur.
- **Kurulum tespiti (v0.1.1, kullanıcının gerçek düzeni geçerli):** kamera video = V1'deki ilk klip; kamera sesi = aynı kaynak + aynı
  start/end'li ses klibi (en alttaki); harici ses = kaynağı hiçbir video klibinin kaynağı olmayan ses klibi, **TÜM ses track'lerinde**
  (ör. `260912_133224_Tr1.WAV` A2'de); T7 çifti = aynı track'te arka arkaya iki harici ses (önce A2).
- **FAIL sınıfları (`classifyError`, `Rec.fail`):** `api` = taze referans + Adobe kalıbıyla yapılmış çağrının ölçülen sonucu ya da
  "is not a function" türü eksik metot; `kod` = bayat referans / nullptr (bizim kullanımımız); `belirsiz` = sınıflanamayan istisna.
  **Yalnız `api` sınıfı engel (CEP gerekçesi) olabilir**; `kod`/`belirsiz` kararı "GEÇİCİ" yapar.

## Testler — v0.1.1

"Hepsini çalıştır" sırası: **T1, T2, T4, T3, T6, T8, T5, T7**. Her test başında sequence'ı baştan okur; önceki testten referans devralmaz.

| Test | Adımlar | PASS ölçütü | facts |
|---|---|---|---|
| **T1 Yedek** | `createCloneAction` → `getSequences` ile yeni sequence aranır; kopya aktif olduysa aslına dönülür | tam 1 yeni sequence | `cloneCreated, cloneName, activeChanged, cloneBecameActive, returnedToOriginal` |
| **T2 Track açma** | kamera videosu ve harici ses, hedef = track sayısı olacak ofsetle clone; açılmazsa yedek: insert + (her tür için taze seçimle) sil | V ve A için yeni/boş track elde edildi | `openedV, openedA, fallbackRan, fallbackV, fallbackA` |
| **T3 Taşı (tek transaction)** | TEK `executeTransaction`: kamera videosu → ilk boş V (+kV), kamera sesi → ilk boş A (+kA) clone (ikisi de aynı hedefe; bağlı partner gelirse üst üste yazılır → tek kopya), iki aslı tek seçimle `createRemoveItemsAction(ripple=false)` sil. Sonra: kullanıcı kopya videoya tıklar, panel `getSelection` ile kaç öğe seçili okur | asıllar gitti, 1+1 kopya, tick'ler birebir, başka klip değişmedi | `origVGone, origAGone, copiesV, copiesA, mismatchFields, collateral, linkedAnswer, selectedCount, autoLinked` |
| **T4 Sadakat** | kamera (+bağlı ses) ve harici ses ilk boş track'lere clone; start/end/in/out (tick), speed, disabled, name — tolerans 0 | tüm alanlar eşit | `pairs, mismatchFields` |
| **T5 Seçim** | 3 klip (kamera V, kamera A, 1. harici) Adobe kalıbıyla seçilir; "timeline'da seçili görünüyor mu?" | geri okuma birebir + kullanıcı "Evet" | `programmaticOk, setOk, addResults, readCount, userSees` |
| **T6 Geri alma** | T3'ün hemen ardından: kullanıcı 1 kez Ctrl+Z; panel T3 öncesi anahtar listesiyle birebir karşılaştırır | otomatik karşılaştırma aynı + kullanıcı "Hayır" demedi | `userAnswer, restored, tracksAfterUndo` |
| **T7 Ripple** | aynı track'te (A2) arka arkaya iki harici sesin ilki taze seçimle `ripple=false, AUDIO` silinir; diğer TÜM kliplerin start'ı karşılaştırılır | hedef gitti, hiçbir klip kaymadı | `targetRemoved, shifted, missing` |
| **T8 Bağlı doğurma (yeni)** | kamera ProjectItem'ı ile `createOverwriteItemAction(pi, aslın start'ı, boş V, boş A)` → V+A birlikte oluştu mu? Sonra 4 ayrı transaction (her biri öncesi taze okuma): `createSetInPointAction` → `createSetOutPointAction` → `createSetStartAction` → `createSetEndAction` ile aslına eşitle; T4 gibi karşılaştır. Kullanıcı yeni videoya tıklar: ses de seçildi mi | birlikte doğdu + tick'ler birebir + kullanıcı "Evet" | `bornTogether, videoBorn, audioBorn, vTrack, aTrack, mismatchFields, linkedAnswer, autoLinked, selectedCount` |

**Karar (`decide`)**: zorunlu = T2, T3, T4, T7. Engel yalnızca `api` sınıfı FAIL'den doğar (T3/T4 zaman farkı T8 çalışıyorsa workaround;
T3 tek-transaction başarısız ama T4+T7 çalışıyorsa "iki adımda taşı" workaround'u). T1/T5/T6/T8 FAIL → workaround.
`kod`/`belirsiz`/eksik varsa öneri "GEÇİCİ". Rapor ÖZET'inde her FAIL `[API]` / `[KOD]` / `[BELİRSİZ]` etiketlidir.

## Kullanılan Premiere API'leri (hepsi `premierepro.d.ts` 26.5.0)

`npm run api:table` ile üretildi (67 benzersiz referans, 0 hata). v0.1.0'a göre **çıkanlar:** `TrackItemSelectionStatic.createEmptySelection`,
`Application.version`. **Eklenenler:** `Sequence.clearSelection`, `SequenceEditor.createOverwriteItemAction`, `TickTimeStatic.createWithTicks`,
her iki track item tipinde `createSetInPointAction / createSetOutPointAction / createSetStartAction / createSetEndAction`.

| d.ts satırı | API | d.ts'teki satır |
|---|---|---|
| L14 | `premierepro` | `export declare type premierepro = {` |
| L434 | `AudioClipTrackItem.createSetEndAction` | `createSetEndAction(tickTime: TickTime): Action;` |
| L441 | `AudioClipTrackItem.createSetInPointAction` | `createSetInPointAction(tickTime: TickTime): Action;` |
| L455 | `AudioClipTrackItem.createSetOutPointAction` | `createSetOutPointAction(tickTime: TickTime): Action;` |
| L462 | `AudioClipTrackItem.createSetStartAction` | `createSetStartAction(tickTime: TickTime): Action;` |
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
| L3112 | `Sequence.clearSelection` | `clearSelection(): Promise<boolean>;` |
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
| L3337 | `SequenceEditor.createOverwriteItemAction` | `createOverwriteItemAction(` |
| L3354 | `SequenceEditor.createCloneTrackItemAction` | `createCloneTrackItemAction(` |
| L3887 | `TickTimeStatic.createWithTicks` | `createWithTicks(ticks: string): TickTime;` |
| L3929 | `TickTimeStatic.TIME_ZERO` | `readonly TIME_ZERO: TickTime;` |
| L3986 | `TickTime.seconds` | `readonly seconds: number;` |
| L3992 | `TickTime.ticks` | `readonly ticks: string;` |
| L4024 | `TrackItemSelection.addItem` | `addItem(` |
| L4034 | `TrackItemSelection.removeItem` | `removeItem(trackItem: VideoClipTrackItem \| AudioClipTrackItem): boolean;` |
| L4039 | `TrackItemSelection.getTrackItems` | `getTrackItems(): Promise<Array<VideoClipTrackItem \| AudioClipTrackItem>>;` |
| L4153 | `VideoClipTrackItem.createSetEndAction` | `createSetEndAction(tickTime: TickTime): Action;` |
| L4160 | `VideoClipTrackItem.createSetInPointAction` | `createSetInPointAction(tickTime: TickTime): Action;` |
| L4174 | `VideoClipTrackItem.createSetOutPointAction` | `createSetOutPointAction(tickTime: TickTime): Action;` |
| L4181 | `VideoClipTrackItem.createSetStartAction` | `createSetStartAction(tickTime: TickTime): Action;` |
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

Premiere dışı (UXP): `navigator.clipboard.setContent / writeText` (`@adobe/cc-ext-uxp-types` 7.3.1), `require("uxp").versions.uxp`,
`require("uxp").host.name/version` (rapordaki Premiere sürümü).

## Doğrulama (bulutta yapılan)

- `npm run typecheck` — strict, 0 hata. `npm run lint` — Adobe premierepro kuralları dahil 0 hata. `npm run check:api` — 67 referans, 0 hata.
- `npm run smoke` — `dev/smoke.cjs`. Mock, 26.5.1'de ölçülen tek kesin davranışı uygular: **işlenen transaction'dan sonra eski
  TrackItem/seçim nesneleri "The script object is no longer valid" verir** (başta öz-sınama ile doğrulanır). `createEmptySelection` çağrılırsa
  mock hata verir.
  - **happy** (kullanıcının gerçek düzeni: V1'de 2 kamera, A1 sesleri, A2'de iki harici ses, A3'te bir harici ses): T1–T8 PASS → "UXP yeterli";
    hiçbir bayat referans kullanılmadı; rapor başlığında "Premiere: 26.5.1"; kilit aşamaları (PROBE_ dışı, test ortasında geçiş,
    kopyanın aktif olması, T1 sırasında çıkış, koşu ortasında başka PROBE_*) geçti.
  - **strict:** happy + `clearSelection`/`setSelection` de referansları geçersiz kılar (en kötü ihtimal) → yine T1–T8 PASS.
  - **grim:** API yok / davranış yok varsayımları (createCloneAction "is not a function", setSelection etkisiz, clone track açmıyor,
    overwrite yalnız video, silme ripple) → FAIL'ler `[API]`, öneri "CEP'e geç".
  - **throw:** olmayan track'e clone/overwrite sınıflanamayan istisna → FAIL'ler `[BELİRSİZ]`, öneri **"GEÇİCİ: UXP + workaround"**
    (istisna tek başına CEP'e götürmüyor).
  - Mock'un diğer davranışları TAHMİNDİR (ör. set In/Out/Start/End'in kırpma anlamı); yalnız panelin akışını ve sınıflamayı test eder.
- `npm run package` — `.ccx` kökte `manifest.json` (version 0.1.1), 644/755, açılıp `dist/` ile birebir aynı olduğu doğrulandı.
- **Bağımsız alt ajan incelemesi:** sürüyor — sonuç ve varsa düzeltmeler bir sonraki commit'te bu satıra yazılacak.

## Önceki tur (v0.1.0) incelemesinden düzeltilenler (özet)

T1'in kullanıcı çıkışını geri zorlaması; "Hepsini çalıştır"ın sequence'ı sabitlememesi; önbellekli ad; kilit kontrolsüz seçim yedek yolu;
paylaşılan canlı seçim; koşular arası kalan sonuçlar; T6'nın track açmayla karışması; `decide()` eksik sayımı — hepsi v0.1.0'da düzeltildi.

## Bilinen belirsizlikler / riskler

1. **d.ts'te "bağlı mı" (link) sorgusu yok.** Bağ, kullanıcının tıklaması + `getSelection`/`getIsSelected` okumasıyla ölçülür (T3, T8).
2. **`createRemoveItemsAction` `mediaType` anlamı belgelenmemiş.** T3 video+ses birlikte silerken VIDEO veriyor (Adobe örneği); ses silinmezse
   rapor "asıl ses gitti mi: HAYIR" der → o zaman ayrı AUDIO silme gerekir.
3. **set In/Out/Start/End action'larının anlamı** (kırpma mı taşıma mı, hangi kenar sabit) belgelenmemiş → T8 her adımdan sonra
   start/end/in/out'u rapora yazar; eşitleme tutmazsa sıra bu satırlara bakılarak değiştirilir.
4. **Overwrite'ın olmayan track index'i ile davranışı** belgelenmemiş (insert için "yeni track açılır" yazıyor). T8 önce mevcut boş track'i seçer.
5. **Clone hedefinde bağlı partner** davranışı: T3 iki clone'u da aynı hedefe yöneltir; partner gelse de gelmese de sonuç 1+1 kopya olmalı —
   `copiesV/copiesA` facts'i bunu doğrular.
6. **T6 Ctrl+Z odağı:** önce timeline'a tıkla / Edit → Undo. Otomatik karşılaştırma yanlış sayıda geri almayı yakalar.
7. **Autosave:** panel kaydetmez; Premiere autosave'i olabilir → deneme projesi önerisi.
8. `settle()` = 400 ms. Snapshot eski durumu görürse (rapor "(yok)" derken timeline'da varsa) artırılmalı.

## Graphify

Ortamda **kurulu değil** (PATH'te `graphify` yok, npm global'de yok, Claude skill/komut listesinde yok) → `/graphify .` **atlandı**.

## Sonraki adım

1. Kullanıcı v0.1.1 raporunu getirir (önce eski sürümü kaldırıp yenisini kurar, V2+/A4+ temizler).
2. Özellikle T3 (tek transaction'da taşı), T6 (tek Ctrl+Z), T8 (bağlı doğurma + set* anlamı) sonuçlarına göre SPREAD'in taşıma yolu seçilir:
   bağ gerekiyorsa overwrite + set*, gerekmiyorsa clone + sil — ikisi de **tek transaction**.
3. Mock'u (`dev/smoke.cjs`) rapordaki gerçek davranışa göre güncelle → SPREAD/RE-STACK mantığı Premiere'siz test edilebilsin.
