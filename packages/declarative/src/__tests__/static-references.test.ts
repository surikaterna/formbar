import { describe, expect, it, vi } from "vitest";
import { resolveStaticReference, staticDependencyKey } from "../validators/static-references.js";

const scopes = {
	orders: { namespace: "data", segments: ["orders"] },
	lines: { namespace: "data", segments: ["items"], parent: "orders" },
	other: { namespace: "data", segments: ["other"] },
};
const ref = (segments: readonly (string | number)[], scope?: string, namespace = "data") => ({
	namespace,
	segments,
	...(scope === undefined ? {} : { scope }),
});

describe("private static StateRef checker", () => {
	it("resolves lexical nested bindings without alias prefixes or runtime indices", () => {
		expect(resolveStaticReference(ref(["sku"], "lines"), scopes, "lines")).toEqual({
			namespace: "data",
			path: ["orders", { row: "orders" }, "items", { row: "lines" }, "sku"],
		});
		expect(resolveStaticReference(ref(["total"], "orders"), scopes, "lines").path).toEqual([
			"orders",
			{ row: "orders" },
			"total",
		]);
		expect(resolveStaticReference(ref(["other"]), scopes, "lines").path).toEqual(["other"]);
	});

	it("preserves numeric and string segments and row boundaries in graph keys", () => {
		const numeric = resolveStaticReference(ref([0], "lines"), scopes, "lines");
		const string = resolveStaticReference(ref(["0"], "lines"), scopes, "lines");
		expect(staticDependencyKey(numeric)).not.toBe(staticDependencyKey(string));
		expect(staticDependencyKey(numeric)).not.toBe(staticDependencyKey(resolveStaticReference(ref([0]), scopes)));
		expect(staticDependencyKey(numeric)).toBe(
			staticDependencyKey(resolveStaticReference(ref([0], "lines"), scopes, "lines")),
		);
	});

	it("rejects missing, sibling, top-level, cyclic and cross-namespace scopes", () => {
		for (const [target, current] of [
			["missing", "lines"],
			["other", "lines"],
			["lines", undefined],
		]) {
			expect(() => resolveStaticReference(ref(["id"], target), scopes, current)).toThrow(TypeError);
		}
		const cyclic = {
			a: { namespace: "data", segments: ["a"], parent: "b" },
			b: { namespace: "data", segments: ["b"], parent: "a" },
		};
		expect(() => resolveStaticReference(ref(["id"], "a"), cyclic, "a")).toThrow(TypeError);
		expect(() => resolveStaticReference(ref(["id"], "lines", "ui"), scopes, "lines")).toThrow(TypeError);
		expect(() =>
			resolveStaticReference(
				ref(["id"], "lines"),
				{ ...scopes, lines: { namespace: "ui", segments: ["items"], parent: "orders" } },
				"lines",
			),
		).toThrow(TypeError);
	});

	it("rejects unsafe shapes, accessor input and segment bounds without invoking getters", () => {
		const getter = vi.fn(() => "data");
		const accessor = Object.defineProperty({}, "namespace", { get: getter, enumerable: true });
		for (const input of [
			accessor,
			ref(["__proto__"]),
			ref(["constructor"]),
			ref(["x".repeat(257)]),
			ref([-1]),
			ref([1.5]),
			ref([Number.MAX_SAFE_INTEGER + 1]),
			ref(Array(65).fill("x")),
			{ ...ref(["x"]), extra: 1 },
			{ ...ref(["x"]), scope: "" },
			ref(["x"], undefined, "other"),
			ref(["x"], undefined, "form"),
			ref(["node", "unknown"], undefined, "field"),
		]) {
			expect(() => resolveStaticReference(input, scopes)).toThrow();
		}
		expect(() =>
			resolveStaticReference(ref(["x"]), Object.defineProperty({}, "orders", { get: getter, enumerable: true })),
		).toThrow();
		expect(getter).not.toHaveBeenCalled();
		expect(resolveStaticReference(ref(["submitted"], undefined, "form"), {})).toEqual({
			namespace: "form",
			path: ["submitted"],
		});
		expect(resolveStaticReference(ref(["name", "valid"], undefined, "field"), {})).toEqual({
			namespace: "field",
			path: ["name", "valid"],
		});
	});
});
