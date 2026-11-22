import { App } from "obsidian";
import Plugin from "../src/main";
import files from "./vault.json";
(async () => {
  const host = document.getElementById("leaf")!;
  const app = new App(files as Record<string, string>, host);
  const plugin = new (Plugin as any)(app, { dir: ".obsidian/plugins/vault-tidy", id: "vault-tidy" });
  await plugin.onload();
  await plugin.openView();
  (window as any).app = app; (window as any).plugin = plugin;
})();
