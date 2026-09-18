import { createForm } from "@formbar/core";
import type { FormbarOption, LayoutNode, SchemaFieldInfo, SchemaFormResult } from "@formbar/from-schema";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { FormbarTui, NO_COLOR_TUI_THEME } from "../index.js";
import { FakeInteractionHost, FakeTextInputSource } from "./fake-interaction-host.js";

const vetoLeak = "CORE-VETO-SECRET";
const otherField: SchemaFieldInfo = { path: "other", type: "string", required: false, metadata: { title: "Other" } };

function fixture(field: SchemaFieldInfo, initial: unknown, options: readonly FormbarOption[] = []) {
	const layout: LayoutNode = {
		type: "section",
		id: "root",
		children: [
			{
				type: "group",
				id: "group",
				children: [
					{ type: "field", id: "value", path: "value" },
					{ type: "field", id: "other", path: "other" },
				],
			},
		],
	};
	const schema: SchemaFormResult = {
		fields: [field, otherField],
		layout,
		metadata: {},
		validators: [],
		defaults: {},
		optionsByPath: new Map(options.length > 0 ? [["value", options]] : []),
		warnings: [],
	};
	const onSubmit = vi.fn(async () => ({ ok: true, submitId: "must-not-submit" }));
	const form = createForm<Record<string, unknown>, unknown>({
		initialData: { value: initial, other: "other" },
		onSubmit,
		middleware: [
			{
				id: "veto-writes",
				beforeAction: ({ action }) =>
					action.type === "set-value" && action.path === "value"
						? { action: "veto", reason: vetoLeak }
						: { action: "continue" },
			},
		],
	});
	const capability = new FakeInteractionHost();
	const textInput = new FakeTextInputSource();
	const view = render(
		React.createElement(FormbarTui, {
			form,
			capability,
			textInput,
			schema,
			layout,
			viewportWidth: 80,
			theme: NO_COLOR_TUI_THEME,
		}),
	);
	return { capability, form, onSubmit, textInput, view };
}

async function focusValue(inputs: ReturnType<typeof fixture>): Promise<void> {
	await vi.waitFor(() => expect(inputs.view.lastFrame()).toContain("Enter: Enter group"));
	expect(inputs.capability.dispatch("enter")).toBe(true);
	await vi.waitFor(() => expect(inputs.view.lastFrame()).toContain("Activate value"));
}

async function expectRejected(inputs: ReturnType<typeof fixture>, canonical: unknown): Promise<void> {
	expect(inputs.form.fieldDynamic("value").get()).toBe(canonical);
	await vi.waitFor(() => expect(inputs.view.lastFrame()).toContain("Field update rejected"));
	expect(inputs.view.frames.join("\n")).not.toContain(vetoLeak);
}

function cleanup(inputs: ReturnType<typeof fixture>): void {
	inputs.view.unmount();
	inputs.form.dispose();
}

describe("authoritative core write rejection", () => {
	it("keeps a text edit open and does not advance after a normal commit veto", async () => {
		const inputs = fixture({ path: "value", type: "string", required: true, metadata: { title: "Value" } }, "before");
		await focusValue(inputs);
		expect(inputs.capability.dispatch("enter")).toBe(true);
		inputs.textInput.emit("X");
		expect(inputs.capability.dispatch("tab")).toBe(true);
		await expectRejected(inputs, "before");
		expect(inputs.view.lastFrame()).toContain("> Value *: beforeX");
		expect(inputs.view.lastFrame()).toContain("Commit and next");
		cleanup(inputs);
	});

	it("keeps a text edit open and never submits after a submit-flush veto", async () => {
		const inputs = fixture({ path: "value", type: "string", required: true, metadata: { title: "Value" } }, "before");
		await focusValue(inputs);
		expect(inputs.capability.dispatch("enter")).toBe(true);
		inputs.textInput.emit("X");
		expect(inputs.capability.dispatch("form-submit")).toBe(true);
		await expectRejected(inputs, "before");
		expect(inputs.view.lastFrame()).toContain("Commit edit");
		expect(inputs.onSubmit).not.toHaveBeenCalled();
		cleanup(inputs);
	});

	it("preserves a boolean and blocks submission after activation is vetoed", async () => {
		const inputs = fixture({ path: "value", type: "boolean", required: false, metadata: { title: "Value" } }, true);
		await focusValue(inputs);
		expect(inputs.capability.dispatch("enter")).toBe(true);
		await expectRejected(inputs, true);
		expect(inputs.capability.dispatch("form-submit")).toBe(true);
		expect(inputs.onSubmit).not.toHaveBeenCalled();
		cleanup(inputs);
	});

	it("keeps a select open and does not advance after a normal commit veto", async () => {
		const inputs = fixture(selectField(), "a", selectOptions());
		await focusValue(inputs);
		expect(inputs.capability.dispatch("enter")).toBe(true);
		expect(inputs.capability.dispatch("arrow-down")).toBe(true);
		expect(inputs.capability.dispatch("tab")).toBe(true);
		await expectRejected(inputs, "a");
		expect(inputs.view.lastFrame()).toContain("Accept and next");
		expect(inputs.view.lastFrame()).toContain("Search:");
		expect(inputs.view.lastFrame()).toContain("> Beta");
		cleanup(inputs);
	});

	it("keeps a select open and never submits after a submit-flush veto", async () => {
		const inputs = fixture(selectField(), "a", selectOptions());
		await focusValue(inputs);
		expect(inputs.capability.dispatch("enter")).toBe(true);
		expect(inputs.capability.dispatch("arrow-down")).toBe(true);
		expect(inputs.capability.dispatch("form-submit")).toBe(true);
		await expectRejected(inputs, "a");
		expect(inputs.view.lastFrame()).toContain("Search:");
		expect(inputs.view.lastFrame()).toContain("> Beta");
		expect(inputs.onSubmit).not.toHaveBeenCalled();
		cleanup(inputs);
	});
});

function selectOptions(): readonly FormbarOption[] {
	return [
		{ title: "Alpha", value: "a" },
		{ title: "Beta", value: "b" },
	];
}

function selectField(): SchemaFieldInfo {
	return { path: "value", type: "string", required: true, metadata: { title: "Value" } };
}
