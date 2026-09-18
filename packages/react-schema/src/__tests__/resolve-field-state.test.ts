import type { LayoutNode } from "@formbar/from-schema";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_FIELD_STATE,
	descriptionId,
	errorId,
	fieldId,
	pruneHiddenFields,
	resolveFieldStates,
} from "../resolve-field-state.js";

describe("resolveFieldStates", () => {
	it("returns default state for fields with no uiState overrides", () => {
		const result = resolveFieldStates({}, ["name", "email"]);
		expect(result.get("name")).toEqual(DEFAULT_FIELD_STATE);
		expect(result.get("email")).toEqual(DEFAULT_FIELD_STATE);
	});

	it("resolves visible=false from uiState", () => {
		const uiState = { "foo.visible": false };
		const result = resolveFieldStates(uiState, ["foo", "bar"]);
		expect(result.get("foo")?.visible).toBe(false);
		expect(result.get("bar")?.visible).toBe(true);
	});

	it("resolves readOnly and disabled from uiState", () => {
		const uiState = {
			"name.readOnly": true,
			"name.disabled": true,
		};
		const result = resolveFieldStates(uiState, ["name"]);
		expect(result.get("name")).toEqual({
			visible: true,
			readOnly: true,
			disabled: true,
		});
	});

	it("coerces truthy/falsy values to booleans", () => {
		const uiState = {
			"x.visible": 0,
			"x.readOnly": 1,
			"x.disabled": "",
		};
		const result = resolveFieldStates(uiState, ["x"]);
		expect(result.get("x")).toEqual({
			visible: false,
			readOnly: true,
			disabled: false,
		});
	});

	it("keeps compatibility with shared presentation state and IDs", async () => {
		const shared = await import("@formbar/from-schema");
		const uiState = { "x.visible": "yes", "x.readOnly": 0, "x.disabled": 1 };
		expect(resolveFieldStates(uiState, ["x"])).toEqual(shared.resolveFieldStates(uiState, ["x"]));
		expect([fieldId("items[0].name"), descriptionId("x"), errorId("x")]).toEqual([
			shared.fieldId("items[0].name"),
			shared.descriptionId("x"),
			shared.errorId("x"),
		]);
	});
});

describe("pruneHiddenFields", () => {
	const makeField = (path: string): LayoutNode => ({
		type: "field",
		id: `field-${path}`,
		path,
	});

	const makeGroup = (children: readonly LayoutNode[]): LayoutNode => ({
		type: "group",
		id: "group-1",
		children,
	});

	it("removes field nodes where visible=false", () => {
		const tree = makeGroup([makeField("foo"), makeField("bar")]);
		const states = new Map([
			["foo", { visible: false, readOnly: false, disabled: false }],
			["bar", { visible: true, readOnly: false, disabled: false }],
		]);

		const result = pruneHiddenFields(tree, states);
		expect(result).not.toBeNull();
		expect(result?.children).toHaveLength(1);
		expect(result?.children?.[0].path).toBe("bar");
	});

	it("keeps all fields when all are visible", () => {
		const tree = makeGroup([makeField("a"), makeField("b")]);
		const states = new Map<string, { visible: boolean; readOnly: boolean; disabled: boolean }>();

		const result = pruneHiddenFields(tree, states);
		expect(result?.children).toHaveLength(2);
	});

	it("does not mutate the original tree", () => {
		const tree = makeGroup([makeField("foo"), makeField("bar")]);
		const original = tree.children?.length;
		const states = new Map([["foo", { visible: false, readOnly: false, disabled: false }]]);

		pruneHiddenFields(tree, states);
		expect(tree.children).toHaveLength(original);
	});

	it("handles nested groups", () => {
		const tree = makeGroup([makeGroup([makeField("nested")])]);
		const states = new Map([["nested", { visible: false, readOnly: false, disabled: false }]]);

		const result = pruneHiddenFields(tree, states);
		expect(result?.children?.[0].children).toHaveLength(0);
	});
});
