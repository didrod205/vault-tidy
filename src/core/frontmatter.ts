// Line-based frontmatter helpers. We avoid re-serialising YAML so that the
// user's formatting, comments and key order stay exactly as they were.

export interface FrontmatterSplit {
	has: boolean;
	/** lines between the opening and closing --- (exclusive) */
	lines: string[];
	/** text before frontmatter content, i.e. "---\n" or "" */
	open: string;
	/** closing delimiter line including its newline, i.e. "---\n" */
	close: string;
	body: string;
	eol: string;
}

export function detectEol(content: string): string {
	return content.includes("\r\n") ? "\r\n" : "\n";
}

export function splitFrontmatter(content: string): FrontmatterSplit {
	const eol = detectEol(content);
	const norm = content;
	if (!(norm.startsWith("---\n") || norm.startsWith("---\r\n"))) {
		return { has: false, lines: [], open: "", close: "", body: content, eol };
	}
	const firstNl = norm.indexOf("\n") + 1;
	const rest = norm.slice(firstNl);
	const re = /^(---|\.\.\.)[ \t]*(\r?\n|$)/m;
	const m = re.exec(rest);
	if (!m) return { has: false, lines: [], open: "", close: "", body: content, eol };
	const fmText = rest.slice(0, m.index);
	const lines = fmText.length ? fmText.replace(/\r?\n$/, "").split(/\r?\n/) : [];
	return {
		has: true,
		lines,
		open: norm.slice(0, firstNl),
		close: m[0],
		body: rest.slice(m.index + m[0].length),
		eol,
	};
}

export function joinFrontmatter(fm: FrontmatterSplit): string {
	if (!fm.has) return fm.body;
	const inner = fm.lines.length ? fm.lines.join(fm.eol) + fm.eol : "";
	const close = fm.close.endsWith("\n") || fm.body.length === 0 ? fm.close : fm.close + fm.eol;
	return fm.open + inner + close + fm.body;
}

export interface KeyBlock {
	key: string;
	start: number; // index of key line
	end: number; // exclusive
	inline: string; // text after "key:" on the key line (trimmed)
}

const KEY_RE = /^([^\s#-][^:]*?):(?:\s+(.*)|\s*)$/;

/** Top-level keys of the frontmatter with their line ranges. */
export function topLevelKeys(lines: string[]): KeyBlock[] {
	const blocks: KeyBlock[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = KEY_RE.exec(lines[i]);
		if (!m) continue;
		let end = i + 1;
		while (end < lines.length) {
			const l = lines[end];
			if (l.trim() === "" || /^[ \t]/.test(l) || /^-(\s|$)/.test(l)) {
				end++;
				continue;
			}
			break;
		}
		// do not swallow trailing blank lines
		while (end > i + 1 && lines[end - 1].trim() === "") end--;
		blocks.push({ key: unquote(m[1].trim()), start: i, end, inline: (m[2] ?? "").trim() });
		i = end - 1;
	}
	return blocks;
}

export function unquote(s: string): string {
	const t = s.trim();
	if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
		return t.slice(1, -1);
	}
	return t;
}

/** Quote a scalar only if YAML would otherwise misread it. */
export function yamlScalar(s: string): string {
	if (s === "") return '""';
	if (/^[\s]|[\s]$/.test(s) || /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) || /: | #/.test(s) || /^(true|false|null|yes|no|~)$/i.test(s) || /^[0-9.+\-eE]+$/.test(s)) {
		return JSON.stringify(s);
	}
	return s;
}

/** Split an inline YAML flow list body like `a, "b, c", d` into items. */
export function splitFlow(body: string): string[] {
	const out: string[] = [];
	let cur = "";
	let q: string | null = null;
	for (const ch of body) {
		if (q) {
			cur += ch;
			if (ch === q) q = null;
			continue;
		}
		if (ch === '"' || ch === "'") {
			q = ch;
			cur += ch;
			continue;
		}
		if (ch === ",") {
			out.push(cur);
			cur = "";
			continue;
		}
		cur += ch;
	}
	if (cur.trim() !== "" || out.length) out.push(cur);
	return out.map((x) => unquote(x.trim())).filter((x) => x !== "");
}
