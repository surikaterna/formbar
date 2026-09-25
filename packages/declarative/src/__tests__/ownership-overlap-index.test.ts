import { describe, expect, it } from "vitest";
import { OwnershipOverlapIndex } from "../ownership-overlap-index.js";

describe("typed ownership overlap index", () => {
	it("counts duplicate exact paths and ancestor/descendant paths without conflating segment types or namespaces", () => {
		const index = new OwnershipOverlapIndex();
		const add = (namespace: string, segments: (string | number)[]) => index.add({ namespace, segments });
		add("data", ["a.b"]);
		add("data", ["a.b"]);
		add("data", ["a.b", 0]);
		add("data", ["a", "b"]);
		add("data", ["0"]);
		add("data", [0]);
		add("ui", ["a.b"]);
		expect(index.query({ namespace: "data", segments: ["a.b"] })).toEqual({
			exact: 2,
			descendants: 1,
			overlaps: 3,
		});
		expect(index.query({ namespace: "data", segments: ["a.b", 0, "leaf"] }).overlaps).toBe(3);
		expect(index.query({ namespace: "data", segments: ["a", "b"] }).overlaps).toBe(1);
		expect(index.query({ namespace: "data", segments: ["0"] }).overlaps).toBe(1);
		expect(index.query({ namespace: "data", segments: [0] }).overlaps).toBe(1);
		expect(index.query({ namespace: "ui", segments: ["a.b"] }).overlaps).toBe(1);
	});
});
