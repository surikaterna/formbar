import { expect, test, vi } from "vitest";
import { createForm } from "../create-form.js";
import { createIssueEmission, issueEmissionId } from "../issue-provenance.js";
import type { ValidationIssue } from "../state.js";
import { replaceOwnedAsyncIssues } from "../store-async-issues.js";
import { FormStore, publishIssueOnly, publishValidationStatus, snapshotOwnership } from "../store.js";
import { createValidationCoordinator } from "../validation-coordinator.js";

test("full-draft owned async validation retains both certified originals after validating settles", async () => {
	const originals: ValidationIssue[] = [];
	const validators = [0, 1].map((index) => ({
		id: `row${index}`,
		fields: [`groups.0.rows.${index}.value`],
		validate: async () => {
			const emit = createIssueEmission({
				fieldId: `row${index}`,
				instanceKey: `groups/0/rows/${index}`,
				binding: { namespace: "data" as const, segments: ["groups", 0, "rows", index, "value"] },
				revision: 1,
				run: {},
				current: () => true,
			});
			const original = emit({ code: "INVALID", message: "invalid", severity: "error" });
			originals.push(original);
			return [original];
		},
	}));
	const form = createForm({
		initialData: { groups: [{ rows: [{ value: 0 }, { value: 1 }] }] },
		ownedScheduling: true,
		asyncValidators: validators,
	});
	const notice = vi.fn();
	form.subscribe(notice);
	const result = await form.validateAsync();
	expect(result.status).toBe("completed");
	expect(result.issues).toEqual(originals);
	expect(result.issues[0]).toBe(originals[0]);
	expect(result.issues[1]).toBe(originals[1]);
	expect(form.getState().issues).toEqual(originals);
	expect(form.getState().meta.validation.validating).toBe(false);
	expect(form.getState().issues.map(issueEmissionId)).toEqual(originals.map(issueEmissionId));
	expect(
		form
			.getState()
			.issues.map(issueEmissionId)
			.every((id) => id !== undefined),
	).toBe(true);
	expect(notice).toHaveBeenCalledTimes(3);
	form.dispose();
});

test("foreground started during validating:false supersedes the completed publication without replacing newer issues", async () => {
	const originals: ValidationIssue[] = [];
	let calls = 0;
	let finishSecond!: (issues: readonly ValidationIssue[]) => void;
	const secondIssues = new Promise<readonly ValidationIssue[]>((resolve) => {
		finishSecond = resolve;
	});
	const emit = (code: string) =>
		createIssueEmission({
			fieldId: "value",
			instanceKey: "value/0",
			binding: { namespace: "data", segments: ["value"] },
			revision: 1,
			run: {},
			current: () => true,
		})({ code, message: code, severity: "error" });
	const form = createForm({
		initialData: { value: 0 },
		ownedScheduling: true,
		asyncValidators: [
			{
				id: "value",
				fields: ["value"],
				validate: async () => {
					calls++;
					if (calls === 2) return secondIssues;
					const original = emit("FIRST");
					originals.push(original);
					return [original];
				},
			},
		],
	});
	let newer: ReturnType<typeof form.validateAsync> | undefined;
	const notices = vi.fn();
	form.subscribe((state) => {
		notices(state);
		if (!state.meta.validation.validating && !newer) newer = form.validateAsync();
	});
	const first = form.validateAsync();
	expect(await first).toEqual({ status: "superseded", issues: [] });
	expect(originals).toHaveLength(1);
	expect(form.getState().issues[0]).toBe(originals[0]);
	expect(issueEmissionId(originals[0] as ValidationIssue)).toBeDefined();
	expect(newer).toBeDefined();
	expect(form.getState().meta.validation.validating).toBe(true);
	const second = emit("SECOND");
	finishSecond([second]);
	expect(await newer).toEqual({ status: "completed", issues: [second] });
	expect(form.getState().issues).toEqual([second]);
	expect(form.getState().issues[0]).toBe(second);
	expect(form.getState().meta.validation.validating).toBe(false);
	expect(calls).toBe(2);
	expect(notices).toHaveBeenCalledTimes(6);
	form.dispose();
});

test("candidate validation settles flags without replacing retained certified draft issues", async () => {
	const store = new FormStore(
		{
			data: { value: 1 },
			uiState: {},
			meta: { validation: { validating: false } },
			fieldMeta: {},
			fieldPolicy: [],
			issues: [],
		},
		undefined,
		true,
	);
	const emit = createIssueEmission({
		fieldId: "row",
		instanceKey: "row/0",
		binding: { namespace: "data", segments: ["value"] },
		revision: 1,
		run: {},
		current: () => true,
	});
	const original = emit({ code: "RETAINED", message: "retained", severity: "error" });
	publishIssueOnly(store, [original]);
	const baseline = snapshotOwnership(store.getState());
	const notifications = vi.fn();
	store.subscribe(notifications);
	const coordinator = createValidationCoordinator({
		validators: [{ id: "candidate", fields: ["value"], validate: async () => [] }],
		getState: () => store.getState(),
		updateState: () => {
			throw new Error("unexpected generic update");
		},
		publishValidationStatus: (paths, validating) => publishValidationStatus(store, paths, validating),
		replaceAsyncIssues: (ids, issues) => replaceOwnedAsyncIssues(store, ids, issues),
	});
	const result = await coordinator.validateCandidate({ data: { value: 1 }, uiState: {} }, 0);
	expect(result).toEqual({ status: "completed", issues: [] });
	expect(store.getState().issues[0]).toBe(original);
	expect(issueEmissionId(store.getState().issues[0] as ValidationIssue)).toBeDefined();
	expect(store.getState().meta.validation.validating).toBe(false);
	expect(snapshotOwnership(store.getState())).toMatchObject({ write: baseline?.write, epoch: baseline?.epoch });
	expect(notifications).toHaveBeenCalledTimes(2);
	coordinator.dispose();
});

test.each(["validating", "issues"])(
	"reentrant data edit during %s notification supersedes owned foreground",
	async (phase) => {
		const form = createForm({
			initialData: { value: 0 },
			ownedScheduling: true,
			asyncValidators: [
				{
					id: "row",
					fields: ["value"],
					validate: async () => [
						{
							code: "INVALID",
							message: "invalid",
							severity: "error",
							path: { namespace: "data", segments: ["value"] },
							source: { origin: "async-validator", validatorId: "row" },
						},
					],
				},
			],
		});
		let changed = false;
		form.subscribe((state) => {
			if (changed || (phase === "validating" ? !state.meta.validation.validating : state.issues.length === 0)) return;
			changed = true;
			form.setValue("value", 1);
		});
		const outcome = await form.validateAsync();
		expect(changed).toBe(true);
		expect(outcome.status).not.toBe("completed");
		form.dispose();
	},
);

test("reset from an owned issue notification cannot return stale completed originals", async () => {
	const form = createForm({
		initialData: { value: 0 },
		ownedScheduling: true,
		asyncValidators: [
			{
				id: "row",
				fields: ["value"],
				validate: async () => [
					{
						code: "INVALID",
						message: "invalid",
						severity: "error",
						path: { namespace: "data", segments: ["value"] },
						source: { origin: "async-validator", validatorId: "row" },
					},
				],
			},
		],
	});
	let resets = 0;
	form.subscribe((state) => {
		if (!state.issues.length || resets) return;
		resets++;
		form.reset();
	});
	const result = await form.validateAsync();
	expect(resets).toBe(1);
	expect(result.status).not.toBe("completed");
	expect(form.getState().issues).toHaveLength(0);
	form.dispose();
});

test("sibling owned blur paths each settle one independently certified issue", async () => {
	vi.useFakeTimers();
	try {
		const emitted: ValidationIssue[] = [];
		const calls = [0, 0];
		const form = createForm({
			initialData: { groups: [{ rows: [{ value: 0 }, { value: 1 }] }] },
			ownedScheduling: true,
			asyncValidators: [0, 1].map((index) => ({
				id: `row${index}`,
				fields: [`groups.0.rows.${index}.value`],
				trigger: "onBlur" as const,
				debounceMs: 0,
				validate: async () => {
					calls[index] = (calls[index] ?? 0) + 1;
					const original = createIssueEmission({
						fieldId: `row${index}`,
						instanceKey: `groups/0/rows/${index}`,
						binding: { namespace: "data", segments: ["groups", 0, "rows", index, "value"] },
						revision: 1,
						run: {},
						current: () => true,
					})({ code: "INVALID", message: "invalid", severity: "error" });
					emitted.push(original);
					return [original];
				},
			})),
		});
		form.field("groups.0.rows.0.value").markTouched();
		form.field("groups.0.rows.1.value").markTouched();
		await vi.runAllTimersAsync();
		expect(calls).toEqual([1, 1]);
		expect(form.getState().issues).toHaveLength(2);
		expect(form.getState().issues).toEqual(emitted);
		expect(
			form
				.getState()
				.issues.map(issueEmissionId)
				.every((id) => id !== undefined),
		).toBe(true);
		form.dispose();
	} finally {
		vi.useRealTimers();
	}
});

test.each(["stage", "policy", "data", "ui"])("pending owned foreground rejects accepted %s write", async (kind) => {
	const store = new FormStore(
		{
			data: { rows: [{ value: 0 }] },
			uiState: { open: true },
			meta: { validation: { validating: false } },
			fieldMeta: {},
			fieldPolicy: [],
			issues: [],
		},
		undefined,
		true,
	);
	let release = () => {};
	const ready = new Promise<void>((resolve) => {
		release = resolve;
	});
	const coordinator = createValidationCoordinator({
		validators: [
			{
				id: "row",
				fields: ["rows.0.value"],
				validate: async () => {
					await ready;
					return [];
				},
			},
		],
		getState: () => store.getState(),
		updateState: () => {
			throw new Error("unexpected generic update");
		},
		publishValidationStatus: (paths, validating) => publishValidationStatus(store, paths, validating),
		replaceAsyncIssues: (ids, issues) => replaceOwnedAsyncIssues(store, ids, issues),
	});
	const pending = coordinator.validate();
	const tx = store.beginTransaction();
	tx.mutate((draft) => {
		if (kind === "data") return { ...draft, data: { rows: [...draft.data.rows] } };
		if (kind === "ui") return { ...draft, uiState: { ...draft.uiState } };
		if (kind === "stage") return { ...draft, meta: { ...draft.meta, stage: "review" } };
		return {
			...draft,
			fieldPolicy: [
				{ path: { namespace: "data" as const, segments: ["rows", 0, "value"] }, producerId: "test", visible: false },
			],
		};
	});
	store.commitTransaction(tx);
	release();
	expect((await pending).status).toBe("superseded");
	expect(store.getState().meta.validation.validating).toBe(false);
	coordinator.dispose();
});

test.each(["abort", "reset", "dispose"])("owned %s cancels an outstanding foreground result", async (kind) => {
	let finish = () => {};
	const ready = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const form = createForm({
		initialData: { value: 0 },
		ownedScheduling: true,
		asyncValidators: [
			{
				id: "row",
				fields: ["value"],
				validate: async () => {
					await ready;
					return [];
				},
			},
		],
	});
	const controller = new AbortController();
	const pending = form.validateAsync(undefined, controller.signal);
	if (kind === "abort") controller.abort();
	else if (kind === "reset") form.reset();
	else form.dispose();
	finish();
	expect((await pending).status).not.toBe("completed");
	expect(form.getState().issues).toHaveLength(0);
	form.dispose();
});
