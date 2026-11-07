import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const manifest = JSON.parse(
  readFileSync(new URL("custom_components/quick_access/manifest.json", import.meta.url), "utf8"),
);
const version: unknown = manifest.version;
if (typeof version !== "string" || !version)
  throw new Error("manifest.json must declare a version");

export default defineConfig({
  root,
  base: "./",
  publicDir: "frontend/public",
  define: {
    __QUICK_ACCESS_VERSION__: JSON.stringify(version),
  },
  build: {
    // HA 2025.9.0+ already requires modern browsers with native ES modules.
    target: "es2022",
    outDir: "custom_components/quick_access/frontend",
    emptyOutDir: true,
    modulePreload: false,
    rolldownOptions: {
      input: {
        quick_access: fileURLToPath(new URL("frontend/src/quick_access.js", import.meta.url)),
        quick_access_config: fileURLToPath(
          new URL("frontend/src/quick_access_config.js", import.meta.url),
        ),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});
