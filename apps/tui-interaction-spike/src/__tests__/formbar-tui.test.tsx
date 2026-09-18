import type { LayoutNode } from "@formbar/from-schema";
import { FormbarTui } from "@formbar/tui";
import { type StandaloneInputKey, normalizeStandaloneInput } from "@formbar/tui/standalone";
import { render } from "ink-testing-library";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Cleanup, ScopedInteractionCapability } from "../contracts.js";
import { createFixtureForm, fixtureSchema } from "../fixture.js";
import { createMemoryInteractionEngine } from "../memory-engine.js";
import { createTextInputSource } from "../text-input-source.js";

const hierarchy: LayoutNode = {
	type: "section",
	id: "root",
	children: [
		{ type: "group", id: "account", children: [{ type: "field", id: "name", path: "name" }] },
		{ type: "group", id: "settings", children: [{ type: "field", id: "age", path: "age" }] },
		{ type: "group", id: "empty", children: [] },
	],
};
const replacement: LayoutNode = {
	type: "section",
	id: "replacement",
	children: [{ type: "field", id: "fresh", path: "enabled" }],
};

async function expectFrame(view: { lastFrame(): string | undefined }, text: string): Promise<void> {
	await vi.waitFor(() => expect(view.lastFrame()).toContain(text));
}

describe("FormbarTui lifecycle", () => {
	it("routes Linux DEL as Backspace while forward delete remains action-dispatched", async () => {
		const engine = createMemoryInteractionEngine();
		const scope = engine.mount({ formType: "fixture", placement: "test" });
		const form = createFixtureForm();
		const input = createTextInputSource();
		const view = render(
			<FormbarTui
				layout={fixtureSchema.layout}
				capability={scope.capability}
				form={form}
				schema={fixtureSchema}
				textInput={input}
				viewportWidth={80}
			/>,
		);
		await expectFrame(view, "identity");
		await expectFrame(view, "preferences");
		scope.dispatch("enter");
		scope.dispatch("enter");
		dispatchKey(scope, { leftArrow: true });
		await expectFrame(view, "Name *: Ad│a");
		dispatchKey(scope, { delete: true }, "\x7f");
		await expectFrame(view, "Name *: A│a");
		expect(scope.dispatch("delete-forward")).toBe(true);
		await expectFrame(view, "Name *: A│");

		scope.dispatch("escape");
		scope.dispatch("escape");
		scope.dispatch("tab");
		scope.dispatch("enter");
		scope.dispatch("tab");
		scope.dispatch("enter");
		input.emit("cyan");
		dispatchKey(scope, { leftArrow: true });
		dispatchKey(scope, { leftArrow: true });
		await expectFrame(view, "Search: cy│an");
		dispatchKey(scope, { backspace: true });
		await expectFrame(view, "Search: c│an");
		expect(scope.dispatch("delete-forward")).toBe(true);
		await expectFrame(view, "Search: c│n");
		view.unmount();
		form.dispose();
	});

	it("renders editable metadata, responsive columns, mode labels, and select overlay without disposing the form", async () => {
		const engine = createMemoryInteractionEngine();
		const scope = engine.mount({ formType: "fixture", placement: "test" });
		const form = createFixtureForm();
		const input = createTextInputSource();
		const props = {
			layout: fixtureSchema.layout,
			capability: scope.capability,
			form,
			schema: fixtureSchema,
			textInput: input,
		};
		const view = render(<FormbarTui {...props} viewportWidth={80} />);
		await expectFrame(view, "identity");
		await expectFrame(view, "preferences");
		await expectFrame(view, "Name *: Ada");
		expect(view.lastFrame()).toContain("Display name");
		expect(
			view
				.lastFrame()
				?.split("\n")
				.some((line) => line.includes("Name") && line.includes("Age")),
		).toBe(true);
		form.fieldDynamic("age").set(200);
		await expectFrame(view, "Unsupported initial field value");
		form.fieldDynamic("age").set(37);
		await expectFrame(view, "Age *: 37");
		view.rerender(<FormbarTui {...props} viewportWidth={40} />);
		await vi.waitFor(() => {
			const lines = view.lastFrame()?.split("\n") ?? [];
			expect(lines.some((line) => line.includes("Name") && line.includes("Age"))).toBe(false);
		});
		expect(scope.dispatch("enter")).toBe(true);
		expect(scope.dispatch("enter")).toBe(true);
		await expectFrame(view, "Enter: Commit edit");
		await expectFrame(view, "Esc: Cancel edit");
		await expectFrame(view, "Tab: Commit and next");
		expect(view.lastFrame()).toContain("Name *: Ada│");
		input.emit(" Grace");
		await expectFrame(view, "Name *: Ada Grace");
		scope.dispatch("escape");
		scope.dispatch("escape");
		scope.dispatch("tab");
		scope.dispatch("enter");
		scope.dispatch("tab");
		scope.dispatch("enter");
		await expectFrame(view, "Search: │");
		expect(view.lastFrame()).toContain("Black (disabled)");
		view.unmount();
		expect(form.isDisposed()).toBe(false);
		form.dispose();
	});

	it("renders pending before committed setup and never misses an immediate override update", async () => {
		const engine = createMemoryInteractionEngine();
		const scope = engine.mount({ formType: "profile", placement: "dialog" });
		const editable = rendererInputs();
		const view = render(<FormbarTui layout={hierarchy} capability={scope.capability} {...editable.props} />);
		await expectFrame(view, "empty");
		const remove = engine.addOverride(
			{ placement: "dialog" },
			{
				input: "enter",
				interaction: { action: "activate", target: { kind: "group", id: "account" } },
				label: "Inspect name",
			},
		);
		await expectFrame(view, "Enter: Inspect name");
		remove();
		await expectFrame(view, "Enter: Enter account");
		view.unmount();
		editable.form.dispose();
	});

	it("rerenders override conflicts and removal without stale labels", async () => {
		const engine = createMemoryInteractionEngine();
		const scope = engine.mount({ formType: "profile", placement: "dialog" });
		const editable = rendererInputs();
		const view = render(<FormbarTui layout={hierarchy} capability={scope.capability} {...editable.props} />);
		await expectFrame(view, "Enter: Enter account");
		const binding = {
			input: "enter",
			interaction: { action: "activate", target: { kind: "group" as const, id: "account" } },
			label: "First",
		};
		const removeFirst = engine.addOverride({ placement: "dialog" }, binding);
		await expectFrame(view, "Enter: First");
		const removeSecond = engine.addOverride({ formType: "profile" }, { ...binding, label: "Second" });
		await vi.waitFor(() => expect(view.lastFrame()).not.toContain("Enter:"));
		removeSecond();
		await expectFrame(view, "Enter: First");
		removeFirst();
		await expectFrame(view, "Enter: Enter account");
		view.unmount();
		editable.form.dispose();
	});

	it("disposes and recreates on capability and layout identity replacement", async () => {
		const engine = createMemoryInteractionEngine();
		const first = engine.mount({ formType: "first", placement: "page" });
		const second = engine.mount({ formType: "second", placement: "page" });
		const editable = rendererInputs();
		const view = render(<FormbarTui layout={hierarchy} capability={first.capability} {...editable.props} />);
		await expectFrame(view, "> account");
		const removeSecondOverride = engine.addOverride(
			{ formType: "second" },
			{
				input: "enter",
				interaction: { action: "activate", target: { kind: "group", id: "account" } },
				label: "Second name",
			},
		);
		view.rerender(<FormbarTui layout={hierarchy} capability={second.capability} {...editable.props} />);
		await expectFrame(view, "Enter: Second name");
		expect(first.dispatch("enter")).toBe(false);
		removeSecondOverride();
		await expectFrame(view, "Enter: Enter account");
		expect(second.dispatch("enter")).toBe(true);
		view.rerender(<FormbarTui layout={replacement} capability={second.capability} {...editable.props} />);
		await expectFrame(view, "> General");
		expect(second.dispatch("escape")).toBe(false);
		expect(second.dispatch("enter")).toBe(true);
		expect(second.dispatch("enter")).toBe(true);
		view.unmount();
		expect(second.dispatch("enter")).toBe(false);
		editable.form.dispose();
	});

	it("leaves one committed registration in StrictMode and none after unmount", async () => {
		const engine = createMemoryInteractionEngine();
		const scope = engine.mount({ formType: "strict", placement: "page" });
		const tracked = trackCapability(scope.capability);
		const editable = rendererInputs();
		const view = render(
			<StrictMode>
				<FormbarTui layout={hierarchy} capability={tracked.capability} {...editable.props} />
			</StrictMode>,
		);
		await expectFrame(view, "Enter: Enter account");
		expect(tracked.counts).toEqual({ actions: 1, defaults: 1, subscriptions: 1, targets: 1 });
		view.unmount();
		expect(tracked.counts).toEqual({ actions: 0, defaults: 0, subscriptions: 0, targets: 0 });
		expect(scope.dispatch("enter")).toBe(false);
		editable.form.dispose();
	});
});

function dispatchKey(scope: { dispatch(input: string): boolean }, key: StandaloneInputKey, raw = ""): void {
	const input = normalizeStandaloneInput(raw, key);
	if (input?.kind !== "action" || !scope.dispatch(input.input)) throw new Error("Expected physical key to dispatch");
}

function rendererInputs() {
	const form = createFixtureForm();
	return {
		form,
		props: { form, schema: fixtureSchema, textInput: createTextInputSource(), viewportWidth: 80 },
	};
}

function trackCapability(base: ScopedInteractionCapability) {
	const counts = { actions: 0, defaults: 0, subscriptions: 0, targets: 0 };
	return {
		counts,
		capability: {
			registerActions(actions) {
				counts.actions += 1;
				return trackedCleanup(base.registerActions(actions), () => {
					counts.actions -= 1;
				});
			},
			registerTargets(targets) {
				counts.targets += 1;
				return trackedCleanup(base.registerTargets(targets), () => {
					counts.targets -= 1;
				});
			},
			contributeDefaultBindings(bindings) {
				counts.defaults += 1;
				return trackedCleanup(base.contributeDefaultBindings(bindings), () => {
					counts.defaults -= 1;
				});
			},
			getEffectiveBinding: base.getEffectiveBinding,
			getRevision: base.getRevision,
			subscribe(listener) {
				counts.subscriptions += 1;
				return trackedCleanup(base.subscribe(listener), () => {
					counts.subscriptions -= 1;
				});
			},
		} satisfies ScopedInteractionCapability,
	};
}

function trackedCleanup(cleanup: Cleanup, decrement: () => void): Cleanup {
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		cleanup();
		decrement();
	};
}
