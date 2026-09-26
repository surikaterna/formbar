import { describe, expect, it, vi } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const definition = {
	version: 1 as const,
	id: "authored",
	root: {
		type: "group" as const,
		id: "root",
		children: [
			{
				type: "repeater" as const,
				id: "outer",
				scope: "o",
				binding: { namespace: "data", segments: ["a.b"] },
				children: [
					{
						type: "repeater" as const,
						id: "inner",
						scope: "i",
						binding: { namespace: "data", scope: "o", segments: ["0"] },
						children: [
							{
								type: "field" as const,
								id: "leaf",
								widget: "text",
								binding: { namespace: "data", scope: "i", segments: ["deep.key"] },
							},
						],
					},
				],
			},
		],
	},
};

describe("prepared definition scoped sync", () => {
	it("owns authored and generated prepared factories before eager init or deferred activation", () => {
		const schema = { type: "object", properties: { name: { type: "string" } } };
		for (const preparation of [
			{ generation: {} },
			{
				definition: { version: 1 as const, id: "authored", root: { type: "group" as const, id: "root", children: [] } },
			},
		]) {
			const prepared = createSchemaForm(schema, { provider: jsonSchemaProvider(), side: "input", ...preparation });
			const init = vi.fn(({ getState, initialData }) => {
				expect(Object.isFrozen(getState().data)).toBe(true);
				expect(Object.isFrozen(initialData)).toBe(true);
			});
			const options = {
				initialData: { name: "Ada" },
				ownedScheduling: true as const,
				plugins: [{ id: "init", onInit: init }],
			};
			const eager = prepared.createForm(options);
			expect(init).toHaveBeenCalledTimes(1);
			const deferred = prepared.createDeferredForm(options);
			expect(Object.isFrozen(deferred.form.getState().data)).toBe(true);
			expect(init).toHaveBeenCalledTimes(1);
			deferred.activate();
			expect(init).toHaveBeenCalledTimes(2);
			eager.dispose();
			deferred.form.dispose();
		}
	});
	it("registers the generated field ID, not its data path", () => {
		const schema = { type: "object", properties: { name: { type: "string" } } };
		const generated = createSchemaForm(schema, { provider: jsonSchemaProvider(), side: "input", generation: {} });
		const root = generated.definition.root;
		if (root.type !== "group" || root.children[0]?.type !== "field") throw new Error("Missing generated field");
		const fieldId = root.children[0].id;
		const prepared = createSchemaForm(schema, {
			provider: jsonSchemaProvider(),
			side: "input",
			generation: {},
			fieldValidators: [{ fieldId, validate: () => [{ code: "generated", message: "bad", severity: "error" }] }],
		});
		expect(prepared.createForm({ initialData: { name: "Ada" } }).validate()[0]).toMatchObject({
			code: "generated",
			path: { namespace: "data", segments: ["name"] },
		});
		expect(() =>
			createSchemaForm(schema, {
				provider: jsonSchemaProvider(),
				side: "input",
				generation: {},
				fieldValidators: [{ fieldId: "name", validate: () => [] }],
			}),
		).toThrow();
	});
	it("fans out current two-level rows without coercing dotted keys or string zero", () => {
		const observed: unknown[] = [];
		const prepared = createSchemaForm(
			{},
			{
				provider: jsonSchemaProvider(),
				side: "input",
				definition,
				fieldValidators: [
					{
						fieldId: "leaf",
						validate: ({ field }) => {
							observed.push([field.instance.scopes, field.binding.segments]);
							return [{ code: "bad", message: "bad", severity: "error" }];
						},
					},
				],
			},
		);
		const form = prepared.createForm({ initialData: { "a.b": [{ "0": [{ "deep.key": "x" }, { "deep.key": "y" }] }] } });
		expect(form.validate().map((issue) => issue.path.segments)).toEqual([
			["a.b", 0, "0", 0, "deep.key"],
			["a.b", 0, "0", 1, "deep.key"],
		]);
		expect(observed).toHaveLength(2);
		form.reset({ data: { "a.b": [] } });
		expect(form.validate()).toEqual([]);
	});

	it("rejects nonfield, unknown and duplicate IDs at preparation", () => {
		for (const ids of [["outer"], ["not-a-field"], ["leaf", "leaf"]]) {
			expect(() =>
				createSchemaForm(
					{},
					{
						provider: jsonSchemaProvider(),
						side: "input",
						definition,
						fieldValidators: ids.map((fieldId) => ({ fieldId, validate: () => [] })),
					},
				),
			).toThrow();
		}
	});

	it("exposes only host-authored typed issues, never caller issue metadata", () => {
		const field = {
			version: 1 as const,
			id: "one",
			root: {
				type: "field" as const,
				id: "leaf",
				widget: "text",
				binding: { namespace: "data", segments: ["a.b"] },
			},
		};
		const prepare = (validate: () => readonly unknown[]) =>
			createSchemaForm(
				{},
				{
					provider: jsonSchemaProvider(),
					side: "input",
					definition: field,
					fieldValidators: [{ fieldId: "leaf", validate: validate as never }],
				},
			).createForm({ initialData: { "a.b": "x" } });
		const owned = prepare(() => [{ code: "bad", message: "bad", severity: "error" }]);
		const [issue] = owned.validate("review");
		expect(issue).toMatchObject({ stage: "review", path: { namespace: "data", segments: ["a.b"] } });
		expect(Object.isFrozen(issue)).toBe(true);
		owned.dispose();
		for (const extra of [
			{ source: "scoped" },
			{ path: { namespace: "data", segments: ["a.b"] } },
			{ descendant: [0] },
			{ descendant: ["missing"] },
		]) {
			const form = prepare(() => [{ code: "bad", message: "bad", severity: "error", ...extra }]);
			expect(() => form.validate()).toThrow();
			form.dispose();
		}
	});

	it("invokes a hidden conditional branch and rejects shared field bindings", () => {
		const branch = {
			version: 1 as const,
			id: "branches",
			root: {
				type: "conditional" as const,
				id: "choice",
				condition: { kind: "literal" as const, value: true },
				then: [{ type: "field" as const, id: "on", widget: "text", binding: { namespace: "data", segments: ["on"] } }],
				else: [
					{ type: "field" as const, id: "off", widget: "text", binding: { namespace: "data", segments: ["off"] } },
				],
			},
		};
		const config = {
			provider: jsonSchemaProvider(),
			side: "input" as const,
			definition: branch,
			fieldValidators: ["on", "off"].map((fieldId) => ({
				fieldId,
				validate: () => [{ code: fieldId, message: fieldId, severity: "error" as const }],
			})),
		};
		const form = createSchemaForm({}, config).createForm({ initialData: { on: "yes", off: "no" } });
		expect(form.validate().map((issue) => issue.code)).toEqual(["on", "off"]);
		const overlap = {
			...branch,
			root: { ...branch.root, else: [{ ...branch.root.else[0], binding: { namespace: "data", segments: ["on"] } }] },
		};
		const unsafe = createSchemaForm({}, { ...config, definition: overlap }).createForm({ initialData: { on: "yes" } });
		expect(() => unsafe.validate()).toThrow("overlapping");
	});
});
