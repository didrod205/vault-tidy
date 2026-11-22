import { requestUrl } from "obsidian";

export const API_BASE = "https://vault-tidy-api.gdode2080.workers.dev";
export const LS_STORE_ID = 0; // filled in when the Lemon Squeezy product exists (0 = accept any, server still checks)
export const BUY_URL = "https://elabstudio.lemonsqueezy.com/buy/vault-tidy-pro";

export interface License {
	key: string;
	instanceId: string;
	email?: string;
	status?: string;
	checkedAt?: number;
}

export class ProError extends Error {}

function form(data: Record<string, string>): string {
	return Object.entries(data)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join("&");
}

export async function activateLicense(key: string, instanceName: string): Promise<License> {
	const res = await requestUrl({
		url: "https://api.lemonsqueezy.com/v1/licenses/activate",
		method: "POST",
		contentType: "application/x-www-form-urlencoded",
		headers: { Accept: "application/json" },
		body: form({ license_key: key.trim(), instance_name: instanceName }),
		throw: false,
	});
	const j = res.json ?? {};
	if (!j.activated) throw new ProError(j.error || `Activation failed (HTTP ${res.status})`);
	if (LS_STORE_ID && j.meta?.store_id !== LS_STORE_ID) throw new ProError("This key is not a Vault Tidy key.");
	return { key: key.trim(), instanceId: j.instance?.id, email: j.meta?.customer_email, status: j.license_key?.status, checkedAt: Date.now() };
}

export async function deactivateLicense(lic: License): Promise<void> {
	await requestUrl({
		url: "https://api.lemonsqueezy.com/v1/licenses/deactivate",
		method: "POST",
		contentType: "application/x-www-form-urlencoded",
		headers: { Accept: "application/json" },
		body: form({ license_key: lic.key, instance_id: lic.instanceId }),
		throw: false,
	});
}

async function call<T>(lic: License, path: string, body: unknown): Promise<T> {
	const res = await requestUrl({
		url: API_BASE + path,
		method: "POST",
		contentType: "application/json",
		headers: { "X-License-Key": lic.key, "X-Instance-Id": lic.instanceId },
		body: JSON.stringify(body),
		throw: false,
	});
	const j = res.json ?? {};
	if (res.status >= 400) throw new ProError(j.error || `Server error (HTTP ${res.status})`);
	return j as T;
}

export interface AiMergeGroup {
	target: string;
	sources: string[];
	reason: string;
}

export function aiTagMerges(lic: License, tags: { tag: string; count: number }[]) {
	return call<{ groups: AiMergeGroup[]; remaining?: number }>(lic, "/v1/tag-merges", { tags });
}

export interface AiTagSuggestion {
	path: string;
	tags: string[];
}

export function aiSuggestTags(lic: License, vocabulary: string[], notes: { path: string; title: string; text: string }[], allowNew: boolean) {
	return call<{ suggestions: AiTagSuggestion[]; remaining?: number }>(lic, "/v1/suggest-tags", { vocabulary, notes, allowNew });
}
