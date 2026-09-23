import { describe, expect, it } from "vitest";
import { createDeferredForm, createForm } from "../index.js";

describe("commit-scoped form resources", () => {
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
