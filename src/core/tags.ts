import { splitFrontmatter, joinFrontmatter, topLevelKeys, splitFlow, yamlScalar, unquote } from "./frontmatter";

/** Returns the new tag (without #), null to delete, or the same tag to keep. */
export type TagFn = (tag: string) => string | null;

const TAG_KEYS = ["tags", "tag"];
const TAG_CHARS = "[^\\s!\"#$%&'()*+,.:;<=>?@\\[\\]\\\\^`{|}~]+";
const BODY_TAG_RE = new RegExp(`(^|\\s)#(${TAG_CHARS})`, "gu");

export function normTag(t: string): string {
	return t.replace(/^#/, "").trim();
}

export function isValidTag(t: string): boolean {
	const s = normTag(t);
	if (!s) return false;
	if (/^[0-9]+$/.test(s)) return false;
	return new RegExp(`^${TAG_CHARS}$`, "u").test(s);
}

/** Rename `from` (and nested children `from/...`) to `to`, case-insensitively. */
export function renameFn(from: string, to: string): TagFn {
	const f = normTag(from).toLowerCase();
	const t = normTag(to);
	return (tag) => {
		const l = tag.toLowerCase();
		if (l === f) return t;
		if (l.startsWith(f + "/")) return t + tag.slice(f.length);
		return tag;
	};
}

/** Merge several tags into one target. */
export function mergeFn(sources: string[], to: string): TagFn {
	const fns = sources.map((s) => renameFn(s, to));
	return (tag) => {
		for (const fn of fns) {
			const r = fn(tag);
			if (r !== tag) return r;
		}
		return tag;
	};
}

export function deleteFn(target: string, includeChildren = true): TagFn {
	const f = normTag(target).toLowerCase();
	return (tag) => {
		const l = tag.toLowerCase();
		if (l === f || (includeChildren && l.startsWith(f + "/"))) return null;
		return tag;
	};
}

interface FmTags {
	blockIndex: number;
	style: "list" | "flow" | "plain" | "empty";
	tags: string[];
	indent: string;
	hadHash: boolean;
}

function readFmTags(lines: string[]): FmTags | null {
	const blocks = topLevelKeys(lines);
	const idx = blocks.findIndex((b) => TAG_KEYS.includes(b.key.toLowerCase()));
	if (idx < 0) return null;
	const b = blocks[idx];
	let style: FmTags["style"];
	let tags: string[] = [];
	let indent = "  ";
	if (b.inline === "" || b.inline === "~" || b.inline === "null") {
		const items = lines.slice(b.start + 1, b.end).filter((l) => l.trim() !== "");
		if (items.length === 0) style = "empty";
		else {
			style = "list";
			const m = /^(\s*)-/.exec(items[0]);
			indent = m ? m[1] : "  ";
			tags = items
				.map((l) => /^\s*-\s*(.*)$/.exec(l)?.[1] ?? "")
				.map((s) => unquote(s.replace(/\s+#.*$/, "")))
				.filter((s) => s !== "");
		}
	} else if (b.inline.startsWith("[")) {
		style = "flow";
		tags = splitFlow(b.inline.replace(/^\[/, "").replace(/\]\s*$/, ""));
	} else {
		style = "plain";
		tags = unquote(b.inline)
			.split(/[,\s]+/)
			.filter((s) => s !== "");
	}
	const hadHash = tags.some((t) => t.startsWith("#"));
	return { blockIndex: idx, style, tags: tags.map(normTag), indent, hadHash };
}

export function frontmatterTags(content: string): string[] {
	const fm = splitFrontmatter(content);
	if (!fm.has) return [];
	return readFmTags(fm.lines)?.tags ?? [];
}

function dedupe(tags: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const t of tags) {
		const k = t.toLowerCase();
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(t);
	}
	return out;
}

function writeTagBlock(key: string, style: FmTags["style"], tags: string[], indent: string): string[] {
	if (tags.length === 0) return [`${key}: []`];
	if (style === "flow" || style === "plain") return [`${key}: [${tags.map(yamlScalar).join(", ")}]`];
	return [`${key}:`, ...tags.map((t) => `${indent}- ${yamlScalar(t)}`)];
}

function transformFm(lines: string[], fn: TagFn): { lines: string[]; changed: boolean } {
	const cur = readFmTags(lines);
	if (!cur) return { lines, changed: false };
	const next: string[] = [];
	let changed = false;
	for (const t of cur.tags) {
		const r = fn(t);
		if (r !== t) changed = true;
		if (r !== null && r !== "") next.push(normTag(r));
	}
	if (!changed) return { lines, changed: false };
	const final = dedupe(next);
	const b = topLevelKeys(lines)[cur.blockIndex];
	const keyName = /^([^:]+):/.exec(lines[b.start])?.[1] ?? "tags";
	const block = writeTagBlock(keyName, cur.style === "empty" ? "list" : cur.style, final, cur.indent);
	return { lines: [...lines.slice(0, b.start), ...block, ...lines.slice(b.end)], changed: true };
}

/** Apply fn to each run of non-code text in a markdown body. */
export function mapProse(body: string, fn: (text: string) => string): string {
	const parts = body.split(/(\r?\n)/);
	let fence: string | null = null;
	for (let i = 0; i < parts.length; i += 2) {
		const line = parts[i];
		const fm = /^\s*(```+|~~~+)/.exec(line);
		if (fence) {
			if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = null;
			continue;
		}
		if (fm) {
			fence = fm[1];
			continue;
		}
		// skip indented code blocks only when the line is clearly code (4 spaces / tab) and not a list continuation
		const segs = line.split(/(`+[^`]*?`+)/);
		for (let j = 0; j < segs.length; j += 2) segs[j] = fn(segs[j]);
		parts[i] = segs.join("");
	}
	return parts.join("");
}

function transformBody(body: string, fn: TagFn): { body: string; changed: boolean } {
	let changed = false;
	const out = mapProse(body, (text) =>
		text.replace(BODY_TAG_RE, (whole, pre: string, tag: string, offset: number, str: string) => {
			if (/^[0-9]+$/.test(tag)) return whole;
			// strip trailing slash noise like "#a/" -> keep as-is
			const r = fn(tag);
			if (r === tag) return whole;
			changed = true;
			if (r === null || r === "") {
				const after = str[offset + whole.length];
				if (pre !== "" && (after === undefined || /[\s.,;:!?)\]]/.test(after))) return "";
				return pre;
			}
			return `${pre}#${normTag(r)}`;
		}),
	);
	return { body: changed ? out : body, changed };
}

/** Rewrite every tag in a note (frontmatter + body). Returns the original string if nothing changed. */
export function transformTags(content: string, fn: TagFn): string {
	const fm = splitFrontmatter(content);
	let changed = false;
	if (fm.has) {
		const r = transformFm(fm.lines, fn);
		if (r.changed) {
			fm.lines = r.lines;
			changed = true;
		}
	}
	const b = transformBody(fm.body, fn);
	if (b.changed) {
		fm.body = b.body;
		changed = true;
	}
	return changed ? joinFrontmatter(fm) : content;
}

export function bodyTags(content: string): string[] {
	const fm = splitFrontmatter(content);
	const found: string[] = [];
	mapProse(fm.body, (text) => {
		for (const m of text.matchAll(BODY_TAG_RE)) if (!/^[0-9]+$/.test(m[2])) found.push(m[2]);
		return text;
	});
	return found;
}

export function allTags(content: string): string[] {
	return [...frontmatterTags(content), ...bodyTags(content)];
}

/** Add tags to the frontmatter `tags` list, creating frontmatter if needed. */
export function addTags(content: string, add: string[]): string {
	const clean = add.map(normTag).filter(isValidTag);
	if (clean.length === 0) return content;
	const existing = new Set(allTags(content).map((t) => t.toLowerCase()));
	const toAdd = dedupe(clean.filter((t) => !existing.has(t.toLowerCase())));
	if (toAdd.length === 0) return content;
	const fm = splitFrontmatter(content);
	if (!fm.has) {
		const eol = fm.eol;
		return ["---", "tags:", ...toAdd.map((t) => `  - ${yamlScalar(t)}`), "---", ""].join(eol) + content;
	}
	const cur = readFmTags(fm.lines);
	if (!cur) {
		fm.lines = [...fm.lines, "tags:", ...toAdd.map((t) => `  - ${yamlScalar(t)}`)];
		return joinFrontmatter(fm);
	}
	const b = topLevelKeys(fm.lines)[cur.blockIndex];
	const keyName = /^([^:]+):/.exec(fm.lines[b.start])?.[1] ?? "tags";
	const block = writeTagBlock(keyName, cur.style === "empty" ? "list" : cur.style, [...cur.tags, ...toAdd], cur.indent);
	fm.lines = [...fm.lines.slice(0, b.start), ...block, ...fm.lines.slice(b.end)];
	return joinFrontmatter(fm);
}
