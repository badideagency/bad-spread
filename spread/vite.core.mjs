// Tek modülün yardımcı panel derlemesi (cep-helper/js/spread-core.js): spread/src/helper-core.ts → IIFE, global `SpreadCore`.
// Kaynak Spread'in kendi modülleri (identity, classify, sessions, core) — ayrı bir kopya YOK.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const out = process.env.SPREAD_CORE_OUT || resolve(here, "..", "cep-helper", "js");

export default defineConfig({
  root: here,
  publicDir: false,
  build: {
    outDir: out,
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    target: "es2020",
    lib: {
      entry: resolve(here, "src", "helper-core.ts"),
      name: "SpreadCore",
      formats: ["iife"],
      fileName: () => "spread-core.js",
    },
  },
});
