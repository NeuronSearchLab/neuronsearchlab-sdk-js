// @ts-nocheck
import {readFileSync} from "node:fs";
import {defineConfig} from "tsup";

const {version} = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  // Baked in at build time for the `client` tag on events.
  define: {__SDK_VERSION__: JSON.stringify(version)},
  outExtension({format}) {
    return {
      js: format === "cjs" ? ".cjs" : ".mjs",
    };
  },
});
