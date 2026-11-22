import { splitFrontmatter } from "./frontmatter";
import { mapProse } from "./tags";

export interface ReplaceOptions {
	find: string;
	replace: string;
	regex: boolean;
	caseSensitive: boolean;
	wholeWord: boolean;
	includeFrontmatter: boolean;
	skipCode: boolean;
}

export function buildRegex(o: ReplaceOptions): RegExp {
	let src = o.regex ? o.find : o.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
	return new RegExp(src, "gu" + (o.caseSensitive ? "" : "i"));
}

export interface Snippet {
	line: number;
	before: string;
	after: string;
}

export interface ReplaceResult {
	content: string;
	count: number;
	snippets: Snippet[];
}

export function replaceInNote(content: string, o: ReplaceOptions, maxSnippets = 3): ReplaceResult {
	if (!o.find) return { content, count: 0, snippets: [] };
	const re = buildRegex(o);
	let count = 0;
	const rep = (text: string) =>
		text.replace(re, (...args) => {
			const m: string = args[0];
			if (m === "") return m;
			count++;
			if (!o.regex) return o.replace;
			// support $1, $<name>
			const groups = args.slice(1, -2);
			const named = typeof args[args.length - 1] === "object" ? (args[args.length - 1] as Record<string, string>) : undefined;
			return o.replace.replace(/\$(\d+|<[^>]+>|&)/g, (_s, g: string) => {
				if (g === "&") return m;
				if (g.startsWith("<")) return named?.[g.slice(1, -1)] ?? "";
				return (groups[Number(g) - 1] as string) ?? "";
			});
		});
	const fm = splitFrontmatter(content);
	let head = content.slice(0, content.length - fm.body.length);
	if (fm.has && o.includeFrontmatter) head = rep(head);
	const body = o.skipCode ? mapProse(fm.body, rep) : rep(fm.body);
	const next = head + body;
	if (count === 0) return { content, count: 0, snippets: [] };
	return { content: next, count, snippets: lineDiff(content, next, maxSnippets) };
}

export function lineDiff(a: string, b: string, max = 3): Snippet[] {
	const al = a.split(/\r?\n/);
	const bl = b.split(/\r?\n/);
	const out: Snippet[] = [];
	if (al.length === bl.length) {
		for (let i = 0; i < al.length && out.length < max; i++) if (al[i] !== bl[i]) out.push({ line: i + 1, before: al[i], after: bl[i] });
		return out;
	}
	// different line counts: report first differing region
	let i = 0;
	while (i < al.length && i < bl.length && al[i] === bl[i]) i++;
	let ea = al.length - 1;
	let eb = bl.length - 1;
	while (ea >= i && eb >= i && al[ea] === bl[eb]) {
		ea--;
		eb--;
	}
	out.push({ line: i + 1, before: al.slice(i, ea + 1).join("\n"), after: bl.slice(i, eb + 1).join("\n") });
	return out;
}
