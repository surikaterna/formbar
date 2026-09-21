import { type PlaygroundSources, SOURCE_KEYS, TOTAL_LIMIT_BYTES } from "./contracts";

const DRAFT_VERSION = 2;
const PREFIX = "formbar:playground:draft:v2:";

export interface StoredDraft {
	readonly version: typeof DRAFT_VERSION;
	readonly presetKey: string;
	/** Epoch milliseconds produced by Date.now(). */
	readonly savedAt: number;
	readonly sources: PlaygroundSources;
}

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export function draftKey(presetKey: string): string {
	return `${PREFIX}${presetKey}`;
}

function isSources(value: unknown): value is PlaygroundSources {
	if (typeof value !== "object" || value === null) return false;
	const source = value as Record<string, unknown>;
	if (Object.keys(source).length !== SOURCE_KEYS.length) return false;
	return SOURCE_KEYS.every((key) => typeof source[key] === "string");
}

function isSavedAt(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 && !Number.isNaN(new Date(value).getTime());
}

export function loadDraft(storage: StorageLike, presetKey: string): StoredDraft | null {
	try {
		const raw = storage.getItem(draftKey(presetKey));
		if (!raw || new Blob([raw]).size > TOTAL_LIMIT_BYTES) return null;
		const value = JSON.parse(raw) as Partial<StoredDraft>;
		if (
			value.version !== DRAFT_VERSION ||
			value.presetKey !== presetKey ||
			!isSavedAt(value.savedAt) ||
			!isSources(value.sources)
		)
			return null;
		return value as StoredDraft;
	} catch {
		return null;
	}
}

export function saveDraft(storage: StorageLike, presetKey: string, sources: PlaygroundSources): boolean {
	try {
		const draft: StoredDraft = { version: DRAFT_VERSION, presetKey, savedAt: Date.now(), sources };
		const serialized = JSON.stringify(draft);
		if (new Blob([serialized]).size > TOTAL_LIMIT_BYTES) return false;
		storage.setItem(draftKey(presetKey), serialized);
		return true;
	} catch {
		return false;
	}
}

export function discardDraft(storage: StorageLike, presetKey: string): boolean {
	try {
		storage.removeItem(draftKey(presetKey));
		return true;
	} catch {
		return false;
	}
}
