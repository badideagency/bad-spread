// AdobeDocs/uxp-premiere-pro-samples, sample-panels/premiere-api/eslint.config.mjs temel alındı.
import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import typescript from "typescript-eslint";
import premierepro from "@adobe/eslint-plugin-premierepro";

export default defineConfig(
  globalIgnores([
    "dist/**",
    "scripts/**",
    "dev/**",
    "release/**",
    "spread/dist/**",
    "spread/dev/**",
    "eslint.config.mjs",
    "vite.config.mjs",
    "spread/vite.config.mjs",
  ]),
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      typescript.configs.recommended,
      premierepro.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
);
