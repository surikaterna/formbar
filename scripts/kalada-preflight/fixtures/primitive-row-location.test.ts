import { describe, expect, it } from "vitest";
import { checkPrivateDirectLocation } from "../../../packages/declarative/src/validators/kalada-direct-location.js";

const path = "root.children[0].binding";
const ref = { namespace: "data" as const, segments: [] as string[], scope: "line" };
const target = { namespace: "data" as const, path: ["rows", { row: "line" }] };
const admitted = {
	nodes: new Map([["root.children[0]", { path: "root.children[0]", type: "field", enclosingScope: "line" }]]),
	targets: new Map([[path, target]]),
	scopes: { line: { namespace: "data" as const, segments: ["rows"] } },
	computations: [],
} as unknown as Parameters<typeof checkPrivateDirectLocation>[2];
const binding = {
	target: ref,
	type: { kind: "primitive-type" as const, name: "string" as const },
	writable: true as const,
};
const locations = (item: unknown) =>
	({ [path]: { line: binding, primitiveItem: item } }) as Parameters<typeof checkPrivateDirectLocation>[3];

describe("#376/#412 exact primitive row direct location", () => {
	it("accepts only a trusted whole scoped item with a precise source range", () => {
		const trusted = locations({ scope: "line", type: "string", writable: true });
		expect(checkPrivateDirectLocation(path, "line", admitted, trusted)).toMatchObject({
			ok: true,
			location: { target: ref, range: { start: 0, end: 4 } },
		});
		for (const evidence of [
			undefined,
			{ scope: "other", type: "string", writable: true },
			{ scope: "line", type: "number", writable: true },
		])
			expect(checkPrivateDirectLocation(path, "line", admitted, locations(evidence))?.ok).not.toBe(true);
		const unscoped = { ...binding, target: { namespace: "data" as const, segments: [] } };
		expect(
			checkPrivateDirectLocation(path, "line", admitted, {
				[path]: { line: unscoped, primitiveItem: { scope: "line", type: "string", writable: true } },
			})?.ok,
		).not.toBe(true);
		expect(
			checkPrivateDirectLocation(
				path,
				"line",
				{ ...admitted, targets: new Map([[path, { namespace: "data" as const, path: ["rows", 0] }]]) },
				trusted,
			)?.ok,
		).not.toBe(true);
	});
});
