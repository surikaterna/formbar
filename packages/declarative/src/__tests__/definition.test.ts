import { describe, expect, it, vi } from "vitest";
import { validateFormDefinition } from "../index.js";
import { binding, completeDefinition, literal, ref } from "./fixtures.js";

describe("version 1 form definitions", () => {
	it("validates every closed node variant and returns a JSON-round-trippable canonical definition", () => {
		const result = validateFormDefinition(completeDefinition());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.root.type).toBe("group");
		expect(JSON.parse(JSON.stringify(result.value))).toEqual(JSON.parse(JSON.stringify(completeDefinition())));
		const repeated = validateFormDefinition(JSON.parse(JSON.stringify(result.value)));
		expect(repeated).toEqual(result);
	});

	it("accepts nested lexical repeater bindings and expressions but rejects inaccessible scopes", () => {
		expect(validateFormDefinition(completeDefinition()).ok).toBe(true);
		const invalid = completeDefinition() as { root: { children: unknown[] } };
		invalid.root.children.push({ type: "field", id: "escaped", binding: binding(["sku"], "line"), widget: "text" });
		const result = validateFormDefinition(invalid);
		expect(result).toMatchObject({ ok: false });
		if (!result.ok) expect(result.diagnostics.map(({ code }) => code)).toContain("unknown-scope");
	});

	it("uses the public expression compiler for operators, direct writable props, and malformed expressions", () => {
		const valid = completeDefinition() as { root: { children: unknown[] } };
		valid.root.children.push({
			type: "field",
			id: "quantity",
			binding: binding(["quantity"]),
			widget: "number",
			props: { value: { mode: "write", expression: ref(["quantity"]) } },
		});
		expect(validateFormDefinition(valid).ok).toBe(true);

		const invalid = completeDefinition() as { root: { visible: unknown } };
		invalid.root.visible = { kind: "op", op: "not-owned-here", args: [literal(true)] };
		const result = validateFormDefinition(invalid);
		expect(result).toMatchObject({ ok: false });
		if (!result.ok)
			expect(result.diagnostics).toContainEqual(
				expect.objectContaining({ code: "invalid-expression", path: ["root", "visible"] }),
			);
	});

	it("accepts field-only conditional required and validates lifecycle reference shapes", () => {
		const valid = completeDefinition() as { root: { children: unknown[] } };
		valid.root.children.push({
			type: "field",
			id: "conditional-required",
			binding: binding(["quantity"]),
			widget: "number",
			required: { kind: "ref", ref: { namespace: "form", segments: ["submitted"] } },
			visible: { kind: "ref", ref: { namespace: "field", segments: ["name", "valid"] } },
		});
		expect(validateFormDefinition(valid).ok).toBe(true);

		for (const expression of [
			{ kind: "ref", ref: { namespace: "form", segments: ["unknown"] } },
			{ kind: "ref", ref: { namespace: "field", segments: ["name", "visible"] } },
			{ kind: "ref", ref: { namespace: "field", segments: ["name", "dirty", "extra"] } },
		]) {
			const invalid = completeDefinition() as { root: { visible: unknown } };
			invalid.root.visible = expression;
			expect(validateFormDefinition(invalid)).toMatchObject({ ok: false });
		}
	});

	it.each([
		["unsupported version", { ...completeDefinition(), version: 2 }, "unsupported-version"],
		["unknown node", { ...completeDefinition(), root: { type: "portal", id: "root" } }, "unknown-node-type"],
		["unknown property", { ...completeDefinition(), schema: {} }, "unknown-key"],
		[
			"malformed binding",
			{
				...completeDefinition(),
				root: { type: "field", id: "x", widget: "text", binding: { namespace: "data", segments: ["__proto__"] } },
			},
			"invalid-binding",
		],
	])("rejects %s", (_name, definition, code) => {
		const result = validateFormDefinition(definition);
		expect(result).toMatchObject({ ok: false });
		if (!result.ok) expect(result.diagnostics.map((item) => item.code)).toContain(code);
	});

	it("rejects duplicate node and scope IDs with deterministically sorted diagnostics", () => {
		const definition = {
			version: 1,
			id: "duplicates",
			root: {
				type: "group",
				id: "root",
				children: [
					{ type: "group", id: "same", children: [] },
					{ type: "group", id: "same", children: [] },
					{ type: "repeater", id: "a", scope: "row", binding: binding(["a"]), children: [] },
					{ type: "repeater", id: "b", scope: "row", binding: binding(["b"]), children: [] },
				],
			},
		};
		const first = validateFormDefinition(definition);
		const second = validateFormDefinition(definition);
		expect(first).toEqual(second);
		if (!first.ok) {
			expect(first.diagnostics.map(({ code }) => code)).toEqual(["duplicate-node-id", "duplicate-scope"]);
		}
	});

	it("rejects executable, accessor, symbol, non-finite, and unsafe-prototype input without invoking it", () => {
		const getter = vi.fn(() => "root");
		const accessor = {
			...completeDefinition(),
			root: Object.defineProperty({}, "id", { get: getter, enumerable: true }),
		};
		const unsafe = Object.assign(Object.create({ inherited: true }), completeDefinition());
		for (const input of [
			accessor,
			unsafe,
			{ ...completeDefinition(), extra: () => true },
			{ ...completeDefinition(), extra: Symbol("x") },
			{ ...completeDefinition(), extra: Number.NaN },
		]) {
			expect(validateFormDefinition(input)).toMatchObject({
				ok: false,
				diagnostics: [{ code: "invalid-json", path: [] }],
			});
		}
		expect(getter).not.toHaveBeenCalled();
	});
});
