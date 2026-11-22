import esbuild from "esbuild-wasm";
import fs from "fs";
fs.rmSync("test-dist", { recursive: true, force: true });
const files = fs.readdirSync("test").filter((f) => f.endsWith(".test.ts")).map((f) => "test/" + f);
await esbuild.build({ entryPoints: files, bundle: true, platform: "node", format: "esm", outdir: "test-dist", outExtension: { ".js": ".mjs" }, logLevel: "warning" });
