import { describe, expect, test, vi } from "vitest";
import { createIssueEmission, issueEmissionId } from "../issue-provenance.js";
import { scopedCaptureReceipt } from "../scoped-capture-receipt.js";
import type { FormStateCapture, ValidationIssue } from "../state.js";
import { FormStore, publishIssueOnly } from "../store.js";

function fixture(rows = 2) {
	const data = { rows: Array.from({ length: rows }, (_, value) => ({ nested: { value } })) };
	const uiState = { open: true };
	const store = new FormStore({
		data,
		uiState,
		meta: { validation: {}, stage: "edit" },
		fieldMeta: {},
		fieldPolicy: [],
		issues: [],
	});
	const capture: FormStateCapture<typeof data, typeof uiState> = {
		state: store.getState(),
		isFormDirty: () => false,
		isFieldDirty: () => false,
	};
	return { data, uiState, store, capture, current: scopedCaptureReceipt(capture) };
}

function issue(index: number): ValidationIssue {
	return createIssueEmission({
		fieldId: "row",
		instanceKey: `rows/${index}`,
		binding: { namespace: "data", segments: ["rows", index, "nested", "value"] },
		revision: 1,
		run: {},
		current: () => true,
	})({ code: "INVALID", message: "invalid", severity: "error" });
}

describe("private scoped capture ownership receipt", () => {
	async function settle(count: number) {
		const f = fixture(count);
		const original = f.store.getState();
		const notification = vi.fn();
		f.store.subscribe(notification);
		const results: ValidationIssue[] = [];
		let synchronous = 0;
		let construction = 0;
		let completion = 0;
		let maximum = 0;
		let counting = "construction";
		const ownKeys = Reflect.ownKeys;
		Reflect.ownKeys = (value) => {
			if (value === f.data.rows) {
				if (counting === "construction") construction++;
				else if (counting === "sync") synchronous++;
				else completion++;
			}
			return ownKeys(value);
		};
		try {
			// The witness is constructed once for the generation, not once per completion.
			const current = scopedCaptureReceipt(f.capture);
			counting = "sync";
			expect(current(f.store.getState())).toBe(true);
			counting = "completion";
			for (let index = 0; index < count; index++) {
				const prior = completion;
				await Promise.resolve();
				expect(current(f.store.getState())).toBe(true);
				results.push(issue(index));
				publishIssueOnly(f.store, results);
				expect(current(f.store.getState())).toBe(true);
				expect(f.store.getState().issues).toContain(results[index]);
				expect(notification).toHaveBeenCalledTimes(index + 1);
				maximum = Math.max(maximum, completion - prior);
			}
			expect(f.store.getState().data).not.toBe(original.data);
			expect(Object.isFrozen(original.data)).toBe(false);
			expect(f.store.getState().issues.map(issueEmissionId)).toHaveLength(count);
			console.info(
				`receipt rows=${count} sync=${synchronous} witness=${construction} completion=${completion} max=${maximum}`,
			);
			expect(synchronous).toBeLessThanOrEqual(10);
			expect(construction).toBe(1);
			expect(completion).toBeLessThanOrEqual(count * 3);
			expect(maximum).toBeLessThanOrEqual(12);
		} finally {
			Reflect.ownKeys = ownKeys;
		}
	}
	test.each([100, 300, 600])("accepts %i independent completions across one detachment", settle, 30_000);

	test("original external alias edits after detachment invalidate; copies have no certificate", () => {
		const f = fixture();
		const first = issue(0);
		publishIssueOnly(f.store, [first, { ...first }]);
		expect(f.current(f.store.getState())).toBe(true);
		expect(f.store.getState().issues[0]).toBe(first);
		expect(issueEmissionId(f.store.getState().issues[1] as ValidationIssue)).toBeUndefined();
		expect(issueEmissionId(JSON.parse(JSON.stringify(first)) as ValidationIssue)).toBeUndefined();
		const row = f.data.rows[1];
		if (!row) throw new Error("missing row");
		row.nested.value = 42;
		expect(f.current(f.store.getState())).toBe(false);
		const fresh = scopedCaptureReceipt({ ...f.capture, state: f.store.getState() });
		expect(fresh(f.store.getState())).toBe(true);
	});

	test("failed second publication and synchronous reentrant write revoke pending completions", () => {
		const f = fixture();
		publishIssueOnly(f.store, [issue(0)]);
		expect(f.current(f.store.getState())).toBe(true);
		const prior = f.store.getState();
		expect(() => publishIssueOnly(f.store, [{ ...issue(1), details: { bad: Symbol() } }])).toThrow(
			"ISSUE_ONLY_UNSUPPORTED_STATE",
		);
		expect(f.store.getState()).toBe(prior);
		expect(f.current(f.store.getState())).toBe(false);
		const fresh = scopedCaptureReceipt({ ...f.capture, state: f.store.getState() });
		let reentered = false;
		f.store.subscribe(() => {
			if (reentered) return;
			reentered = true;
			const tx = f.store.beginTransaction();
			tx.mutate((draft) => ({ ...draft, data: { rows: [] } }));
			f.store.commitTransaction(tx);
		});
		publishIssueOnly(f.store, [issue(1)]);
		expect(fresh(f.store.getState())).toBe(false);
	});

	function invalidation(kind: string) {
		const f = fixture();
		const original = f.store.getState();
		if (kind === "data") {
			const row = f.data.rows[1];
			if (!row) throw new Error("missing row");
			row.nested.value = 8;
		}
		if (kind === "ui") f.uiState.open = false;
		if (kind === "policy") (original.fieldPolicy as unknown[]).push({});
		if (kind === "stage") (original.meta as { stage: string }).stage = "review";
		if (kind === "write" || kind === "reset" || kind === "reentry") {
			const tx = f.store.beginTransaction();
			tx.mutate((draft) => ({ ...draft, data: { rows: [] } }));
			f.store.commitTransaction(tx);
		}
		if (kind === "failed") {
			expect(() => publishIssueOnly(f.store, [{ ...issue(0), details: { bad: Symbol() } }])).toThrow();
			expect(f.store.getState()).toBe(original);
			expect(f.current(f.store.getState())).toBe(false);
			return;
		}
		if (kind === "dispose") f.store.dispose();
		expect(f.current(f.store.getState())).toBe(false);
	}
	test.each(["data", "ui", "policy", "stage", "write", "reset", "failed", "reentry", "dispose"])(
		"invalidates on %s",
		invalidation,
	);
});
