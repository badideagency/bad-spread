# Spread — Claude için proje notları

Ayrıntılı devir notu, kararlar ve kaynaklar: `handoff.md`. Bu dosya yalnız her oturumda geçerli kısa kurallar.

## Tasarım skill'leri (`.claude/skills/`, v1.2.0)

BadIdea panel projesindeki setin birebir kopyaları + Hallmark. Kaynak ve sürümler `handoff.md` → "Tasarım skill'leri".

| Skill | Ne için | Ne zaman |
|---|---|---|
| `critique` | 5 boyutlu tasarım eleştirisi (puan + Koru / Düzelt / Hızlı kazanım) | YALNIZ görsel / arayüz işi bittikten sonra, denetim olarak |
| `emil-design-eng` | Cila: boşluk ritmi, animasyon kararı, bileşen ayrıntısı | YALNIZ yeni ekran / bileşen yaparken |
| `ui-ux-pro-max` | UX kuralları / desen veritabanı | YALNIZ bilinmeyen bir desen gerektiğinde, SORGU olarak |
| `hallmark` | YALNIZ `hallmark audit <hedef>` (sıralı sorun listesi, düzenleme yok) | Görsel iş bittikten sonra, denetim olarak |

- **Körlemesine çalıştırılmaz.** Mantık, hata düzeltme, test, kurulum, belge işlerinde hiçbiri çalışmaz.
- `ui-ux-pro-max` yalnız sorgu: `python3 -B .claude/skills/ui-ux-pro-max/scripts/search.py "<soru>" [--domain ux|style|color|…]`.
  **`--persist` ve `--force` ASLA** (çalışma ağacına rakip bir "tasarım sistemi" dosyası yazar).
- Hallmark'ın `redesign` / `study` fiilleri ve varsayılan "yeni tasarım" akışı KULLANILMAZ (landing page odaklı).
- Skill'ler karar vermez, malzeme verir. Çelişkide sıra: kullanıcının isteği → `handoff.md`'deki tasarım kararları ve UXP
  sınırları (ör. UXP'de CSS geçişi, @font-face, gölge yok) → skill önerileri.
- Kurulmayanlar (kullanıcının kararı): taste-skill, Anti-Slop Frontend Skill.
