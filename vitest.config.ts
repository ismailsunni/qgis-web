import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "happy-dom",
    // @qgis-js/ol imports OpenLayers without file extensions; let Vite resolve it.
    server: { deps: { inline: ["@qgis-js/ol"] } },
  },
});
