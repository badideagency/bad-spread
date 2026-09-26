// cep-helper/js/spread-core.js (yardımcı panele derlenmiş TEK modül) kaynakla güncel mi: geçici klasöre yeniden derler, bayt bayt
// karşılaştırır. Farklıysa: `npm run build:core` ve commit. Böylece yardımcı paneldeki BAĞLA Spread'in kuralından sapamaz.
// Kullanım: node scripts/check-core.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), "spread-core-"));
try {
  execFileSync(process.execPath, [join(ROOT, "node_modules/vite/bin/vite.js"), "build", "--config", "spread/vite.core.mjs", "--logLevel", "error"], {
    cwd: ROOT,
    env: { ...process.env, SPREAD_CORE_OUT: tmp },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const fresh = readFileSync(join(tmp, "spread-core.js"), "utf8");
  const committed = readFileSync(join(ROOT, "cep-helper/js/spread-core.js"), "utf8");
  if (fresh !== committed) {
    console.error("✗ cep-helper/js/spread-core.js kaynaktan (spread/src) ESKİ — `npm run build:core` çalıştır ve commit et.");
    process.exit(1);
  }
  console.log(`spread-core.js güncel (${fresh.length} bayt; kaynak: spread/src/helper-core.ts → identity, classify, sessions, core).`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
