import { createForm } from "@formbar/core";
import type { LayoutNode, SchemaFormResult } from "@formbar/from-schema";
import { render } from "ink-testing-library";
import React, { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	FormbarTui,
	NO_COLOR_TUI_THEME,
	type ScopedInteractionCapability,
	type TargetRegistration,
	type TuiDiagnostic,
	type TuiFieldAdapterRegistry,
	type TuiFieldAdapterResolution,
} from "../index.js";
import { FakeInteractionHost } from "./fake-interaction-host.js";

const layout: LayoutNode = {
	type: "section",
	id: "root",
	children: [{ type: "group", id: "account", children: [{ type: "field", id: "name", path: "name" }] }],
};

function schemaFor(candidate = layout): SchemaFormResult {
	return {
		fields: [{ path: "name", type: "string", required: true, metadata: { title: "Name", description: "Public" } }],
		layout: candidate,
		metadata: {},
		validators: [],
		defaults: {},
		optionsByPath: new Map(),
		warnings: [],
	};
}

function fixture() {
	const form = createForm<Record<string, unknown>, unknown>({ initialData: { name: "Ada" } });
	const capability = new FakeInteractionHost();
	const listeners = new Set<(text: string) => void>();
	const textInput = {
		subscribe(listener: (text: string) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return {
		form,
		capability,
		schema: schemaFor(),
		textInput,
		emit: (text: string) => {
			for (const listener of listeners) listener(text);
		},
	};
}

function element(inputs: ReturnType<typeof fixture>, additions: Record<string, unknown> = {}) {
	return React.createElement(FormbarTui, {
		...inputs,
		layout,
		viewportWidth: 80,
		...additions,
	});
}

describe("editable FormbarTui", () => {
	it("edits through the caller text source and commits with Enter", async () => {
		const inputs = fixture();
		const view = render(element(inputs));
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Name *: Ada"));
		expect(inputs.capability.dispatch("enter")).toBe(true);
		expect(inputs.capability.dispatch("enter")).toBe(true);
		inputs.emit(" Lovelace");
		expect(inputs.capability.dispatch("enter")).toBe(true);
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Ada Lovelace"));
		view.unmount();
		expect(inputs.form.isDisposed()).toBe(false);
		inputs.form.dispose();
	});

	it("rejects entire control chunks, protects stale drafts, and blurs only on focus loss", async () => {
		const inputs = fixture();
		const view = render(element(inputs));
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Enter: Enter account"));
		inputs.capability.dispatch("enter");
		inputs.emit("bad\nchunk");
		expect(view.lastFrame()).not.toContain("bad");
		expect(inputs.form.fieldDynamic("name").isTouched()).toBe(false);
		inputs.emit("X");
		inputs.form.fieldDynamic("name").set("external");
		expect(inputs.capability.dispatch("enter")).toBe(true);
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Value changed externally"));
		expect(inputs.form.fieldDynamic("name").get()).toBe("external");
		inputs.capability.dispatch("escape");
		expect(inputs.capability.dispatch("escape")).toBe(true);
		expect(inputs.form.fieldDynamic("name").isTouched()).toBe(true);
		view.unmount();
		inputs.form.dispose();
	});

	it("blocks unsupported values without disclosing them and reports after commit", async () => {
		const secret = "DO-NOT-LEAK";
		const inputs = fixture();
		inputs.form.fieldDynamic("name").set({ secret });
		const onDiagnostic = vi.fn();
		const view = render(element(inputs, { onDiagnostic }));
		expect(view.lastFrame()).toContain("Unsupported initial field value");
		expect(view.lastFrame()).not.toContain(secret);
		expect(inputs.capability.dispatch("enter")).toBe(false);
		await vi.waitFor(() => expect(onDiagnostic).toHaveBeenCalledTimes(1));
		view.rerender(element(inputs, { onDiagnostic, viewportWidth: 40, theme: NO_COLOR_TUI_THEME }));
		expect(onDiagnostic).toHaveBeenCalledTimes(1);
		view.unmount();
		inputs.form.dispose();
	});

	it("atomically blocks external invalid values and remounts after safe recovery", async () => {
		const inputs = fixture();
		const retained: TargetRegistration[] = [];
		const tracked = track(inputs.capability);
		const capability: ScopedInteractionCapability = {
			...tracked.capability,
			registerTargets(targets) {
				retained.push(...targets);
				return tracked.capability.registerTargets(targets);
			},
		};
		const view = render(element({ ...inputs, capability }));
		await vi.waitFor(() => expect(tracked.counts.targets).toBe(1));
		inputs.form.fieldDynamic("name").set({ private: "never-serialize" });
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Unsupported initial field value"));
		expect(view.lastFrame()).not.toContain("never-serialize");
		expect(tracked.counts).toEqual({ defaults: 0, subscriptions: 0, targets: 0 });
		expect(retained[0]?.invoke("activate")).toBe(false);
		inputs.form.fieldDynamic("name").set("Recovered");
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Name *: Recovered"));
		expect(tracked.counts).toEqual({ defaults: 1, subscriptions: 1, targets: 1 });
		view.unmount();
		inputs.form.dispose();
	});

	it("detects invalid canonical mutation during registration and rolls back every acquired capability", async () => {
		const inputs = fixture();
		const retained: TargetRegistration[] = [];
		const counts = { actions: 0, defaults: 0, subscriptions: 0, targets: 0, text: 0 };
		const capability = registrationRaceCapability(inputs.capability, counts, retained, () => {
			inputs.form.fieldDynamic("name").set({ secret: "race-secret" });
		});
		const textInput = {
			subscribe(listener: (text: string) => void) {
				counts.text += 1;
				return decrement(inputs.textInput.subscribe(listener), () => {
					counts.text -= 1;
				});
			},
		};
		const diagnostics: unknown[] = [];
		const view = render(
			element({ ...inputs, capability, textInput }, { onDiagnostic: (item) => diagnostics.push(item) }),
		);
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Unsupported initial field value"));
		expect(counts).toEqual({ actions: 0, defaults: 0, subscriptions: 0, targets: 0, text: 0 });
		expect(retained.every((target) => target.invoke("activate") === false)).toBe(true);
		expect(JSON.stringify([view.frames, diagnostics])).not.toContain("race-secret");
		view.unmount();
		inputs.form.dispose();
	});

	it("keeps one ownership set when registration races with a valid canonical update", async () => {
		const inputs = fixture();
		const retained: TargetRegistration[] = [];
		const counts = { actions: 0, defaults: 0, subscriptions: 0, targets: 0, text: 0 };
		const capability = registrationRaceCapability(inputs.capability, counts, retained, () => {
			inputs.form.fieldDynamic("name").set("Grace");
		});
		const textInput = {
			subscribe(listener: (text: string) => void) {
				counts.text += 1;
				return decrement(inputs.textInput.subscribe(listener), () => {
					counts.text -= 1;
				});
			},
		};
		const view = render(element({ ...inputs, capability, textInput }));
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Name *: Grace"));
		expect(counts).toEqual({ actions: 1, defaults: 1, subscriptions: 1, targets: 1, text: 1 });
		view.unmount();
		expect(counts).toEqual({ actions: 0, defaults: 0, subscriptions: 0, targets: 0, text: 0 });
		inputs.form.dispose();
	});

	it("enforces masking before invoking a hostile structural registry", async () => {
		const inputs = fixture();
		inputs.form.fieldDynamic("name").set("canonical-secret");
		let secretReads = 0;
		const protectedForm = new Proxy(inputs.form, {
			get(target, property) {
				if (property !== "fieldDynamic") return Reflect.get(target, property, target);
				return (path: string) => {
					const api = target.fieldDynamic(path);
					return new Proxy(api, {
						get(fieldTarget, fieldProperty) {
							if (fieldProperty === "get")
								return () => {
									secretReads += 1;
									throw new Error("secret read");
								};
							return Reflect.get(fieldTarget, fieldProperty, fieldTarget);
						},
					});
				};
			},
		});
		const resolve = vi.fn(() => ({
			adapterId: "hostile",
			codec: {
				mode: "text" as const,
				toDraft: vi.fn((value: unknown) => ({ ok: true, value: String(value) })),
				acceptsDraft: () => true,
				fromDraft: (draft: string) => ({ ok: true, value: draft }),
			},
			diagnostics: [],
		}));
		const registry: TuiFieldAdapterRegistry = {
			mode: "replace",
			snapshot: () => [],
			resolve,
			extend: () => registry,
			replace: () => registry,
		};
		const schemaField = inputs.schema.fields[0];
		if (!schemaField) throw new Error("Fixture field is required");
		const secretSchema = {
			...inputs.schema,
			fields: [{ ...schemaField, metadata: { title: "Password", widget: "password" } }],
		};
		const diagnostics: unknown[] = [];
		const view = render(
			element(
				{ ...inputs, form: protectedForm, schema: secretSchema },
				{ adapterRegistry: registry, onDiagnostic: (item) => diagnostics.push(item) },
			),
		);
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Password *: [write-only]"));
		expect(resolve).not.toHaveBeenCalled();
		expect(secretReads).toBe(0);
		expect(JSON.stringify([view.frames, diagnostics])).not.toContain("canonical-secret");
		inputs.capability.dispatch("enter");
		inputs.capability.dispatch("enter");
		inputs.emit("replacement-secret");
		await vi.waitFor(() => expect(view.lastFrame()).toContain("••••••••••••••••••│"));
		expect(JSON.stringify([view.frames, diagnostics])).not.toContain("replacement-secret");
		view.unmount();
		inputs.form.dispose();
	});

	it("sanitizes adapter-controlled canonical, draft, error, help, and diagnostic output", async () => {
		const inputs = fixture();
		inputs.form.fieldDynamic("name").set("canonical\u001b[31m\tvalue");
		const codecRegistry = structuralRegistry(() => ({
			adapterId: "control-codec",
			codec: {
				mode: "text" as const,
				toDraft: () => ({ ok: true, value: "draft\u001b[32m\tvalue" }),
				acceptsDraft: () => true,
				fromDraft: () => ({ ok: false, code: "custom-invalid", message: "error\u001b[33m\tvalue" }),
			},
			diagnostics: [],
		}));
		const view = render(element(inputs, { adapterRegistry: codecRegistry }));
		await vi.waitFor(() => expect(view.lastFrame()).toContain("canonical�[31m�value"));
		inputs.capability.dispatch("enter");
		inputs.capability.dispatch("enter");
		await vi.waitFor(() => expect(view.lastFrame()).toContain("draft�[32m�value│"));
		inputs.capability.dispatch("enter");
		await vi.waitFor(() => expect(view.lastFrame()).toContain("error�[33m�value"));
		expect(view.frames.every(withoutInjectedControls)).toBe(true);
		view.unmount();

		const diagnostics: TuiDiagnostic[] = [];
		const diagnosticRegistry = structuralRegistry(() => ({
			diagnostics: [
				{ code: "unsupported-field", severity: "error", path: "name\u001b", message: "bad\u001b[31m\tadapter" },
			],
		}));
		const blocked = render(
			element(inputs, { adapterRegistry: diagnosticRegistry, onDiagnostic: (item) => diagnostics.push(item) }),
		);
		await vi.waitFor(() => expect(blocked.lastFrame()).toContain("bad�[31m�adapter"));
		expect(blocked.frames.every(withoutInjectedControls)).toBe(true);
		expect(diagnostics.every((item) => withoutInjectedControls(`${item.path ?? ""}${item.message}`))).toBe(true);
		blocked.unmount();
		inputs.form.dispose();
	});

	it("never displays write-only values", async () => {
		const inputs = fixture();
		inputs.form.fieldDynamic("name").set("DO-NOT-LEAK");
		const field = inputs.schema.fields[0];
		if (field === undefined) throw new Error("Fixture field is required");
		const writeOnly = {
			...inputs.schema,
			fields: [{ ...field, metadata: { title: "Secret", writeOnly: true } }],
		};
		const view = render(element({ ...inputs, schema: writeOnly }));
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Secret *: [write-only]"));
		expect(view.lastFrame()).not.toContain("DO-NOT-LEAK");
		inputs.capability.dispatch("enter");
		inputs.capability.dispatch("enter");
		inputs.emit("replacement-secret");
		await vi.waitFor(() => expect(view.lastFrame()).toContain("••••••••••••••••••│"));
		expect(view.lastFrame()).not.toContain("replacement-secret");
		expect(inputs.capability.dispatch("enter")).toBe(true);
		expect(inputs.form.fieldDynamic("name").get()).toBe("replacement-secret");
		view.unmount();
		inputs.form.dispose();
	});

	it("preserves typed select identity, canonical titles, disabled selections, and a valid option window", async () => {
		const form = createForm<Record<string, unknown>, unknown>({ initialData: { choice: -0 } });
		const capability = new FakeInteractionHost();
		const listeners = new Set<(text: string) => void>();
		const textInput = {
			subscribe(listener: (text: string) => void) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		};
		const options = [
			...Array.from({ length: 8 }, (_, index) => ({
				value: `disabled-${index}`,
				title: `Disabled ${index}`,
				disabled: true,
			})),
			{ value: 0, title: "Positive zero" },
			{ value: -0, title: "Negative zero", disabled: true },
			{ value: "0", title: "String zero" },
			{ value: false, title: "Boolean false" },
			{ value: null, title: "Null" },
		];
		const selectLayout: LayoutNode = {
			type: "section",
			id: "root",
			children: [{ type: "field", id: "choice", path: "choice" }],
		};
		const schema: SchemaFormResult = {
			...schemaFor(selectLayout),
			fields: [{ path: "choice", type: "number", required: false, metadata: { title: "Choice" } }],
			optionsByPath: new Map([["choice", options]]),
		};
		const view = render(
			React.createElement(FormbarTui, { form, capability, textInput, schema, layout: selectLayout, viewportWidth: 80 }),
		);
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Choice: Negative zero"));
		capability.dispatch("enter");
		capability.dispatch("enter");
		await vi.waitFor(() => expect(view.lastFrame()).toContain("> Negative zero (disabled)"));
		expect(capability.dispatch("enter")).toBe(true);
		expect(Object.is(form.fieldDynamic("choice").get(), -0)).toBe(true);
		expect(form.isPristine()).toBe(true);
		capability.dispatch("enter");
		for (const listener of listeners) listener("Disabled");
		await vi.waitFor(() => expect(view.lastFrame()).toContain("> Disabled 0 (disabled)"));
		expect(capability.dispatch("enter")).toBe(true);
		expect(Object.is(form.fieldDynamic("choice").get(), -0)).toBe(true);
		capability.dispatch("escape");
		capability.dispatch("enter");
		expect(capability.dispatch("arrow-up")).toBe(true);
		await vi.waitFor(() => expect(view.lastFrame()).toContain("> Positive zero"));
		capability.dispatch("enter");
		expect(Object.is(form.fieldDynamic("choice").get(), 0)).toBe(true);
		expect(Object.is(form.fieldDynamic("choice").get(), -0)).toBe(false);
		view.unmount();
		form.dispose();
	});

	it("keeps one live ownership set in StrictMode and releases it without disposing the form", async () => {
		const inputs = fixture();
		const tracked = track(inputs.capability);
		const view = render(
			React.createElement(StrictMode, undefined, element({ ...inputs, capability: tracked.capability })),
		);
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Enter: Enter account"));
		expect(tracked.counts).toEqual({ defaults: 1, subscriptions: 1, targets: 1 });
		view.unmount();
		expect(tracked.counts).toEqual({ defaults: 0, subscriptions: 0, targets: 0 });
		expect(inputs.form.isDisposed()).toBe(false);
		inputs.form.dispose();
	});

	it("makes retained target callbacks decline after renderer cleanup", async () => {
		const inputs = fixture();
		const retained: TargetRegistration[] = [];
		const capability: ScopedInteractionCapability = {
			registerActions: inputs.capability.registerActions.bind(inputs.capability),
			registerTargets(targets) {
				retained.push(...targets);
				return inputs.capability.registerTargets(targets);
			},
			contributeDefaultBindings: inputs.capability.contributeDefaultBindings.bind(inputs.capability),
			getEffectiveBinding: inputs.capability.getEffectiveBinding.bind(inputs.capability),
			getRevision: inputs.capability.getRevision.bind(inputs.capability),
			subscribe: inputs.capability.subscribe.bind(inputs.capability),
		};
		const view = render(element({ ...inputs, capability }));
		await vi.waitFor(() => expect(retained).toHaveLength(2));
		view.unmount();

		const group = retained.find(({ target }) => target.kind === "group");
		const field = retained.find(({ target }) => target.kind === "field");
		if (group === undefined || field === undefined) throw new Error("Expected retained group and field targets");
		for (const action of ["activate", "next", "previous", "back"]) expect(group.invoke(action)).toBe(false);
		for (const action of ["activate", "next", "previous", "back"]) expect(field.invoke(action)).toBe(false);
		inputs.form.dispose();
	});
});

function track(base: ScopedInteractionCapability) {
	const counts = { defaults: 0, subscriptions: 0, targets: 0 };
	return {
		counts,
		capability: {
			registerActions: base.registerActions.bind(base),
			registerTargets(targets) {
				counts.targets += 1;
				return decrement(base.registerTargets(targets), () => {
					counts.targets -= 1;
				});
			},
			contributeDefaultBindings(bindings) {
				counts.defaults += 1;
				return decrement(base.contributeDefaultBindings(bindings), () => {
					counts.defaults -= 1;
				});
			},
			getEffectiveBinding: base.getEffectiveBinding.bind(base),
			getRevision: base.getRevision.bind(base),
			subscribe(listener) {
				counts.subscriptions += 1;
				return decrement(base.subscribe(listener), () => {
					counts.subscriptions -= 1;
				});
			},
		} satisfies ScopedInteractionCapability,
	};
}

function decrement(cleanup: () => void, update: () => void) {
	let done = false;
	return () => {
		if (done) return;
		done = true;
		cleanup();
		update();
	};
}

function registrationRaceCapability(
	base: ScopedInteractionCapability,
	counts: { actions: number; defaults: number; subscriptions: number; targets: number },
	retained: TargetRegistration[],
	mutate: () => void,
): ScopedInteractionCapability {
	return {
		registerActions(actions) {
			counts.actions += 1;
			return decrement(base.registerActions(actions), () => {
				counts.actions -= 1;
			});
		},
		registerTargets(targets) {
			counts.targets += 1;
			retained.push(...targets);
			const cleanup = base.registerTargets(targets);
			mutate();
			return decrement(cleanup, () => {
				counts.targets -= 1;
			});
		},
		contributeDefaultBindings(bindings) {
			counts.defaults += 1;
			return decrement(base.contributeDefaultBindings(bindings), () => {
				counts.defaults -= 1;
			});
		},
		getEffectiveBinding: base.getEffectiveBinding.bind(base),
		getRevision: base.getRevision.bind(base),
		subscribe(listener) {
			counts.subscriptions += 1;
			return decrement(base.subscribe(listener), () => {
				counts.subscriptions -= 1;
			});
		},
	};
}

function structuralRegistry(resolve: () => TuiFieldAdapterResolution): TuiFieldAdapterRegistry {
	const registry: TuiFieldAdapterRegistry = {
		mode: "replace",
		snapshot: () => [],
		resolve,
		extend: () => registry,
		replace: () => registry,
	};
	return registry;
}

function withoutInjectedControls(frame: string): boolean {
	return Array.from(frame).every((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code === 10 || (code > 31 && (code < 127 || code > 159));
	});
}
