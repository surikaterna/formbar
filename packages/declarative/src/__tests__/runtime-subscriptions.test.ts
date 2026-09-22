import { describe, expect, it, vi } from "vitest";
import { createFormRuntime } from "../index.js";
import { definition, field, node, runtime } from "./runtime-fixtures.js";

describe("runtime subscriptions", () => {
	it("attaches one core subscription lazily and releases it after final unsubscribe", () => {
		const formDefinition = definition([field("name", ["name"])]);
		const created = runtime(formDefinition, { initialData: { name: "Ada", other: 0 } });
		const subscribe = vi.spyOn(created.form, "subscribe");
		const port = createFormRuntime({ form: created.form, definition: formDefinition });
		port.getSnapshot();
		expect(subscribe).not.toHaveBeenCalled();
		const formObservation = port.observeForm();
		const nodeObservation = port.observeNode(node(port, "root")?.instance.instanceKey ?? "");
		const stopForm = formObservation.subscribe(() => {});
		const stopNode = nodeObservation.subscribe(() => {});
		expect(subscribe).toHaveBeenCalledTimes(1);
		stopForm();
		stopNode();
		const stopAgain = port.subscribe(() => {});
		expect(subscribe).toHaveBeenCalledTimes(2);
		stopAgain();
	});

	it("suppresses irrelevant selected-node notifications and preserves equal identities", () => {
		const formDefinition = definition([field("name", ["name"])]);
		const { form, runtime: port } = runtime(formDefinition, { initialData: { name: "Ada", other: 0 } });
		const root = node(port, "root");
		if (!root) throw new Error("root");
		const observation = port.observeNode(root.instance.instanceKey);
		const listener = vi.fn();
		const first = observation.getSnapshot();
		const stop = observation.subscribe(listener);
		form.setValue("other", 1);
		expect(listener).not.toHaveBeenCalled();
		expect(observation.getSnapshot()).toBe(first);
		stop();
	});

	it("contains hostile callbacks and disposes observations and the core connection", () => {
		const formDefinition = definition([field("name", ["name"])]);
		const { form, runtime: port } = runtime(formDefinition, { initialData: { name: "Ada" } });
		const observation = port.observeForm();
		const listener = vi.fn(() => {
			throw new Error("hostile");
		});
		observation.subscribe(listener);
		expect(() => form.setValue("name", "Grace")).not.toThrow();
		expect(listener).toHaveBeenCalledOnce();
		expect(observation.getLifecycleDiagnostics()).toEqual([{ code: "adapter" }]);
		port.dispose();
		form.setValue("name", "Lin");
		expect(listener).toHaveBeenCalledOnce();
	});

	it.each(["first", "second"] as const)(
		"keeps duplicate runtime callback registrations independent when removing the %s",
		(removed) => {
			const formDefinition = definition([field("name", ["name"])]);
			const { form, runtime: port } = runtime(formDefinition, { initialData: { name: "Ada" } });
			const listener = vi.fn();
			const first = port.subscribe(listener);
			const second = port.subscribe(listener);
			(removed === "first" ? first : second)();
			form.setValue("name", "Grace");
			expect(listener).toHaveBeenCalledOnce();
			(removed === "first" ? second : first)();
			form.setValue("name", "Lin");
			expect(listener).toHaveBeenCalledOnce();
		},
	);

	it.each(["first", "second"] as const)(
		"keeps duplicate selected callback registrations independent when removing the %s",
		(removed) => {
			const formDefinition = definition([field("name", ["name"])]);
			const { form, runtime: port } = runtime(formDefinition, { initialData: { name: "Ada" } });
			const selected = port.observeNode(node(port, "name")?.instance.instanceKey ?? "");
			selected.getSnapshot();
			const listener = vi.fn();
			const first = selected.subscribe(listener);
			const second = selected.subscribe(listener);
			(removed === "first" ? first : second)();
			form.setValue("name", "Grace");
			expect(listener).toHaveBeenCalledOnce();
			(removed === "first" ? second : first)();
			form.setValue("name", "Lin");
			expect(listener).toHaveBeenCalledOnce();
		},
	);

	it("deregisters disposed observations and clears retained listener/state references", () => {
		const formDefinition = definition([field("name", ["name"])]);
		const { form, runtime: port } = runtime(formDefinition, { initialData: { name: "Ada" } });
		const owned = (port as unknown as { observations: Set<unknown>; listeners: Set<unknown> }).observations;
		for (let index = 0; index < 250; index++) port.observeForm().dispose();
		expect(owned.size).toBe(0);

		const listener = vi.fn();
		const selected = port.observeNode(node(port, "name")?.instance.instanceKey ?? "");
		selected.getSnapshot();
		selected.subscribe(listener);
		selected.dispose();
		expect(owned.size).toBe(0);
		form.setValue("name", "Grace");
		expect(listener).not.toHaveBeenCalled();

		const active = Array.from({ length: 100 }, () => port.observeForm());
		for (const observation of active) observation.subscribe(listener);
		expect(owned.size).toBe(100);
		port.dispose();
		expect(owned.size).toBe(0);
		expect((port as unknown as { listeners: Set<unknown> }).listeners.size).toBe(0);
		for (const observation of active) observation.dispose();
		port.observeForm();
		expect(owned.size).toBe(0);
	});
});
