// Kaynak koddaki "d.ts:L<satır> Tip.üye" yorumlarını premierepro.d.ts'e karşı doğrular.
//  - satır numarası gerçekten o üyeyi içeriyor mu,
//  - o satır gerçekten o tipin (export declare type Tip = {...}) içinde mi.
// Ayrıca kaynakta ppro/Premiere nesnesi üzerinden çağrılıp yanında d.ts yorumu OLMAYAN
// bilinen API adlarını da uyarı olarak listeler.
// Kullanım: node scripts/check-api-refs.mjs [--table]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DTS = join(ROOT, "node_modules/@adobe/premierepro/src/premierepro.d.ts");
const dts = readFileSync(DTS, "utf8").split("\n");

// satır → çevreleyen tip adı
const owner = new Array(dts.length).fill(null);
let current = null;
for (let i = 0; i < dts.length; i++) {
  const t = dts[i].match(/^export declare type (\w+) =/);
  const e = dts[i].match(/^\s+export enum (\w+)/);
  if (t) current = t[1];
  else if (/^export namespace Constants/.test(dts[i])) current = "Constants";
  if (e) current = `Constants.${e[1]}`;
  owner[i] = current;
}

function files(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}
// Probe (kök) + Spread (spread/) kaynakları
const sources = [
  join(ROOT, "index.ts"),
  ...files(join(ROOT, "src")),
  join(ROOT, "spread", "index.ts"),
  ...files(join(ROOT, "spread", "src")),
];

const REF = /d\.ts:L(\d+)\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)/g;
let bad = 0;
const seen = new Map();
for (const f of sources) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((text, idx) => {
    for (const m of text.matchAll(REF)) {
      const ln = Number(m[1]);
      const ref = m[2];
      const where = `${relative(ROOT, f)}:${idx + 1}`;
      const line = dts[ln - 1];
      let ok = false;
      let why = "";
      if (line === undefined) why = "d.ts'te böyle bir satır yok";
      else if (ref.startsWith("Constants.")) {
        const en = ref.split(".")[1];
        ok = new RegExp(`\\benum ${en}\\b`).test(line);
        if (!ok) why = `satırda "enum ${en}" yok: ${line.trim()}`;
      } else if (!ref.includes(".")) {
        ok = new RegExp(`\\b${ref}\\b`).test(line);
        if (!ok) why = `satırda "${ref}" yok: ${line.trim()}`;
      } else {
        const [type, member] = ref.split(".");
        const hasMember = new RegExp(`(^|\\s|readonly\\s)${member}\\s*[(:?]`).test(line);
        const own = owner[ln - 1];
        ok = hasMember && own === type;
        if (!hasMember) why = `satırda "${member}" üyesi yok: ${line.trim()}`;
        else if (own !== type) why = `satır ${own} tipinde, ${type} değil`;
      }
      if (!ok) {
        bad++;
        console.error(`✗ ${where}  d.ts:L${ln} ${ref}  → ${why}`);
      }
      const key = `${ref}@${ln}`;
      if (!seen.has(key)) seen.set(key, { ln, ref, line: (line ?? "").trim(), uses: [] });
      seen.get(key).uses.push(where);
    }
  });
}

// Yorumsuz API çağrısı taraması: d.ts'teki üye adlarından biri ".ad(" ya da ".ad" olarak geçip
// aynı satırda (veya bir önceki satırda) d.ts yorumu yoksa uyar.
const memberNames = new Set();
for (let i = 0; i < dts.length; i++) {
  const m = dts[i].match(/^\s{2}(?:readonly\s+)?([a-zA-Z_]\w*)\s*[(:?]/);
  if (m && owner[i] && !owner[i].startsWith("Constants")) memberNames.add(m[1]);
}
// genel JS/DOM adlarıyla çakışanları hariç tut
for (const n of ["name", "type", "id", "value", "toString", "equals", "add", "subtract", "divide", "multiply", "path", "empty", "getItems", "removeItem", "addEventListener", "removeEventListener", "open", "close", "save", "cast", "version"]) memberNames.delete(n);
// Satırdan yorumları ve string metnini atar; template içindeki ${...} ifadeleri korunur.
function codeOnly(line) {
  if (/^\s*(\*|\/\*)/.test(line)) return "";
  let out = "";
  let mode = "code"; // code | ' | " | `
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (mode === "code") {
      if (ch === "/" && line[i + 1] === "/") break;
      if (ch === "'" || ch === '"' || ch === "`") mode = ch;
      else if (ch === "}" && depth > 0) {
        depth--;
        mode = "`";
      } else out += ch;
    } else if (ch === "\\") i++;
    else if (mode === "`" && ch === "$" && line[i + 1] === "{") {
      depth++;
      mode = "code";
      i++;
    } else if (ch === mode) mode = "code";
  }
  return out;
}
const warn = [];
for (const f of sources) {
  if (f.endsWith("ui.ts")) continue; // yalnız DOM
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((text, idx) => {
    const code = codeOnly(text);
    for (const m of code.matchAll(/\.([a-zA-Z_]\w*)\s*\(/g)) {
      if (!memberNames.has(m[1])) continue;
      const ctx = text + (lines[idx - 1] ?? "");
      if (!/d\.ts:L\d+/.test(ctx)) warn.push(`${relative(ROOT, f)}:${idx + 1}  .${m[1]}(  (d.ts yorumu yok)`);
    }
  });
}

const short = process.argv.includes("--table-short");
if (short || process.argv.includes("--table")) {
  console.log(`| d.ts satırı | API | d.ts'teki satır |${short ? "" : " kullanıldığı yer(ler) |"}`);
  console.log(`|---|---|---|${short ? "" : "---|"}`);
  for (const v of [...seen.values()].sort((a, b) => a.ln - b.ln)) {
    const uses = short ? "" : ` ${[...new Set(v.uses)].join(", ")} |`;
    console.log(`| L${v.ln} | \`${v.ref}\` | \`${v.line.replace(/\|/g, "\\|")}\` |${uses}`);
  }
}
for (const w of warn) console.warn(`⚠ ${w}`);
console.log(`\n${seen.size} benzersiz d.ts referansı, ${bad} hatalı, ${warn.length} yorumsuz çağrı uyarısı.`);
process.exit(bad || warn.length ? 1 : 0);
