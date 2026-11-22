// Minimal browser shim of the Obsidian API, used only for local UI testing.
import { createElement, Sparkles, Tags, List, Replace, History, Pencil, Trash2, ExternalLink, X } from "lucide";

// ---- DOM helpers Obsidian adds to HTMLElement.prototype ----
type DomInfo = { cls?: string | string[]; text?: string; attr?: Record<string, string>; type?: string; value?: string; placeholder?: string; href?: string };
function applyInfo(el: HTMLElement, o?: DomInfo | string) {
	if (!o) return;
	if (typeof o === "string") {
		el.className = o;
		return;
	}
	if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
	if (o.text !== undefined) el.textContent = o.text;
	if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v);
	if (o.type) (el as HTMLInputElement).type = o.type;
	if (o.value !== undefined) (el as HTMLInputElement).value = o.value;
	if (o.placeholder) (el as HTMLInputElement).placeholder = o.placeholder;
	if (o.href) (el as HTMLAnchorElement).href = o.href;
}
const P = HTMLElement.prototype as any;
P.createEl = function (tag: string, o?: DomInfo, cb?: (el: HTMLElement) => void) {
	const el = document.createElement(tag);
	applyInfo(el, o);
	this.appendChild(el);
	cb?.(el);
	return el;
};
P.createDiv = function (o?: DomInfo) {
	return this.createEl("div", o);
};
P.createSpan = function (o?: DomInfo) {
	return this.createEl("span", o);
};
P.empty = function () {
	this.innerHTML = "";
};
P.setText = function (t: string) {
	this.textContent = t;
};
P.addClass = function (...c: string[]) {
	this.classList.add(...c);
};
P.removeClass = function (...c: string[]) {
	this.classList.remove(...c);
};
P.toggleClass = function (c: string, v: boolean) {
	this.classList.toggle(c, v);
};
P.setAttr = function (k: string, v: string) {
	this.setAttribute(k, v);
};
P.appendText = function (t: string) {
	this.appendChild(document.createTextNode(t));
};

const ICONS: Record<string, any> = { sparkles: Sparkles, tags: Tags, list: List, replace: Replace, history: History, pencil: Pencil, "trash-2": Trash2, "external-link": ExternalLink, x: X };
export function setIcon(el: HTMLElement, name: string) {
	el.innerHTML = "";
	const node = ICONS[name];
	if (node) {
		const svg = createElement(node);
		svg.setAttribute("class", "svg-icon");
		el.appendChild(svg);
	}
}

export function debounce<T extends (...a: any[]) => any>(fn: T, ms: number) {
	let t: any;
	return ((...a: any[]) => {
		clearTimeout(t);
		t = setTimeout(() => fn(...a), ms);
	}) as T;
}

export function normalizePath(p: string) {
	return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export class Notice {
	constructor(msg: string, timeout = 4000) {
		let c = document.querySelector(".notice-container");
		if (!c) {
			c = document.body.createDiv({ cls: "notice-container" });
		}
		const n = (c as HTMLElement).createDiv({ cls: "notice", text: msg });
		(window as any).__notices = [...((window as any).__notices ?? []), msg];
		setTimeout(() => n.remove(), timeout);
	}
}

export async function requestUrl(o: { url: string; method?: string; body?: string; headers?: Record<string, string>; contentType?: string }) {
	const h = { ...(o.headers ?? {}) } as Record<string, string>;
	if (o.contentType) h["Content-Type"] = o.contentType;
	const r = await fetch(o.url, { method: o.method ?? "GET", body: o.body, headers: h });
	const text = await r.text();
	let json: any = null;
	try {
		json = JSON.parse(text);
	} catch {}
	return { status: r.status, text, json };
}

// ---- Vault / metadata ----
export class TAbstractFile {
	constructor(public path: string) {}
	get name() {
		return this.path.split("/").pop()!;
	}
}
export class TFile extends TAbstractFile {
	get basename() {
		return this.name.replace(/\.md$/, "");
	}
	extension = "md";
}

function parseYamlLite(lines: string[]): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	let cur: string | null = null;
	for (const l of lines) {
		const item = /^\s*-\s*(.*)$/.exec(l);
		if (item && cur) {
			(out[cur] as unknown[]).push(item[1].replace(/^["']|["']$/g, ""));
			continue;
		}
		const m = /^([^\s:][^:]*):\s*(.*)$/.exec(l);
		if (!m) continue;
		const v = m[2].trim();
		if (v === "") {
			out[m[1]] = [];
			cur = m[1];
		} else if (v.startsWith("[")) {
			out[m[1]] = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
			cur = null;
		} else {
			out[m[1]] = /^\d+$/.test(v) ? Number(v) : v.replace(/^["']|["']$/g, "");
			cur = null;
		}
	}
	return out;
}

export interface CachedMetadata {
	tags?: { tag: string }[];
	frontmatter?: Record<string, unknown>;
}

export function getAllTags(c: CachedMetadata): string[] {
	const fm = c.frontmatter?.tags ?? c.frontmatter?.tag;
	const fmTags = Array.isArray(fm) ? fm : typeof fm === "string" ? fm.split(/[,\s]+/) : [];
	return [...fmTags.map((t) => "#" + String(t).replace(/^#/, "")), ...(c.tags ?? []).map((t) => t.tag)];
}

type Listener = (...a: any[]) => void;
class Events {
	private l = new Map<string, Listener[]>();
	on(n: string, fn: Listener) {
		this.l.set(n, [...(this.l.get(n) ?? []), fn]);
		return { n, fn };
	}
	trigger(n: string, ...a: any[]) {
		(this.l.get(n) ?? []).forEach((f) => f(...a));
	}
}

export class Vault extends Events {
	files = new Map<string, string>();
	fileObjs = new Map<string, TFile>();
	adapterStore = new Map<string, string>();
	constructor(private app: App, initial: Record<string, string>) {
		super();
		for (const [p, c] of Object.entries(initial)) this.setFile(p, c);
	}
	private setFile(p: string, c: string) {
		this.files.set(p, c);
		if (!this.fileObjs.has(p)) this.fileObjs.set(p, new TFile(p));
	}
	getName() {
		return "test-vault";
	}
	getMarkdownFiles() {
		return [...this.fileObjs.values()].filter((f) => f.path.endsWith(".md"));
	}
	getAbstractFileByPath(p: string) {
		return this.fileObjs.get(p) ?? null;
	}
	async cachedRead(f: TFile) {
		return this.files.get(f.path) ?? "";
	}
	async read(f: TFile) {
		return this.files.get(f.path) ?? "";
	}
	async process(f: TFile, fn: (d: string) => string) {
		const next = fn(this.files.get(f.path) ?? "");
		this.setFile(f.path, next);
		this.app.metadataCache.reindex();
		return next;
	}
	adapter = {
		exists: async (p: string) => this.adapterStore.has(p),
		read: async (p: string) => this.adapterStore.get(p) ?? "",
		write: async (p: string, d: string) => void this.adapterStore.set(p, d),
	};
}

export class MetadataCache extends Events {
	cache = new Map<string, CachedMetadata>();
	constructor(private app: App) {
		super();
	}
	reindex() {
		for (const f of this.app.vault.getMarkdownFiles()) {
			const c = this.app.vault.files.get(f.path)!;
			const m = /^---\n([\s\S]*?)\n---\n?/.exec(c);
			const fm = m ? parseYamlLite(m[1].split("\n")) : undefined;
			let body = m ? c.slice(m[0].length) : c;
			body = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
			const tags = [...body.matchAll(/(^|\s)(#[^\s!"#$%&'()*+,.:;<=>?@\[\]\\^`{|}~]+)/gu)].map((x) => ({ tag: x[2] })).filter((t) => !/^#\d+$/.test(t.tag));
			this.cache.set(f.path, { frontmatter: fm, tags });
		}
		setTimeout(() => this.trigger("resolved"), 50);
	}
	getFileCache(f: TFile) {
		return this.cache.get(f.path) ?? null;
	}
}

export class WorkspaceLeaf {
	view: any = null;
	constructor(public app: App, public container: HTMLElement) {}
	async setViewState(s: { type: string }) {
		const ctor = this.app.workspace.viewCreators.get(s.type)!;
		this.view = ctor(this);
		this.container.empty();
		this.container.appendChild(this.view.containerEl);
		await this.view.onOpen();
	}
	getViewState() {
		return { type: this.view?.getViewType() };
	}
}

export class Workspace {
	viewCreators = new Map<string, (l: WorkspaceLeaf) => any>();
	leaves: WorkspaceLeaf[] = [];
	constructor(private app: App, private host: HTMLElement) {}
	getLeavesOfType(t: string) {
		return this.leaves.filter((l) => l.view?.getViewType() === t);
	}
	getRightLeaf() {
		const l = new WorkspaceLeaf(this.app, this.host);
		this.leaves.push(l);
		return l;
	}
	getLeaf() {
		return this.getRightLeaf();
	}
	revealLeaf() {}
}

export class App {
	vault: Vault;
	metadataCache: MetadataCache;
	workspace: Workspace;
	constructor(files: Record<string, string>, host: HTMLElement) {
		this.vault = new Vault(this, files);
		this.metadataCache = new MetadataCache(this);
		this.workspace = new Workspace(this, host);
		this.metadataCache.reindex();
	}
}

export class Component {
	registerEvent() {}
	register() {}
}

export class ItemView extends Component {
	containerEl: HTMLElement;
	contentEl: HTMLElement;
	app: App;
	constructor(public leaf: WorkspaceLeaf) {
		super();
		this.app = leaf.app;
		this.containerEl = document.createElement("div");
		this.containerEl.className = "workspace-leaf-content";
		this.containerEl.createDiv({ cls: "view-header" });
		this.contentEl = this.containerEl.createDiv({ cls: "view-content" });
	}
	async onOpen() {}
}

export class Modal {
	modalEl: HTMLElement;
	titleEl: HTMLElement;
	contentEl: HTMLElement;
	private bg: HTMLElement;
	constructor(public app: App) {
		this.bg = document.createElement("div");
		this.bg.className = "modal-container mod-dim";
		this.bg.createDiv({ cls: "modal-bg" });
		this.modalEl = this.bg.createDiv({ cls: "modal" });
		const close = this.modalEl.createDiv({ cls: "modal-close-button" });
		close.onclick = () => this.close();
		this.titleEl = this.modalEl.createDiv({ cls: "modal-title" });
		this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
	}
	open() {
		document.body.appendChild(this.bg);
		this.onOpen();
	}
	close() {
		this.onClose();
		this.bg.remove();
	}
	onOpen() {}
	onClose() {}
}

class ButtonComponent {
	buttonEl: HTMLButtonElement;
	constructor(parent: HTMLElement) {
		this.buttonEl = parent.createEl("button") as HTMLButtonElement;
	}
	setButtonText(t: string) {
		this.buttonEl.textContent = t;
		return this;
	}
	setCta() {
		this.buttonEl.classList.add("mod-cta");
		return this;
	}
	setWarning() {
		this.buttonEl.classList.add("mod-warning");
		return this;
	}
	setDisabled(d: boolean) {
		this.buttonEl.disabled = d;
		return this;
	}
	setIcon(n: string) {
		setIcon(this.buttonEl, n);
		return this;
	}
	setTooltip(t: string) {
		this.buttonEl.setAttribute("aria-label", t);
		return this;
	}
	onClick(fn: () => any) {
		this.buttonEl.onclick = fn;
		return this;
	}
}
class TextComponent {
	inputEl: HTMLInputElement;
	constructor(parent: HTMLElement) {
		this.inputEl = parent.createEl("input", { type: "text" }) as HTMLInputElement;
	}
	setValue(v: string) {
		this.inputEl.value = v;
		return this;
	}
	setPlaceholder(v: string) {
		this.inputEl.placeholder = v;
		return this;
	}
	onChange(fn: (v: string) => any) {
		this.inputEl.addEventListener("input", () => fn(this.inputEl.value));
		return this;
	}
}
class ToggleComponent {
	toggleEl: HTMLElement;
	private v = false;
	private fn?: (v: boolean) => any;
	constructor(parent: HTMLElement) {
		this.toggleEl = parent.createDiv({ cls: "checkbox-container" });
		this.toggleEl.createEl("input", { type: "checkbox" });
		this.toggleEl.onclick = () => this.setValue(!this.v, true);
	}
	setValue(v: boolean, fire = false) {
		this.v = v;
		this.toggleEl.classList.toggle("is-enabled", v);
		if (fire) this.fn?.(v);
		return this;
	}
	onChange(fn: (v: boolean) => any) {
		this.fn = fn;
		return this;
	}
}

export class Setting {
	settingEl: HTMLElement;
	private info: HTMLElement;
	private nameEl: HTMLElement;
	private descEl: HTMLElement;
	private controlEl: HTMLElement;
	constructor(parent: HTMLElement) {
		this.settingEl = parent.createDiv({ cls: "setting-item" });
		this.info = this.settingEl.createDiv({ cls: "setting-item-info" });
		this.nameEl = this.info.createDiv({ cls: "setting-item-name" });
		this.descEl = this.info.createDiv({ cls: "setting-item-description" });
		this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
	}
	setName(n: string) {
		this.nameEl.textContent = n;
		return this;
	}
	setDesc(d: string) {
		this.descEl.textContent = d;
		return this;
	}
	addText(cb: (t: TextComponent) => any) {
		cb(new TextComponent(this.controlEl));
		return this;
	}
	addToggle(cb: (t: ToggleComponent) => any) {
		cb(new ToggleComponent(this.controlEl));
		return this;
	}
	addButton(cb: (b: ButtonComponent) => any) {
		cb(new ButtonComponent(this.controlEl));
		return this;
	}
	addExtraButton(cb: (b: ButtonComponent) => any) {
		const b = new ButtonComponent(this.controlEl);
		b.buttonEl.classList.add("clickable-icon", "extra-setting-button");
		cb(b);
		return this;
	}
}

export class Plugin extends Component {
	app: App;
	manifest: { dir: string; id: string };
	private data: any = null;
	constructor(app: App, manifest: { dir: string; id: string }) {
		super();
		this.app = app;
		this.manifest = manifest;
	}
	registerView(t: string, fn: (l: WorkspaceLeaf) => any) {
		this.app.workspace.viewCreators.set(t, fn);
	}
	addRibbonIcon() {}
	addCommand(c: { id: string; callback: () => any }) {
		((window as any).__commands ??= {})[c.id] = c.callback;
	}
	addSettingTab(t: any) {
		(window as any).__settingTab = t;
	}
	async loadData() {
		return this.data;
	}
	async saveData(d: any) {
		this.data = JSON.parse(JSON.stringify(d));
	}
}

export class PluginSettingTab {
	containerEl: HTMLElement;
	constructor(public app: App, public plugin: Plugin) {
		this.containerEl = document.createElement("div");
		this.containerEl.className = "vertical-tab-content";
	}
}
