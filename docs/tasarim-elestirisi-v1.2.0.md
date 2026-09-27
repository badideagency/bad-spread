> **Not:** bu rapor düzeltmelerden ÖNCEKİ ekranlar üzerinedir. Uygulanan / bilerek uygulanmayan maddeler: `handoff.md` → "Tasarım eleştirisi".

# Critique: Spread v1.2.0 (UXP) + Spread Helper v1.2.0 (CEP), BadIdea dark redesign

- **Reviewer:** Critique skill (5 dimensions) + emil-design-eng review + Hallmark `audit`. Read-only; no files in the repo were edited.
- **Date:** 2026-09-27
- **Material:** `spread/public/index.html`, `cep-helper/index.html`, `spread/src/ui.ts`, `cep-helper/js/panel.js`, `handoff.md` §4, screenshots `docs/ekran/01–23`, and the v1.1.0 screenshots at e0cdaf1 for 02/06/21. The yardstick is BadIdea's `tasarim-sistemi/SKILL.md` and the `globals.css .dark` tokens.
- **Constraints respected (no fix below works against them):** no @font-face (the UI font is left unset), no transitions or animations in UXP, no box-shadow, no flex `gap`, no `:focus-visible`, hex colours only, no Spectrum widgets, `<div>` buttons.
- **Verdict:** The idle state is clean and on-brief: one title, one cream button, warm surfaces, no shadow. Once the panel is working, the hierarchy flips. During a confirm or a progress run the **disabled** step button is the brightest shape on screen, and the button you actually have to press (Devam) is the faintest. That problem, plus a handful of 1–6 px alignment misses, is most of the gap between this and "Apple-grade".

---

## Scores

```
Philosophy      ███████░░░  7
Hierarchy       ██████░░░░  6
Detail          ██████░░░░  6
Functionality   ██████░░░░  6
Innovation      █████░░░░░  5      mean 6.0
```

### 1. Philosophy consistency: 7/10 (Strong)
**Evidence:** There is one clear direction. The warm BadIdea surface ladder is used (`--yuzey-1 #1d1910` page, `--yuzey-2` card, `--yuzey-3` secondary), text is cream (never pure white), there is no shadow, and the dividers are hairlines at 10% cream (index.html:18-32, 64-68). The direction drifts in four places:
- (a) Fading is done with opacity: `.step.future {opacity:.4}` (213-217) and `.btn[disabled] {opacity:.4}` (108-111). BadIdea explicitly bans this: *"opaklıkla soldurma YASAK"* ("fading with opacity is forbidden"); `--metin-sonuk` exists for exactly this job.
- (b) The accent fill stays on a disabled button, which makes it a 40% cream pill.
- (c) The "⚙" is drawn as a sun (circle plus 8 rays, index.html:492). v1.1 used a real gear glyph.
- (d) There are six radius values (2, 4, 6, 8, 10, 12), and the helper uses its own token names (`--ikincil`, `--sonuk`, `--kenar`) for the same values (helper index.html:10-11).
**Keep:** warm ladder plus cream. **Fix:** replace the opacity fades with tokens. **Quick win:** swap the sun for a gear.

### 2. Visual hierarchy: 6/10 (Functional)
**Evidence:** The idle states (01, 02, 05) are excellent: "Spread" at 20/600, the sequence name at 12 in the muted tone, the next step at 600 with a cream ring and the cream button, and future steps faded. But every operation passes through a confirm and a progress state (03, 04, 06, 07, 15, 16):
- There, `.btn.primary[disabled]` renders as a `#777267` fill, 3.66:1 against the page. That is the brightest filled shape on screen.
- Meanwhile `#ask-yes` (Devam) is `--yuzey-3` on a `--yuzey-2` card, a fill contrast of only **1.30:1**.
- Inside the card, the all-caps bold cream DİKKAT line (13/600) competes with the card title (14/600). Caps at 13 px read heavier than mixed case at 14 px (06).

The score reflects the worst state that persists, not the best one. **Fix:** move the accent off the disabled button. **Quick win:** make the card title 16/22.

### 3. Detail execution: 6/10 (Functional)
**Evidence:** Measured on the 2x PNGs:
- Step digits sit **2 px above** the circle centre (circle rows 190–233, "1" rows 200–215; 01). One pixel comes from the geometry: `line-height:18px` inside a 20 px content box, so the line box is top-aligned. The other pixel comes from Open Sans's typo metrics, which a Segoe- or Adobe-Clean-class font would roughly cancel.
- The ✓ marks and the helper dot end **6 px inside** the right edge that the buttons, dividers and "Sorun bildir" share (278 vs 284 css px, in 02 and 14-560).
- `#sync-hint` starts at 30 px while the step names start at 32.
- "Yeniden çalıştır" is centred across the full row (12). `.rerun{align-self:flex-start}` has no effect because `.step` is a block, not a flex container.
- `#report` overflows the right edge by about 6 px (11).
- "← Geri" is inset 8 px from the left edge (11).
- Helper details break words mid-word ("hata ver/medi", "topla/m 12", 23) because of `.row{word-break:break-all}`.
- The helper line cuts off the group count, the one number that matters (21).

**Keep:** 8 px rhythm, `white-space:nowrap` on buttons. **Fix:** the alignment list above.

### 4. Functionality: 6/10 (Functional)
**Evidence:** The core flow works and each state is legible. The edge cases are what hold it back:
- **Hover:** in the confirm card, hovering either button paints it `--yuzey-2` on a `--yuzey-2` card, so both buttons **vanish on hover** (98-101). Everywhere else, hover makes buttons darker, which runs against the ladder's rule that depth comes from lightness.
- **Focus:** the focus ring is `--kenar-guclu`, 1.62:1 (105-107). ↻, the update strip and "Ne yapmalıyım?" are focusable (`tabindex`) but have no focus style at all.
- **Update strip:** after a successful install the strip still says "Yeni sürüm 1.2.1 · Güncelle" right above "✓ 1.2.1 kuruldu" (17). The strip's `latest` is never cleared (spread/index.ts:134, 225).
- **Affordances:** clicking a finished step's name reveals "Yeniden çalıştır", but the name looks like a plain label. The next step's name has `cursor:pointer` but clicking it does nothing.

**Fix:** hover token plus a visible focus ring.

### 5. Innovation: 5/10 (Functional, and appropriately so)
**Evidence:** The warm cream-on-umber ladder sets Spread apart from Adobe's neutral grey panels, and the next step's cream number ring is a nice echo of the cream button. Otherwise this is a standard stepper list. That is the right amount of restraint for a tool panel used many times a day; there is nothing to add.

---

## Ranked fixes (visual and interaction only; all respect the UXP constraints)

### P0: the confirm/progress hierarchy inversion (visible on every operation)

**1. The disabled step button keeps the accent, and Devam is the weakest button on screen** (03, 04, 06, 07, 15, 16).
```css
/* index.html, replaces .btn[disabled] (108-111). No opacity fading (BadIdea rule). */
.btn.primary[disabled],
.btn.secondary[disabled] { opacity: 1; background-color: var(--yuzey-2); color: var(--metin-sonuk); cursor: default; } /* 4.64:1 */
.btn.ghost[disabled]     { opacity: 1; color: var(--metin-sonuk); cursor: default; }
```
Recommended with it: `index.html:475` becomes `<div id="ask-yes" class="btn primary" tabindex="1">Devam</div>`.
- **Why:** BadIdea's rule is *"krem dolgu = BİRİNCİL EYLEM"* ("cream fill = the primary action"). While the confirm card is open, the primary action is Devam, and the step button is disabled. So there is still exactly one live cream fill on screen, and v1.1 also gave Devam the accent.
- **Needs your call:** this bends the handoff §4 line "Onaydaki [Devam] ikincil dolgu" ("Devam in the confirm card uses the secondary fill"). If you reject it, fix #1 alone still removes the inversion.

**2. Buttons vanish on hover inside the card; hover darkens elsewhere.**
```css
:root { --yuzey-3-hover: #544e41; } /* oklch(0.425 0.022 84.6), the next rung of the ladder (computed). krem on it 7.8:1 */
.btn.secondary:hover        { background-color: var(--yuzey-3-hover); }
.btn.ghost:hover            { background-color: var(--yuzey-2); }   /* unchanged on the page */
#ask .btn.ghost:hover       { background-color: var(--yuzey-3); }   /* was y2 on a y2 card = invisible */
```
The helper needs the same change: add the token, then `button:not(.primary):not(:disabled):hover { background: var(--yuzey-3-hover); }`, replacing helper index.html:26. As written today, disabled helper buttons also react to hover.

### P1

**3. Step digits sit high** (you spotted this; confirmed as 2 px at 1x). Centre the digit geometrically and stop depending on line-height. This also works whether UXP sizes boxes as content-box or border-box.
```css
.num { display: flex; align-items: center; justify-content: center; line-height: 12px; } /* drop line-height:18px and text-align:center (188-199) */
```
About 1 px of residual lift remains in the Open Sans screenshot. That comes from the stand-in font's metrics, so check the real Premiere font before adding any `padding-top` nudge.

**4. The helper line truncates "Bağla bekliyor: "Ana Kurgu" · 1…" at 300 px** (you spotted this; confirmed).
- **Cause:** v1.2 added ↻ (24 px) and wider button padding. v1.1 fit on one line (21-v1.1).
- **Fix:** put the count first, so a long sequence name gets ellipsized instead of the count. The Bağla button already supplies the verb. This is a display string change in `cep-helper/js/panel.js:86`:
```js
bindLine = { text: p.groups + " grup bekliyor · “" + p.sequence + "”", cls: "" };
```
"11 grup bekliyor · “Ana Kurgu”" is about 165 px against 181 px available.

**5. The settings icon reads as a sun** (a brightness toggle; index.html:492).
- Replace it with Lucide `settings` (the gear), since Lucide is BadIdea's single icon set. Copy the path from lucide.dev: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="#b8b4ac"`, round caps and joins.
- Match stroke weights across icons: the gear at 14 px needs `stroke-width="2.3"` (≈1.33 px); ↻ at 16 px needs `stroke-width="2"` on the 24 grid (or keep today's 1.3/16).
- Optional: redraw ↻ as Lucide `rotate-cw`. Today's L-shaped arrowhead renders heavier than its arc (01, header).

**6. Future steps: replace opacity with the muted token** (213-217; today they measure 3.66:1 for names and 2.43:1 for digits).
```css
.step.future .step-name { opacity: 1; color: var(--metin-sonuk); cursor: default; }                        /* 5.64:1 */
.step.future .num       { opacity: 1; color: var(--metin-sonuk); border-color: var(--kenar-zayif); }
```

**7. A visible focus ring on every focusable element** (105-107). `:focus-visible` isn't available, so the ring also appears after a mouse click; `--notr` is the quiet colour that still clears 3:1.
```css
.btn:focus, .icon-btn:focus, #update-strip:focus, #result-help:focus { outline: 1px solid var(--notr); } /* 3.35:1 (was 1.62:1) */
```

**8. One right edge** (the ✓ and the dot are 6 px inside the edge everything else uses).
```css
.mark { text-align: right; }        /* 218-224: ✓ / ! end at the content edge like the buttons */
.dot  { margin: 0 0 0 4px; }        /* 157-163: was 0 6px 0 4px */
```

**9. Confirm card hierarchy** (06, 15, 16).
```css
#ask-title          { font-size: 16px; line-height: 22px; margin: 0 0 6px 0; } /* reuses the 16/22 step of #settings-title */
#ask-summary .attn  { font-weight: 500; }   /* caps + cream already carry the emphasis; 600 caps outweighed the title */
#ask-summary .line  { margin: 0 0 6px 0; }  /* was 2px 0 (collapses to 2px): the facts ran together as one paragraph */
```

**10. The update strip still offers "Güncelle" after the install has finished** (17).
- This is an interaction fix, not CSS. After the success `opEnd` in `spread/index.ts` (~225), clear `latest` and call `paintUpdate()`, or show the `.wait` variant with the text "1.2.1 kuruldu · Premiere'i yeniden başlat".
- It is display state only, but it lives outside the view files, so it's your call.

### P2 (polish)

**11. Re-run row and sync hint alignment** (12, 02).
```css
.step       { display: flex; flex-direction: column; }   /* lets .rerun{align-self:flex-start} work */
.rerun      { margin: 2px 0 0 24px; }                     /* 24 + 8px ghost padding = text at 32px, under the step name */
#sync-hint  { margin: -2px 0 6px 32px; }                  /* was 30px */
```

**12. False and missing affordances on step names.**
```css
.step.todo .step-name { cursor: default; }                /* the next step's name does nothing on click */
.step.done .step-name:hover, .step.warn .step-name:hover { color: var(--metin-ikincil); } /* hint that it opens "Yeniden çalıştır" */
```

**13. Settings screen edges** (11).
```css
#btn-back             { margin-left: -8px; }                    /* "← Geri" text on the 16px edge, like the footer's "Ayarlar" */
#report, #issue-text  { width: auto; align-self: stretch; }     /* 100% + border/padding overflowed ~6px */
input, select         { padding: 2px 6px; }                     /* "90" and "2" touched the field edge; check native UXP fields */
```

**14. Helper detail readability** (23).
```css
.row { word-break: normal; overflow-wrap: anywhere; }   /* helper index.html:35, replaces break-all */
```

**15. Radius scale: four steps, as BadIdea allows.** Define `--r-sm: 6px; --r-md: 10px; --r-lg: 12px;` and use them as follows:
- `.icon-btn` 8 → `--r-md`
- `textarea` 8 → `--r-md` (matching `#log`)
- `input`, `select` 8 → `--r-sm`
- helper `textarea` and `#log` 8 → `--r-md`
- helper `.icon` 6 stays `--r-sm`

Dots, the number circles and the progress track stay fully round.

**16. Helper-closed state reads quieter than the healthy state** (13: grey dot, grey text). Add `.dot.off { background-color: var(--surec); }`. `ui.ts` already sets the `off` class, but no CSS rule targets it today.

**17. Helper status text is clickable but looks inert.** Add `#srv:hover { color: var(--ikincil); }`. Optionally, set `#srv`'s `title` to its full text in `panel.js`'s `set()` so a truncated error can still be read.

**18. Typography hygiene.**
- In static markup, use typographic quotes: index.html:519 `"Sil" = Bağla'da … Topla'dan` becomes `“Sil” = Bağla’da … Topla’dan`.
- Add `#progress-text, #ver { font-variant-numeric: tabular-nums; }` so live counters like "(4/7)" don't jitter. It is harmless if UXP ignores it.

**19. Helper token names.** Rename `--ikincil`, `--sonuk` and `--kenar` to `--metin-ikincil`, `--metin-sonuk` and `--kenar-zayif`. This gives the two panels one vocabulary with zero visual change.

**20. Optional: update strip mass.** The full-width cream bar above "Spread" becomes the first thing you read (14, and especially 14-560). If the position is free, put it under the header row. Otherwise, `#update-strip { padding: 5px 12px; font-weight: 500; }` quiets it without losing the accent.

---

## Quick wins (5–15 min each, highest signal first)

1. #1: move the accent off disabled buttons and onto Devam.
2. #3: flex-centre the step digits.
3. #8: two right-edge lines.
4. #4: one string to put the count first in the helper.
5. #5: gear path.

---

## Keep: don't break these

- **Surfaces and colour:** the warm surface ladder (`#1d1910` page / `#2f291f` card / `#413b2f` secondary), cream `#fff7e9` text with no pure white, 10% hairline dividers, and no shadows anywhere.
- **Idle-state hierarchy** (01/02/05): 20/600 title, muted sequence name, exactly one cream button on the next step, a cream ring on the next number, and the green ✓ as status only.
- **Neutral progress bar** (`--metin-ikincil` on `--yuzey-3`, 3 px): no accent spent on progress.
- **Settings group headers** (11/600, caps, `letter-spacing:.4px`, muted): the iOS grouped-list idiom fits a settings screen.
- **Motion code** (emil-clean): explicit transition properties (no `all`), `:active scale(.97)`, focus not transitioned, `white-space:nowrap` on buttons, durations under 300 ms. Keep it written for when UXP supports it; in the CEP helper it already renders.
- **Helper strip:** a single line with ellipsis and a status dot, the same tokens as Spread, and cream appearing only when Bağla is needed.
- **Turkish rendering:** every screenshot draws İ Ş Ğ ı ç ü ö correctly, including caps ("ÇALIŞTIR", "DİKKAT", "KARIŞIK").

---

## emil-design-eng review (required format)

| Before | After | Why |
| --- | --- | --- |
| `.btn { transition: background-color 160ms ease-out, opacity 160ms ease-out, transform 120ms ease-out }` | `.btn { transition: background-color 150ms ease, transform 150ms ease-out }` | A colour change should use `ease`. Opacity no longer animates once disabled buttons stop using it. 150 ms fits both the brief's 150–200 ms and the 100–160 ms press window. |
| `.btn[disabled]` still gets `:active { transform: scale(0.97) }` | `.btn[disabled]:active { transform: none }` | A disabled control must not acknowledge a press. |
| `.icon-btn` (↻) has no `:active` state | `.icon-btn:active { transform: scale(0.95) }` and `.icon-btn { transition: background-color 150ms ease, transform 150ms ease-out }` | Every pressable element needs press feedback, including icon buttons. |
| `.btn.secondary:hover { background-color: var(--yuzey-2) }` | `.btn.secondary:hover { background-color: var(--yuzey-3-hover) /* #544e41 */ }` | Hover went darker, against the rule that depth comes from lightness, and inside `#ask` the button vanished into the card. |
| `.btn.ghost:hover` = `--yuzey-2` inside a `--yuzey-2` card | `#ask .btn.ghost:hover { background-color: var(--yuzey-3) }` | The hover was invisible. |
| `.btn:focus { outline: 1px solid var(--kenar-guclu) }`; none on `.icon-btn`, `#update-strip`, `#result-help` | `.btn:focus, .icon-btn:focus, #update-strip:focus, #result-help:focus { outline: 1px solid var(--notr) }` | The old ring was 1.62:1 (effectively invisible), and three focusable elements had no ring at all. The new one is 3.35:1 and still quiet. |
| `.btn[disabled] { opacity: .4 }`, `.step.future … { opacity: .4 }` | Token colours (`--yuzey-2` / `--metin-sonuk` / `--kenar-zayif`), `opacity: 1` | Opacity fading is unmeasured contrast (2.43–3.66:1) and is banned by BadIdea. It also left the accent sitting on a disabled button. |
| helper `button:hover { background: var(--yuzey-2) }` | `button:not(.primary):not(:disabled):hover { background: var(--yuzey-3-hover) }` | Disabled buttons reacted to hover, and the hover went darker. |
| helper `button { transition: background-color 160ms ease-out, transform 120ms ease-out }` | `button { transition: background-color 150ms ease, transform 150ms ease-out }` | CEP is Chromium, so these transitions do render; this is the one panel where the motion is visible. |
| helper `#srv` (clickable, `cursor:pointer`, no hover) | `#srv:hover { color: var(--ikincil) }` | The only way into the details must look pressable. |

Checklist items that already pass: no `transition: all`, no `scale(0)` entrances, no `ease-in`, no keyframes, every duration under 300 ms, focus rings not transitioned, and keyboard activation is not animated. The `@media (hover:hover)` gate doesn't apply because the host is desktop-only.

---

## Hallmark `audit` (landing-page-only tells skipped: hero, nav, footer, 3-card grid, LCP, eyebrow-on-sections)

No project `design.md`; graded against BadIdea `tasarim-sistemi` as the declared reference (brief).

**Critical**
- *(waived, not counted)* Inter-everywhere — `index.html` font-family unset / Open Sans stand-in. Single UI font is a documented UXP constraint (no @font-face). → no action.

**Major**
- **[major] Mismatched icon sets** (index.html:429, 492; ui.ts:275, 337)
  - Why it's a tell: custom line SVGs (↻ and a sun-shaped "gear") are mixed with font-drawn glyphs (✓ ⚠ ✗ ! ← › →), and the gear itself reads as a brightness icon.
  - Fix: use Lucide `settings` and `rotate-cw` with matched 1.33 px strokes. Leave the text glyphs as they are, since they are the documented fallback.
- **[major] Hover-only / hidden affordances** (ui.ts:277 `title` on the step name; `.step-name` click opens re-run; helper `#srv` click opens details)
  - Why it's a tell: a step's outcome lives only in a tooltip, and two key actions sit behind unmarked labels.
  - Fix: fixes #12 and #17 above.
- **[major] Mid-render token improvisation** (helper index.html:10-11 uses different token names; index.html:403/411 hard-code `Consolas, monospace`; index.html:493/521/552 use inline `style=` margins)
  - Why it's a tell: the two panels speak two token vocabularies.
  - Fix: fix #19, add a `--font-mono` token, and move inline margins into classes. The hard-coded SVG `stroke` hex is a documented UXP exception.
- **[major] Design-system drift: opacity fading and radius count** (index.html:108-111, 213-217; radii 2/4/6/8/10/12)
  - Why it's a tell: BadIdea bans opacity fading and arbitrary radii. This would be critical if BadIdea's system were adopted as this repo's `design.md`.
  - Fix: fixes #1, #6 and #15.

**Minor**
- **[minor] Straight quotes and apostrophes** (index.html:519 `"Sil"`, `Bağla'da`; panel.js:86 `"Ana Kurgu"`; ask copy)
  - Fix: use curly “ ” and ’ in static and display strings.
- **[minor] Numbers without tabular-nums** (`#progress-text`, `#ver`)
  - Fix: fix #18.
- **[minor] Accidental centring** (`.rerun`, index.html:228-232, shown in 12)
  - Fix: fix #11.
- **[minor] Edge misalignment** (`.mark`, `.dot`, `#sync-hint`, `#btn-back`, `#report` overflow)
  - Fix: fixes #8, #11 and #13.
- **[minor] Word-breaking mid-word** (helper index.html:35 `break-all`)
  - Fix: fix #14.
- **[minor] Clipped key datum** (helper line truncates the group count, shown in 21)
  - Fix: fix #4.

Structural fingerprint: not the AI template. It's a tool stepper with left-aligned asymmetric rows. Pass. Also passing: no pure black or white, no card-in-card, no side stripe, no glow on dark, no `transition-all`, no animated focus rings, results that carry information rather than celebration.

**Summary: 0 critical (1 waived) · 4 major · 6 minor**
**Verdict:** close. This does not read as AI-generated. The four majors are about consistency and affordance, not aesthetics; fix them, then the minors.

---

## Measured values used above

| Pair | Contrast |
| --- | --- |
| Muted `#969288` on page / card / secondary (`y1` / `y2` / `y3`) | 5.64 / 4.64 / 3.58 |
| Future step name (cream at 40% on the page) | 3.66 |
| Future step digit (secondary text at 40%) | 2.43 |
| Disabled primary fill `#777267` vs page | 3.66 (brightest non-accent fill on screen) |
| Devam fill (`y3`) vs card (`y2`) | 1.30 |
| Focus ring `--kenar-guclu` vs page | 1.62; with `--notr` 3.35 |
| Status colours on the page | ✓ 7.6, ! 7.6, error 7.6 |

Step digit offset (2x PNG 01): circle rows 190–233 (centre 211.5), glyph rows 200–215 (centre 207.5), so the digit sits 2 css px high.
