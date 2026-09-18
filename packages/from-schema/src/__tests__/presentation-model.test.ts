import type { ValidationIssue } from "@formbar/core";
import type { SchemaFieldInfo } from "@scheman/core";
import { describe, expect, it } from "vitest";
import type { LayoutNode } from "../layout/layout-types.js";
import {
	createFormPresentation,
	descriptionId,
	errorId,
	fieldId,
	pruneHiddenFields,
	resolveFieldStates,
} from "../presentation-model.js";

const fields: readonly SchemaFieldInfo[] = [
	{
		path: "profile.name",
		type: "string",
		required: true,
		metadata: { label: "Display name", title: "Name", description: "Public name", readOnly: true },
	},
	{ path: "secret", type: "string", required: false },
];

const layout: LayoutNode = {
	type: "group",
	id: "layout-root",
	children: fields.map((field) => ({ type: "field", id: `layout-${field.path}`, path: field.path })),
};

function issue(path: readonly (string | number)[], message: string): ValidationIssue {
	return {
		code: "TEST",
		message,
		severity: "error",
		path: { namespace: "data", segments: path },
		source: { origin: "function-validator", validatorId: "test" },
	};
}

describe("presentation compatibility primitives", () => {
	it("preserves field-state defaults, coercion, and dynamic precedence", () => {
		const states = resolveFieldStates(
			{ "profile.name.readOnly": 0, "profile.name.disabled": 1, "secret.visible": "" },
			[{ path: "profile.name", readOnly: true }, "secret"],
		);
		expect(states.get("profile.name")).toEqual({ visible: true, readOnly: false, disabled: true });
		expect(states.get("secret")?.visible).toBe(false);
	});

	it("prunes into a new visible tree without mutating the source", () => {
		const states = resolveFieldStates(
			{ "secret.visible": false },
			fields.map((field) => field.path),
		);
		const visible = pruneHiddenFields(layout, states);
		expect(visible).not.toBe(layout);
		expect(visible?.children?.map((node) => node.path)).toEqual(["profile.name"]);
		expect(layout.children).toHaveLength(2);
	});

	it("matches the established nested and indexed ID format", () => {
		expect(fieldId("items[0].name")).toBe("field-items-0-name");
		expect(descriptionId("items[0].name")).toBe("field-items-0-name-description");
		expect(errorId("items[0].name")).toBe("field-items-0-name-error");
	});
});

describe("createFormPresentation", () => {
	it("indexes hidden fields and preserves metadata, option identity, and exact issue ownership", () => {
		const options = [{ value: "Ada", title: "Ada" }] as const;
		const exactIssue = issue(["profile", "name"], "Owned");
		const indexedIssue = issue(["items", 0, "name"], "Unowned indexed path");
		const formIssue = issue([], "Form");
		const presentation = createFormPresentation(
			{ fields, layout, metadata: { title: "Profile" }, optionsByPath: new Map([["profile.name", options]]) },
			{ uiState: { "secret.visible": false }, issues: [exactIssue, indexedIssue, formIssue] },
		);

		const name = presentation.fieldsByPath.get("profile.name");
		expect(name).toMatchObject({
			title: "Display name",
			description: "Public name",
			required: true,
			state: { visible: true, readOnly: true, disabled: false },
		});
		expect(name?.metadata).toBe(fields[0]?.metadata);
		expect(name?.options).toBe(options);
		expect(name?.issues).toEqual([exactIssue]);
		expect(presentation.fieldsByPath.get("secret")?.state.visible).toBe(false);
		expect(presentation.layout.children).toHaveLength(1);
		expect(presentation.formIssues).toEqual([indexedIssue, formIssue]);
	});

	it("falls back to the final path segment for a title", () => {
		const presentation = createFormPresentation({ fields, layout, metadata: {} });
		expect(presentation.fieldsByPath.get("secret")?.title).toBe("secret");
	});

	it("returns null when the root field is hidden", () => {
		const root = fields[1];
		if (!root) throw new Error("fixture requires a root field");
		const presentation = createFormPresentation(
			{ fields: [root], layout: { type: "field", id: "layout-secret", path: "secret" }, metadata: {} },
			{ uiState: { "secret.visible": false } },
		);
		expect(presentation.layout).toBeNull();
		expect(presentation.fieldsByPath.has("secret")).toBe(true);
	});

	it("rejects duplicate source field paths deterministically", () => {
		const duplicate = fields[0];
		if (!duplicate) throw new Error("fixture requires a duplicate field");
		expect(() => createFormPresentation({ fields: [duplicate, duplicate], layout, metadata: {} })).toThrowError(
			new TypeError('Duplicate schema field path: "profile.name".'),
		);
	});

	it("rejects layout field paths that have no source field", () => {
		expect(() =>
			createFormPresentation({
				fields,
				layout: { type: "field", id: "layout-unknown", path: "unknown" },
				metadata: {},
			}),
		).toThrowError(new TypeError('Layout field path is not present in schema fields: "unknown".'));
	});

	it.each([
		["absent", { type: "field", id: "layout-invalid" }],
		["empty", { type: "field", id: "layout-invalid", path: "" }],
		["whitespace", { type: "field", id: "layout-invalid", path: " \t " }],
		["non-string", { type: "field", id: "layout-invalid", path: 42 }],
	])("rejects %s layout field paths before membership checks", (_case, invalidLayout) => {
		expect(() =>
			createFormPresentation({ fields, layout: invalidLayout as unknown as LayoutNode, metadata: {} }),
		).toThrowError(new TypeError("Layout field path must be a non-blank string."));
	});
});
