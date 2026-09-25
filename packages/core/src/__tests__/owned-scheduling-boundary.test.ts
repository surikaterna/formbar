import { describe, expect, test, vi } from "vitest";
import { createDeferredForm, createForm } from "../create-form.js";
import { activateOwnedSchedulingBoundary } from "../internal/scoped-sync.js";
import { scopedCaptureReceipt } from "../scoped-capture-receipt.js";
import type { FormState } from "../state.js";
import { FormStore, ownStoreBeforeScheduling, publishIssueOnly, snapshotOwnership } from "../store.js";
import { defaultStrategy } from "../transaction.js";

function state(data: unknown, uiState: unknown): FormState<unknown, unknown> {
	return { data, uiState, meta: { validation: {} }, fieldMeta: {}, fieldPolicy: [], issues: [] };
}

describe("#301 owned scheduling boundary", () => {
	test("opt-in reentry coalesces superseded states and reads the current owned snapshot at each invocation", () => {
		const form = createForm({ initialData: { x: 0 }, ownedScheduling: true });
		const seen: [string, number, number][] = [];
		const observe = (name: string, argument: typeof form extends { getState: () => infer S } ? S : never) => {
			const current = form.getState();
			expect(argument).toBe(current);
			expect(argument).toBe(form.captureState().state);
			expect(snapshotOwnership(argument)?.epoch).toBe(snapshotOwnership(current)?.epoch);
			seen.push([name, argument.data.x, snapshotOwnership(argument)?.epoch ?? -1]);
		};
		form.subscribe((snapshot) => {
			observe("first", snapshot);
			if (snapshot.data.x === 1) {
				form.setValue("x", 2);
				form.setValue("x", 3);
				// This argument is historical after our own synchronous writes.
				expect(snapshot).not.toBe(form.getState());
			}
		});
		form.subscribe((snapshot) => observe("second", snapshot));
		expect(form.setValue("x", 1)).toEqual({ ok: true });
		expect(seen.map(([name, x]) => [name, x])).toEqual([
			["first", 1],
			["second", 3],
			["first", 3],
		]);
		expect(seen[0]?.[2]).toBeLessThan(seen[1]?.[2] ?? 0);
		expect(seen[1]?.[2]).toBe(seen[2]?.[2]);
		form.dispose();
	});

	test("issue-only reentry preserves epoch but delivers latest identity; activation also drains coherently", () => {
		const form = createForm({ initialData: { x: 0 } });
		const seen: string[] = [];
		form.subscribe((snapshot) => {
			expect(snapshot).toBe(form.getState());
			expect(snapshot).toBe(form.captureState().state);
			seen.push(`first:${snapshot.data.x}`);
			if (snapshot.data.x === 0) form.setValue("x", 1);
		});
		form.subscribe((snapshot) => {
			expect(snapshot).toBe(form.getState());
			expect(snapshot).toBe(form.captureState().state);
			seen.push(`second:${snapshot.data.x}`);
		});
		activateOwnedSchedulingBoundary(form);
		expect(seen).toEqual(["first:0", "second:1", "first:1"]);
		form.dispose();

		const store = new FormStore(state({}, {}), undefined, true);
		const initial = store.getState();
		const delivered: object[] = [];
		store.subscribe((snapshot) => {
			if (snapshot.issues.length === 1) publishIssueOnly(store, []);
		});
		store.subscribe((snapshot) => {
			expect(snapshot).toBe(store.getState());
			delivered.push(snapshot);
		});
		publishIssueOnly(store, [
			{
				code: "test",
				message: "test",
				severity: "error",
				path: { namespace: "data", segments: ["x"], canonical: "x" },
				source: { origin: "function-validator", validatorId: "test" },
			},
		]);
		expect(delivered).toEqual([store.getState()]);
		expect(store.getState()).not.toBe(initial);
		expect(snapshotOwnership(store.getState())?.epoch).toBe(snapshotOwnership(initial)?.epoch);
		store.dispose();
	});

	test("unsubscribe, dispose, and throwing subscribers remain isolated during owned drain", () => {
		const store = new FormStore(state({ x: 0 }, {}), undefined, true);
		const called: string[] = [];
		let stop = () => {};
		store.subscribe(() => {
			called.push("writer");
			stop();
			throw new Error("listener failure");
		});
		stop = store.subscribe(() => called.push("removed"));
		store.subscribe(() => called.push("last"));
		publishIssueOnly(store, []);
		expect(called).toEqual(["writer", "last"]);
		store.subscribe(() => store.dispose());
		store.subscribe(() => called.push("after dispose"));
		publishIssueOnly(store, []);
		expect(called).toEqual(["writer", "last", "writer", "last"]);
	});

	test("always-writing feedback throws a finite code-only overflow and permits a later notification", () => {
		const form = createForm({ initialData: { x: 0 }, ownedScheduling: true });
		let writes = 0;
		const stop = form.subscribe((snapshot) => {
			writes++;
			form.setValue("x", snapshot.data.x + 1);
		});
		expect(() => form.setValue("x", 1)).toThrow("OWNED_NOTIFICATION_OVERFLOW");
		expect(writes).toBe(1024);
		expect(form.getState().data.x).toBe(1025);
		stop();
		const notified = vi.fn();
		form.subscribe(notified);
		expect(form.setValue("x", 1026)).toEqual({ ok: true });
		expect(notified).toHaveBeenCalledOnce();
		form.dispose();
	});

	test("nested owned forms surface the inner overflow without undoing either committed write", () => {
		const outer = createForm({ initialData: { x: 0 }, ownedScheduling: true });
		const inner = createForm({ initialData: { x: 0 }, ownedScheduling: true });
		let innerWrites = 0;
		const stopInner = inner.subscribe((snapshot) => {
			innerWrites++;
			inner.setValue("x", snapshot.data.x + 1);
		});
		const stopOuter = outer.subscribe(() => {
			inner.setValue("x", 1);
		});
		const error = vi.fn();
		try {
			outer.setValue("x", 1);
		} catch (caught) {
			error(caught);
		}
		expect(error).toHaveBeenCalledOnce();
		expect(error.mock.calls[0]?.[0]).toMatchObject({ message: "OWNED_NOTIFICATION_OVERFLOW" });
		expect(innerWrites).toBe(1024);
		expect(inner.getState().data.x).toBe(1025);
		expect(outer.getState().data.x).toBe(1);
		stopInner();
		stopOuter();
		const innerNotice = vi.fn();
		const outerNotice = vi.fn();
		inner.subscribe(innerNotice);
		outer.subscribe(outerNotice);
		expect(inner.setValue("x", 1026)).toEqual({ ok: true });
		expect(outer.setValue("x", 2)).toEqual({ ok: true });
		expect(innerNotice).toHaveBeenCalledOnce();
		expect(outerNotice).toHaveBeenCalledOnce();
		inner.dispose();
		outer.dispose();
	});

	test("non-opt-in nested notification arguments retain legacy historical delivery", () => {
		const form = createForm({ initialData: { x: 0 } });
		const seen: [number, number][] = [];
		form.subscribe((snapshot) => {
			if (snapshot.data.x === 1) form.setValue("x", 2);
		});
		form.subscribe((snapshot) => seen.push([snapshot.data.x, form.getState().data.x]));
		form.setValue("x", 1);
		expect(seen).toEqual([
			[2, 2],
			[1, 2],
		]);
		form.dispose();
	});
	test("creation opt-in owns before eager init and deferred first capture; invalid originals never initialize", () => {
		for (const deferred of [false, true]) {
			const caller = { ok: 1 };
			const observed: boolean[] = [];
			const options = {
				initialData: caller,
				initialUiState: { tab: "first" },
				ownedScheduling: true as const,
				middleware: [
					{
						onInit: ({ state }: { state: FormState<typeof caller, { tab: string }> }) => {
							observed.push(
								Object.isFrozen(state.data) && Object.isFrozen(state.uiState) && Object.isFrozen(state.fieldPolicy),
							);
						},
					},
				],
				plugins: [
					{
						id: "init",
						onInit: ({
							getState,
							initialData,
						}: { getState: () => { data: typeof caller }; initialData: typeof caller }) => {
							observed.push(Object.isFrozen(getState().data) && Object.isFrozen(initialData));
						},
					},
				],
			};
			const runtime = deferred ? createDeferredForm(options) : undefined;
			const form = runtime?.form ?? createForm(options);
			expect(Object.isFrozen(form.getState().data)).toBe(true);
			expect(snapshotOwnership(form.getState())?.owned).toBe(true);
			expect(observed).toEqual(deferred ? [] : [true, true]);
			runtime?.activate();
			expect(observed).toEqual([true, true]);
			caller.ok = 2;
			expect(form.getState().data).toEqual({ ok: 1 });
			form.dispose();
		}
		const init = vi.fn();
		const invalid = { ok: new Date() };
		expect(() =>
			createForm({ initialData: invalid, ownedScheduling: true, plugins: [{ id: "p", onInit: init }] }),
		).toThrow("ISSUE_ONLY_UNSUPPORTED_STATE");
		expect(() =>
			createDeferredForm({ initialData: invalid, ownedScheduling: true, middleware: [{ onInit: init }] }),
		).toThrow("ISSUE_ONLY_UNSUPPORTED_STATE");
		expect(init).not.toHaveBeenCalled();
		expect(Object.isFrozen(invalid)).toBe(false);
	});

	test("invalid direct input never invokes pipeline hooks, while invalid trusted output cannot publish", () => {
		const beforeAction = vi.fn();
		const beforeEvaluate = vi.fn();
		const evaluate = vi.fn(() => ({ writes: [{ path: "bad", value: new Date(), mode: "set" as const }] }));
		const afterAction = vi.fn();
		const form = createForm({
			initialData: { ok: 1 },
			ownedScheduling: true,
			middleware: [{ beforeAction, beforeEvaluate, afterAction }],
			plugins: [{ id: "bad", evaluate }],
		});
		const prior = form.getState();
		const notice = vi.fn();
		form.subscribe(notice);
		expect(form.setValue("ok", new Date() as never)).toEqual({ ok: false, error: "ISSUE_ONLY_UNSUPPORTED_STATE" });
		expect(beforeAction).not.toHaveBeenCalled();
		expect(beforeEvaluate).not.toHaveBeenCalled();
		expect(evaluate).not.toHaveBeenCalled();
		expect(form.setValue("ok", 2)).toEqual({ ok: false, error: "ISSUE_ONLY_UNSUPPORTED_STATE" });
		expect(evaluate).toHaveBeenCalledTimes(1);
		expect(afterAction).not.toHaveBeenCalled();
		expect(form.getState()).toBe(prior);
		expect(notice).not.toHaveBeenCalled();
	});

	test("trusted transform output is rejected at commit without afterAction or submit handler", () => {
		const afterAction = vi.fn();
		const onSubmit = vi.fn(async () => ({ ok: true as const, submitId: "sent" }));
		const form = createForm({
			initialData: { ok: 1 },
			ownedScheduling: true,
			onSubmit,
			middleware: [{ afterAction }],
			transforms: [{ id: "invalid", path: "ok", phase: "ingress", transform: () => new Date() }],
		});
		const initial = form.getState();
		const notify = vi.fn();
		form.subscribe(notify);
		expect(form.dispatch({ type: "set-value", path: "ok", value: 2 })).toEqual({
			ok: false,
			error: "ISSUE_ONLY_UNSUPPORTED_STATE",
		});
		expect(form.getState()).toBe(initial);
		expect(notify).not.toHaveBeenCalled();
		expect(afterAction).not.toHaveBeenCalled();
		expect(onSubmit).not.toHaveBeenCalled();
		form.dispose();
	});
	test("immediate opt-in detaches before a scheduling capture; prior snapshots and caller values stay writable", () => {
		const caller = { rows: [{ name: "initial" }] };
		const ui = { tab: "first" };
		const form = createForm({ initialData: caller, initialUiState: ui });
		const prior = form.getState();
		const priorReceipt = scopedCaptureReceipt(form.captureState());
		const listener = vi.fn();
		let notifiedReceipt: ((state: typeof prior) => boolean) | undefined;
		form.subscribe(() => {
			notifiedReceipt = scopedCaptureReceipt(form.captureState());
		});
		form.subscribe(listener);
		activateOwnedSchedulingBoundary(form);
		const capture = form.captureState();
		const current = scopedCaptureReceipt(capture);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(capture.state);
		expect(priorReceipt(capture.state)).toBe(false);
		expect(notifiedReceipt?.(capture.state)).toBe(true);
		expect(capture.state.data).not.toBe(prior.data);
		expect(capture.state.uiState).not.toBe(prior.uiState);
		expect(Object.isFrozen(capture.state.data)).toBe(true);
		expect(snapshotOwnership(capture.state)?.owned).toBe(true);
		caller.rows[0].name = "caller edit";
		ui.tab = "caller edit";
		(prior.data as typeof caller).rows[0].name = "prior edit";
		(prior.uiState as typeof ui).tab = "prior edit";
		expect(capture.state.data).toEqual({ rows: [{ name: "initial" }] });
		expect(capture.state.uiState).toEqual({ tab: "first" });
		expect(current(form.getState())).toBe(true);
		activateOwnedSchedulingBoundary(form);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(form.setValue("rows[0].name", "next")).toEqual({ ok: true });
		expect(current(form.getState())).toBe(false);
		expect(snapshotOwnership(form.getState())?.epoch).toBeGreaterThan(snapshotOwnership(capture.state)?.epoch);
		const changed = scopedCaptureReceipt(form.captureState());
		form.field("rows[0].name").handleBlur();
		expect(form.field("rows[0].name").isTouched()).toBe(true);
		expect(changed(form.getState())).toBe(true);
	});

	test("deferred attach publishes one owned snapshot before activation; many receipts avoid data reinspection", () => {
		const runtime = createDeferredForm({ initialData: { rows: Array.from({ length: 100 }, (_, i) => ({ n: i })) } });
		const { form } = runtime;
		const before = form.getState();
		let rowVisits = 0;
		const ownKeys = Reflect.ownKeys;
		const rows = (before.data as { rows: unknown[] }).rows;
		const spy = vi.spyOn(Reflect, "ownKeys").mockImplementation((target) => {
			if (target === rows) rowVisits++;
			return ownKeys(target);
		});
		const subscriber = vi.fn();
		form.subscribe(subscriber);
		activateOwnedSchedulingBoundary(form);
		expect(subscriber).toHaveBeenCalledTimes(1);
		expect(form.getState()).not.toBe(before);
		expect(rowVisits).toBe(1);
		const receipts = Array.from({ length: 20 }, () => scopedCaptureReceipt(form.captureState()));
		runtime.activate();
		for (const receipt of receipts) expect(receipt(form.getState())).toBe(true);
		expect(rowVisits).toBe(1);
		spy.mockRestore();
		form.reset();
		for (const receipt of receipts) expect(receipt(form.getState())).toBe(false);
		form.dispose();
	});

	test("issue-only publication shares the owned branches and epoch; a committed policy write invalidates captures", () => {
		const store = new FormStore(state({ rows: [1] }, { tab: "a" }));
		ownStoreBeforeScheduling(store);
		const capture = { state: store.getState(), isFormDirty: () => false, isFieldDirty: () => false };
		const receipt = scopedCaptureReceipt(capture);
		const first = capture.state;
		publishIssueOnly(store, []);
		expect(store.getState().data).toBe(first.data);
		expect(store.getState().uiState).toBe(first.uiState);
		expect(store.getState().fieldPolicy).toBe(first.fieldPolicy);
		expect(snapshotOwnership(store.getState())?.epoch).toBe(snapshotOwnership(first)?.epoch);
		expect(receipt(store.getState())).toBe(true);
		const tx = store.beginTransaction();
		tx.mutate((draft) => ({ ...draft, meta: { ...draft.meta, stage: "discarded" } }));
		store.rollbackTransaction(tx);
		expect(receipt(store.getState())).toBe(true);
		const next = store.beginTransaction();
		const policy = [{ path: { namespace: "data" as const, segments: ["rows"] }, producerId: "owner", visible: false }];
		next.mutate((draft) => ({ ...draft, fieldPolicy: policy }));
		store.commitTransaction(next);
		expect(receipt(store.getState())).toBe(false);
		policy[0].visible = true;
		expect(store.getState().fieldPolicy[0]?.visible).toBe(false);
	});

	test("a failed issue-only publication does not mint an epoch or notify, and revokes pending receipts", () => {
		const store = new FormStore(state({ row: "a" }, {}));
		ownStoreBeforeScheduling(store);
		const capture = { state: store.getState(), isFormDirty: () => false, isFieldDirty: () => false };
		const receipt = scopedCaptureReceipt(capture);
		const listener = vi.fn();
		store.subscribe(listener);
		const issue = {
			code: "bad",
			message: "bad",
			severity: "error" as const,
			path: { namespace: "data" as const, segments: ["row"], canonical: "row" },
			source: { origin: "function-validator" as const, validatorId: "test" },
			details: { unsafe: new Date() },
		};
		expect(() => publishIssueOnly(store, [issue])).toThrow();
		expect(store.getState()).toBe(capture.state);
		expect(snapshotOwnership(store.getState())?.epoch).toBe(snapshotOwnership(capture.state)?.epoch);
		expect(listener).not.toHaveBeenCalled();
		expect(receipt(store.getState())).toBe(false);
		const fresh = scopedCaptureReceipt({ ...capture, state: store.getState() });
		publishIssueOnly(store, []);
		expect(fresh(store.getState())).toBe(true);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	test("unsupported activation and writes reject atomically without notification and recover", () => {
		const malformed = new FormStore(state({ safe: true }, { x: 1 }));
		const tx = malformed.beginTransaction();
		tx.mutate((draft) => ({ ...draft, data: new Date() }));
		malformed.commitTransaction(tx);
		const prior = malformed.getState();
		const notice = vi.fn();
		malformed.subscribe(notice);
		expect(() => ownStoreBeforeScheduling(malformed)).toThrow("ISSUE_ONLY_UNSUPPORTED_STATE");
		expect(malformed.getState()).toBe(prior);
		expect(notice).not.toHaveBeenCalled();
		const classForm = createForm({
			initialData: {
				opaque: new (class Payload {
					value = 1;
				})(),
			},
		});
		const classState = classForm.getState();
		const classNotice = vi.fn();
		classForm.subscribe(classNotice);
		expect(() => activateOwnedSchedulingBoundary(classForm)).toThrow("ISSUE_ONLY_UNSUPPORTED_STATE");
		expect(classForm.getState()).toBe(classState);
		expect(classNotice).not.toHaveBeenCalled();
		const form = createForm({ initialData: { ok: 1 } });
		activateOwnedSchedulingBoundary(form);
		const old = form.getState();
		const callback = vi.fn();
		form.subscribe(callback);
		const bad = form.setValue("ok", new Date() as never);
		expect(bad).toEqual({ ok: false, error: "ISSUE_ONLY_UNSUPPORTED_STATE" });
		expect(form.getState()).toBe(old);
		expect(callback).not.toHaveBeenCalled();
		expect(() => form.reset({ data: { ok: new Date() } as never })).toThrow("ISSUE_ONLY_UNSUPPORTED_STATE");
		expect(form.getState()).toBe(old);
		expect(callback).not.toHaveBeenCalled();
		expect(form.setValue("ok", 2)).toEqual({ ok: true });
		expect(form.getState().data).toEqual({ ok: 2 });
	});

	test("custom strategy and malformed descriptor, sparse array, or plugin write never activate/publish", () => {
		const custom = new FormStore(state({}, {}), { ...defaultStrategy });
		const listener = vi.fn();
		custom.subscribe(listener);
		expect(() => ownStoreBeforeScheduling(custom)).toThrow("OWNED_STATE_UNSUPPORTED");
		expect(listener).not.toHaveBeenCalled();
		const form = createForm({ initialData: { ok: 1 } });
		activateOwnedSchedulingBoundary(form);
		const original = form.getState();
		const notify = vi.fn();
		form.subscribe(notify);
		const getter = Object.defineProperty({}, "unsafe", { enumerable: true, get: () => 1 });
		for (const value of [getter, Array(2), { nested: Number.NaN }, { constructor: 1 }]) {
			expect(form.setValue("ok", value)).toEqual({ ok: false, error: "ISSUE_ONLY_UNSUPPORTED_STATE" });
			expect(form.getState()).toBe(original);
		}
		expect(notify).not.toHaveBeenCalled();
		const supplied = { nested: 2 };
		expect(form.setValue("ok", supplied)).toEqual({ ok: true });
		supplied.nested = 3;
		expect(form.getState().data).toEqual({ ok: { nested: 2 } });
		const pluginForm = createForm({
			initialData: { ok: 1 },
			plugins: [{ id: "unsafe", evaluate: () => ({ writes: [{ path: "bad", value: new Date(), mode: "set" }] }) }],
		});
		activateOwnedSchedulingBoundary(pluginForm);
		const pluginState = pluginForm.getState();
		const pluginNotice = vi.fn();
		pluginForm.subscribe(pluginNotice);
		expect(pluginForm.setValue("ok", 2)).toEqual({ ok: false, error: "ISSUE_ONLY_UNSUPPORTED_STATE" });
		expect(pluginForm.getState()).toBe(pluginState);
		expect(pluginNotice).not.toHaveBeenCalled();
	});
});
