import { splitFrontmatter, joinFrontmatter, topLevelKeys, unquote, yamlScalar } from "./frontmatter";

export interface PropInfo {
	key: string;
	value: string; // raw inline value or "(list)" summary
	listItems: string[];
}

export function readProps(content: string): PropInfo[] {
	const fm = splitFrontmatter(content);
	if (!fm.has) return [];
	return topLevelKeys(fm.lines).map((b) => {
		const items = fm.lines
			.slice(b.start + 1, b.end)
			.map((l) => /^\s*-\s*(.*)$/.exec(l)?.[1])
			.filter((x): x is string => x !== undefined)
			.map(unquote);
		return { key: b.key, value: unquote(b.inline), listItems: items };
	});
}

export type PropResult = { content: string; status: "changed" | "unchanged" | "conflict"; note?: string };

/** Rename a top-level key. If the target key already exists the file is reported as a conflict. */
export function renameKey(content: string, from: string, to: string): PropResult {
	const fm = splitFrontmatter(content);
	if (!fm.has) return { content, status: "unchanged" };
	const blocks = topLevelKeys(fm.lines);
	const src = blocks.find((b) => b.key === from);
	if (!src) return { content, status: "unchanged" };
	if (from !== to && blocks.some((b) => b.key === to)) {
		return { content, status: "conflict", note: `already has "${to}"` };
	}
	const line = fm.lines[src.start];
	const rest = line.slice(line.search(/:(\s|$)/));
	fm.lines[src.start] = `${needsQuoteKey(to) ? JSON.stringify(to) : to}${rest}`;
	return { content: joinFrontmatter(fm), status: "changed" };
}

function needsQuoteKey(k: string): boolean {
	return /[:#]|^\s|\s$|^[-?[\]{}&*!|>'"%@`]/.test(k);
}

export function deleteKey(content: string, key: string): PropResult {
	const fm = splitFrontmatter(content);
	if (!fm.has) return { content, status: "unchanged" };
	const b = topLevelKeys(fm.lines).find((x) => x.key === key);
	if (!b) return { content, status: "unchanged" };
	fm.lines = [...fm.lines.slice(0, b.start), ...fm.lines.slice(b.end)];
	return { content: joinFrontmatter(fm), status: "changed" };
}

/** Set a scalar value (creates the key or frontmatter if missing, overwrites lists). */
export function setValue(content: string, key: string, value: string, onlyIfMissing = false): PropResult {
	const fm = splitFrontmatter(content);
	const line = `${needsQuoteKey(key) ? JSON.stringify(key) : key}: ${yamlScalar(value)}`;
	if (!fm.has) {
		return { content: ["---", line, "---", ""].join(fm.eol) + content, status: "changed" };
	}
	const b = topLevelKeys(fm.lines).find((x) => x.key === key);
	if (!b) {
		fm.lines = [...fm.lines, line];
		return { content: joinFrontmatter(fm), status: "changed" };
	}
	if (onlyIfMissing) return { content, status: "unchanged" };
	const curVal = unquote(b.inline);
	if (b.end === b.start + 1 && curVal === value) return { content, status: "unchanged" };
	fm.lines = [...fm.lines.slice(0, b.start), line, ...fm.lines.slice(b.end)];
	return { content: joinFrontmatter(fm), status: "changed" };
}

/** Replace a specific value of a key (scalar or list item), case-sensitive exact match. */
export function replaceValue(content: string, key: string, from: string, to: string): PropResult {
	const fm = splitFrontmatter(content);
	if (!fm.has) return { content, status: "unchanged" };
	const b = topLevelKeys(fm.lines).find((x) => x.key === key);
	if (!b) return { content, status: "unchanged" };
	let changed = false;
	if (b.inline !== "") {
		if (b.inline.startsWith("[")) {
			const inner = b.inline.replace(/^\[/, "").replace(/\]\s*$/, "");
			const items = inner.split(",").map((s) => s.trim());
			const next = items.map((s) => (unquote(s) === from ? ((changed = true), yamlScalar(to)) : s));
			if (changed) fm.lines[b.start] = fm.lines[b.start].replace(/:\s.*$/, `: [${next.join(", ")}]`);
		} else if (unquote(b.inline) === from) {
			fm.lines[b.start] = fm.lines[b.start].replace(/:\s.*$/, `: ${yamlScalar(to)}`);
			changed = true;
		}
	} else {
		for (let i = b.start + 1; i < b.end; i++) {
			const m = /^(\s*-\s*)(.*)$/.exec(fm.lines[i]);
			if (m && unquote(m[2]) === from) {
				fm.lines[i] = m[1] + yamlScalar(to);
				changed = true;
			}
		}
	}
	return changed ? { content: joinFrontmatter(fm), status: "changed" } : { content, status: "unchanged" };
}
