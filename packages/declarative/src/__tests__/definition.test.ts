import { describe, expect, it, vi } from "vitest";
import { validateFormDefinition } from "../index.js";
import { binding, completeDefinition, literal, ref } from "./fixtures.js";

describe("version 1 form definitions", () => {
	it("round-trips explicit submission policy and field-only inclusion without changing defaults", () => {
		const legacy = validateFormDefinition(completeDefinition());
		expect(legacy.ok).toBe(true);
		if (!legacy.ok) return;
		expect(legacy.value.submission).toBeUndefined();
		const input = {
			...completeDefinition(),
			submission: { hiddenValues: "omit-inactive" },
			root: {
				type: "group",
				id: "root",
				children: [
					{ type: "field", id: "secret", widget: "text", binding: binding(["secret"]), submitWhenHidden: "include" },
				],
			},
		};
		const result = validateFormDefinition(input);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.submission).toEqual({ hiddenValues: "omit-inactive" });
		expect(result.value.root).toMatchObject(input.root);
		expect(validateFormDefinition(JSON.parse(JSON.stringify(result.value)))).toEqual(result);
		expect(validateFormDefinition({ ...input, submission: { hiddenValues: "include" } })).toMatchObject({
			ok: true,
			value: { submission: { hiddenValues: "include" } },
		});
	});

	it.each([
		[{ hiddenValues: "discard" }, ["submission", "hiddenValues"], "invalid-type"],
		[{ hiddenValues: "include", extra: true }, ["submission", "extra"], "unknown-key"],
		[{}, ["submission", "hiddenValues"], "required"],
		[null, ["submission"], "invalid-type"],
		[[], ["submission"], "invalid-type"],
	])("rejects invalid submission %j", (submission, path, code) => {
		const result = validateFormDefinition({ ...completeDefinition(), submission });
		expect(result).toMatchObject({ ok: false });
		if (!result.ok) expect(result.diagnostics).toContainEqual(expect.objectContaining({ path, code }));
	});

	it("rejects invalid field overrides and overrides on every non-field node", () => {
		for (const value of ["omit-inactive", false, null]) {
			const result = validateFormDefinition({
				version: 1,
				id: "invalid",
				root: { type: "field", id: "f", binding: binding(["x"]), widget: "text", submitWhenHidden: value },
			});
			expect(result).toMatchObject({ ok: false });
			if (!result.ok)
				expect(result.diagnostics).toContainEqual(expect.objectContaining({ path: ["root", "submitWhenHidden"] }));
		}
		for (const child of (completeDefinition().root as { children: unknown[] }).children) {
			const result = validateFormDefinition({
				version: 1,
				id: "invalid",
				root: { ...(child as object), submitWhenHidden: "include" },
			});
			if ((child as { type: string }).type === "field") continue;
			expect(result).toMatchObject({ ok: false });
			if (!result.ok)
				expect(result.diagnostics).toContainEqual(
					expect.objectContaining({ code: "unknown-key", path: ["root", "submitWhenHidden"] }),
				);
		}
	});
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

	it("validates exact action concurrency, target, and built-in payload contracts", () => {
		const valid = completeDefinition() as { root: { children: unknown[] } };
		valid.root.children.push({
			type: "action",
			id: "append",
			action: "array.append",
			concurrency: "queue",
			target: binding(["orders"]),
			payload: literal("new"),
		});
		expect(validateFormDefinition(valid).ok).toBe(true);
		for (const node of [
			{ type: "action", id: "missing-target", action: "array.remove" },
			{ type: "action", id: "missing-payload", action: "array.append", target: binding(["orders"]) },
			{ type: "action", id: "submit-payload", action: "submit", payload: literal("secret") },
			{ type: "action", id: "custom-target", action: "save", target: binding(["orders"]) },
			{ type: "action", id: "bad-mode", action: "save", concurrency: "parallel" },
		]) {
			const result = validateFormDefinition({ version: 1, id: "action", root: node });
			expect(result).toMatchObject({ ok: false });
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
