import { describe, expect, it, vi } from "vitest";
import { admitKaladaDefinition } from "../../../packages/declarative/src/validators/kalada-definition.js";

const program = (expression: unknown) => ({ format: "kalada-program", version: 1, profile: "kalada-v1", expression });
const read = (segments: string[], scope?: string) =>
	program({ kind: "ref", ref: { namespace: "data", segments, ...(scope ? { scope } : {}) } });
const literal = program({ kind: "literal", value: true });
const thenKey = "then";
const binding = (segments: string[], scope?: string) => ({ namespace: "data", segments, ...(scope ? { scope } : {}) });
const props = () => ({
	text: { mode: "read", expression: read(["name"]) },
	input: { mode: "write", reference: binding(["name"]) },
	label: { mode: "literal", value: "hello" },
});

function definition() {
	return {
		version: 1,
		id: "form",
		root: {
			type: "group",
			id: "root",
			visible: literal,
			children: [
				{
					type: "section",
					id: "section",
					disabled: literal,
					children: [
						{
							type: "repeater",
							id: "orders",
							scope: "orders",
							binding: binding(["orders"]),
							readOnly: literal,
							children: [
								{
									type: "custom",
									id: "custom",
									renderer: "card",
									props: props(),
									children: [
										{
											type: "repeater",
											id: "lines",
											scope: "lines",
											binding: binding(["items"], "orders"),
											children: [
												{
													type: "conditional",
													id: "gate",
													condition: read(["ready"], "lines"),
													[thenKey]: [
														{
															type: "tabs",
															id: "tabs",
															tabs: [
																{
																	id: "tab",
																	label: "one",
																	children: [
																		{
																			type: "field",
																			id: "field",
																			widget: "text",
																			binding: binding(["value"], "lines"),
																			required: literal,
																			props: props(),
																		},
																	],
																},
															],
														},
													],
													else: [
														{
															type: "accordion",
															id: "accordion",
															items: [
																{
																	id: "item",
																	label: "two",
																	children: [
																		{
																			type: "action",
																			id: "action",
																			action: "array.append",
																			target: binding(["items"], "orders"),
																			payload: read(["value"], "lines"),
																			props: props(),
																		},
																		{ type: "output", id: "output", value: read(["value"], "lines"), props: props() },
																	],
																},
															],
														},
													],
												},
											],
										},
									],
								},
							],
						},
					],
				},
			],
		},
		computations: [{ id: "computed", target: binding(["total"]), expression: read(["amount"]) }],
	};
}

describe("private FormDefinition Kalada inventory (not public validation)", () => {
	it("checks validation bindings in their lexical frame and inventories string messages", () => {
		const path = "root.children[0].children[0]";
		const entry: { type: string; id: string; binding?: unknown; messages?: unknown } = {
			type: "validation",
			id: "errors",
			binding: binding(["sku"], "rows"),
			messages: ["required", "invalid"],
		};
		const input = {
			version: 1,
			id: "form",
			root: {
				type: "group",
				id: "root",
				children: [{ type: "repeater", id: "repeat", scope: "rows", binding: binding(["rows"]), children: [entry] }],
			},
		};
		const admitted = admitKaladaDefinition(input);
		expect(admitted.targets.get(`${path}.binding`)).toEqual({
			namespace: "data",
			path: ["rows", { row: "rows" }, "sku"],
		});
		expect(admitted.nodes.get("errors")?.enclosingScope).toBe("rows");
		const missing = structuredClone(input);
		missing.root.children[0].children[0] = { type: "validation", id: "errors" };
		expect(() => admitKaladaDefinition(missing)).toThrow(`${path}.binding: INVALID_BINDING`);
		entry.binding = binding(["sku"], "missing");
		expect(() => admitKaladaDefinition(input)).toThrow(`${path}.binding: INVALID_BINDING`);
		entry.binding = { namespace: "ui", segments: ["sku"], scope: "rows" };
		expect(() => admitKaladaDefinition(input)).toThrow(`${path}.binding: INVALID_BINDING`);
		entry.binding = binding(["sku"], "rows");
		entry.messages = ["ok", 1];
		expect(() => admitKaladaDefinition(input)).toThrow(`${path}.messages[1]: INVALID_SHAPE`);
		entry.messages = "wrong";
		expect(() => admitKaladaDefinition(input)).toThrow(`${path}.messages: INVALID_SHAPE`);
	});

	it("visits every expression slot, lexical scopes and direct targets without executing anything", () => {
		const execute = vi.fn();
		const input = definition();
		const result = admitKaladaDefinition(input);
		const paths = result.slots.map(({ path }) => path);
		expect(paths).toEqual([
			"root.visible",
			"root.children[0].disabled",
			"root.children[0].children[0].readOnly",
			"root.children[0].children[0].children[0].props.text.expression",
			"root.children[0].children[0].children[0].children[0].children[0].condition",
			"root.children[0].children[0].children[0].children[0].children[0].then[0].tabs[0].children[0].required",
			"root.children[0].children[0].children[0].children[0].children[0].then[0].tabs[0].children[0].props.text.expression",
			"root.children[0].children[0].children[0].children[0].children[0].else[0].items[0].children[0].payload",
			"root.children[0].children[0].children[0].children[0].children[0].else[0].items[0].children[0].props.text.expression",
			"root.children[0].children[0].children[0].children[0].children[0].else[0].items[0].children[1].value",
			"root.children[0].children[0].children[0].children[0].children[0].else[0].items[0].children[1].props.text.expression",
			"computations[0].expression",
		]);
		expect(result.slots.find(({ path }) => path.endsWith(".condition"))?.dependencies).toEqual([
			{ namespace: "data", path: ["orders", { row: "orders" }, "items", { row: "lines" }, "ready"] },
		]);
		expect(result.fields.get("field")?.enclosingScope).toBe("lines");
		expect(result.aliases.size).toBe(2);
		expect(result.targets.has("computations[0].target")).toBe(true);
		expect(result.targets.has("root.children[0].children[0].children[0].props.input.reference")).toBe(true);
		expect(result.slots.some(({ path }) => path.endsWith("reference") || path.endsWith("target"))).toBe(false);
		expect(execute).not.toHaveBeenCalled();
	});

	it("rejects old expressions at each actual declaration path", () => {
		const valid = definition();
		const paths = admitKaladaDefinition(valid).slots.map(({ path }) => path);
		const sibling = "root.children[0].children[0].children[0].props.text.expression";
		for (const path of paths) {
			const candidate: Record<string, unknown> = structuredClone(valid);
			const parts = path.replaceAll("[", ".").replaceAll("]", "").split(".");
			let cursor: Record<string, unknown> = candidate;
			for (const part of parts.slice(0, -1)) cursor = cursor[part] as Record<string, unknown>;
			cursor[parts.at(-1) as string] = { kind: "literal", value: true };
			expect(() => admitKaladaDefinition(candidate), path).toThrow(`${path}: RE-AUTHOR`);
			if (path.includes(".props.text.expression") && path !== sibling) {
				const siblingParts = sibling.replaceAll("[", ".").replaceAll("]", "").split(".");
				let siblingCursor: Record<string, unknown> = candidate;
				for (const part of siblingParts) siblingCursor = siblingCursor[part] as Record<string, unknown>;
				expect(siblingCursor).toEqual(read(["name"]));
				cursor[parts.at(-1) as string] = read(["name"]);
				expect(admitKaladaDefinition(candidate).slots.some((slot) => slot.path === sibling)).toBe(true);
			}
		}
	});

	it("rejects invalid direct writes, scope leaks, unsafe input and duplicate IDs with paths", () => {
		const valid = definition();
		const field = valid.root.children[0].children[0].children[0].children[0].children[0].then[0].tabs[0].children[0];
		field.props = { ...field.props, input: { mode: "write", expression: read(["name"]) } } as typeof field.props;
		expect(() => admitKaladaDefinition(valid)).toThrow(
			"root.children[0].children[0].children[0].children[0].children[0].then[0].tabs[0].children[0].props.input.expression: UNKNOWN_KEY",
		);
		field.props = props();
		expect(
			admitKaladaDefinition(valid).slots.some(
				({ path }) => path === "root.children[0].children[0].children[0].props.text.expression",
			),
		).toBe(true);
		field.required = read(["x"], "unknown");
		expect(() => admitKaladaDefinition(valid)).toThrow(".required.expression.ref: KALADA_INVALID_REFERENCE");
		field.required = literal;
		field.id = "gate";
		expect(() => admitKaladaDefinition(valid)).toThrow(".id: DUPLICATE_NODE_ID");
		const getter = vi.fn();
		expect(() =>
			admitKaladaDefinition(Object.defineProperty({ ...valid }, "bad", { enumerable: true, get: getter })),
		).toThrow("INVALID_JSON");
		expect(getter).not.toHaveBeenCalled();
	});

	it("rejects computed or non-data write targets, bare programs, and non-JSON literals", () => {
		const valid = definition();
		const field = valid.root.children[0].children[0].children[0].children[0].children[0].then[0].tabs[0].children[0];
		const path = "root.children[0].children[0].children[0].children[0].children[0].then[0].tabs[0].children[0]";
		const input = field.props.input;
		field.props = { ...field.props, input: { mode: "write", reference: read(["name"]) } } as typeof field.props;
		expect(() => admitKaladaDefinition(valid)).toThrow(`${path}.props.input.reference: INVALID_BINDING`);
		field.props = {
			...field.props,
			input: { mode: "write", reference: { namespace: "ui", segments: ["name"] } },
		} as typeof field.props;
		expect(() => admitKaladaDefinition(valid)).toThrow(`${path}.props.input.reference: INVALID_BINDING`);
		field.props = { ...field.props, input };
		field.required = { kind: "literal", value: true } as typeof field.required;
		expect(() => admitKaladaDefinition(valid)).toThrow(`${path}.required: RE-AUTHOR`);
		field.required = literal;
		field.props = { ...field.props, label: { mode: "literal", value: () => true } } as typeof field.props;
		expect(() => admitKaladaDefinition(valid)).toThrow("INVALID_JSON");
	});
});
