import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteStaticCopy } from "vite-plugin-static-copy";

const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  build: { target: "esnext" },
  plugins: [
    svelte(),
    viteStaticCopy({
      silent: true,
      targets: [
        { src: "node_modules/qgis-js/dist/assets/wasm/*", dest: "assets/wasm", rename: { stripBase: true } },
        { src: "node_modules/coi-serviceworker/coi-serviceworker.min.js", dest: ".", rename: { stripBase: true } },
      ],
    }),
    {
      name: "coop-coep-headers",
      configureServer(server) {
        server.middlewares.use((_req, res, next) => {
          Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
          next();
        });
      },
    },
  ],
  preview: { headers },
});
