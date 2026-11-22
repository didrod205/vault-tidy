import { App, TFile, getAllTags, normalizePath } from "obsidian";
import { lineDiff, Snippet } from "./core/replace";

export interface PlanItem {
	path: string;
	before: string;
	after: string;
	snippets: Snippet[];
	note?: string;
}

export interface Plan {
	title: string;
	items: PlanItem[];
	skipped: { path: string; reason: string }[];
}

export interface HistoryItem {
	path: string;
	before: string;
	after: string;
}

export interface HistoryBatch {
	id: string;
	time: number;
	title: string;
	items: HistoryItem[];
	undone?: boolean;
}

export interface ApplyResult {
	applied: number;
	conflicts: string[];
}

export function markdownFiles(app: App, folder = ""): TFile[] {
	const f = folder.trim().replace(/^\/+|\/+$/g, "");
	return app.vault
		.getMarkdownFiles()
		.filter((file) => !f || file.path === f || file.path.startsWith(f + "/"))
		.sort((a, b) => a.path.localeCompare(b.path));
}

export interface TagStat {
	tag: string;
	count: number;
	files: number;
}

/** Tag usage across the vault using Obsidian's metadata cache (exact spelling kept). */
export function collectTags(app: App): TagStat[] {
	const counts = new Map<string, { count: number; files: Set<string> }>();
	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) continue;
		for (const raw of getAllTags(cache) ?? []) {
			const t = raw.replace(/^#/, "");
			if (!counts.has(t)) counts.set(t, { count: 0, files: new Set() });
			const c = counts.get(t)!;
			c.count++;
			c.files.add(file.path);
		}
	}
	return [...counts.entries()].map(([tag, c]) => ({ tag, count: c.count, files: c.files.size }));
}

export interface PropStat {
	key: string;
	files: number;
	sampleValues: string[];
}

export function collectProps(app: App): PropStat[] {
	const map = new Map<string, { files: number; values: Map<string, number> }>();
	for (const file of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) continue;
		for (const [k, v] of Object.entries(fm)) {
			if (k === "position") continue;
			if (!map.has(k)) map.set(k, { files: 0, values: new Map() });
			const e = map.get(k)!;
			e.files++;
			const vals = Array.isArray(v) ? v : [v];
			for (const x of vals) {
				if (x === null || x === undefined || typeof x === "object") continue;
				const s = String(x);
				e.values.set(s, (e.values.get(s) ?? 0) + 1);
			}
		}
	}
	return [...map.entries()]
		.map(([key, e]) => ({
			key,
			files: e.files,
			sampleValues: [...e.values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map((x) => x[0]),
		}))
		.sort((a, b) => b.files - a.files || a.key.localeCompare(b.key));
}

/** Build a plan by running a pure transform over candidate files. */
export async function buildPlan(
	app: App,
	title: string,
	files: TFile[],
	transform: (content: string, file: TFile) => string | { content: string; skip?: string; note?: string },
): Promise<Plan> {
	const plan: Plan = { title, items: [], skipped: [] };
	for (const file of files) {
		const before = await app.vault.cachedRead(file);
		const r = transform(before, file);
		const res = typeof r === "string" ? { content: r } : r;
		if ("skip" in res && res.skip) {
			plan.skipped.push({ path: file.path, reason: res.skip });
			continue;
		}
		if (res.content === before) continue;
		plan.items.push({ path: file.path, before, after: res.content, snippets: lineDiff(before, res.content, 3), note: res.note });
	}
	return plan;
}

export class HistoryStore {
	private batches: HistoryBatch[] = [];
	constructor(private app: App, private file: string, private max = 30) {}

	async load() {
		try {
			if (await this.app.vault.adapter.exists(this.file)) {
				this.batches = JSON.parse(await this.app.vault.adapter.read(this.file)) as HistoryBatch[];
			}
		} catch (e) {
			console.error("Vault Tidy: could not read history", e);
			this.batches = [];
		}
	}

	list(): HistoryBatch[] {
		return this.batches;
	}

	async push(b: HistoryBatch) {
		this.batches.unshift(b);
		// cap by count and by total size (~40 MB)
		let size = 0;
		this.batches = this.batches.slice(0, this.max).filter((x) => {
			size += x.items.reduce((s, i) => s + i.before.length + i.after.length, 0);
			return size < 40_000_000;
		});
		await this.save();
	}

	async save() {
		await this.app.vault.adapter.write(normalizePath(this.file), JSON.stringify(this.batches));
	}
}

export async function applyPlan(app: App, items: PlanItem[]): Promise<{ result: ApplyResult; done: HistoryItem[] }> {
	const conflicts: string[] = [];
	const done: HistoryItem[] = [];
	for (const it of items) {
		const file = app.vault.getAbstractFileByPath(it.path);
		if (!(file instanceof TFile)) {
			conflicts.push(it.path);
			continue;
		}
		let ok = false;
		await app.vault.process(file, (data) => {
			if (data !== it.before) return data;
			ok = true;
			return it.after;
		});
		if (ok) done.push({ path: it.path, before: it.before, after: it.after });
		else conflicts.push(it.path);
	}
	return { result: { applied: done.length, conflicts }, done };
}

export async function undoBatch(app: App, batch: HistoryBatch): Promise<ApplyResult> {
	const conflicts: string[] = [];
	let applied = 0;
	for (const it of batch.items) {
		const file = app.vault.getAbstractFileByPath(it.path);
		if (!(file instanceof TFile)) {
			conflicts.push(it.path);
			continue;
		}
		let ok = false;
		await app.vault.process(file, (data) => {
			if (data !== it.after) return data;
			ok = true;
			return it.before;
		});
		if (ok) applied++;
		else conflicts.push(it.path);
	}
	return { applied, conflicts };
}
