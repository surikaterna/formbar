import { afterEach, describe, expect, test, vi } from "vitest";
import { createIssueEmission, issueEmissionId } from "../issue-provenance.js";
import type { FormState, ValidationIssue } from "../state.js";
import { FormStore, publishIssueOnly } from "../store.js";

function state(size = 1): FormState<{ groups: { rows: { value: number }[] }[] }, { open: boolean }> {
	return {
		data: { groups: [{ rows: Array.from({ length: size }, (_, value) => ({ value })) }] },
		uiState: { open: true },
		meta: { validation: {} },
		fieldMeta: {},
		fieldPolicy: [],
		issues: [],
	};
}

function issue(index: number): ValidationIssue {
	return {
		code: `row-${index}`,
		message: "invalid",
		severity: "error",
		path: { namespace: "data", segments: ["groups", 0, "rows", index, "value"] },
		source: { origin: "async-validator", validatorId: `validator-${index}` },
	};
}

describe("trusted issue-only publication", () => {
	test("shares sealed branches, preserves original certified issues and isolates caller mutation", () => {
		const store = new FormStore(state());
		const before = store.getState();
		const emitted = createIssueEmission({
			fieldId: "field",
			instanceKey: "row-0",
			binding: { namespace: "data", segments: ["groups", 0, "rows", 0, "value"] },
			revision: 1,
			run: {},
			current: () => true,
		})({ code: "certified", message: "error", severity: "error" });
		const ordinary = issue(1);
		const input = [emitted, ordinary];
		publishIssueOnly(store, input);
		const first = store.getState();
		expect(first.data).toBe(before.data);
		expect(first.uiState).toBe(before.uiState);
		expect(first.issues[0]).toBe(emitted);
		expect(issueEmissionId(first.issues[0] ?? ordinary)).toBe(issueEmissionId(emitted));
		expect(issueEmissionId({ ...emitted })).toBeUndefined();
		input.pop();
		expect(() => {
			(ordinary.source as { validatorId: string }).validatorId = "forged";
		}).toThrow();
		expect(() => {
			(first.data.groups[0]?.rows[0] as { value: number }).value = 8;
		}).toThrow();
		publishIssueOnly(store, [ordinary]);
		expect(first.issues).toEqual([emitted, ordinary]);
		expect(store.getState().issues).toEqual([ordinary]);
	});

	test("rejects active transactions, preserves rollback and allows reentrant writes after notification", () => {
		const store = new FormStore(state());
		const tx = store.beginTransaction();
		tx.mutate((draft) => ({ ...draft, uiState: { open: false } }));
		expect(() => publishIssueOnly(store, [issue(0)])).toThrow(/transaction is active/);
		store.rollbackTransaction(tx);
		const seen: FormState<unknown, unknown>[] = [];
		store.subscribe((snapshot) => {
			seen.push(snapshot);
			if (seen.length !== 1) return;
			const nested = store.beginTransaction();
			nested.mutate((draft) => ({ ...draft, uiState: { open: false } }));
			store.commitTransaction(nested);
		});
		publishIssueOnly(store, [issue(0)]);
		expect(seen).toHaveLength(2);
		expect(seen[0]?.uiState).toEqual({ open: true });
		expect(seen[1]?.uiState).toEqual({ open: false });
		expect(store.getState().issues).toHaveLength(1);
		store.dispose();
		publishIssueOnly(store, [issue(1)]);
		expect(store.getState().issues).toHaveLength(1);
	});

	test("normal transactions still clone the data graph after an issue-only commit", () => {
		const store = new FormStore(state());
		publishIssueOnly(store, [issue(0)]);
		const prior = store.getState();
		const tx = store.beginTransaction();
		(tx.draftState.data.groups[0]?.rows[0] as { value: number }).value = 10;
		tx.mutate((draft) => draft);
		store.commitTransaction(tx);
		expect(prior.data.groups[0]?.rows[0]?.value).toBe(0);
		expect(store.getState().data.groups[0]?.rows[0]?.value).toBe(10);
	});

	test("rejects mutable internals without publishing, then accepts a safe replacement", () => {
		const unsafe = state();
		const store = new FormStore({ ...unsafe, data: { groups: new Map() } });
		const notify = vi.fn();
		store.subscribe(notify);
		expect(() => publishIssueOnly(store, [issue(0)])).toThrow(/plain immutable-shareable/);
		expect(store.getState().issues).toHaveLength(0);
		expect(notify).not.toHaveBeenCalled();
		const tx = store.beginTransaction();
		tx.mutate((draft) => ({ ...draft, data: unsafe.data }));
		store.commitTransaction(tx);
		publishIssueOnly(store, [issue(0)]);
		expect(store.getState().issues).toHaveLength(1);
	});

	test("a normal reset invalidates sharing and the next publication seals the new data", () => {
		const store = new FormStore(state());
		publishIssueOnly(store, [issue(0)]);
		const prior = store.getState();
		const reset = store.beginTransaction();
		reset.mutate((draft) => ({ ...draft, data: state(2).data, issues: [] }));
		store.commitTransaction(reset);
		publishIssueOnly(store, [issue(1)]);
		expect(prior.data.groups[0]?.rows).toHaveLength(1);
		expect(prior.issues).toHaveLength(1);
		expect(store.getState().data.groups[0]?.rows).toHaveLength(2);
		expect(Object.isFrozen(store.getState().data.groups[0]?.rows)).toBe(true);
	});
});

afterEach(() => vi.useRealTimers());

for (const size of [100, 300, 600]) {
	test(`nested ${size} rows: fixture for independent issue completions avoids repeated data traversal`, async () => {
		vi.useFakeTimers();
		const store = new FormStore(state(size));
		const original = Reflect.ownKeys;
		let sync = 0;
		let total = 0;
		const notifications: number[] = [];
		store.subscribe((snapshot) => notifications.push(snapshot.issues.length));
		vi.spyOn(Reflect, "ownKeys").mockImplementation((value) => {
			if (Array.isArray(value) && value.length === size) total++;
			return original(value);
		});
		try {
			const tx = store.beginTransaction();
			tx.mutate((draft) => ({ ...draft, data: { groups: [{ rows: [...(draft.data.groups[0]?.rows ?? [])] }] } }));
			store.commitTransaction(tx);
			sync = total;
			const results = Array.from({ length: size }, (_, index) => issue(index));
			for (let index = 0; index < size; index++) {
				setTimeout(() => publishIssueOnly(store, results.slice(0, index + 1)), 0);
			}
			await vi.runAllTimersAsync();
			expect(notifications).toHaveLength(size + 1);
			expect(notifications.slice(1)).toEqual(Array.from({ length: size }, (_, i) => i + 1));
			expect(new Set(store.getState().issues)).toEqual(new Set(results));
			expect(sync).toBeLessThanOrEqual(10);
			expect(total).toBeLessThanOrEqual(12);
			console.info(`#283 rows=${size} synchronous=${sync} total=${total} completions=${size}`);
		} finally {
			vi.restoreAllMocks();
			store.dispose();
		}
	});
}

test("late staggered issue resolutions traverse no rows per completion after initial sealing", () => {
	const size = 100;
	const store = new FormStore(state(size));
	const original = Reflect.ownKeys;
	let traversals = 0;
	vi.spyOn(Reflect, "ownKeys").mockImplementation((value) => {
		if (Array.isArray(value) && value.length === size) traversals++;
		return original(value);
	});
	try {
		for (let index = 0; index < size; index++) {
			const before = traversals;
			publishIssueOnly(store, [issue(index)]);
			expect(traversals - before).toBeLessThanOrEqual(2);
			expect(store.getState().issues[0]?.code).toBe(`row-${index}`);
		}
		expect(traversals).toBeLessThanOrEqual(12);
	} finally {
		vi.restoreAllMocks();
		store.dispose();
	}
});
