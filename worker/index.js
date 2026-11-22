// Vault Tidy Pro API (Cloudflare Worker + Workers AI)
// Endpoints: POST /v1/tag-merges, POST /v1/suggest-tags, GET /health
// Auth: X-License-Key + X-Instance-Id, validated against Lemon Squeezy (cached 1h).

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const DAILY_LIMIT = 150;
const TAG_RE = /^[^\s!"#$%&'()*+,.:;<=>?@\[\]\\^`{|}~]+$/u;

const SOON_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vault Tidy Pro</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#1e1e1e;color:#dcddde;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.c{max-width:520px;padding:32px}h1{color:#fff;margin:0 0 8px}a{color:#a88bfa}img{max-width:100%;border-radius:10px;margin-top:20px;border:1px solid #333}</style></head>
<body><div class="c"><h1>Vault Tidy Pro</h1><p>AI tools for the Vault Tidy Obsidian plugin: find synonym and duplicate tags, and tag untagged notes. No API key needed.</p>
<p><b>Checkout is opening very soon</b> ($4/month or $29/year). Everything else in Vault Tidy is free. Follow the <a href="https://github.com/didrod205/vault-tidy">GitHub repo</a> to get notified.</p>
<img src="/img/pro-ai.png" alt="Vault Tidy Pro"></div></body></html>`;

const json = (data, status = 200) =>
	new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });

async function sha(s) {
	const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
	return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function validateLicense(env, key, instance) {
	if (!key || !instance) return { ok: false, error: "Missing license. Activate Vault Tidy Pro in the plugin settings." };
	if (env.DEV_KEY && key === env.DEV_KEY) return { ok: true, id: "dev" };
	const id = await sha(key + ":" + instance);
	const cacheKey = new Request(`https://cache.vault-tidy/lic/${id}`);
	const cache = caches.default;
	const hit = await cache.match(cacheKey);
	if (hit) return { ...(await hit.json()), id };
	const r = await fetch("https://api.lemonsqueezy.com/v1/licenses/validate", {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
		body: `license_key=${encodeURIComponent(key)}&instance_id=${encodeURIComponent(instance)}`,
	});
	const j = await r.json().catch(() => ({}));
	let res;
	if (!j.valid) res = { ok: false, error: "License is not valid or has expired." };
	else if (j.license_key?.test_mode && !String(env.TEST_KEYS ?? "").split(",").includes(key)) res = { ok: false, error: "This is a test-mode key and cannot be used." };
	else if (env.LS_STORE_ID && String(j.meta?.store_id) !== String(env.LS_STORE_ID)) res = { ok: false, error: "This key is not a Vault Tidy key." };
	else if (env.LS_PRODUCT_ID && String(j.meta?.product_id) !== String(env.LS_PRODUCT_ID)) res = { ok: false, error: "This key is not a Vault Tidy key." };
	else res = { ok: true };
	await cache.put(cacheKey, new Response(JSON.stringify(res), { headers: { "cache-control": `max-age=${res.ok ? 3600 : 300}` } }));
	return { ...res, id };
}

async function useQuota(env, id) {
	if (!env.QUOTA) return { ok: true, remaining: DAILY_LIMIT };
	const day = new Date().toISOString().slice(0, 10);
	const k = `q:${id}:${day}`;
	const n = Number((await env.QUOTA.get(k)) ?? 0);
	if (n >= DAILY_LIMIT) return { ok: false, remaining: 0 };
	await env.QUOTA.put(k, String(n + 1), { expirationTtl: 60 * 60 * 30 });
	return { ok: true, remaining: DAILY_LIMIT - n - 1 };
}

async function ask(env, system, user, schema) {
	const out = await env.AI.run(MODEL, {
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
		max_tokens: 2500,
		temperature: 0.1,
		response_format: { type: "json_schema", json_schema: schema },
	});
	const r = out?.response;
	if (r && typeof r === "object") return r;
	const s = String(r ?? "");
	const m = s.match(/\{[\s\S]*\}/);
	return m ? JSON.parse(m[0]) : {};
}

const MERGE_SCHEMA = {
	type: "object",
	properties: {
		groups: {
			type: "array",
			items: {
				type: "object",
				properties: { target: { type: "string" }, sources: { type: "array", items: { type: "string" } }, reason: { type: "string" } },
				required: ["target", "sources", "reason"],
			},
		},
	},
	required: ["groups"],
};

async function tagMerges(env, body) {
	const tags = (Array.isArray(body.tags) ? body.tags : [])
		.filter((t) => t && typeof t.tag === "string" && TAG_RE.test(t.tag))
		.sort((a, b) => (b.count || 0) - (a.count || 0))
		.slice(0, 1200);
	if (tags.length < 2) return { groups: [] };
	const exact = new Set(tags.map((t) => t.tag));
	const variants = new Map();
	for (const t of tags) {
		const k = t.tag.toLowerCase();
		if (!variants.has(k)) variants.set(k, []);
		variants.get(k).push(t.tag);
	}
	const countOf = new Map(tags.map((t) => [t.tag, t.count || 0]));
	const resolve = (name) => {
		const n = String(name ?? "").replace(/^#/, "").trim();
		if (exact.has(n)) return n;
		const v = variants.get(n.toLowerCase());
		return v ? [...v].sort((a, b) => countOf.get(b) - countOf.get(a))[0] : null;
	};
	const system =
		"You clean up tag systems in personal knowledge bases. Group tags that mean the SAME thing: synonyms, abbreviations (ml = machine-learning), translations (책 = book), singular/plural, spelling variants and typos. " +
		"Merge only if a person would use the tags interchangeably for exactly the same notes, so replacing one with the other loses no meaning. " +
		"Do NOT group tags that are merely related or overlapping: python vs javascript, book vs reading, book vs to-read, web-design vs ux, ai vs machine-learning, project vs projects/alpha, health vs fitness are all DIFFERENT. Nested tags (a/b) are only grouped with tags that mean exactly the same full path. " +
		"For each group, target must be one of the tags in the input, normally the most used or clearest spelling. Every tag appears in at most one group. " +
		'Answer only JSON: {"groups":[{"target":"...","sources":["..."],"reason":"short reason"}]}';
	const user = "Tags with usage counts:\n" + tags.map((t) => `${t.tag} (${t.count || 0})`).join("\n");
	const res = await ask(env, system, user, MERGE_SCHEMA);

	// candidates: expand every mentioned tag to all its case variants
	const used = new Set();
	const cands = [];
	for (const g of res.groups ?? []) {
		const target = resolve(g.target);
		if (!target || used.has(target.toLowerCase())) continue;
		const srcs = new Set(variants.get(target.toLowerCase()).filter((x) => x !== target));
		for (const s of g.sources ?? []) {
			const r = resolve(s);
			if (!r || used.has(r.toLowerCase())) continue;
			variants.get(r.toLowerCase()).forEach((x) => x !== target && srcs.add(x));
		}
		if (!srcs.size) continue;
		used.add(target.toLowerCase());
		srcs.forEach((x) => used.add(x.toLowerCase()));
		cands.push({ target, sources: [...srcs], reason: String(g.reason ?? "").slice(0, 80) });
	}
	// also add pure case-variant groups the model skipped
	for (const [k, v] of variants) {
		if (v.length > 1 && !used.has(k)) {
			const target = [...v].sort((a, b) => countOf.get(b) - countOf.get(a) || (a === a.toLowerCase() ? -1 : 1))[0];
			cands.push({ target, sources: v.filter((x) => x !== target), reason: "different capitalisation" });
			used.add(k);
		}
	}
	// second pass: verify each (target, source) pair; trivial pairs are auto-accepted
	const norm = (t) => t.toLowerCase().replace(/[-_\s.]/g, "").replace(/(ies)$/, "y").replace(/(?<!s)s$/, "");
	const pairs = [];
	cands.forEach((g, gi) => g.sources.forEach((src) => pairs.push({ gi, src, target: g.target, auto: norm(src) === norm(g.target) })));
	const ask2 = pairs.filter((p) => !p.auto);
	let okIds = new Set();
	if (ask2.length) {
		const vsys =
			"You verify proposed tag merges. For each pair answer same=true ONLY if the two tags mean exactly the same thing, so a note tagged with one would always deserve the other (synonym, abbreviation, translation, plural, spelling or typo). " +
			"Related, broader, narrower or overlapping topics are NOT the same (web-design vs ux: false; ai vs machine-learning: false; book vs to-read: false; ml vs machine-learning: true; 책 vs book: true; 독서 vs reading: true; 독서 vs book: false). " +
			'Answer only JSON: {"results":[{"id":0,"same":true}]}';
		const vuser = ask2.map((p, i) => `${i}: ${p.target} | ${p.src}`).join("\n");
		const v = await ask(env, vsys, vuser, {
			type: "object",
			properties: { results: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, same: { type: "boolean" } }, required: ["id", "same"] } } },
			required: ["results"],
		});
		okIds = new Set((v.results ?? []).filter((r) => r.same === true).map((r) => Number(r.id)));
	}
	const keep = new Set(pairs.filter((p) => p.auto || okIds.has(ask2.indexOf(p))).map((p) => p.gi + "|" + p.src));
	let groups = cands
		.map((g, gi) => ({ ...g, sources: g.sources.filter((s) => keep.has(gi + "|" + s)) }))
		.filter((g) => g.sources.length);
	used.clear();
	groups.forEach((g) => [g.target, ...g.sources].forEach((x) => used.add(x.toLowerCase())));
	// rule-based groups (plural/separator/case) for tags the model skipped
	const normKey = (t) => t.toLowerCase().replace(/[-_\s.]/g, "").replace(/ies$/, "y").replace(/(?<!s)s$/, "");
	const byNorm = new Map();
	for (const t of tags) {
		if (used.has(t.tag.toLowerCase())) continue;
		const k = normKey(t.tag);
		if (!byNorm.has(k)) byNorm.set(k, []);
		byNorm.get(k).push(t.tag);
	}
	for (const v of byNorm.values()) {
		if (v.length < 2) continue;
		const target = [...v].sort((a, b) => countOf.get(b) - countOf.get(a) || (a === a.toLowerCase() ? -1 : 1) || a.length - b.length)[0];
		groups.push({ target, sources: v.filter((x) => x !== target), reason: "same word, different spelling" });
		v.forEach((x) => used.add(x.toLowerCase()));
	}
	return body.debug ? { groups, debug: { first: res, cands } } : { groups };
}

const SUGGEST_SCHEMA = {
	type: "object",
	properties: {
		suggestions: {
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "integer" },
					tags: { type: "array", items: { type: "object", properties: { tag: { type: "string" }, confidence: { type: "number" } }, required: ["tag", "confidence"] } },
				},
				required: ["id", "tags"],
			},
		},
	},
	required: ["suggestions"],
};

async function suggestTags(env, body) {
	const vocab = (Array.isArray(body.vocabulary) ? body.vocabulary : []).filter((t) => typeof t === "string" && TAG_RE.test(t)).slice(0, 400);
	const notes = (Array.isArray(body.notes) ? body.notes : []).slice(0, 20).map((n) => ({
		path: String(n.path ?? ""),
		title: String(n.title ?? "").slice(0, 120),
		text: String(n.text ?? "").slice(0, 1500),
	}));
	const allowNew = !!body.allowNew || vocab.length < 5;
	if (!notes.length) return { suggestions: [] };
	const vLower = new Map(vocab.map((t) => [t.toLowerCase(), t]));
	const system =
		"You tag notes in a personal knowledge base. For each note choose up to 3 tags that describe what the note is ABOUT. A tag fits only if the note is clearly about that topic; never use a tag just because nothing else fits (do not tag a workout plan #daily). Give each tag a confidence 0..1. " +
		(allowNew
			? "Use existing vocabulary tags when they truly fit. When no existing tag fits a clear topic, create 1-2 new tags for it: short, lowercase, words joined with '-', same language as the note (e.g. a workout plan -> fitness, a ramen recipe -> recipe, cooking). Every note with a clear topic should get at least one tag."
			: "Use ONLY tags from the existing vocabulary, spelled exactly. If nothing fits, return an empty list.") +
		' Answer only JSON: {"suggestions":[{"id":0,"tags":[{"tag":"...","confidence":0.9}]}]}';
	const user =
		`Existing vocabulary: ${vocab.join(", ") || "(none)"}\n\n` + notes.map((n, i) => `### Note ${i}\nTitle: ${n.title}\n${n.text}`).join("\n\n");
	const res = await ask(env, system, user, SUGGEST_SCHEMA);
	const out = [];
	for (const s of res.suggestions ?? []) {
		const n = notes[Number(s.id)];
		if (!n) continue;
		const tags = [];
		for (const raw of s.tags ?? []) {
			if (raw && typeof raw === "object" && typeof raw.confidence === "number" && raw.confidence < 0.75) continue;
			const t = String(raw && typeof raw === "object" ? raw.tag : raw).replace(/^#/, "").trim();
			const known = vLower.get(t.toLowerCase());
			if (known) tags.push(known);
			else if (allowNew && TAG_RE.test(t) && t.length <= 40) tags.push(t.toLowerCase());
		}
		out.push({ path: n.path, tags: [...new Set(tags)].slice(0, 3) });
	}
	return { suggestions: out };
}

// Provider-agnostic licensing: the plugin only talks to this API, so the payment
// provider can change later without a plugin update.
async function lsCall(path, data) {
	const r = await fetch(`https://api.lemonsqueezy.com/v1/licenses/${path}`, {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
		body: Object.entries(data)
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
			.join("&"),
	});
	return r.json().catch(() => ({}));
}

async function activate(env, b) {
	const key = String(b.key ?? "").trim();
	const name = String(b.instance_name ?? "obsidian").slice(0, 100);
	if (!key) return json({ error: "Enter a license key." }, 400);
	const j = await lsCall("activate", { license_key: key, instance_name: name });
	if (!j.activated) return json({ error: j.error || j.message || "Activation failed." }, 400);
	if (j.license_key?.test_mode && !String(env.TEST_KEYS ?? "").split(",").includes(key)) {
		await lsCall("deactivate", { license_key: key, instance_id: j.instance?.id });
		return json({ error: "This is a test-mode key and cannot be used." }, 400);
	}
	if (env.LS_STORE_ID && String(j.meta?.store_id) !== String(env.LS_STORE_ID)) {
		await lsCall("deactivate", { license_key: key, instance_id: j.instance?.id });
		return json({ error: "This key is not a Vault Tidy key." }, 400);
	}
	return json({ instanceId: j.instance?.id, email: j.meta?.customer_email, status: j.license_key?.status, plan: j.meta?.variant_name });
}

async function deactivate(env, b) {
	const j = await lsCall("deactivate", { license_key: String(b.key ?? ""), instance_id: String(b.instanceId ?? "") });
	return json({ ok: !!j.deactivated });
}

export default {
	async fetch(req, env) {
		const url = new URL(req.url);
		if (req.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST" } });
		if (url.pathname === "/health") return json({ ok: true });
		if (url.pathname === "/pro") {
			if (env.BUY_URL) return Response.redirect(env.BUY_URL, 302);
			return new Response(SOON_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
		}
		if (req.method !== "POST") return json({ error: "Not found" }, 404);
		if (url.pathname === "/v1/license/activate" || url.pathname === "/v1/license/deactivate") {
			let b;
			try {
				b = await req.json();
			} catch {
				return json({ error: "Bad request" }, 400);
			}
			return url.pathname.endsWith("activate") && !url.pathname.endsWith("deactivate") ? activate(env, b) : deactivate(env, b);
		}
		const lic = await validateLicense(env, req.headers.get("x-license-key"), req.headers.get("x-instance-id"));
		if (!lic.ok) return json({ error: lic.error }, 401);
		const q = await useQuota(env, lic.id);
		if (!q.ok) return json({ error: "Daily AI limit reached. It resets at midnight UTC." }, 429);
		let body;
		try {
			body = await req.json();
		} catch {
			return json({ error: "Bad request" }, 400);
		}
		if (lic.id !== "dev") delete body.debug;
		try {
			if (url.pathname === "/v1/tag-merges") return json({ ...(await tagMerges(env, body)), remaining: q.remaining });
			if (url.pathname === "/v1/suggest-tags") return json({ ...(await suggestTags(env, body)), remaining: q.remaining });
		} catch (e) {
			console.error(e);
			return json({ error: "The AI service is busy. Please try again in a minute." }, 503);
		}
		return json({ error: "Not found" }, 404);
	},
};
