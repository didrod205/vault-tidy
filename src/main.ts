import { Notice, Plugin, PluginSettingTab, Setting, App, normalizePath } from "obsidian";
import { TidyView, VIEW_TYPE } from "./ui/view";
import { HistoryStore, Plan, applyPlan, undoBatch, HistoryBatch } from "./engine";
import { previewPlan, promptText } from "./ui/modals";
import { License, activateLicense, deactivateLicense, BUY_URL, ProError } from "./pro/api";

interface Settings {
	license: License | null;
	aiAllowNewTags: boolean;
}

const DEFAULTS: Settings = { license: null, aiAllowNewTags: true };

export default class VaultTidyPlugin extends Plugin {
	settings: Settings = DEFAULTS;
	history!: HistoryStore;

	async onload() {
		await this.loadSettings();
		this.history = new HistoryStore(this.app, normalizePath(`${this.manifest.dir}/history.json`));
		await this.history.load();

		this.registerView(VIEW_TYPE, (leaf) => new TidyView(leaf, this));
		this.addRibbonIcon("sparkles", "Open Vault Tidy", () => this.openView());
		this.addCommand({ id: "open", name: "Open", callback: () => this.openView() });
		this.addCommand({
			id: "undo-last",
			name: "Undo last change",
			callback: async () => {
				const last = this.history.list().find((b) => !b.undone);
				if (!last) return new Notice("Nothing to undo.");
				await this.undo(last);
			},
		});
		this.addSettingTab(new TidySettingTab(this.app, this));
	}

	async openView() {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
	}

	refreshViews() {
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => (l.view as TidyView).render());
	}

	isPro(): boolean {
		return !!this.settings.license?.instanceId;
	}

	buyUrl(): string {
		return BUY_URL;
	}

	async promptActivate() {
		const key = await promptText(this.app, "Activate Vault Tidy Pro", "License key", "", "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX");
		if (!key) return;
		try {
			const name = `obsidian-${this.app.vault.getName()}-${Math.random().toString(36).slice(2, 8)}`;
			this.settings.license = await activateLicense(key, name);
			await this.saveSettings();
			new Notice("Vault Tidy Pro activated. Thank you!");
			this.refreshViews();
		} catch (e) {
			new Notice(e instanceof ProError ? e.message : "Could not reach the license server.");
		}
	}

	/** Preview → apply → record history. */
	async run(plan: Plan) {
		const items = await previewPlan(this.app, plan);
		if (!items || !items.length) return;
		const { result, done } = await applyPlan(this.app, items);
		if (done.length) {
			await this.history.push({ id: String(Date.now()), time: Date.now(), title: plan.title, items: done });
		}
		const msg = `Updated ${result.applied} note${result.applied === 1 ? "" : "s"}.` + (result.conflicts.length ? ` ${result.conflicts.length} skipped because they changed meanwhile.` : "");
		new Notice(msg);
		window.setTimeout(() => this.refreshViews(), 400);
	}

	async undo(b: HistoryBatch) {
		const r = await undoBatch(this.app, b);
		b.undone = true;
		await this.history.save();
		new Notice(`Undid “${b.title}” in ${r.applied} note${r.applied === 1 ? "" : "s"}.` + (r.conflicts.length ? ` ${r.conflicts.length} were edited since and left as they are.` : ""));
		window.setTimeout(() => this.refreshViews(), 400);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULTS, (await this.loadData()) as Partial<Settings> | null);
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class TidySettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: VaultTidyPlugin) {
		super(app, plugin);
	}
	display() {
		const { containerEl } = this;
		containerEl.empty();
		const lic = this.plugin.settings.license;
		new Setting(containerEl)
			.setName("Pro license")
			.setDesc(lic ? `Active${lic.email ? " · " + lic.email : ""}` : "Unlock the AI tools. One license works on up to 3 devices.")
			.addButton((b) =>
				lic
					? b.setButtonText("Deactivate on this device").onClick(async () => {
							await deactivateLicense(lic);
							this.plugin.settings.license = null;
							await this.plugin.saveSettings();
							this.display();
							this.plugin.refreshViews();
						})
					: b
							.setButtonText("Enter license key")
							.setCta()
							.onClick(async () => {
								await this.plugin.promptActivate();
								this.display();
							}),
			)
			.addExtraButton((b) => b.setIcon("external-link").setTooltip("Get Pro").onClick(() => window.open(BUY_URL)));
		new Setting(containerEl)
			.setName("Clear history")
			.setDesc("Removes saved undo snapshots (stored in the plugin folder).")
			.addButton((b) =>
				b.setButtonText("Clear").onClick(async () => {
					this.plugin.history.list().splice(0);
					await this.plugin.history.save();
					new Notice("History cleared.");
				}),
			);
	}
}
