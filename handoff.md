# handoff — Spread (ADIM 2: SPREAD v0.2.0) + Spread Probe geçmişi

## Durum (tek bakışta)

| | |
|---|---|
| Sürüm | **Spread v0.2.0** — yeni eklenti: id `com.badideagency.spread`, panel "Spread", paket `release/spread.ccx` |
| Yapılan | **SPREAD** (her klip kendi track'ine, zaman değişmeden) + **DURUM RAPORU** (+ kopyala). RE-STACK **yazılmadı** (bilinçli). |
| Probe | `Spread Probe` v0.1.1 repoda **aynen** duruyor (kök `index.ts`, `src/`, `public/`, `dev/smoke.cjs`); kaynak dosyaları ve `release/spread-probe.ccx` **bayt bayt aynı** (sha256 doğrulandı). |
| Bulutta doğrulanan | `tsc --strict`, Adobe eslint kuralları, d.ts satır kontrolü (iki eklenti, 74 ref), Spread mock'uyla 12 senaryo (kullanıcının gerçek 22 kamera + 12 WAV düzeni, bozuk overwrite dahil), Probe smoke 6 senaryo, `.ccx` yapısı |
| Doğrulanamayan | Gerçek Premiere davranışı — kullanıcının koşusu bekleniyor ([KURULUM_TR.md](KURULUM_TR.md)) |
| Dal | `claude/sweet-bell-do4j75` |

## Yoklamanın kanıtladıkları (Premiere 26.5.1, Probe v0.1.1 gerçek raporu)

- `createCloneTrackItemAction`: hedef track yoksa açıyor (V ve A). Kopya start/end/in/out/speed tick düzeyinde birebir.
  Kopya **TEK öğe**: bağlı partner gelmez, kopyalar birbirine **BAĞLI DEĞİL**.
- `createOverwriteItemAction(projectItem, time, vIdx, aIdx)`: video+sesi **BAĞLI** doğuruyor; set In/Out/Start/End ile aslına tick düzeyinde
  eşitlendi. **Dikkat:** T8'de klip kırpılmamıştı (set action'lar gerçek bir kırpmayı düzeltirken henüz ölçülmedi); overwrite'ın
  **olmayan** track'i açıp açmadığı ölçülmedi (T8 mevcut V3/A5'e yazdı).
- `createRemoveItemsAction(ripple=false)`: başka klibi kaydırmıyor. `mediaType` filtre değil → video+ses tek seçimle tek action'da silinir.
- **TEK transaction = tek Ctrl+Z** ile tamamen geri alınıyor.
- **TrackItem referansları transaction sonrası geçersiz.** Her transaction'dan sonra yeniden oku, klibi (tip, track, start, end, kaynak) ile yeniden bul.
- Seçim: `getSelection + addItem + setSelection` programla doğru ama timeline'da **GÖRÜNMÜYOR**.
- **Link/unlink API'si YOK.** Harici ses kameraya bağlanamaz.

## SPREAD tasarımı (v0.2.0)

**Birimler** (`spread/src/plan.ts`, saf fonksiyon): KAMERA = video + aynı kaynaklı, aynı start/end/in/out'lu ses klip(ler)i (çok kanal
olabilir); SADECE-VİDEO; SES = kamera birimine ait olmayan her ses klibi. Start'a göre sıralı (eşitlikte track, sonra ad).
**Hedef düzen:** video birimleri V1, V2, …; kamera ses kanalları (birim sırasıyla, kanallar ardışık) A1, A2, …; ses birimleri onların altında.
Her track'te ≤1 klip. Tüm klipleri zaten hedefindeyse birim **yerinde kalır** (kullanıcının düzeninde: ilk kamera V1/A1'de kalır).

**Taşıma yöntemleri:** kamera → `createOverwriteItemAction` (proje öğesinden, BAĞLI doğar); ses / sadece-video → `createCloneTrackItemAction`
(kanıtlı, zaman ofseti 0); asıllar → tek seçimle `createRemoveItemsAction(ripple=false)`.

**Transaction'lar (ve seçilen yol + neden):**
1. `Spread: yedek sequence` — `createCloneAction`; `getSequences` ile tam 1 yeni sequence görülmezse Spread **başlamaz**; yedek aktif
   olursa `setActiveSequence(asıl)` + doğrulama. (Undo sayısına katılmaz; kullanıcıya "yedeği geri alma" denmez.)
2. `Spread: track hazırlığı` (**TX-A**, yalnız yeni track gerekiyorsa) — **SEÇİLEN YOL: gereken track'ler önce KANITLI yöntemle
   (clone ofseti) açılır**, overwrite'ın track açmasına güvenilmez. Her yeni track için bir geçici yardımcı kopya, hedef index = o anki
   track sayısı olacak şekilde sırayla (V için ilk video klibi, A için ilk ses klibi), **sequence sonunun 10 sn ötesine park edilerek**.
   Neden: (a) overwrite'ın olmayan track'i açtığı ölçülmedi; (b) tek transaction'da ardışık birden çok track açılması da ölçülmedi —
   bu belirsiz adımı **asıllara dokunmadan önce** ayrı bir transaction'da ölçmek, başarısızlıkta zararı "birkaç yardımcı klip" ile sınırlar
   (park edildikleri için hiçbir asılla zamanda çakışamazlar; tek Ctrl+Z). Sonra `verifyTracks`: track sayıları ≥ gereken, her yeni
   track'te tam 1 yardımcı, yardımcılar park yerinde, **asıllar birebir duruyor**. Tutmazsa DUR.
3. `Spread: dağıt` (**TX-B**, tek transaction) — hemen öncesinde: taşınan asıllar + yardımcılar Adobe seçim kalıbıyla birebir seçilir
   (`clearSelection → getSelection → addItem → setSelection → geri okuma`); uygun değilse DUR. Transaction içinde sıra:
   (1) clone'lar (ses / sadece-video; `plan.ts` bağımlılık sırası: bir kopya, hedef track'inde zamanda çakıştığı henüz kopyalanmamış bir
   asılın üstüne yazılmaz; döngü ya da silinmemiş kamera asılıyla çakışma → plan hatası, Spread başlamaz),
   (2) remove (asıllar + yardımcılar, tek seçim), (3) kamera overwrite'ları (hedefler artık boş).
4. `Spread: kırpma eşitlemesi` (**TX-C**, yalnız gerekirse) — yalnız "kırpılmış asıl, overwrite ile beklenen biçimde kırpılmamış yerleşmiş"
   kamera klipleri (aynı track + kaynak + **aynı start** + in=0 + out=medya süresi + aynı hız) için set In → Out → Start → End.
   **Kırpılmamış kliplere set action hiç çalışmaz.** Başka her fark (ör. kaymış start) eşitleme adayı DEĞİL → DUR.

**Doğrulama** (`spread/src/verify.ts`, saf; her transaction'dan sonra): klip sayısı aynı; her klibin start/end/in/out(+hız) aslıyla tick
düzeyinde aynı; her track'te ≤1 klip; kamera birimlerinde video ve ses(ler) aynı start/end'de; her klip planladığı track'te ve doğru
kaynaktan. Tutmazsa **DUR**: panel farkları (tick) yazar, "Ctrl+Z'ye N kez bas ya da yedek sequence'ı kullan" der, **kendi başına
düzeltmez**. Hata veren transaction'da önce/sonra karşılaştırılıp kısmen uygulanıp uygulanmadığı ölçülür (N doğru söylensin).

**Ön kontroller (plan hatası → hiçbir şey değişmez):** kamera klibinde hız≠1, devre dışı, ayar katmanı, proje öğesi okunamıyor / medya
klibi değil (overwrite bunları koruyamaz); okuma hataları; güvenli clone sırası yok. **Uyarılar:** kamera kaynaklı ama eşleşmeyen ses
(ayrı ses birimi olur, bağı kopar); kırpılmış kameralar (TX-C gerekebilir); kamera klip efektleri taşınmaz (onay metninde).

**Referans kuralı:** Probe'daki kuşak koruması aynen (`spread/src/model.ts`): transaction / soru / clearSelection / setSelection sonrası kuşak
artar; `useRef/useProj/FreshSelection` eski kuşak referansını Premiere'e göndermeden `StaleRefError` verir. TX-A yardımcıları `s1`'den, TX-B
kaynakları seçimden SONRA okunan `so.snap`'ten, TX-C klipleri `sC0`'dan.

**Bitiş:** tüm klipler programla seçilir (görünmeyebilir) + "Şimdi Clip > Synchronize'ı dene. Menü gri ise timeline'a tıkla, Ctrl+A, sağ tık >
Synchronize (Audio)." + geri alma bilgisi.

**DURUM RAPORU** (`spread/src/status.ts`, salt okuma): track başına klipler (start/end/in/out tick + saniye, kaynak, medya süresi); birim
eşleşmesi — her ses birimi için zamanda çakıştığı kameralar (çakışma tick/saniye/%), her kamera için çakışan sesler; makine okunur
`CLIP;…` ve `OVERLAP;…` satırları. Kullanıcı bunu **Synchronize'dan SONRA** getirecek → RE-STACK bu veriyle tasarlanacak.

### Spread dosya haritası

```
spread/index.ts        giriş: SPREAD / Durum raporu / Raporu kopyala, aktif sequence göstergesi, meşgul kilidi
spread/src/ppro.ts     require("premierepro") + d.ts tipleri
spread/src/session.ts  aktif sequence bağlamı + koşu boyunca sabitleme (assertSameSequence)
spread/src/model.ts    snapshot (kuşaklı, medya süresi ile), anahtarlar, relocate
spread/src/edit.ts     transact()+TxOps (Adobe düzenleme kalıbı), selectExactly/selectAll (Adobe seçim kalıbı)
spread/src/plan.ts     SAF: birimler, hedef düzen, ön kontroller, clone bağımlılık sırası
spread/src/verify.ts   SAF: verifySpread (TX-B/TX-C), verifyTracks (TX-A)
spread/src/spread.ts   akış: plan → onay → yedek → TX-A → TX-B → TX-C → seç
spread/src/status.ts   DURUM RAPORU
spread/public/         manifest.json (com.badideagency.spread, 0.2.0), index.html, ikonlar
spread/dev/smoke.cjs   mock Premiere + 12 senaryo
```

### Komutlar

```bash
npm run build:spread     # spread/dist
npm run smoke:spread     # 12 senaryo
npm run package:spread   # release/spread.ccx (+ zip kontrolü)
npm run check            # iki eklenti: typecheck + lint + check:api + Probe smoke + Spread smoke
```

### Spread smoke (`spread/dev/smoke.cjs`) — mock yalnız KANITLANMIŞ davranışı uygular

Kanıtlanmamış olanlarda mock **hata verir**: clone hedefi > track sayısı ("atlamalı" açma), overwrite olmayan track'e, `createEmptySelection`,
bayat referans. Böylece Spread'in bunlara dayanmadığı da sınanır. set In/Out/Start/End'in anlamı mock'ta TAHMİNDİR.

| Senaryo | Ne gösterir |
|---|---|
| `real` | **Kullanıcının gerçek düzeni**: V1'de 22 kamera (A038C0xx_260912*.MP4 / C01xx.MP4 dönüşümlü, A1'de bağlı sesleri), A2/A3'te 12 WAV (260912_HHMMSS_Tr1/Tr2/TrLR). Onay "22 kamera, 12 ses bulundu, 50 track açılacak (V 19, A 31)"; son düzen V1..V22 / A1..A22 kamera, A23..A34 WAV; zamanlar tick düzeyinde aynı; kameralar bağlı; 3 transaction (yedek, track hazırlığı, dağıt), set action yok; yedek aslıyla aynı; başka sequence'a dokunulmadı; Ctrl+Z ×2 → asıl düzen birebir. **Not:** Probe raporunun tam tick değerleri bu oturumda yok — adlar, sayılar, düzen gerçek; süreler 25 fps kare-hizalı üretildi. |
| `trim` | 2 kırpılmış kamera → TX-C yalnız o 4 klibe set action → aslına eşit |
| `broken` | **bozuk overwrite** (video 1 kare kayık) → doğrulama yakalar, fark tick olarak yazılır, TX-C **çalışmaz** (kendi başına düzeltme yok), "Ctrl+Z ×2 ya da yedek" |
| `nonseq` | tek transaction'da ardışık track açma çalışmazsa → TX-A'da DUR, asıla hiç dokunulmadı |
| `nobackup` | yedek oluşmazsa → Spread başlamaz, timeline'a dokunulmaz |
| `backupactive` | yedek aktif olursa → asıla dönülür, Spread asılda tamamlanır, yedeğe dokunulmaz |
| `cancel` | onayda "Hayır" → hiçbir şey (yedek de) oluşmaz |
| `switch` | işlem ortasında başka sequence'a geçiş → DUR, diğer sequence'a dokunulmaz |
| `multichannel` | 2 kanallı kamera → kanallar ardışık A track'lerine, bağlı |
| `already` | dağıtılmış sequence'ta ikinci SPREAD → "Zaten dağıtılmış", işlem yok |
| `status` | Synchronize taklidinden sonra durum raporu: çakışma tick değeri doğru, CLIP satırları tam, panoya kopyalanıyor |
| `plan` | saf plan testleri: döngü → hata; hız≠1 kamera → hata; eşleşmeyen kamera sesi → uyarı; WAV hedefinde silinmemiş kamera sesi → hata; dağıtılmış düzen → iş yok |

### Kullanılan Premiere API'leri (iki eklenti; `premierepro.d.ts` 26.5.0; `npm run api:table`)

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
| L532 | `AudioClipTrackItem.isAdjustmentLayer` | `isAdjustmentLayer(): Promise<boolean>;` |
| L537 | `AudioClipTrackItem.isDisabled` | `isDisabled(): Promise<boolean>;` |
| L672 | `AudioTrack.getTrackItems` | `getTrackItems(` |
| L788 | `ClipProjectItemStatic.cast` | `cast(projectItem: ProjectItem): ClipProjectItem;` |
| L1029 | `ClipProjectItem.getMedia` | `getMedia(): Promise<Media>;` |
| L1308 | `CompoundAction.addAction` | `addAction(action: Action): boolean;` |
| L1314 | `CompoundAction.empty` | `readonly empty: boolean;` |
| L1834 | `Guid.toString` | `toString(): string;` |
| L2087 | `Media.getDuration` | `getDuration(): TickTime;` |
| L2414 | `ProjectStatic.getActiveProject` | `getActiveProject(): Promise<Project>;` |
| L2493 | `Project.getActiveSequence` | `getActiveSequence(): Promise<Sequence>;` |
| L2520 | `Project.getSequences` | `getSequences(): Promise<Sequence[]>;` |
| L2590 | `Project.setActiveSequence` | `setActiveSequence(sequence: Sequence): Promise<boolean>;` |
| L2598 | `Project.executeTransaction` | `executeTransaction(` |
| L2608 | `Project.lockedAccess` | `lockedAccess(callback: () => void): void;` |
| L2788 | `ProjectItemStatic.TYPE_CLIP` | `readonly TYPE_CLIP: number;` |
| L2843 | `ProjectItem.getId` | `getId(): string;` |
| L2854 | `ProjectItem.name` | `readonly name: string;` |
| L2860 | `ProjectItem.type` | `readonly type: number;` |
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
| L4251 | `VideoClipTrackItem.isAdjustmentLayer` | `isAdjustmentLayer(): Promise<boolean>;` |
| L4256 | `VideoClipTrackItem.isDisabled` | `isDisabled(): Promise<boolean>;` |
| L4392 | `VideoTrack.getTrackItems` | `getTrackItems(` |
| L4692 | `Constants.MediaType` | `export enum MediaType {` |
| L4804 | `Constants.TrackItemType` | `export enum TrackItemType {` |

### Bilinen belirsizlikler (kullanıcının ilk gerçek koşusunda bakılacaklar)

1. **Tek transaction'da ardışık track açma** (TX-A, V 19 + A 31 yardımcı): ölçülmedi. Çalışmazsa TX-A doğrulaması DURDURUR; asıllar
   güvende (yalnız park edilmiş yardımcılar eklenmiş olur → tek Ctrl+Z). O zaman: track'leri tek tek açan yol (çok adım) ya da
   kullanıcının elle eklemesi (Sequence > Add Tracks) düşünülür.
2. **Overwrite'ın projectItem kaynak işaretlerini (source in/out) kullanması:** proje öğesinde in/out işaretliyse overwrite yalnız o bölümü
   koyabilir → doğrulama (yanlış uzunluk) DURDURUR. O durumda kullanıcı işaretleri temizler.
3. **set In/Out/Start/End'in gerçek kırpmadaki anlamı** ölçülmedi (TX-C). Kullanıcının kameraları büyük ihtimalle kırpılmamış (in=0,
   tam uzunluk) → TX-C hiç çalışmaz. Çalışır ve tutmazsa DUR; rapordaki farklar bir sonraki sürümde sırayı belirler.
4. **Kamera klip efektleri** overwrite'la taşınmaz (onay metninde yazıyor); ham klipler varsayıldı.
5. **Seçim görünmüyor** (kanıtlı) → talimat Ctrl+A ile.

### Graphify

Ortamda **kurulu değil** (PATH'te `graphify` yok, npm global'de yok, Claude skill/komut listesinde yok) → `/graphify .` **atlandı**.

### Sonraki adım

1. Kullanıcı gerçek projenin **Save As** kopyasında, orijinal sequence'ta SPREAD'i dener; sonucu (başarı ya da DURDU satırları) getirir.
2. Synchronize sonrası **Durum raporu**nu getirir → RE-STACK (interval packing: video V1'den, ses A1'den, zamana dokunmadan) tasarlanır.

---

## Geçmiş: Spread Probe (ADIM 1 / 1b, v0.1.1)

### ⚠ ADIM 1b bulgusu (Premiere 26.5.1, v0.1.0 gerçek raporu)

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

### Durum (tek bakışta)

| | |
|---|---|
| Sürüm | **0.1.1** (manifest `version` 0.1.1 → Creative Cloud güncelleme olarak görür; panel başlığında "v0.1.1") |
| Yapılan | 8 test (T1–T8), "Hepsini çalıştır", rapor + sınıflı karar önerisi, "Raporu kopyala". **SPREAD / RE-STACK YAZILMADI.** |
| Paket | `release/spread-probe.ccx` (kökte `manifest.json`, dosyalar 644, klasörler 755; açılıp `dist/` ile birebir karşılaştırıldı) |
| Bulutta doğrulanan | `tsc --strict`, Adobe `@adobe/eslint-plugin-premierepro` kuralları, d.ts satır kontrolü (67 ref), mock Premiere ile 6 senaryo (happy/strict/grim/throw/linked/filter) + kilit aşamaları, `.ccx` yapısı, bağımsız alt ajan incelemesi |
| Doğrulanamayan | Gerçek Premiere davranışı — kullanıcının v0.1.1 raporu bekleniyor ([KURULUM_TR.md](KURULUM_TR.md)) |
| Dal | `claude/sweet-bell-do4j75` |

### Dosya haritası

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
dev/smoke.cjs          sahte premierepro ile dist/'i Node'da uçtan uca çalıştırır (happy/strict/grim/throw/linked/filter)
release/               spread-probe.ccx
```

### Komutlar

```bash
npm ci
npm run check        # typecheck + lint + check:api + smoke (6 senaryo)
npm run package      # build → release/spread-probe.ccx → verify-ccx.py
npm run api:table    # kullanılan her API'nin d.ts satırı + kullanıldığı yerler
```

### Mimari kararlar

- **Tek API kaynağı:** `node_modules/@adobe/premierepro/src/premierepro.d.ts` (26.5.0). Her çağrının yanında `// d.ts:L<satır> Tip.üye`;
  `scripts/check-api-refs.mjs` satırın o üyeyi içerdiğini ve o tipin gövdesinde olduğunu kontrol eder. `tsc --strict`, `any` yok.
- **Referans kuşağı (v0.1.1, `timeline.ts`):** her `snapshot()` bir kuşak numarası taşır. `transact()` işlendikten sonra (hata verse bile,
  `finally`) ve her kullanıcı sorusundan sonra (`askUser`) kuşak artar; temkin için `clearSelection`/`setSelection` sonrası da.
  Premiere'e giden her referans `useRef`/`useProj`/`FreshSelection.gen` kontrolünden geçer; eski kuşaktan bir referans Premiere'e hiç
  gitmeden `StaleRefError` ("BAYAT REFERANS") verir. Testler arası tek köprü (`lastT3`) yalnızca **değer** (anahtar listeleri) taşır.
- **Adobe düzenleme kalıbı:** `project.lockedAccess(() => project.executeTransaction(compound => {...}, "PROBE …"))`.
  Action'lar lexically executeTransaction callback'i içinde üretilir (`TxOps`); Adobe lint kuralı `require-action-lock-scope` 0 hata.
- **Adobe seçim kalıbı (`selectExactly`):** `clearSelection` → sequence'ı baştan oku, klipleri `relocate` ile bul → `getSelection` →
  `addItem(taze, false)` → `setSelection` → **geri oku**: `getSelection()` öğeleri (track, start, end, kaynak adı) ile
  `getIsSelected` veren klipler birebir aynı olmalı, istenen her klip seçili olmalı, seçili her klip "istenen ∪ izinli" içinde olmalı
  (izinli = Linked Selection'ın ekleyebileceği, silinmesinde sakınca olmayan klipler; ör. T2'de insert'in kendi partneri).
  Uygun değilse silme **yapılmaz** (yanlış klip silinmesin) ve bu **ölçüm sayılmaz** (FAIL [BELİRSİZ]). Silmeye verilen seçim `setSelection`'dan sonra `getSelection()` ile alınır
  (Adobe `removeSelectedTrackItems` gibi); ardından gelen transaction referanslarını dönen taze `snap`'ten alır.
- **Silme `mediaType`:** yalnız video → VIDEO, yalnız ses → AUDIO, video+ses birlikte (T3, T2 yedek) → VIDEO (Adobe örneğindeki gibi).
  Anlamı (filtre mi hizalama mı) belgelenmemiş → **T7 ölçer**: ses klibini önce VIDEO ile siler; silinmezse filtre demektir, AUDIO ile
  siler (`mediaTypeFilters`). T3'te video gidip ses kalırsa FAIL [KOD] ("V için VIDEO, A için AUDIO ayrı remove gerekir").
- **PROBE_ kilidi (değişmedi):** her test `requireProbe(pin)`; her transaction/seçim öncesi `assertStillProbe()` (tutulan + taze aktif
  sequence adı PROBE_, guid aynı); "Hepsini çalıştır" başladığı sequence'a sabitlenir; T1 yalnız "yeni kopya aktif olduysa" aslına döner,
  kullanıcı başka sequence'a geçtiyse durur.
- **Kurulum tespiti (v0.1.1, kullanıcının gerçek düzeni geçerli):** kamera video = V1'deki ilk klip; kamera sesi = aynı kaynak + aynı
  start/end'li ses klibi (en alttaki); harici ses = kaynağı hiçbir video klibinin kaynağı olmayan ses klibi, **TÜM ses track'lerinde**
  (ör. `260912_133224_Tr1.WAV` A2'de); T7 çifti = aynı track'te arka arkaya iki harici ses (önce A2).
- **FAIL sınıfları (`classifyError`, `Rec.fail`):** yakalanan istisna **asla** `api` değildir (`classifyError` yalnız `kod`/`belirsiz` döndürür;
  "is not a function" bile `belirsiz`). `api` yalnızca test içinde, taze referans + Adobe kalıbıyla yapılmış bir çağrının **ölçülen**
  sonucuna (ya da kullanıcı gözlemine) verilir. Güvenlik iptalleri (seçim uygun değil → silme yapılmadı) `belirsiz`tir.
  **Yalnız `api` sınıfı engel (CEP gerekçesi) olabilir**; `kod`/`belirsiz` kararı "GEÇİCİ" yapar.

### Testler — v0.1.1

"Hepsini çalıştır" sırası: **T1, T2, T4, T3, T6, T8, T5, T7**. Her test başında sequence'ı baştan okur; önceki testten referans devralmaz.

| Test | Adımlar | PASS ölçütü | facts |
|---|---|---|---|
| **T1 Yedek** | `createCloneAction` → `getSequences` ile yeni sequence aranır; kopya aktif olduysa aslına dönülür | tam 1 yeni sequence | `cloneCreated, cloneName, activeChanged, cloneBecameActive, returnedToOriginal` |
| **T2 Track açma** | kamera videosu ve harici ses, hedef = track sayısı olacak ofsetle clone; açılmazsa yedek: insert → eklenenlerin HEPSİ tek seçimle (partner izinli) sil → kalan varsa kendi türüyle 2. geçiş | V ve A için yeni/boş track elde edildi | `openedV, openedA, fallbackRan, fallbackV, fallbackA, measured` |
| **T3 Taşı (tek transaction)** | TEK `executeTransaction`: kamera videosu → ilk boş V (+kV), kamera sesi → ilk boş A (+kA) clone (ikisi de aynı hedefe; bağlı partner gelirse üst üste yazılır → tek kopya), iki aslı tek seçimle `createRemoveItemsAction(ripple=false)` sil. Sonra: kullanıcı kopya videoya tıklar, panel `getSelection` ile kaç öğe seçili okur | asıllar gitti, 1+1 kopya, tick'ler birebir, başka klip değişmedi | `origVGone, origAGone, copiesV, copiesA, mismatchFields, collateral, linkedAnswer, selectedCount, autoLinked` |
| **T4 Sadakat** | kamera (+bağlı ses) ve harici ses ilk boş track'lere clone; start/end/in/out (tick), speed, disabled, name — tolerans 0 | tüm alanlar eşit | `pairs, mismatchFields` |
| **T5 Seçim** | 3 klip (kamera V, kamera A, 1. harici) Adobe kalıbıyla seçilir; "timeline'da seçili görünüyor mu?" | geri okuma birebir + kullanıcı "Evet" | `programmaticOk, setOk, addResults, readCount, userSees` |
| **T6 Geri alma** | T3'ün hemen ardından: kullanıcı 1 kez Ctrl+Z; panel T3 öncesi anahtar listesiyle birebir karşılaştırır | otomatik karşılaştırma aynı + kullanıcı "Hayır" demedi | `userAnswer, restored, tracksAfterUndo` |
| **T7 Ripple** | aynı track'te (A2) arka arkaya iki harici sesin ilki taze seçimle `ripple=false` silinir: önce `mediaType=VIDEO` (anlam ölçümü), silinmezse `AUDIO`; diğer TÜM kliplerin start'ı karşılaştırılır | hedef gitti, hiçbir klip kaymadı | `targetRemoved, shifted, missing, mediaTypeFilters` |
| **T8 Bağlı doğurma (yeni)** | kamera ProjectItem'ı ile `createOverwriteItemAction(pi, aslın start'ı, boş V, boş A)` → V+A birlikte oluştu mu? Sonra her adım ayrı transaction (öncesi taze okuma; yeni klip = T8 öncesinde olmayan tek klip): sıra 1 `SetIn → SetOut → SetStart → SetEnd`, tutmazsa sıra 2 `SetStart → SetEnd → SetIn → SetOut`; T4 gibi karşılaştır; eski kliplere dokunuldu mu kontrol. Kullanıcı yeni videoya tıklar: ses de seçildi mi | birlikte doğdu + tick'ler birebir + kullanıcı "Evet" | `bornTogether, videoBorn, audioBorn, vTrack, aTrack, orderUsed, mismatchFields, touchedOld, linkedAnswer, autoLinked, selectedCount` |

**Karar (`decide`)**: zorunlu = T2, T3, T4, T7. Engel yalnızca `api` sınıfı FAIL'den doğar. T3/T4'te yalnız zaman alanı farkı: T8 geçtiyse
workaround, geçmediyse belirsiz (asla engel değil). T3 tek-transaction başarısız ama T4+T7 çalışıyorsa "iki adımda taşı" workaround'u.
T3 hedef track yokken başka klip değiştiyse belirsiz (T2'nin bulgusu iki kez sayılmaz). T8'de set* iki sırada da tutmazsa belirsiz.
T1/T5/T6/T8 FAIL → workaround.
`kod`/`belirsiz`/eksik varsa öneri "GEÇİCİ". Rapor ÖZET'inde her FAIL `[API]` / `[KOD]` / `[BELİRSİZ]` etiketlidir.

### Kullanılan Premiere API'leri (hepsi `premierepro.d.ts` 26.5.0)

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

### Doğrulama (bulutta yapılan)

- `npm run typecheck` — strict, 0 hata. `npm run lint` — Adobe premierepro kuralları dahil 0 hata. `npm run check:api` — 67 referans, 0 hata.
- `npm run smoke` — `dev/smoke.cjs`. Mock, 26.5.1'de ölçülen tek kesin davranışı uygular: **işlenen transaction'dan sonra eski
  TrackItem/seçim nesneleri "The script object is no longer valid" verir** (başta öz-sınama ile doğrulanır). `createEmptySelection` çağrılırsa
  mock hata verir.
  - **happy** (kullanıcının gerçek düzeni: V1'de 2 kamera, A1 sesleri, A2'de iki harici ses, A3'te bir harici ses): T1–T8 PASS → "UXP yeterli";
    hiçbir bayat referans kullanılmadı; rapor başlığında "Premiere: 26.5.1"; kilit aşamaları (PROBE_ dışı, test ortasında geçiş,
    kopyanın aktif olması, T1 sırasında çıkış, koşu ortasında başka PROBE_*) geçti.
  - **strict:** happy + `clearSelection`/`setSelection` de referansları geçersiz kılar (en kötü ihtimal) → yine T1–T8 PASS.
  - **grim:** createCloneAction "is not a function" (→ T1 `[BELİRSİZ]`, engel DEĞİL), clone track açmıyor (üst track'e yapışır →
    T2 yedek yolla PASS, T3 `[BELİRSİZ]`), overwrite yalnız video (T8 `[API]`), silme ripple yapıyor (T7 `[API]` → **tek engel**),
    kullanıcı her şeye "Hayır" → öneri "CEP'e geç" yalnız ÖLÇÜLEN T7 davranışından.
  - **throw:** olmayan track'e clone/overwrite sınıflanamayan istisna → FAIL'ler `[BELİRSİZ]`, öneri **"GEÇİCİ: UXP + workaround"**
    (istisna tek başına CEP'e götürmüyor).
  - **linked:** Linked Selection seçimi ve silmeyi bağlı partnere genişletir + clone olmayan track'e istisna → T2 yedek yolu eklenenleri
    tek seçimle siliyor, PASS; CEP yok.
  - **filter:** `mediaType` filtre (VIDEO yalnız videoyu siler) → T3 `[KOD]` ("V/A ayrı remove"), T7 filtreyi ölçüyor, CEP yok.
  - Mock'un diğer davranışları TAHMİNDİR (ör. set In/Out/Start/End'in kırpma anlamı); yalnız panelin akışını ve sınıflamayı test eder.
- `npm run package` — `.ccx` kökte `manifest.json` (version 0.1.1), 644/755, açılıp `dist/` ile birebir aynı olduğu doğrulandı.
- **Bağımsız alt ajan incelemesi (v0.1.1, salt okuma; tüm dosyalar baştan sona okundu, 67 referans kendi betiğiyle doğrulandı,
  kendi mock modlarıyla ("linked", "linkdel") hatalar yeniden üretildi):**
  1. Hiçbir TrackItem referansı transaction sınırını aşmıyor — **HOLDS** (her T1–T8 ve T2 yedek yolu adım adım izlendi; `invalidateRefs`
     hata durumunda da çalışıyor; `lastT3` yalnız değer tutuyor).
  2. Seçim kalıbı Adobe örneğiyle aynı — **HOLDS WITH CAVEATS** (`createEmptySelection` yok; clearSelection + geri okuma güvenli ama
     bağlı partnerlere karşı fazla katıydı) → düzeltildi.
  3. PROBE_ kilidi aynen duruyor — **HOLDS**.  4. Her API d.ts'te var — **HOLDS** (67/67, `Application.version` yalnız yorumda).
  - **Sınıflama — kısmen bozuk** bulundu ve düzeltildi: (a) "is not a function / not supported" istisnası `api` sayılıp tek başına CEP
    üretebiliyordu → `classifyError` artık asla `api` döndürmüyor; (b) güvenlik iptalleri (API hiç çağrılmadan) `api` sayılıyordu →
    `belirsiz`; (c) T5'te "Atla" + uygun olmayan seçim `api` idi → `belirsiz`.
  - Diğer bulgular → düzeltmeler: (1) T2 yedek yolunda Linked Selection partneri tür-tür seçimi bozup yanlış CEP veriyordu → eklenenler
    tek seçimle (partner izinli) siliniyor; (2) video silinince bağlı ses de giderse ses geçişi istisna atıyordu → kalanlar her geçişte
    yeniden hesaplanıyor; (3) T8 aynı track'teki eski kamera klibini kırpabiliyordu → yeni klip "T8 öncesinde olmayan tek klip";
    (4) T8'in sabit set* sırası yanlış engel doğurabiliyordu → iki sıra deneniyor, tutmazsa `belirsiz`, T3/T4 zaman farkı asla engel değil;
    (5) T3 tek VIDEO silme mediaType filtre ise sesi bırakır → T7 mediaType anlamını ölçüyor, T3'te bu durum `[KOD]`;
    (6) hedef track yokken T3 çakışması T2 bulgusunu iki kez sayıyordu → `belirsiz`. Ayrıca geri okumada `getSelection` öğeleri artık
    kimlikleriyle (track, start, end, kaynak) karşılaştırılıyor.
  - Bu düzeltmeler yeni mock modlarıyla (linked, filter, yeniden tanımlanan grim) doğrulandı; ikinci bir alt ajan turu yapılmadı.

### Önceki tur (v0.1.0) incelemesinden düzeltilenler (özet)

T1'in kullanıcı çıkışını geri zorlaması; "Hepsini çalıştır"ın sequence'ı sabitlememesi; önbellekli ad; kilit kontrolsüz seçim yedek yolu;
paylaşılan canlı seçim; koşular arası kalan sonuçlar; T6'nın track açmayla karışması; `decide()` eksik sayımı — hepsi v0.1.0'da düzeltildi.

### Bilinen belirsizlikler / riskler

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

### Graphify

Ortamda **kurulu değil** (PATH'te `graphify` yok, npm global'de yok, Claude skill/komut listesinde yok) → `/graphify .` **atlandı**.

### Sonraki adım

1. Kullanıcı v0.1.1 raporunu getirir (önce eski sürümü kaldırıp yenisini kurar, V2+/A4+ temizler).
2. Özellikle T3 (tek transaction'da taşı), T6 (tek Ctrl+Z), T8 (bağlı doğurma + set* anlamı) sonuçlarına göre SPREAD'in taşıma yolu seçilir:
   bağ gerekiyorsa overwrite + set*, gerekmiyorsa clone + sil — ikisi de **tek transaction**.
3. Mock'u (`dev/smoke.cjs`) rapordaki gerçek davranışa göre güncelle → SPREAD/RE-STACK mantığı Premiere'siz test edilebilsin.
