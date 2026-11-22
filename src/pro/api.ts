import { requestUrl } from "obsidian";

export const API_BASE = "https://vault-tidy-api.gdode2080.workers.dev";
export const BUY_URL = API_BASE + "/pro";

export interface License {
	key: string;
	instanceId: string;
	email?: string;
	status?: string;
	plan?: string;
	checkedAt?: number;
}

export class ProError extends Error {}

export async function activateLicense(key: string, instanceName: string): Promise<License> {
	const res = await requestUrl({
		url: API_BASE + "/v1/license/activate",
		method: "POST",
		contentType: "application/json",
		body: JSON.stringify({ key: key.trim(), instance_name: instanceName }),
		throw: false,
	});
	const j = res.json ?? {};
	if (res.status >= 400 || !j.instanceId) throw new ProError(j.error || `Activation failed (HTTP ${res.status})`);
	return { key: key.trim(), instanceId: j.instanceId, email: j.email, status: j.status, plan: j.plan, checkedAt: Date.now() };
}

export async function deactivateLicense(lic: License): Promise<void> {
	await requestUrl({
		url: API_BASE + "/v1/license/deactivate",
		method: "POST",
		contentType: "application/json",
		body: JSON.stringify({ key: lic.key, instanceId: lic.instanceId }),
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
