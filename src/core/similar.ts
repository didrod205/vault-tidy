// Rule-based detection of tags that are probably the same thing
// (case, separators, simple plurals, one-letter typos). Free tier.

export interface TagCount {
	tag: string;
	count: number;
}

export interface MergeGroup {
	target: string;
	sources: string[];
	reason: string;
}

function key(t: string): string {
	return t
		.toLowerCase()
		.split("/")
		.map((seg) => seg.replace(/[-_\s.]+/g, ""))
		.join("/");
}

function singular(seg: string): string {
	if (seg.length > 4 && seg.endsWith("ies")) return seg.slice(0, -3) + "y";
	if (seg.length > 4 && /(ses|xes|zes|ches|shes)$/.test(seg)) return seg.slice(0, -2);
	if (seg.length > 3 && seg.endsWith("s") && !seg.endsWith("ss")) return seg.slice(0, -1);
	return seg;
}

function stem(t: string): string {
	return key(t)
		.split("/")
		.map(singular)
		.join("/");
}

function lev(a: string, b: string): number {
	if (Math.abs(a.length - b.length) > 1) return 2;
	const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) dp[0][j] = j;
	for (let i = 1; i <= a.length; i++)
		for (let j = 1; j <= b.length; j++)
			dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
	return dp[a.length][b.length];
}

/** Pick the most-used spelling as the target. */
function pickTarget(group: TagCount[], preferLonger = false): string {
	const lower = (t: string) => (t === t.toLowerCase() ? 1 : 0);
	const sep = (t: string) => (/[-_]/.test(t) ? 1 : 0);
	return [...group].sort(
		(x, y) =>
			y.count - x.count ||
			lower(y.tag) - lower(x.tag) ||
			sep(y.tag) - sep(x.tag) ||
			(preferLonger ? y.tag.length - x.tag.length : x.tag.length - y.tag.length) ||
			x.tag.localeCompare(y.tag),
	)[0].tag;
}

export function findSimilarTags(tags: TagCount[]): MergeGroup[] {
	const byStem = new Map<string, TagCount[]>();
	for (const t of tags) {
		const k = stem(t.tag);
		if (!byStem.has(k)) byStem.set(k, []);
		byStem.get(k)!.push(t);
	}
	const groups: MergeGroup[] = [];
	const used = new Set<string>();
	for (const g of byStem.values()) {
		if (g.length < 2) continue;
		const target = pickTarget(g);
		const sameCase = new Set(g.map((x) => x.tag.toLowerCase())).size === 1;
		groups.push({
			target,
			sources: g.map((x) => x.tag).filter((x) => x !== target),
			reason: sameCase ? "different capitalisation" : "same word, different spelling/plural",
		});
		g.forEach((x) => used.add(x.tag));
	}
	// typo pass on remaining single tags (length >= 5, distance 1, same parent path)
	const rest = tags.filter((t) => !used.has(t.tag) && t.tag.length >= 5);
	for (let i = 0; i < rest.length; i++) {
		if (used.has(rest[i].tag)) continue;
		const cluster = [rest[i]];
		for (let j = i + 1; j < rest.length; j++) {
			if (used.has(rest[j].tag)) continue;
			const a = stem(rest[i].tag);
			const b = stem(rest[j].tag);
			if (/^[0-9]/.test(a) || /\d/.test(a + b)) continue;
			if (lev(a, b) === 1) cluster.push(rest[j]);
		}
		if (cluster.length > 1) {
			const target = pickTarget(cluster, true);
			groups.push({ target, sources: cluster.map((x) => x.tag).filter((x) => x !== target), reason: "possible typo" });
			cluster.forEach((x) => used.add(x.tag));
		}
	}
	return groups;
}
