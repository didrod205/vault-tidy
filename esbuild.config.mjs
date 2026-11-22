import esbuild from "esbuild-wasm";
import { builtinModules as builtins } from "node:module";
const prod = process.argv[2] === "production";
await esbuild.build({
  entryPoints: ["src/main.ts"], bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtins],
  format: "cjs", target: "es2020", logLevel: "info", sourcemap: prod ? false : "inline",
  treeShaking: true, outfile: "main.js", minify: false,
});
