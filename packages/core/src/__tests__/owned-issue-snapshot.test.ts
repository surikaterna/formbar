import { describe, expect, test, vi } from "vitest";
import { createIssueEmission, issueEmissionId } from "../issue-provenance.js";
import type { ValidationIssue } from "../state.js";
import { FormStore, publishIssueOnly } from "../store.js";

function store(data: unknown = { rows: [{ value: 1 }] }, uiState: unknown = { open: true }) {
	return new FormStore({ data, uiState, meta: { validation: {} }, fieldMeta: {}, fieldPolicy: [], issues: [] });
}

function issue(): ValidationIssue {
	return createIssueEmission({
		fieldId: "field",
		instanceKey: "row",
		binding: { namespace: "data", segments: ["rows", 0] },
		revision: 0,
		run: {},
		current: () => true,
	})({ code: "INVALID", message: "invalid", severity: "error" });
}

describe("internal issue-only ownership", () => {
	test("detaches prior and transaction-supplied aliases exactly once per dirty epoch", () => {
		const data = { value: 1 };
		const s = store(data);
		const before = s.getState();
		const ownedIssue = issue();
		const listener = vi.fn();
		s.subscribe(listener);
		publishIssueOnly(s, [ownedIssue, ownedIssue]);
		const first = s.getState();
		expect(first.data).not.toBe(before.data);
		expect(first.uiState).not.toBe(before.uiState);
		expect(first.data).toEqual(data);
		expect(first.issues).toEqual([ownedIssue]);
		expect(first.issues[0]).toBe(ownedIssue);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(before)).toBe(false);
		expect(issueEmissionId(first.issues[0] as ValidationIssue)).toBeTypeOf("number");
		data.value = 2;
		expect(first.data).toEqual({ value: 1 });
		publishIssueOnly(s, []);
		expect(s.getState().data).toBe(first.data);
		const supplied = { value: 3 };
		const tx = s.beginTransaction();
		tx.mutate((draft) => ({ ...draft, data: supplied }));
		s.commitTransaction(tx);
		const previous = s.getState();
		publishIssueOnly(s, [ownedIssue]);
		expect(s.getState().data).not.toBe(previous.data);
		supplied.value = 4;
		expect(s.getState().data).toEqual({ value: 3 });
		expect(Object.isFrozen(supplied)).toBe(false);
		expect(listener).toHaveBeenCalledTimes(4);
	});

	test.each([
		{ name: "symbol child", make: () => ({ x: 1, [Symbol("hidden")]: { value: 1 } }) },
		{ name: "accessor", make: () => Object.defineProperty({}, "x", { get: () => 1, enumerable: true }) },
		{ name: "sparse", make: () => new Array(2) },
		{ name: "nonfinite", make: () => ({ x: Number.POSITIVE_INFINITY }) },
		{ name: "undefined", make: () => ({ x: undefined }) },
		{ name: "nonplain", make: () => new Date() },
		{ name: "unsafe", make: () => Object.defineProperty({}, "__proto__", { value: 1, enumerable: true }) },
		{ name: "hidden", make: () => Object.defineProperty({}, "x", { value: 1 }) },
		{
			name: "cycle",
			make: () => {
				const x: { self?: unknown } = {};
				x.self = x;
				return x;
			},
		},
		{
			name: "too deep",
			make: () => {
				let x: object = {};
				for (let i = 0; i < 70; i++) x = { x };
				return x;
			},
		},
	])("rejects $name atomically without freezing aliases", ({ make }) => {
		const data = make();
		const s = store(data);
		const before = s.getState();
		const listener = vi.fn();
		s.subscribe(listener);
		expect(() => publishIssueOnly(s, [])).toThrow("ISSUE_ONLY_UNSUPPORTED_STATE");
		expect(s.getState()).toBe(before);
		expect(listener).not.toHaveBeenCalled();
		expect(Object.isFrozen(data)).toBe(false);
	});

	test("symbol-keyed child cannot become a mutable published alias", () => {
		const hidden = Symbol("hidden");
		const data = { x: 1, [hidden]: { value: 1 } };
		const s = store(data);
		const before = s.getState();
		const listener = vi.fn();
		s.subscribe(listener);
		expect(() => publishIssueOnly(s, [])).toThrow("ISSUE_ONLY_UNSUPPORTED_STATE");
		expect(s.getState()).toBe(before);
		expect(Reflect.ownKeys(s.getState().data as object)).toContain(hidden);
		expect(Object.isFrozen(data)).toBe(false);
		expect(Object.isFrozen(data[hidden])).toBe(false);
		data[hidden].value = 9;
		expect((s.getState().data as typeof data)[hidden].value).toBe(9);
		expect(listener).not.toHaveBeenCalled();
	});

	test("rejects mutable and copied issues and custom strategy", () => {
		const s = store();
		const original = issue();
		const copied = { ...original };
		const before = s.getState();
		expect(() => publishIssueOnly(s, [copied])).toThrow("ISSUE_ONLY_UNSUPPORTED_STATE");
		expect(() => publishIssueOnly(s, [{ ...original, code: "OTHER" }])).toThrow("ISSUE_ONLY_UNSUPPORTED_STATE");
		expect(s.getState()).toBe(before);
		expect(Object.isFrozen(copied)).toBe(false);
		const custom = new FormStore(before, { clone: structuredClone, freeze: (value) => value });
		expect(() => publishIssueOnly(custom, [])).toThrow("ISSUE_ONLY_UNSUPPORTED_STATE");
	});

	test("ordinary issue transactions remain available without opt-in", () => {
		const s = store();
		const ordinary = { ...issue() };
		const tx = s.beginTransaction();
		tx.mutate((draft) => ({ ...draft, issues: [ordinary] }));
		s.commitTransaction(tx);
		expect(s.getState().issues[0]).toBe(ordinary);
		const before = s.getState();
		expect(() => publishIssueOnly(s, [])).toThrow("ISSUE_ONLY_UNSUPPORTED_STATE");
		expect(s.getState()).toBe(before);
		expect(Object.isFrozen(ordinary)).toBe(false);
	});

	test("failed attempt projection retains certified issue identity without aliasing metadata", () => {
		const retained = issue();
		const candidate = issue();
		const attempt = {
			submitId: "submit",
			revision: 1,
			status: "failed" as const,
			issues: [candidate],
			renderableIssues: [retained, candidate],
		};
		const s = new FormStore({ ...store().getState(), issues: [retained], attemptValidation: attempt });
		publishIssueOnly(s, [retained]);
		const current = s.getState().attemptValidation;
		expect(current?.issues[0]).toBe(candidate);
		expect(current?.renderableIssues).toEqual([retained, candidate]);
		attempt.submitId = "changed";
		attempt.issues.push(issue());
		expect(current?.submitId).toBe("submit");
		expect(current?.issues).toHaveLength(1);
		expect(Object.isFrozen(attempt)).toBe(false);
	});

	test("reentrant publication keeps latest state; rollback and no-op retain ownership", () => {
		const s = store();
		const snapshots: unknown[] = [];
		s.subscribe((state) => {
			snapshots.push(state);
			if (snapshots.length === 1) publishIssueOnly(s, [issue()]);
		});
		publishIssueOnly(s, []);
		expect(snapshots).toHaveLength(2);
		expect(s.getState()).toBe(snapshots[1]);
		const data = s.getState().data;
		const tx = s.beginTransaction();
		s.rollbackTransaction(tx);
		const noop = s.beginTransaction();
		s.commitTransaction(noop);
		publishIssueOnly(s, []);
		expect(s.getState().data).toBe(data);
		s.dispose();
		expect(() => publishIssueOnly(s, [])).toThrow("ISSUE_ONLY_UNSUPPORTED_STATE");
	});

	test("reset-like replacement requires a new ownership transition", () => {
		const s = store();
		publishIssueOnly(s, []);
		const old = s.getState();
		const tx = s.beginTransaction();
		tx.mutate(() => ({
			data: { rows: [] },
			uiState: { open: false },
			meta: { validation: {} },
			fieldMeta: {},
			fieldPolicy: [],
			issues: [],
		}));
		s.commitTransaction(tx);
		const reset = s.getState();
		publishIssueOnly(s, []);
		expect(s.getState().data).not.toBe(reset.data);
		expect(s.getState().data).not.toBe(old.data);
		expect(s.getState().uiState).toEqual({ open: false });
	});

	test("staggered completions publish promptly without rescanning data", async () => {
		vi.useFakeTimers();
		try {
			const rows = Array.from({ length: 100 }, (_, value) => ({ nested: { value } }));
			const s = store({ rows });
			const seen: number[] = [];
			s.subscribe((state) => seen.push(state.issues.length));
			const ownKeys = Reflect.ownKeys;
			let enumerations = 0;
			const spy = vi.spyOn(Reflect, "ownKeys").mockImplementation((value) => {
				if (value === rows) enumerations++;
				return ownKeys(value);
			});
			try {
				const issues = [issue(), issue(), issue()];
				for (let index = 0; index < issues.length; index++) {
					setTimeout(() => publishIssueOnly(s, issues.slice(0, index + 1)), index + 1);
				}
				for (let index = 0; index < issues.length; index++) {
					const previous = enumerations;
					await vi.advanceTimersByTimeAsync(1);
					expect(enumerations - previous).toBeLessThanOrEqual(2);
					expect(seen).toHaveLength(index + 1);
				}
				expect(seen).toEqual([1, 2, 3]);
			} finally {
				spy.mockRestore();
			}
		} finally {
			vi.useRealTimers();
		}
	});

	test.each([100, 300, 600])(
		"%i nested rows: bounded data enumeration across independent completions",
		async (size) => {
			vi.useFakeTimers();
			try {
				const rows = Array.from({ length: size }, (_, index) => ({ nested: { value: index } }));
				const s = store({ rows });
				const notifications = vi.fn();
				s.subscribe(notifications);
				const ownKeys = Reflect.ownKeys;
				let enumerations = 0;
				const spy = vi.spyOn(Reflect, "ownKeys").mockImplementation((value) => {
					if (value === rows) enumerations++;
					return ownKeys(value);
				});
				try {
					const issued = Array.from({ length: size }, () => issue());
					const before = s.getState();
					publishIssueOnly(s, []);
					const sync = enumerations;
					const owned = s.getState().data;
					for (let index = 0; index < size; index++) {
						setTimeout(() => publishIssueOnly(s, issued.slice(0, index + 1)), 0);
					}
					await vi.runAllTimersAsync();
					expect(sync).toBeLessThanOrEqual(10);
					expect(enumerations).toBeLessThanOrEqual(12);
					console.info(
						`#283 rows=${size} sync=${sync} all=${enumerations} notifications=${notifications.mock.calls.length}`,
					);
					expect(s.getState().data).toBe(owned);
					expect(owned).not.toBe(before.data);
					expect(notifications).toHaveBeenCalledTimes(size + 1);
				} finally {
					spy.mockRestore();
				}
			} finally {
				vi.useRealTimers();
			}
		},
	);
});
