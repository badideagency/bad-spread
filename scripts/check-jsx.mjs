// cep-helper/jsx/host.jsx denetimi (ExtendScript = ES3):
//  1) ES3 olarak ayrıştırılabiliyor mu (espree ecmaVersion 3)
//  2) ES3'te / Premiere ExtendScript'te güvenilmez yapılar YOK: JSON, Array.prototype.indexOf/forEach/map/filter, Object.keys, let/const
//  3) Dize sabitlerinde ASCII dışı karakter YOK (dosya kodlaması ExtendScript'te yanlış okunsa da mesajlar bozulmasın)
//  4) Her Premiere DOM üyesi kullanımının yanında (aynı ya da bir önceki satırda) "docs:" yorumu var ve yorumdaki adres
//     doğrulanmış kaynak listesinde (Premiere Pro Scripting Guide sayfası + başlık; getLinkedItems için Adobe PProPanel tip tanımı)
// Kullanım: node scripts/check-jsx.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const espree = require("espree");
const ROOT = new URL("..", import.meta.url).pathname;
const FILE = join(ROOT, "cep-helper/jsx/host.jsx");
const src = readFileSync(FILE, "utf8");
const lines = src.split("\n");
let bad = 0;
const err = (m) => {
  bad++;
  console.error("✗ " + m);
};

// 1) ES3
let tokens = [];
try {
  espree.parse(src, { ecmaVersion: 3 });
  tokens = espree.tokenize(src, { ecmaVersion: 3, loc: true });
} catch (e) {
  err(`ES3 ayrıştırılamadı: ${e.message} (satır ${e.lineNumber})`);
}

// 2) yasak yapılar (yorumlar hariç kod token'larında)
const FORBIDDEN = new Set(["JSON", "indexOf", "forEach", "map", "filter", "reduce", "keys", "let", "const", "trim", "isArray"]);
for (let i = 0; i < tokens.length; i++) {
  const t = tokens[i];
  if ((t.type === "Identifier" || t.type === "Keyword") && FORBIDDEN.has(t.value)) err(`satır ${t.loc.start.line}: ES3/ExtendScript'te güvenilmez "${t.value}"`);
}

// 3) dize sabitlerinde ASCII dışı
for (const t of tokens) if (t.type === "String" && /[^\x00-\x7e]/.test(t.value)) err(`satır ${t.loc.start.line}: dize sabitinde ASCII dışı karakter (\\uXXXX kullan)`);

// 4) belge yorumları — kaynak: github.com/docsforadobe/premiere-scripting-guide (docs/<yol>.md başlıkları), mkdocs çapası
const G = "https://ppro-scripting.docsforadobe.dev";
const DOCS = {
  project: [`${G}/application/application/#appproject`], // docs/application/application.md "### app.project"
  activeSequence: [`${G}/general/project/#projectactivesequence`], // docs/general/project.md "### Project.activeSequence"
  version: [`${G}/application/application/#appversion`], // docs/application/application.md "### app.version"
  name: [`${G}/sequence/sequence/#sequencename`, `${G}/item/projectitem/#projectitemname`], // "### Sequence.name", "### ProjectItem.name"
  videoTracks: [`${G}/sequence/sequence/#sequencevideotracks`], // "### Sequence.videoTracks"
  audioTracks: [`${G}/sequence/sequence/#sequenceaudiotracks`], // "### Sequence.audioTracks"
  numTracks: [`${G}/collection/trackcollection/#trackcollectionnumtracks`], // "### TrackCollection.numTracks"
  clips: [`${G}/sequence/track/#trackclips`], // "### Track.clips"
  numItems: [`${G}/collection/trackitemcollection/#trackitemcollectionnumitems`], // "### TrackItemCollection.numItems"
  start: [`${G}/item/trackitem/#trackitemstart`], // "### TrackItem.start"
  end: [`${G}/item/trackitem/#trackitemend`], // "### TrackItem.end"
  ticks: [`${G}/other/time/#timeticks`], // "### Time.ticks"
  projectItem: [`${G}/item/trackitem/#trackitemprojectitem`], // "### TrackItem.projectItem"
  nodeId: [`${G}/item/trackitem/#trackitemnodeid`, `${G}/item/projectitem/#projectitemnodeid`], // "### TrackItem.nodeId", "### ProjectItem.nodeId"
  setSelected: [`${G}/item/trackitem/#trackitemsetselected`], // "### TrackItem.setSelected()"
  getSelection: [`${G}/sequence/sequence/#sequencegetselection`], // "### Sequence.getSelection()"
  linkSelection: [`${G}/sequence/sequence/#sequencelinkselection`], // "### Sequence.linkSelection()"
  length: [`${G}/collection/collection/`], // docs/collection/collection.md Attributes: length
  // Scripting Guide'da YOK; Adobe'nin PProPanel örneğindeki tip tanımı: "getLinkedItems(): TrackItemCollection"
  getLinkedItems: ["https://github.com/Adobe-CEP/Samples/blob/master/PProPanel/jsx/PremierePro.23.0.d.ts#L1253"],
};
// ".length" genel bir JS özelliği → otomatik taramada yok (tek Premiere kullanımı getSelection sonucunda, yorumlu).
// ".name/.start/.end" kendi istek nesnelerimizde (it, grp, req) de var → bu alıcılar atlanır.
const OURS = new Set(["it", "grp", "req"]);
for (let i = 0; i < tokens.length - 2; i++) {
  const [a, dot, m] = [tokens[i], tokens[i + 1], tokens[i + 2]];
  if (dot.type !== "Punctuator" || dot.value !== "." || m.type !== "Identifier" || !Object.hasOwn(DOCS, m.value) || m.value === "length") continue;
  const recv = a.value;
  if (["name", "start", "end"].includes(m.value) && OURS.has(recv)) continue; // kendi değişkenimiz
  const ln = m.loc.start.line;
  const ctx = (lines[ln - 1] ?? "") + "\n" + (lines[ln - 2] ?? "");
  const urls = [...ctx.matchAll(/docs:\s*([^\s,]+)(?:\s*,\s*([^\s]+))?/g)].flatMap((x) => [x[1], x[2]]).filter(Boolean);
  if (!urls.length) {
    err(`satır ${ln}: ${recv}.${m.value} yanında "docs:" yorumu yok`);
    continue;
  }
  if (!urls.some((u) => DOCS[m.value].includes(u) || DOCS[m.value].some((d) => d.endsWith("/") && u === d))) err(`satır ${ln}: ${recv}.${m.value} için doğrulanmamış belge adresi: ${urls.join(" ")}`);
}
// 5) KAPSAM: dosyadaki HER ".üye" ya belge listesinde (Premiere DOM) ya da aşağıdaki JS / kendi veri alanlarımız listesinde olmalı.
// Böylece belge kaynağı eklenmeden yeni bir Premiere API'si kullanılamaz.
const JS_AND_OURS = new Set([
  // ES3 yerleşikleri
  "push", "join", "charAt", "charCodeAt", "toString", "slice", "hasOwnProperty", "length",
  // host.jsx'in kendi veri alanları (istek / sonuç nesneleri)
  "kind", "track", "items", "groups", "id", "sequence", "item", "count", "verified", "detail", "linked", "found", "total", "missing", "st", "en", "nm", "pid",
]);
for (let i = 0; i < tokens.length - 1; i++) {
  const [dot, m] = [tokens[i], tokens[i + 1]];
  if (dot.type !== "Punctuator" || dot.value !== "." || m.type !== "Identifier") continue;
  if (!Object.hasOwn(DOCS, m.value) && !JS_AND_OURS.has(m.value)) err(`satır ${m.loc.start.line}: ".${m.value}" ne belge listesinde ne JS/kendi alanlar listesinde — kaynaksız API?`);
}

// kullanılan her belge adresi listede mi
for (const [i, l] of lines.entries())
  for (const x of l.matchAll(/docs:\s*(https?:\/\/[^\s,]+)(?:\s*,\s*(https?:\/\/[^\s]+))?/g))
    for (const u of [x[1], x[2]].filter(Boolean)) if (!Object.values(DOCS).flat().includes(u)) err(`satır ${i + 1}: listede olmayan belge adresi ${u}`);

console.log(`host.jsx: ES3 ${tokens.length ? "ayrıştırıldı" : "AYRIŞTIRILAMADI"}, ${Object.keys(DOCS).length} Premiere DOM üyesi için belge listesi, ${bad} hata.`);
process.exit(bad ? 1 : 0);
