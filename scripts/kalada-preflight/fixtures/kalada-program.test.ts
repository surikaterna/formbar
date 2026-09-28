import { describe, expect, it, vi } from "vitest";
import {
	ProgramAdmissionError,
	admitKaladaProgram,
} from "../../../packages/declarative/src/validators/kalada-program.js";

const program = (expression: unknown) => ({ format: "kalada-program", version: 1, profile: "kalada-v1", expression });
const ref = (segments: (string | number)[], scope?: string, namespace = "data") => ({
	namespace,
	segments,
	...(scope ? { scope } : {}),
});
const read = (reference: unknown) => ({ kind: "ref", ref: reference });
const scopes = {
	orders: { namespace: "data", segments: ["orders"] },
	lines: { namespace: "data", segments: ["items"], parent: "orders" },
	other: { namespace: "data", segments: ["other"] },
};
const slot = "root.children[0].condition";

describe("private Kalada program admission", () => {
	it("stores canonical data and typed static dependencies without evaluating", () => {
		const input = program({
			kind: "boolean-logical",
			operator: "and",
			left: read(ref(["ready"])),
			right: read(ref(["sku"], "lines")),
		});
		const admitted = admitKaladaProgram(input, slot, scopes, "lines");
		expect(admitted.program).toEqual(input);
		expect(admitted.program).not.toBe(input);
		const originalRef = input.expression.right.ref;
		const canonicalRef = admitted.program.expression;
		if (canonicalRef.kind !== "boolean-logical" || canonicalRef.right.kind !== "ref") throw new Error("wrong AST");
		expect(canonicalRef.right.ref).toEqual(originalRef);
		expect(canonicalRef.right.ref).not.toBe(originalRef);
		expect(canonicalRef.right.ref.segments).not.toBe(originalRef.segments);
		expect(Object.keys(canonicalRef.right.ref)).toEqual(["namespace", "segments", "scope"]);
		expect(admitted.dependencies).toEqual([
			{ namespace: "data", path: ["ready"] },
			{ namespace: "data", path: ["orders", { row: "orders" }, "items", { row: "lines" }, "sku"] },
		]);
		expect(admitKaladaProgram(admitted.program, slot, scopes, "lines")).toEqual(admitted);
		expect(Object.hasOwn(admitted, "evaluate")).toBe(false);
		originalRef.segments.push("mutated");
		expect(canonicalRef.right.ref.segments).toEqual(["sku"]);
	});

	it("keeps numeric and string reads distinct without running a resolver", () => {
		const admitted = admitKaladaProgram(
			program({ kind: "boolean-logical", operator: "or", left: read(ref([0])), right: read(ref(["0"])) }),
			slot,
		);
		expect(admitted.dependencies).toEqual([
			{ namespace: "data", path: [0] },
			{ namespace: "data", path: ["0"] },
		]);
	});

	it("rejects legacy slots at the supplied path and malformed envelopes", () => {
		for (const expression of [{ kind: "literal", value: true }, read(ref(["x"])), { kind: "op", op: "and" }]) {
			expect(() => admitKaladaProgram(expression, slot)).toThrow(`${slot}: RE-AUTHOR`);
		}
		const valid = program({ kind: "literal", value: true });
		for (const input of [
			null,
			{ ...valid, format: "other" },
			{ ...valid, version: 2 },
			{ ...valid, profile: "other" },
			{ ...valid, extra: true },
			{ expression: valid.expression },
			program({ kind: "unknown" }),
		]) {
			expect(() => admitKaladaProgram(input, slot)).toThrow(ProgramAdmissionError);
		}
	});

	it("rejects unsafe JSON without invoking accessors or accepting inherited data", () => {
		const getter = vi.fn(() => true);
		const valid = program({ kind: "literal", value: true });
		for (const input of [
			Object.defineProperty({ ...valid }, "extra", { enumerable: true, get: getter }),
			Object.assign(Object.create({ inherited: true }), valid),
			program({ kind: "literal", value: Number.NaN }),
			program({ kind: "literal", value: Array(2) }),
			program({ kind: "literal", value: "x".repeat(17000) }),
			program({ kind: "literal", value: Array(300).fill(0) }),
		]) {
			expect(() => admitKaladaProgram(input, slot)).toThrow(ProgramAdmissionError);
		}
		expect(getter).not.toHaveBeenCalled();
	});

	it("enforces lexical scope, namespace and reference shape with inner diagnostics", () => {
		for (const reference of [
			ref(["x"], "other"),
			ref(["x"], "lines", "ui"),
			ref(["__proto__"]),
			ref(["x"], "missing"),
			ref(["x"], undefined, "admin"),
			ref(["bad"], undefined, "form"),
			ref(["x", "bad"], undefined, "field"),
			{ ...ref(["x"]), extra: true },
			"data.x",
		]) {
			expect(() => admitKaladaProgram(program(read(reference)), slot, scopes, "lines")).toThrow(
				`${slot}.expression.ref: KALADA_INVALID_REFERENCE`,
			);
		}
		expect(admitKaladaProgram(program(read(ref(["valid"], undefined, "form"))), slot).dependencies).toEqual([
			{ namespace: "form", path: ["valid"] },
		]);
		expect(admitKaladaProgram(program(read(ref(["name", "valid"], undefined, "field"))), slot).dependencies).toEqual([
			{ namespace: "field", path: ["name", "valid"] },
		]);
		expect(() => admitKaladaProgram(program(read(ref(["x"], "lines"))), "computations[0].expression", scopes)).toThrow(
			"computations[0].expression.expression.ref: KALADA_INVALID_REFERENCE",
		);
	});
});
