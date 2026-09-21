import { describe, expect, it } from "vitest";
import { SOURCE_KEYS, TOTAL_LIMIT_BYTES } from "../playground/contracts";
import { type StorageLike, discardDraft, draftKey, legacyDraftKey, loadDraft, saveDraft } from "../playground/storage";

const sources = { schema: "{}", definition: "null", initialData: "{}" };

class MemoryStorage implements StorageLike {
	readonly values = new Map<string, string>();
	getItem(key: string) {
		return this.values.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.values.set(key, value);
	}
	removeItem(key: string) {
		this.values.delete(key);
	}
}

describe("playground storage", () => {
	it("round-trips drafts only for the matching version and preset", () => {
		const storage = new MemoryStorage();
		expect(saveDraft(storage, "one", sources)).toBe(true);
		const draft = loadDraft(storage, "one");
		expect(draft?.sources).toEqual(sources);
		expect(Number.isFinite(draft?.savedAt ?? Number.NaN)).toBe(true);
		expect(loadDraft(storage, "two")).toBeNull();
		storage.values.set(draftKey("one"), JSON.stringify({ version: 1, presetKey: "one", sources }));
		expect(loadDraft(storage, "one")).toBeNull();
		expect(storage.values.has(draftKey("one"))).toBe(false);
	});

	it("clears legacy layout drafts without translating them and still loads v2", () => {
		const storage = new MemoryStorage();
		storage.values.set(
			legacyDraftKey("one"),
			JSON.stringify({ version: 1, presetKey: "one", layout: {}, sources: { schema: "{}", layout: "null" } }),
		);
		expect(saveDraft(storage, "one", sources)).toBe(true);
		expect(loadDraft(storage, "one")?.sources).toEqual(sources);
		expect(storage.values.has(legacyDraftKey("one"))).toBe(false);
	});

	it.each([
		["missing savedAt", undefined],
		["null savedAt", null],
		["string savedAt", new Date().toISOString()],
		["negative savedAt", -1],
		["out-of-range savedAt", 9_000_000_000_000_000],
	])("rejects draft metadata with %s", (_label, savedAt) => {
		const storage = new MemoryStorage();
		storage.values.set(draftKey("one"), JSON.stringify({ version: 2, presetKey: "one", savedAt, sources }));
		expect(loadDraft(storage, "one")).toBeNull();
	});

	it.each([
		["missing version", { presetKey: "one", savedAt: Date.now(), sources }],
		["missing preset key", { version: 2, savedAt: Date.now(), sources }],
		["mismatched preset key", { version: 2, presetKey: "two", savedAt: Date.now(), sources }],
		["missing sources", { version: 2, presetKey: "one", savedAt: Date.now() }],
	])("rejects drafts with %s metadata", (_label, draft) => {
		const storage = new MemoryStorage();
		storage.values.set(draftKey("one"), JSON.stringify(draft));
		expect(loadDraft(storage, "one")).toBeNull();
	});

	it("uses the authoritative source keys and rejects missing or extra source entries", () => {
		expect(SOURCE_KEYS).toEqual(["schema", "definition", "initialData"]);
		const storage = new MemoryStorage();
		const metadata = { version: 2, presetKey: "one", savedAt: Date.now() };
		const { definition: _definition, ...missing } = sources;
		storage.values.set(draftKey("one"), JSON.stringify({ ...metadata, sources: missing }));
		expect(loadDraft(storage, "one")).toBeNull();
		storage.values.set(draftKey("one"), JSON.stringify({ ...metadata, sources: { ...sources, extra: "{}" } }));
		expect(loadDraft(storage, "one")).toBeNull();
	});

	it("guards corrupt and oversized storage", () => {
		const storage = new MemoryStorage();
		storage.values.set(draftKey("one"), "not-json");
		expect(loadDraft(storage, "one")).toBeNull();
		storage.values.set(draftKey("one"), "x".repeat(TOTAL_LIMIT_BYTES + 1));
		expect(loadDraft(storage, "one")).toBeNull();
		expect(saveDraft(storage, "one", { ...sources, schema: "x".repeat(TOTAL_LIMIT_BYTES) })).toBe(false);
	});

	it("contains quota and access exceptions for load, save, and discard", () => {
		const broken: StorageLike = {
			getItem: () => {
				throw new Error("denied");
			},
			setItem: () => {
				throw new Error("quota");
			},
			removeItem: () => {
				throw new Error("denied");
			},
		};
		expect(loadDraft(broken, "one")).toBeNull();
		expect(saveDraft(broken, "one", sources)).toBe(false);
		expect(discardDraft(broken, "one")).toBe(false);
	});
});
