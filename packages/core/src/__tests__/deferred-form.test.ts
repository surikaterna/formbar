import { describe, expect, it } from "vitest";
import { createDeferredForm, createForm } from "../index.js";

describe("commit-scoped form resources", () => {
	it("passes each middleware init the current retained snapshot without changing the initial snapshot", () => {
		const observed: string[] = [];
		const snapshots: unknown[] = [];
		const deferred = createDeferredForm({
			initialData: { name: "Ada" },
			middleware: [
				{
					id: "observe",
					onInit({ state }) {
						observed.push(state.data.name);
						snapshots.push(state);
					},
				},
			],
		});
		const initial = deferred.form.getState();
		deferred.activate();
		deferred.form.setValue("name", "Grace");
		deferred.deactivate();
		const changed = deferred.form.getState();
		deferred.activate();
		expect(observed).toEqual(["Ada", "Grace"]);
		expect(snapshots).toEqual([initial, changed]);
		expect(initial.data.name).toBe("Ada");
		expect(changed.data.name).toBe("Grace");
		expect(deferred.form.getState()).toBe(changed);
		deferred.deactivate();
		deferred.form.dispose();
	});

	it("stops initialization on reentrant dispose and releases late and earlier resources once", () => {
		const events: string[] = [];
		const deferred: ReturnType<typeof createDeferredForm> = createDeferredForm({
			middleware: [
				{
					id: "m",
					onInit: () => {
						events.push("mw-init");
					},
					onDispose: () => {
						events.push("mw-dispose");
					},
				},
			],
			plugins: [
				{
					id: "first",
					onInit: () => {
						events.push("first");
						return () => {
							events.push("first-release");
							deferred.activate();
						};
					},
				},
				{
					id: "dispose",
					onInit: () => {
						events.push("dispose");
						deferred.form.dispose();
						return () => {
							events.push("late-release");
						};
					},
				},
				{
					id: "never",
					onInit: () => {
						events.push("never");
					},
				},
			],
		});
		deferred.activate();
		expect(deferred.form.isDisposed()).toBe(true);
		expect(events).toEqual(["mw-init", "first", "dispose", "first-release", "mw-dispose", "late-release"]);
		deferred.activate();
		deferred.deactivate();
		expect(events).toHaveLength(6);
	});

	it("does not reactivate inside a throwing disposer during partial initialization", () => {
		const events: string[] = [];
		const deferred: ReturnType<typeof createDeferredForm> = createDeferredForm({
			plugins: [
				{
					id: "first",
					onInit: () => {
						events.push("init");
						return () => {
							events.push("release");
							deferred.activate();
							throw new Error("cleanup failed");
						};
					},
				},
				{
					id: "throws",
					onInit: () => {
						throw new Error("init failed");
					},
				},
			],
		});
		expect(() => deferred.activate()).toThrow("init failed");
		expect(events).toEqual(["init", "release"]);
		deferred.deactivate();
		expect(events).toHaveLength(2);
		deferred.form.dispose();
		expect(deferred.form.isDisposed()).toBe(true);
	});

	it("does not initialize later middleware or plugins after middleware disposes the form", () => {
		const events: string[] = [];
		const deferred: ReturnType<typeof createDeferredForm> = createDeferredForm({
			middleware: [
				{
					id: "dispose",
					onInit: () => {
						events.push("init");
						deferred.form.dispose();
					},
					onDispose: () => {
						events.push("cleanup");
					},
				},
				{
					id: "never-middleware",
					onInit: () => {
						events.push("never-middleware");
					},
				},
			],
			plugins: [
				{
					id: "never-plugin",
					onInit: () => {
						events.push("never-plugin");
					},
				},
			],
		});
		deferred.activate();
		expect(events).toEqual(["init", "cleanup"]);
		expect(deferred.form.isDisposed()).toBe(true);
	});

	it("keeps a stable baseline until activation and releases subscriptions on every replay", () => {
		const events: string[] = [];
		let notify = 0;
		const deferred = createDeferredForm({
			initialData: { name: "Ada" },
			middleware: [
				{
					id: "audit",
					onInit: () => {
						events.push("mw-init");
					},
					onDispose: () => {
						events.push("mw-dispose");
					},
				},
			],
			plugins: [
				{
					id: "audit",
					onInit(ctx) {
						events.push("init");
						ctx.subscribe(() => {
							notify++;
						});
						ctx.dispatch({ type: "set-value", path: "name", value: "Grace" });
						return () => {
							events.push("release");
						};
					},
					evaluate: () => ({ fieldPolicy: [{ path: "name", required: true }] }),
					onDispose: () => {
						events.push("permanent");
					},
				},
			],
		});
		const { form } = deferred;
		const baseline = form.getState();
		expect(baseline.data.name).toBe("Ada");
		expect(baseline.fieldPolicy).toEqual([]);
		expect(events).toEqual([]);
		deferred.activate();
		expect(form.getState().data.name).toBe("Grace");
		expect(form.getState().fieldPolicy).not.toEqual([]);
		expect(notify).toBe(1);
		deferred.deactivate();
		deferred.deactivate();
		form.setValue("name", "Before replay");
		expect(notify).toBe(1);
		deferred.activate();
		expect(form.getState().data.name).toBe("Grace");
		expect(notify).toBe(2);
		deferred.deactivate();
		expect(events).toEqual(["mw-init", "init", "release", "mw-dispose", "mw-init", "init", "release", "mw-dispose"]);
		expect(form.isDisposed()).toBe(false);
		let disposed = 0;
		form.onDispose(() => {
			disposed++;
		});
		form.dispose();
		form.dispose();
		expect(disposed).toBe(1);
		expect(events.at(-1)).toBe("permanent");
	});

	it("releases partially initialized plugin resources and preserves imperative eagerness", () => {
		const events: string[] = [];
		const plugins = [
			{
				id: "first",
				onInit: () => {
					events.push("first");
					return () => {
						events.push("release");
					};
				},
			},
			{
				id: "throws",
				onInit: () => {
					throw new Error("init failed");
				},
			},
		];
		const deferred = createDeferredForm({ plugins });
		expect(() => deferred.activate()).toThrow("init failed");
		expect(events).toEqual(["first", "release"]);
		expect(deferred.form.isDisposed()).toBe(false);
		deferred.form.dispose();
		const eager = createForm({ plugins: [plugins[0]] });
		expect(events.at(-1)).toBe("first");
		eager.dispose();
		expect(events.at(-1)).toBe("release");
	});
});
