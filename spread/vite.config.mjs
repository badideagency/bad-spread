// Spread eklentisi derlemesi (Probe'un kök vite.config.mjs'iyle aynı düzen; AdobeDocs premiere-api örneği temel alındı)
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: here,
  publicDir: resolve(here, "public"),
  base: "./",
  build: {
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    target: "esnext",
    rolldownOptions: {
      input: resolve(here, "index.ts"),
      external: ["fs", "os", "premierepro", "uxp"],
      output: {
        format: "cjs",
        preserveModules: true,
        preserveModulesRoot: here,
        entryFileNames: "[name].js",
      },
    },
  },
});
