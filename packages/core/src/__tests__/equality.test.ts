import { describe, expect, it } from "vitest";
import { structuredEqual } from "../equality.js";

describe("structuredEqual", () => {
	it("enforces bidirectional alias and cycle correspondence", () => {
		const shared = { leaf: 1 };
		const aliased = { a: shared, b: shared };
		const duplicated = { a: { leaf: 1 }, b: { leaf: 1 } };
		expect(structuredEqual(aliased, duplicated)).toBe(false);
		expect(structuredEqual(duplicated, aliased)).toBe(false);
		const partiallyShared = { a: shared, b: { leaf: 1 } };
		expect(structuredEqual(aliased, partiallyShared)).toBe(false);
		expect(structuredEqual(partiallyShared, aliased)).toBe(false);

		const self: { child?: unknown } = {};
		self.child = self;
		const child: { child?: unknown } = {};
		child.child = child;
		const nested = { child };
		expect(structuredEqual(self, nested)).toBe(false);
		expect(structuredEqual(nested, self)).toBe(false);
		const equivalent: { child?: unknown } = {};
		equivalent.child = equivalent;
		expect(structuredEqual(self, equivalent)).toBe(true);
	});

	it("supports nested cloneable collections and typed-array buffer topology", () => {
		const leftBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
		const rightBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
		const left = new Map([["set", new Set([new Uint8Array(leftBuffer), new Uint8Array(leftBuffer, 1, 2)])]]);
		const right = new Map([["set", new Set([new Uint8Array(rightBuffer), new Uint8Array(rightBuffer, 1, 2)])]]);
		expect(structuredEqual(left, right)).toBe(true);

		const split = new Map([
			["set", new Set([new Uint8Array(new Uint8Array([1, 2, 3, 4]).buffer), new Uint8Array([2, 3])])],
		]);
		expect(structuredEqual(left, split)).toBe(false);
	});

	it("is total and conservatively rejects unsupported prototypes", () => {
		class Unsupported {
			value = 1;
		}
		expect(structuredEqual(new Unsupported(), new Unsupported())).toBe(false);
		expect(structuredEqual({ value: Number.NaN, amount: 1n }, { value: Number.NaN, amount: 1n })).toBe(true);
		expect(structuredEqual({ value: undefined }, {})).toBe(false);
		expect(
			structuredEqual(
				new Proxy(
					{},
					{
						ownKeys: () => {
							throw new Error("hostile");
						},
					},
				),
				{},
			),
		).toBe(false);
	});
});
