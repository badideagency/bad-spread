// DURUM RAPORU — aktif sequence'ın tam dökümü (salt okuma). Kullanıcı bunu Synchronize'dan SONRA getirecek; Re-stack bu veriyle tasarlanacak.
//   - track başına klipler: start/end/in/out (tick + saniye), kaynak adı
//   - birim eşleşmesi: hangi ses hangi kamerayla zamanda çakışıyor, çakışma süresi
//   - makine okunur blok (CLIP / OVERLAP satırları)

import { classify, devicesOf, channelsOf, roleLabel } from "./classify";
import { makeGroups } from "./bind";
import { big, secOf, snapshot, trackLabel, type ClipInfo } from "./model";
import { makePlan, type Unit } from "./plan";
import { requireActive } from "./session";

const PANEL = "Spread v0.3.0";

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
  for (const d of devicesOf(cls)) L.push(`  cihaz ${d.key}: ${d.clips.length} klip, toplam ${secOf(d.total)} sn (ör. "${d.sample}")`);
  for (const ch of channelsOf(cls)) L.push(`  harici kanal ${ch}: ${cls.filter((x) => x.role === "external" && x.channel === ch).length} klip`);
  for (const x of cls.filter((i) => i.role === "unknown")) L.push(`  dokunulmaz: ${trackLabel(x.clip.kind, x.clip.track)} "${x.clip.name}" (${x.why})`);
  const groups = makeGroups(cls.filter((x) => x.role === "camera").map((x) => x.clip));
  L.push(`  gruplar (zamanda çakışan kameralar): ${groups.length}`);
  for (const g of groups)
    L.push(`    ${g.id} [${secOf(g.start)}s–${secOf(g.end)}s] ${g.cams.length} kamera; çapa ${trackLabel("V", g.anchor.track)} "${g.anchor.name}" [${secOf(g.anchor.start)}s–${secOf(g.anchor.end)}s]`);

  L.push("");
  L.push("MAKİNE OKUNUR (noktalı virgül ayraçlı)");
  L.push("# CLIP;tür;track;start;end;in;out;hız;kaynak;ad");
  for (const c of s.clips) L.push(`CLIP;${c.kind};${trackLabel(c.kind, c.track)};${c.start};${c.end};${c.inPt};${c.outPt};${c.speed};${c.projName};${c.name}`);
  L.push("# OVERLAP;ses;sesTrack;kamera;kameraTrack;çakışmaTick;çakışmaSn");
  for (const r of overlapRows) L.push(r);
  return L.join("\n");
}
