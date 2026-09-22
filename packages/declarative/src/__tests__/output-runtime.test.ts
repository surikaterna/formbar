import { describe, expect, it, vi } from "vitest";
import type { FormDefinition, OutputNode, ResolvedOutputState, createFormRuntime } from "../index.js";
import { validateFormDefinition } from "../index.js";
import { dataRef, definition, literal, node, op, runtime } from "./runtime-fixtures.js";

const output = (id: string, value: OutputNode["value"], extra = {}): OutputNode => ({
	type: "output",
	id,
	value,
	...extra,
});

const resolvedOutput = (port: ReturnType<typeof createFormRuntime>, id: string, index = 0): ResolvedOutputState => {
	const state = node(port, id, index);
	if (state?.type !== "output") throw new Error(`Missing output ${id}`);
	return state;
};

describe("output definition validation", () => {
	it.each(["plain", "number", "currency-usd", "percent"] as const)("accepts the %s format", (format) => {
		const result = validateFormDefinition({
			version: 1,
			id: "formats",
			root: output("value", literal(1), { label: "Total", format }),
		});
		expect(result).toMatchObject({ ok: true, value: { root: { label: "Total", format } } });
	});

	it("rejects unknown formatter IDs at their exact path", () => {
		const result = validateFormDefinition({
			version: 1,
			id: "formats",
			root: output("value", literal(1), { format: "host-code" as never }),
		});
		expect(result).toEqual({
			ok: false,
			diagnostics: [
				{
					code: "unsupported-output-format",
					path: ["root", "format"],
					message: "Unsupported output format 'host-code'.",
				},
			],
		});
	});
});

describe("output runtime projection", () => {
	it("preserves successful scalar, null, and object results as raw values", () => {
		const formDefinition = definition([
			output("sum", op("add", dataRef(["quantity"]), dataRef(["bonus"]))),
			output("empty", dataRef(["empty"])),
			output("object", dataRef(["details"])),
		]);
		const { runtime: port } = runtime(formDefinition, {
			initialData: { quantity: 2, bonus: 3, empty: null, details: { exact: true } },
		});
		expect(resolvedOutput(port, "sum").output).toEqual({ status: "ready", value: 5 });
		expect(resolvedOutput(port, "empty").output).toEqual({ status: "ready", value: null });
		expect(resolvedOutput(port, "object").output).toEqual({ status: "ready", value: { exact: true } });
	});

	it.each([
		["missing", dataRef(["absent"]), "missing"],
		["denied", { kind: "ref", ref: { namespace: "secret", segments: ["value"] } }, "denied"],
		["type", op("add", literal("one"), literal(1)), "type"],
		["division", op("div", literal(1), literal(0)), "division-zero"],
		["non-finite", op("mul", literal(Number.MAX_VALUE), literal(2)), "non-finite"],
	] as const)("fails closed for %s expressions with code-only diagnostics", (_name, expression, code) => {
		const { runtime: port } = runtime(definition([output("result", expression)]), { initialData: {} });
		expect(resolvedOutput(port, "result").output).toEqual({ status: "error", code });
		expect(port.getSnapshot().diagnostics).toEqual([
			{
				code: "expression",
				nodeId: "result",
				instanceKey: JSON.stringify(["result", []]),
				property: "value",
				expressionCode: code,
			},
		]);
	});

	it("does not evaluate or diagnose a hidden output value", () => {
		const hidden = output("hidden", dataRef(["absent"]), { visible: literal(false) });
		const { runtime: port } = runtime(definition([hidden]), { initialData: {} });
		expect(resolvedOutput(port, "hidden")).toMatchObject({ visible: false, output: { status: "hidden" } });
		expect(port.getSnapshot().diagnostics).toEqual([]);
	});

	it("reacts to edits and reset replacement without retaining stale values", () => {
		const formDefinition = definition([output("ratio", op("div", dataRef(["amount"]), dataRef(["count"])))]);
		const { form, runtime: port } = runtime(formDefinition, { initialData: { amount: 10, count: 2 } });
		expect(resolvedOutput(port, "ratio").output).toEqual({ status: "ready", value: 5 });
		form.setValue("amount", 12);
		expect(resolvedOutput(port, "ratio").output).toEqual({ status: "ready", value: 6 });
		form.setValue("count", 0);
		expect(resolvedOutput(port, "ratio").output).toEqual({ status: "error", code: "division-zero" });
		form.reset();
		expect(resolvedOutput(port, "ratio").output).toEqual({ status: "ready", value: 5 });
		form.reset({ data: { amount: 21, count: 3 } });
		expect(resolvedOutput(port, "ratio").output).toEqual({ status: "ready", value: 7 });
	});

	it("resolves lexical repeater scopes for each output instance", () => {
		const formDefinition = definition([
			{
				type: "repeater",
				id: "lines",
				binding: { namespace: "data", segments: ["lines"] },
				scope: "line",
				children: [output("line-total", op("mul", dataRef(["quantity"], "line"), dataRef(["price"], "line")))],
			},
		]);
		const { runtime: port } = runtime(formDefinition, {
			initialData: {
				lines: [
					{ quantity: 2, price: 4 },
					{ quantity: 3, price: 5 },
				],
			},
		});
		expect(resolvedOutput(port, "line-total", 0).output).toEqual({ status: "ready", value: 8 });
		expect(resolvedOutput(port, "line-total", 1).output).toEqual({ status: "ready", value: 15 });
	});

	it("never writes output values or changes core lifecycle, issues, or submitted payload", async () => {
		const submitted = vi.fn();
		const formDefinition = definition([output("total", op("mul", dataRef(["quantity"]), literal(5)))]);
		const { form, runtime: port } = runtime(formDefinition, {
			initialData: { quantity: 2 },
			onSubmit: async ({ payload }) => {
				submitted(payload);
				return { ok: true, submitId: "output" };
			},
		});
		expect(resolvedOutput(port, "total").output).toEqual({ status: "ready", value: 10 });
		expect(form.getState()).toMatchObject({ data: { quantity: 2 }, issues: [], fieldMeta: {} });
		expect(form.isDirty()).toBe(false);
		expect(form.isTouched()).toBe(false);
		await form.submit();
		expect(submitted).toHaveBeenCalledWith({ quantity: 2 });
		expect(form.getState().data).toEqual({ quantity: 2 });
	});
});

const publicDefinition: FormDefinition = {
	version: 1,
	id: "public-output",
	root: output("public", literal(true), { format: "plain" }),
};
void publicDefinition;
