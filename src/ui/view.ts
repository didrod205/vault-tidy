import { ItemView, Notice, Setting, WorkspaceLeaf, setIcon, debounce } from "obsidian";
import type VaultTidyPlugin from "../main";
import { collectTags, collectProps, buildPlan, markdownFiles, TagStat } from "../engine";
import { transformTags, renameFn, mergeFn, deleteFn, isValidTag, addTags, allTags } from "../core/tags";
import { renameKey, deleteKey, setValue, replaceValue } from "../core/props";
import { replaceInNote, ReplaceOptions } from "../core/replace";
import { findSimilarTags, MergeGroup } from "../core/similar";
import { promptText } from "./modals";
import { aiTagMerges, aiSuggestTags, ProError } from "../pro/api";
import { splitFrontmatter } from "../core/frontmatter";

export const VIEW_TYPE = "vault-tidy-view";
type Tab = "tags" | "props" | "replace" | "ai" | "history";

export class TidyView extends ItemView {
	tab: Tab = "tags";
	tagFilter = "";
	tagSort: "count" | "name" = "count";
	selectedTags = new Set<string>();
	replace: ReplaceOptions & { folder: string } = { find: "", replace: "", regex: false, caseSensitive: false, wholeWord: false, includeFrontmatter: false, skipCode: true, folder: "" };
	aiGroups: (MergeGroup & { on: boolean })[] | null = null;
	aiTagResults: { path: string; tags: string[]; on: Set<string> }[] | null = null;
	busy = false;

	constructor(leaf: WorkspaceLeaf, private plugin: VaultTidyPlugin) {
		super(leaf);
	}
	getViewType() {
		return VIEW_TYPE;
	}
	getDisplayText() {
		return "Vault Tidy";
	}
	getIcon() {
		return "sparkles";
	}
	async onOpen() {
		this.render();
		this.registerEvent(this.app.metadataCache.on("resolved", debounce(() => this.tab !== "replace" && this.tab !== "ai" && this.render(), 800, true)));
	}

	render() {
		const root = this.contentEl;
		root.empty();
		root.addClass("vt-root");
		const tabs = root.createDiv({ cls: "vt-tabs" });
		const defs: [Tab, string, string][] = [
			["tags", "Tags", "tags"],
			["props", "Properties", "list"],
			["replace", "Find & replace", "replace"],
			["ai", "AI", "sparkles"],
			["history", "History", "history"],
		];
		for (const [id, label, icon] of defs) {
			const b = tabs.createEl("button", { cls: "vt-tab" + (this.tab === id ? " is-active" : "") });
			setIcon(b.createSpan(), icon);
			b.createSpan({ text: label });
			if (id === "ai" && !this.plugin.isPro()) b.createSpan({ cls: "vt-pro-badge", text: "PRO" });
			b.onclick = () => {
				this.tab = id;
				this.render();
			};
		}
		const body = root.createDiv({ cls: "vt-body" });
		if (this.tab === "tags") this.renderTags(body);
		else if (this.tab === "props") this.renderProps(body);
		else if (this.tab === "replace") this.renderReplace(body);
		else if (this.tab === "ai") this.renderAi(body);
		else this.renderHistory(body);
	}

	// ---------- Tags ----------
	renderTags(el: HTMLElement) {
		const tags = collectTags(this.app);
		const suggestions = findSimilarTags(tags.map((t) => ({ tag: t.tag, count: t.count })));
		if (suggestions.length) {
			const box = el.createDiv({ cls: "vt-card vt-suggest" });
			const h = box.createDiv({ cls: "vt-card-head" });
			h.createEl("strong", { text: `${suggestions.length} likely duplicate tag group${suggestions.length === 1 ? "" : "s"}` });
			const allBtn = h.createEl("button", { text: "Review all", cls: "mod-cta" });
			allBtn.onclick = () => this.runMerges(suggestions, "Merge duplicate tags");
			for (const g of suggestions.slice(0, 8)) {
				const r = box.createDiv({ cls: "vt-suggest-row vt-grid" });
				const left = r.createDiv({ cls: "vt-grid-main" });
				const chips = left.createDiv({ cls: "vt-chips" });
				g.sources.forEach((s) => chips.createSpan({ cls: "vt-chip vt-chip-muted", text: "#" + s }));
				chips.createSpan({ cls: "vt-arrow", text: "→" });
				chips.createSpan({ cls: "vt-chip", text: "#" + g.target });
				left.createDiv({ cls: "vt-reason", text: g.reason });
				const b = r.createEl("button", { text: "Merge" });
				b.onclick = () => this.runMerges([g], `Merge into #${g.target}`);
			}
			if (suggestions.length > 8) box.createDiv({ cls: "vt-muted", text: `+${suggestions.length - 8} more in "Review all"` });
			if (!this.plugin.isPro()) {
				const up = box.createDiv({ cls: "vt-muted vt-upsell" });
				up.setText("Want synonyms too (e.g. #ml and #machine-learning)? ");
				const a = up.createEl("a", { text: "AI duplicate finder", href: "#" });
				a.onclick = (e) => {
					e.preventDefault();
					this.tab = "ai";
					this.render();
				};
			}
		}

		const tools = el.createDiv({ cls: "vt-toolbar" });
		const search = tools.createEl("input", { type: "search", placeholder: `Filter ${tags.length} tags…`, value: this.tagFilter });
		search.oninput = () => {
			this.tagFilter = search.value;
			drawList();
		};
		const sort = tools.createEl("select");
		sort.createEl("option", { text: "Most used", value: "count" });
		sort.createEl("option", { text: "A → Z", value: "name" });
		sort.value = this.tagSort;
		sort.onchange = () => {
			this.tagSort = sort.value as "count" | "name";
			drawList();
		};
		const sel = el.createDiv({ cls: "vt-selbar" });
		const list = el.createDiv({ cls: "vt-list" });

		const drawSel = () => {
			sel.empty();
			if (this.selectedTags.size === 0) {
				sel.createSpan({ cls: "vt-muted", text: "Tip: tick several tags to merge or delete them together." });
				return;
			}
			sel.createSpan({ text: `${this.selectedTags.size} selected` });
			const m = sel.createEl("button", { text: "Merge into…", cls: "mod-cta" });
			m.onclick = async () => {
				const srcs = [...this.selectedTags];
				const best = [...tags].filter((t) => this.selectedTags.has(t.tag)).sort((a, b) => b.count - a.count)[0]?.tag ?? "";
				const to = await promptText(this.app, "Merge tags", `Merge ${srcs.map((s) => "#" + s).join(", ")} into`, best, "tag name");
				if (!to) return;
				if (!isValidTag(to)) return new Notice("That is not a valid tag name.");
				await this.runMerges([{ target: to.replace(/^#/, ""), sources: srcs, reason: "" }], `Merge into #${to.replace(/^#/, "")}`);
				this.selectedTags.clear();
			};
			const d = sel.createEl("button", { text: "Delete", cls: "mod-warning" });
			d.onclick = async () => {
				const srcs = [...this.selectedTags];
				const fn = (c: string) => srcs.reduce((acc, s) => transformTags(acc, deleteFn(s)), c);
				await this.plugin.run(await buildPlan(this.app, `Delete ${srcs.length} tag${srcs.length === 1 ? "" : "s"}`, this.filesWithTags(srcs), fn));
				this.selectedTags.clear();
			};
			const c = sel.createEl("a", { text: "clear", href: "#" });
			c.onclick = (e) => {
				e.preventDefault();
				this.selectedTags.clear();
				drawList();
				drawSel();
			};
		};

		const drawList = () => {
			list.empty();
			const q = this.tagFilter.toLowerCase();
			const rows = tags
				.filter((t) => !q || t.tag.toLowerCase().includes(q))
				.sort((a, b) => (this.tagSort === "count" ? b.count - a.count || a.tag.localeCompare(b.tag) : a.tag.localeCompare(b.tag)));
			if (rows.length === 0) list.createDiv({ cls: "vt-empty", text: tags.length ? "No tags match." : "No tags in this vault yet." });
			for (const t of rows.slice(0, 1500)) this.tagRow(list, t, drawSel);
		};
		drawList();
		drawSel();
	}

	tagRow(list: HTMLElement, t: TagStat, onSel: () => void) {
		const r = list.createDiv({ cls: "vt-row" });
		const cb = r.createEl("input", { type: "checkbox" });
		cb.checked = this.selectedTags.has(t.tag);
		cb.onchange = () => {
			cb.checked ? this.selectedTags.add(t.tag) : this.selectedTags.delete(t.tag);
			onSel();
		};
		r.createSpan({ cls: "vt-name", text: "#" + t.tag });
		r.createSpan({ cls: "vt-count", text: `${t.files}` }).setAttr("aria-label", `${t.count} uses in ${t.files} notes`);
		const ren = r.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Rename" } });
		setIcon(ren, "pencil");
		ren.onclick = async () => {
			const to = await promptText(this.app, "Rename tag", `Rename #${t.tag} (and its nested tags) to`, t.tag);
			if (!to || to.replace(/^#/, "") === t.tag) return;
			if (!isValidTag(to)) return new Notice("That is not a valid tag name.");
			await this.plugin.run(await buildPlan(this.app, `Rename #${t.tag} → #${to.replace(/^#/, "")}`, this.filesWithTags([t.tag]), (c) => transformTags(c, renameFn(t.tag, to))));
		};
		const del = r.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Delete" } });
		setIcon(del, "trash-2");
		del.onclick = async () => {
			await this.plugin.run(await buildPlan(this.app, `Delete #${t.tag}`, this.filesWithTags([t.tag]), (c) => transformTags(c, deleteFn(t.tag))));
		};
	}

	filesWithTags(tags: string[]) {
		const want = tags.map((t) => t.replace(/^#/, "").toLowerCase());
		return markdownFiles(this.app).filter((f) => {
			const cache = this.app.metadataCache.getFileCache(f);
			const all = [...(cache?.tags?.map((x) => x.tag) ?? []), ...frontTags(cache?.frontmatter)].map((x) => x.replace(/^#/, "").toLowerCase());
			return all.some((x) => want.some((w) => x === w || x.startsWith(w + "/")));
		});
	}

	async runMerges(groups: MergeGroup[], title: string) {
		const srcs = groups.flatMap((g) => g.sources);
		const fn = mergeMany(groups);
		await this.plugin.run(await buildPlan(this.app, title, this.filesWithTags(srcs), (c) => transformTags(c, fn)));
	}

	// ---------- Properties ----------
	renderProps(el: HTMLElement) {
		const props = collectProps(this.app);
		el.createDiv({ cls: "vt-muted vt-intro", text: "Rename, delete or bulk-edit frontmatter properties. Formatting and key order in your notes are kept." });
		const bulk = el.createDiv({ cls: "vt-card" });
		bulk.createEl("strong", { text: "Set a property on many notes" });
		let key = "",
			val = "",
			folder = "",
			onlyMissing = true;
		new Setting(bulk).setName("Property").addText((t) => t.setPlaceholder("status").onChange((v) => (key = v.trim())));
		new Setting(bulk).setName("Value").addText((t) => t.setPlaceholder("draft").onChange((v) => (val = v)));
		new Setting(bulk).setName("Folder").setDesc("Leave empty for the whole vault").addText((t) => t.setPlaceholder("Projects/2026").onChange((v) => (folder = v)));
		new Setting(bulk).setName("Only where missing").addToggle((t) => t.setValue(true).onChange((v) => (onlyMissing = v)));
		new Setting(bulk).addButton((b) =>
			b
				.setButtonText("Preview")
				.setCta()
				.onClick(async () => {
					if (!key) return new Notice("Enter a property name.");
					await this.plugin.run(await buildPlan(this.app, `Set ${key}: ${val}`, markdownFiles(this.app, folder), (c) => setValue(c, key, val, onlyMissing).content));
				}),
		);

		const list = el.createDiv({ cls: "vt-list" });
		if (props.length === 0) list.createDiv({ cls: "vt-empty", text: "No properties found." });
		for (const p of props) {
			const r = list.createDiv({ cls: "vt-row" });
			const name = r.createDiv({ cls: "vt-name" });
			name.createSpan({ text: p.key });
			if (p.sampleValues.length) name.createSpan({ cls: "vt-samples", text: p.sampleValues.join(" · ") });
			r.createSpan({ cls: "vt-count", text: String(p.files) });
			const files = () => markdownFiles(this.app).filter((f) => this.app.metadataCache.getFileCache(f)?.frontmatter?.[p.key] !== undefined);
			const ren = r.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Rename property" } });
			setIcon(ren, "pencil");
			ren.onclick = async () => {
				const to = await promptText(this.app, "Rename property", `Rename "${p.key}" to`, p.key);
				if (!to || to === p.key) return;
				await this.plugin.run(
					await buildPlan(this.app, `Rename property ${p.key} → ${to}`, files(), (c) => {
						const res = renameKey(c, p.key, to);
						return res.status === "conflict" ? { content: c, skip: res.note } : res.content;
					}),
				);
			};
			const rv = r.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Replace a value" } });
			setIcon(rv, "replace");
			rv.onclick = async () => {
				const from = await promptText(this.app, `Replace a value of "${p.key}"`, "Current value", p.sampleValues[0] ?? "");
				if (from === null) return;
				const to = await promptText(this.app, `Replace a value of "${p.key}"`, `Replace "${from}" with`, "");
				if (to === null) return;
				await this.plugin.run(await buildPlan(this.app, `${p.key}: ${from} → ${to}`, files(), (c) => replaceValue(c, p.key, from, to).content));
			};
			const del = r.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Delete property" } });
			setIcon(del, "trash-2");
			del.onclick = async () => {
				await this.plugin.run(await buildPlan(this.app, `Delete property ${p.key}`, files(), (c) => deleteKey(c, p.key).content));
			};
		}
	}

	// ---------- Find & replace ----------
	renderReplace(el: HTMLElement) {
		const o = this.replace;
		el.createDiv({ cls: "vt-muted vt-intro", text: "Search the whole vault (or one folder), preview every change, then apply. Code blocks are skipped by default." });
		new Setting(el).setName("Find").addText((t) => t.setValue(o.find).setPlaceholder("text or /regex/").onChange((v) => (o.find = v)));
		new Setting(el).setName("Replace with").setDesc(o.regex ? "Use $1, $2 for groups" : "").addText((t) => t.setValue(o.replace).onChange((v) => (o.replace = v)));
		new Setting(el).setName("Folder").setDesc("Leave empty for the whole vault").addText((t) => t.setValue(o.folder).setPlaceholder("Projects").onChange((v) => (o.folder = v)));
		const opts = el.createDiv({ cls: "vt-opts" });
		const tg = (label: string, k: "regex" | "caseSensitive" | "wholeWord" | "includeFrontmatter" | "skipCode") => {
			const l = opts.createEl("label");
			const c = l.createEl("input", { type: "checkbox" });
			c.checked = o[k];
			c.onchange = () => {
				o[k] = c.checked;
				if (k === "regex") this.render();
			};
			l.appendText(" " + label);
		};
		tg("Regex", "regex");
		tg("Match case", "caseSensitive");
		tg("Whole word", "wholeWord");
		tg("Include frontmatter", "includeFrontmatter");
		tg("Skip code", "skipCode");
		new Setting(el).addButton((b) =>
			b
				.setButtonText("Preview changes")
				.setCta()
				.onClick(async () => {
					if (!o.find) return new Notice("Enter something to find.");
					try {
						new RegExp(o.regex ? o.find : "x");
					} catch (e) {
						return new Notice("Invalid regex: " + (e as Error).message);
					}
					let total = 0;
					const plan = await buildPlan(this.app, `Replace “${o.find}” → “${o.replace}”`, markdownFiles(this.app, o.folder), (c) => {
						const r = replaceInNote(c, o);
						total += r.count;
						return { content: r.content, note: r.count ? `${r.count}×` : undefined };
					});
					plan.title += ` (${total} match${total === 1 ? "" : "es"})`;
					await this.plugin.run(plan);
				}),
		);
	}

	// ---------- AI (Pro) ----------
	renderAi(el: HTMLElement) {
		const pro = this.plugin.isPro();
		const hero = el.createDiv({ cls: "vt-card vt-hero" });
		hero.createEl("strong", { text: "Vault Tidy Pro" });
		hero.createDiv({ text: "AI that understands what your tags mean. No API key, nothing to set up." });
		const ul = hero.createEl("ul");
		ul.createEl("li", { text: "Find synonym and near-duplicate tags (#ml, #machine-learning, #AI-ML)" });
		ul.createEl("li", { text: "Suggest tags for untagged notes, using the tags you already have" });
		ul.createEl("li", { text: "Only tag names and short note excerpts are sent. Nothing is stored." });
		if (!pro) {
			new Setting(hero)
				.addButton((b) => b.setButtonText("Get Pro").setCta().onClick(() => window.open(this.plugin.buyUrl())))
				.addButton((b) => b.setButtonText("I have a license key").onClick(() => this.plugin.promptActivate().then(() => this.render())));
			return;
		}
		hero.createDiv({ cls: "vt-muted", text: `Licensed${this.plugin.settings.license?.email ? " to " + this.plugin.settings.license.email : ""}.` });

		// Synonym merges
		const a = el.createDiv({ cls: "vt-card" });
		a.createEl("strong", { text: "AI duplicate tag finder" });
		const aBtn = new Setting(a).setDesc("Looks at all tag names and groups the ones that mean the same thing.");
		aBtn.addButton((b) =>
			b
				.setButtonText(this.aiGroups ? "Run again" : "Find duplicates")
				.setCta()
				.onClick(async () => {
					b.setDisabled(true).setButtonText("Thinking…");
					try {
						const tags = collectTags(this.app).map((t) => ({ tag: t.tag, count: t.count }));
						const res = await aiTagMerges(this.plugin.settings.license!, tags.slice(0, 3000));
						this.aiGroups = res.groups.map((g) => ({ ...g, on: true }));
						if (!this.aiGroups.length) new Notice("No duplicate tags found. Nice and tidy!");
					} catch (e) {
						new Notice(e instanceof ProError ? e.message : "AI request failed: " + (e as Error).message);
					}
					this.render();
				}),
		);
		if (this.aiGroups?.length) {
			for (const g of this.aiGroups) {
				const r = a.createDiv({ cls: "vt-suggest-row vt-grid vt-grid-ai" });
				const cb = r.createEl("input", { type: "checkbox" });
				cb.checked = g.on;
				cb.onchange = () => (g.on = cb.checked);
				const left = r.createDiv({ cls: "vt-grid-main" });
				const chips = left.createDiv({ cls: "vt-chips" });
				g.sources.forEach((s) => chips.createSpan({ cls: "vt-chip vt-chip-muted", text: "#" + s }));
				chips.createSpan({ cls: "vt-arrow", text: "→" });
				const target = chips.createEl("input", { type: "text", value: g.target, cls: "vt-target" });
				target.onchange = () => (g.target = target.value.replace(/^#/, "").trim());
				left.createDiv({ cls: "vt-reason", text: g.reason });
			}
			new Setting(a).addButton((b) =>
				b
					.setButtonText("Preview merges")
					.setCta()
					.onClick(() => {
						const on = this.aiGroups!.filter((g) => g.on && isValidTag(g.target));
						if (on.length) void this.runMerges(on, `AI: merge ${on.length} tag group${on.length === 1 ? "" : "s"}`);
					}),
			);
		}

		// Tag suggestions
		const s = el.createDiv({ cls: "vt-card" });
		s.createEl("strong", { text: "Tag untagged notes" });
		let folder = "";
		let allowNew = this.plugin.settings.aiAllowNewTags;
		new Setting(s).setName("Folder").setDesc("Leave empty for the whole vault").addText((t) => t.setPlaceholder("Inbox").onChange((v) => (folder = v)));
		new Setting(s)
			.setName("Allow new tags")
			.setDesc("Off: only use tags that already exist in your vault")
			.addToggle((t) =>
				t.setValue(allowNew).onChange(async (v) => {
					allowNew = v;
					this.plugin.settings.aiAllowNewTags = v;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(s).setDesc("Up to 20 notes per run.").addButton((b) =>
			b
				.setButtonText("Suggest tags")
				.setCta()
				.onClick(async () => {
					const untagged = markdownFiles(this.app, folder).filter((f) => {
						const c = this.app.metadataCache.getFileCache(f);
						return !(c?.tags?.length || frontTags(c?.frontmatter).length);
					});
					if (!untagged.length) return new Notice("Every note in that folder already has tags.");
					b.setDisabled(true).setButtonText("Thinking…");
					try {
						const notes = [];
						for (const f of untagged.slice(0, 20)) {
							const text = splitFrontmatter(await this.app.vault.cachedRead(f)).body.slice(0, 1500);
							notes.push({ path: f.path, title: f.basename, text });
						}
						const vocab = collectTags(this.app)
							.sort((x, y) => y.count - x.count)
							.slice(0, 400)
							.map((t) => t.tag);
						const res = await aiSuggestTags(this.plugin.settings.license!, vocab, notes, allowNew);
						this.aiTagResults = res.suggestions.filter((x) => x.tags.length).map((x) => ({ ...x, on: new Set(x.tags) }));
						if (!this.aiTagResults.length) new Notice("No confident suggestions this time.");
					} catch (e) {
						new Notice(e instanceof ProError ? e.message : "AI request failed: " + (e as Error).message);
					}
					this.render();
				}),
		);
		if (this.aiTagResults?.length) {
			for (const r of this.aiTagResults) {
				const row = s.createDiv({ cls: "vt-suggest-row" });
				row.createSpan({ cls: "vt-path", text: r.path });
				for (const t of r.tags) {
					const chip = row.createEl("button", { cls: "vt-chip" + (r.on.has(t) ? "" : " vt-off"), text: "#" + t });
					chip.onclick = () => {
						r.on.has(t) ? r.on.delete(t) : r.on.add(t);
						chip.toggleClass("vt-off", !r.on.has(t));
					};
				}
			}
			new Setting(s).addButton((b) =>
				b
					.setButtonText("Preview tagging")
					.setCta()
					.onClick(async () => {
						const map = new Map(this.aiTagResults!.map((r) => [r.path, [...r.on]]));
						const files = markdownFiles(this.app).filter((f) => map.get(f.path)?.length);
						await this.plugin.run(await buildPlan(this.app, `AI: tag ${files.length} note${files.length === 1 ? "" : "s"}`, files, (c, f) => addTags(c, map.get(f.path) ?? [])));
						this.aiTagResults = null;
					}),
			);
		}
	}

	// ---------- History ----------
	renderHistory(el: HTMLElement) {
		const list = this.plugin.history.list();
		if (!list.length) {
			el.createDiv({ cls: "vt-empty", text: "Nothing yet. Every change you apply shows up here and can be undone." });
			return;
		}
		for (const b of list) {
			const r = el.createDiv({ cls: "vt-row vt-hist" + (b.undone ? " is-undone" : "") });
			const t = r.createDiv({ cls: "vt-name" });
			t.createSpan({ text: b.title });
			t.createSpan({ cls: "vt-samples", text: `${new Date(b.time).toLocaleString()} · ${b.items.length} note${b.items.length === 1 ? "" : "s"}${b.undone ? " · undone" : ""}` });
			if (!b.undone) {
				const u = r.createEl("button", { text: "Undo" });
				u.onclick = async () => {
					await this.plugin.undo(b);
					this.render();
				};
			}
		}
	}
}

function frontTags(fm: Record<string, unknown> | undefined): string[] {
	if (!fm) return [];
	const v = fm.tags ?? fm.tag;
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
	if (typeof v === "string") return v.split(/[,\s]+/).filter(Boolean);
	return [];
}

function mergeMany(groups: MergeGroup[]) {
	const fns = groups.map((g) => mergeFn(g.sources, g.target));
	return (tag: string) => {
		for (const fn of fns) {
			const r = fn(tag);
			if (r !== tag) return r;
		}
		return tag;
	};
}

export { allTags };
