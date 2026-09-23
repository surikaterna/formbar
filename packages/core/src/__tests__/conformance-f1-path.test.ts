import { describe, expect, test } from "vitest";
import { FormbarError } from "../errors.js";
import { parsePath, toDot, toPointer } from "../index.js";

describe("F1: Path grammar + namespace conformance", () => {
	test("F1.01: dot notation parse", () => {
		const result = parsePath("name");
		expect(result).toEqual({ namespace: "data", segments: ["name"] });
	});

	test("F1.02: nested dot notation", () => {
		const result = parsePath("address.city");
		expect(result).toEqual({ namespace: "data", segments: ["address", "city"] });
	});

	test("F1.03: JSON Pointer simple", () => {
		const result = parsePath("/name");
		expect(result).toEqual({ namespace: "data", segments: ["name"] });
	});

	test("F1.04: JSON Pointer nested", () => {
		const result = parsePath("/address/city");
		expect(result).toEqual({ namespace: "data", segments: ["address", "city"] });
	});

	test("F1.05: $ui namespace via dot notation", () => {
		const result = parsePath("$ui.visible");
		expect(result).toEqual({ namespace: "ui", segments: ["visible"] });
	});

	test("F1.06: $ui is a literal data segment via pointer", () => {
		const result = parsePath("/$ui/visible");
		expect(result).toEqual({ namespace: "data", segments: ["$ui", "visible"] });
	});

	test("F1.07: REJECT $ui/ mixed style", () => {
		expect(() => parsePath("$ui/visible")).toThrow(FormbarError);
		try {
			parsePath("$ui/visible");
		} catch (err) {
			expect((err as FormbarError).code).toBe("FORMBAR_PATH_MIXED_NAMESPACE");
		}
	});

	test("F1.08: /ui/name is DATA namespace (not UI)", () => {
		const result = parsePath("/ui/name");
		expect(result).toEqual({ namespace: "data", segments: ["ui", "name"] });
	});

	test("F1.09: RFC6901 tilde-1 decode (~1 → /)", () => {
		const result = parsePath("/a~1b");
		expect(result).toEqual({ namespace: "data", segments: ["a/b"] });
	});

	test("F1.10: RFC6901 tilde-0 decode (~0 → ~)", () => {
		const result = parsePath("/a~0b");
		expect(result).toEqual({ namespace: "data", segments: ["a~b"] });
	});

	test("F1.11: array index via dot notation", () => {
		const result = parsePath("items.0.name");
		expect(result).toEqual({ namespace: "data", segments: ["items", 0, "name"] });
	});

	test("F1.12: array index via pointer", () => {
		const result = parsePath("/items/0/name");
		expect(result).toEqual({ namespace: "data", segments: ["items", "0", "name"] });
	});

	test("F1.13: round-trip via toPointer → parsePath is byte-equal", () => {
		const original = parsePath("/address/city");
		const pointer = toPointer(original);
		const roundTripped = parsePath(pointer);
		expect(roundTripped).toEqual(original);
	});

	test("F1.14: round-trip via toDot → parsePath is byte-equal", () => {
		const original = parsePath("address.city");
		const dot = toDot(original);
		const roundTripped = parsePath(dot);
		expect(roundTripped).toEqual(original);
	});

	test("F1.15: empty JSON Pointer resolves the data root", () => {
		expect(parsePath("")).toEqual({ namespace: "data", segments: [] });
		expect(toPointer(parsePath(""))).toBe("");
	});
});
