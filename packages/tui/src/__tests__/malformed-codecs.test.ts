import { createForm } from "@formbar/core";
import type { FormbarOption, LayoutNode, SchemaFieldInfo, SchemaFormResult } from "@formbar/from-schema";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import {
	FormbarTui,
	NO_COLOR_TUI_THEME,
	type TuiCodecResult,
	type TuiFieldCodec,
	createTuiFieldAdapterRegistry,
} from "../index.js";
import { FakeInteractionHost, FakeTextInputSource } from "./fake-interaction-host.js";

const leak = "MALFORMED-CODEC-SECRET";

function malformed<T>(): TuiCodecResult<T> {
	return { ok: true, error: leak, message: leak } as unknown as TuiCodecResult<T>;
}

function fixture(field: SchemaFieldInfo, codec: TuiFieldCodec, initial: unknown) {
	const layout: LayoutNode = {
		type: "section",
		id: "root",
		children: [{ type: "group", id: "group", children: [{ type: "field", id: "field", path: field.path }] }],
	};
	const options = codec.options ?? [];
	const schema: SchemaFormResult = {
		fields: [field],
		layout,
		metadata: {},
		validators: [],
		defaults: {},
		optionsByPath: new Map(options.length > 0 ? [[field.path, options]] : []),
		warnings: [],
	};
	const onSubmit = vi.fn(async () => ({ ok: true, submitId: "must-not-submit" }));
	const form = createForm<Record<string, unknown>, unknown>({ initialData: { [field.path]: initial }, onSubmit });
	const capability = new FakeInteractionHost();
	const textInput = new FakeTextInputSource();
	const adapterRegistry = createTuiFieldAdapterRegistry(
		[{ id: "adversarial", matches: () => true, create: () => codec }],
		"replace",
	);
	const view = render(
		React.createElement(FormbarTui, {
			form,
			capability,
			textInput,
			schema,
			layout,
			adapterRegistry,
			viewportWidth: 80,
			theme: NO_COLOR_TUI_THEME,
		}),
	);
	return { capability, form, onSubmit, textInput, view };
}

function textCodec(fromDraft: TuiFieldCodec["fromDraft"], acceptsDraft: TuiFieldCodec["acceptsDraft"] = () => true) {
	return {
		mode: "text" as const,
		toDraft: (value: unknown) => ({ ok: true as const, value: String(value) }),
		acceptsDraft,
		fromDraft,
	};
}

async function enterField(inputs: ReturnType<typeof fixture>): Promise<void> {
	await vi.waitFor(() => expect(inputs.view.lastFrame()).toContain("Enter: Enter group"));
	expect(inputs.capability.dispatch("enter")).toBe(true);
	await vi.waitFor(() => expect(inputs.view.lastFrame()).toContain("Activate value"));
}

async function assertContained(inputs: ReturnType<typeof fixture>, expected: unknown): Promise<void> {
	expect(inputs.form.fieldDynamic("value").get()).toBe(expected);
	expect(inputs.onSubmit).not.toHaveBeenCalled();
	await vi.waitFor(() => expect(inputs.view.lastFrame()).toContain("Field adapter failed"));
	expect(inputs.view.frames.join("\n")).not.toContain(leak);
	inputs.view.unmount();
	inputs.form.dispose();
}

describe("malformed custom codec containment", () => {
	it("blocks text commit and a following submit when ok:true lacks an own value", async () => {
		const inputs = fixture(
			{ path: "value", type: "string", required: true, metadata: { title: "Value" } },
			textCodec(() => malformed()),
			"canonical",
		);
		await enterField(inputs);
		expect(inputs.capability.dispatch("enter")).toBe(true);
		inputs.textInput.emit("X");
		expect(inputs.capability.dispatch("enter")).toBe(true);
		expect(inputs.capability.dispatch("form-submit")).toBe(true);
		await assertContained(inputs, "canonical");
	});

	it("blocks submit-time text flush for malformed failures and ignores arbitrary error fields", async () => {
		const malformedFailure = { ok: false, message: leak, error: leak } as unknown as TuiCodecResult<string>;
		const inputs = fixture(
			{ path: "value", type: "string", required: true, metadata: { title: "Value" } },
			textCodec(() => malformedFailure),
			"canonical",
		);
		await enterField(inputs);
		expect(inputs.capability.dispatch("enter")).toBe(true);
		inputs.textInput.emit("X");
		expect(inputs.capability.dispatch("form-submit")).toBe(true);
		await assertContained(inputs, "canonical");
	});

	it("blocks a text codec success carrying the wrong control-specific value kind", async () => {
		const inputs = fixture(
			{ path: "value", type: "string", required: true, metadata: { title: "Value" } },
			textCodec(() => ({ ok: true, value: false })),
			"canonical",
		);
		await enterField(inputs);
		expect(inputs.capability.dispatch("enter")).toBe(true);
		inputs.textInput.emit("X");
		expect(inputs.capability.dispatch("form-submit")).toBe(true);
		await assertContained(inputs, "canonical");
	});

	it("blocks boolean writes and submission when next-value validation is malformed", async () => {
		const codec: TuiFieldCodec = {
			mode: "boolean",
			toDraft: (value) => (value === true ? { ok: true, value: true } : malformed()),
			acceptsDraft: () => false,
			fromDraft: () => ({ ok: false, code: "not-editable" }),
		};
		const inputs = fixture(
			{ path: "value", type: "boolean", required: false, metadata: { title: "Value" } },
			codec,
			true,
		);
		await enterField(inputs);
		expect(inputs.capability.dispatch("enter")).toBe(true);
		expect(inputs.capability.dispatch("form-submit")).toBe(true);
		await assertContained(inputs, true);
	});

	it.each(["enter", "form-submit"])("blocks select %s writes when option validation is malformed", async (action) => {
		const options: readonly FormbarOption[] = [
			{ title: "Alpha", value: "a" },
			{ title: "Beta", value: "b" },
		];
		const codec: TuiFieldCodec = {
			mode: "select",
			options,
			toDraft: (value) => (value === "a" ? { ok: true, value: "" } : malformed()),
			acceptsDraft: () => true,
			fromDraft: () => ({ ok: false, code: "not-editable" }),
		};
		const inputs = fixture({ path: "value", type: "string", required: true, metadata: { title: "Value" } }, codec, "a");
		await enterField(inputs);
		expect(inputs.capability.dispatch("enter")).toBe(true);
		expect(inputs.capability.dispatch("arrow-down")).toBe(true);
		expect(inputs.capability.dispatch(action)).toBe(true);
		expect(inputs.capability.dispatch("form-submit")).toBe(true);
		await assertContained(inputs, "a");
	});

	it("blocks malformed acceptsDraft responses before any write or submit", async () => {
		const inputs = fixture(
			{ path: "value", type: "string", required: true, metadata: { title: "Value" } },
			textCodec(
				(draft) => ({ ok: true, value: draft }),
				() => leak as unknown as boolean,
			),
			"canonical",
		);
		await enterField(inputs);
		expect(inputs.capability.dispatch("enter")).toBe(true);
		inputs.textInput.emit("X");
		expect(inputs.capability.dispatch("form-submit")).toBe(true);
		await assertContained(inputs, "canonical");
	});
});
