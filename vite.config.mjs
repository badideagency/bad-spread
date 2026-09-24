// Based on AdobeDocs/uxp-premiere-pro-samples, sample-panels/premiere-api/vite.config.mjs
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  publicDir: "public",
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    target: "esnext",
    rolldownOptions: {
      input: resolve(__dirname, "index.ts"),
      external: ["os", "premierepro", "uxp"],
      output: {
        format: "cjs",
        preserveModules: true,
        preserveModulesRoot: __dirname,
        entryFileNames: "[name].js",
      },
    },
  },
});
