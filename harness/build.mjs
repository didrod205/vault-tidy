import esbuild from "esbuild-wasm";
import path from "path";
await esbuild.build({
  entryPoints: ["harness/boot.ts"], bundle: true, format: "iife", outfile: "harness/dist.js", logLevel: "warning",
  plugins: [{ name: "shim", setup(b) { b.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.resolve("harness/obsidian-shim.ts") })); } }],
});
