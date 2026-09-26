// DURUM RAPORU — aktif sequence'ın tam dökümü (salt okuma). Kullanıcı bunu Synchronize'dan SONRA getirecek; Re-stack bu veriyle tasarlanacak.
//   - track başına klipler: start/end/in/out (tick + saniye), kaynak adı
//   - birim eşleşmesi: hangi ses hangi kamerayla zamanda çakışıyor, çakışma süresi
//   - makine okunur blok (CLIP / OVERLAP satırları)

import { classify, devicesOf, sourcesOf, roleLabel } from "./classify";
import { bindState, layoutState, parkedFromRecord } from "./collect";
import { analyze, describeLinks, sessionGroups } from "./sessions";
import { getThreshold, loadRecord, mappingFor, recordDrift } from "./settings";
import { readPanelLinkResult } from "./linker";
import { big, secOf, snapshot, trackLabel, type ClipInfo } from "./model";
import { makePlan, type Unit } from "./plan";
import { requireActive } from "./session";

const PANEL = "Spread v0.3.3";

function overlapTicks(a: ClipInfo, b: ClipInfo): bigint {
  const s = big(a.start) > big(b.start) ? big(a.start) : big(b.start);
  const e = big(a.end) < big(b.end) ? big(a.end) : big(b.end);
  return e > s ? e - s : 0n;
}

export async function buildStatusReport(): Promise<string> {
  const ctx = await requireActive();
  const s = await snapshot(ctx, { media: true });
  const plan = makePlan(s, null);
  const cls = classify(s);
  const roleOf = new Map(cls.map((x) => [x.clip, roleLabel(x)]));
  const L: string[] = [];
  L.push("================================================");
  L.push(`SPREAD DURUM RAPORU — ${PANEL}`);
  L.push("================================================");
  L.push(`Tarih: ${new Date().toISOString()}`);
  L.push(`Sequence: "${ctx.name}" — V track: ${s.vCount}, A track: ${s.aCount}, klip: ${s.clips.length}`);
  for (const w of s.warnings) L.push(`uyarı: ${w}`);

  const row = (c: ClipInfo) =>
    `  "${c.name}"  start=${c.start} (${secOf(c.start)}s)  end=${c.end} (${secOf(c.end)}s)  in=${c.inPt} (${secOf(c.inPt)}s)  out=${c.outPt} (${secOf(c.outPt)}s)` +
    `  kaynak="${c.projName}"${c.mediaDur ? ` medya=${secOf(c.mediaDur)}s` : ""}${c.speed !== 1 ? ` hız=${c.speed}` : ""}${c.disabled ? " DEVRE-DIŞI" : ""}` +
    `  [${roleOf.get(c) ?? "?"}]`;

  L.push("");
  L.push("TRACK DÖKÜMÜ");
  for (const kind of ["V", "A"] as const) {
    const count = kind === "V" ? s.vCount : s.aCount;
    for (let t = 0; t < count; t++) {
      const list = s.clips.filter((c) => c.kind === kind && c.track === t).sort((a, b) => (big(a.start) < big(b.start) ? -1 : 1));
      L.push(`${trackLabel(kind, t)}: ${list.length ? `${list.length} klip` : "(boş)"}`);
      for (const c of list) L.push(row(c));
    }
  }

  const cams: Unit[] = plan.units.filter((u) => u.video);
  const auds: Unit[] = plan.units.filter((u) => u.kind === "audio");
  L.push("");
  L.push(`BİRİMLER: ${plan.counts.camera} kamera (${plan.counts.cameraChannels} ses kanalı), ${plan.counts.videoOnly} sadece-video, ${plan.counts.audio} ses`);
  for (const w of plan.warnings) L.push(`  uyarı: ${w}`);

  L.push("");
  L.push("EŞLEŞME — her ses birimi için zamanda çakıştığı kameralar (en uzun çakışma önce)");
  const overlapRows: string[] = [];
  for (const a of auds) {
    const ac = a.audio[0];
    const hits = cams
      .map((c) => ({ c, o: overlapTicks(ac, c.video!) }))
      .filter((h) => h.o > 0n)
      .sort((x, y) => (y.o > x.o ? 1 : y.o < x.o ? -1 : 0));
    const dur = big(ac.end) - big(ac.start);
    L.push(`${trackLabel("A", ac.track)} "${ac.name}" [${secOf(ac.start)}s–${secOf(ac.end)}s] → ${hits.length ? `${hits.length} kamera` : "ÇAKIŞAN KAMERA YOK"}`);
    for (const h of hits) {
      const v = h.c.video!;
      const pct = dur > 0n ? ((Number(h.o) / Number(dur)) * 100).toFixed(1) : "?";
      L.push(`    ${trackLabel("V", v.track)} "${v.name}" çakışma=${h.o} tick (${secOf(h.o)}s, sesin %${pct}'i)`);
      overlapRows.push(`OVERLAP;${ac.name};${trackLabel("A", ac.track)};${v.name};${trackLabel("V", v.track)};${h.o};${secOf(h.o)}`);
    }
  }
  L.push("");
  L.push("EŞLEŞME — her kamera için zamanda çakıştığı sesler");
  for (const c of cams) {
    const v = c.video!;
    const hits = auds.map((a) => ({ a, o: overlapTicks(a.audio[0], v) })).filter((h) => h.o > 0n);
    L.push(`${trackLabel("V", v.track)} "${v.name}" [${secOf(v.start)}s–${secOf(v.end)}s] (${c.kind === "camera" ? `kamera, sesi ${c.audio.map((x) => trackLabel("A", x.track)).join("+")}` : "sadece-video"}) → ${hits.length ? hits.map((h) => `"${h.a.audio[0].name}" ${secOf(h.o)}s`).join(", ") : "çakışan ses yok"}`);
  }

  L.push("");
  L.push("SINIFLAMA (TOPLA / BAĞLA)");
  for (const d of devicesOf(cls)) L.push(`  kamera cihazı ${d.key}: ${d.clips.length} klip, toplam ${secOf(d.total)} sn (ör. "${d.sample}")`);
  for (const src of sourcesOf(cls)) L.push(`  harici kaynak ${src}: ${cls.filter((x) => x.role === "external" && x.source === src).length} klip`);
  for (const x of cls.filter((i) => i.role === "unknown")) L.push(`  dokunulmaz: ${trackLabel(x.clip.kind, x.clip.track)} "${x.clip.name}" (${x.why})`);

  // park listesi TOPLA KAYDINDAN (track sırasından tahmin yok)
  const rec = loadRecord(ctx.guid);
  const parked = parkedFromRecord(cls, rec);
  const a = analyze(s, cls, { threshold: getThreshold(), exclude: parked });
  L.push("");
  L.push(
    `OTURUMLAR (güçlü bağ eşiği %${Math.round(getThreshold() * 100)}; ${rec ? `TOPLA kaydı ${rec.at} — kayıttaki park'taki ${parked.size} klip hariç` : "TOPLA kaydı yok"})`
  );
  if (rec) {
    const ls = layoutState(rec, s);
    L.push(`  TOPLA düzeni: ${ls === "collected" ? "duruyor" : ls === "undone" ? "GERİ ALINMIŞ (park kaydı TOPLA'da bırakılır)" : "TOPLA'dan sonra DEĞİŞMİŞ (TOPLA park kaydını sorar)"}`);
    for (const d of recordDrift(rec, mappingFor(sourcesOf(cls)), Math.round(getThreshold() * 100))) L.push(`  TOPLA'dan sonra değişti: ${d}`);
    const bs = bindState(rec, s);
    const pr = rec.bind ? readPanelLinkResult() : null;
    const byPanel = pr && pr.sequence === ctx.name && pr.planCreatedAt === rec.bind!.at ? pr : null;
    if (rec.bind)
      L.push(
        `  BAĞLA kaydı: ${rec.bind.stage === "linked" ? "kesme/silme + bağlama" : byPanel ? `kesme/silme; bağlama Spread Helper panelinden (${byPanel.at}): ${byPanel.summary}` : "kesme/silme (bağlama bitmedi — Spread'de BAĞLA ya da Spread Helper panelinde BAĞLA)"} ` +
          `${rec.bind.at}; timeline'da ${bs === "applied" ? "yerinde" : bs === "partial" ? "KISMEN yerinde (düzen değişmiş)" : "yok (geri alınmış)"}`
      );
    if (bs === "applied" && rec.bind!.created.length) L.push("  not: harici sesler çapalara kesildi — aşağıdaki oturum analizi kesilmiş düzene göredir (TOPLA/BAĞLA bunu kullanmaz)");
  }
  for (const d of a.duplicates) L.push(`  ÇİFT KOPYA: ${d}`);
  L.push(`  güçlü bağlar (${a.links.length}):`);
  for (const l of describeLinks(a, 200)) L.push(`    ${l}`);
  for (const x of a.sessions) {
    L.push(`  ${x.id} [${secOf(x.start)}s–${secOf(x.end)}s] ${x.label}`);
    for (const g of sessionGroups(x))
      L.push(`    ${g.id}: ${g.cams.length} kamera; çapa ${trackLabel("V", g.anchor.track)} "${g.anchor.name}" [${secOf(g.anchor.start)}s–${secOf(g.anchor.end)}s]`);
  }
  for (const o of a.orphans) L.push(`  sahipsiz: ${o.label} [${secOf(o.start)}s–${secOf(o.end)}s]`);
  for (const v of a.vetoDecisions) L.push(`  ${v}`);
  for (const u of a.unresolved) for (const l of u.lines) L.push(`  AYRILAMADI: ${l}`);
  if (a.orderIssue) for (const l of a.orderIssue.lines) L.push(`  SIRA ${a.orderIssue.kind === "conflict" ? "ÇELİŞKİSİ" : "BELİRSİZ"}: ${l}`);

  L.push("");
  L.push("MAKİNE OKUNUR (noktalı virgül ayraçlı)");
  L.push("# CLIP;tür;track;start;end;in;out;hız;kaynak;ad");
  for (const c of s.clips) L.push(`CLIP;${c.kind};${trackLabel(c.kind, c.track)};${c.start};${c.end};${c.inPt};${c.outPt};${c.speed};${c.projName};${c.name}`);
  L.push("# OVERLAP;ses;sesTrack;kamera;kameraTrack;çakışmaTick;çakışmaSn");
  for (const r of overlapRows) L.push(r);
  return L.join("\n");
}
