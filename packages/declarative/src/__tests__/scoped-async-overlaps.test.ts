import { describe, expect, it } from "vitest";
import type { ConcreteOwner } from "../runtime-ownership.js";
import { overlappingOwners } from "../scoped-async-overlaps.js";

function owner(segments: readonly (string | number)[], namespace = "data"): ConcreteOwner {
	return {
		instance: { nodeId: "cell", instanceKey: "cell", scopes: [] },
		binding: { namespace, segments },
		visible: true,
		eligible: true,
		protected: false,
	};
}

describe("capture-local async overlap index", () => {
	it("distinguishes dotted keys, numeric object keys, array indices and namespaces", () => {
		const dotted = owner(["a.b", "0"]);
		const split = owner(["a", "b", "0"]);
		const indexed = owner(["a.b", 0]);
		const ui = owner(["a.b", "0"], "ui");
		expect(overlappingOwners([dotted, split, indexed, ui]).size).toBe(0);
		const parent = { ...owner(["a.b"]), visible: false, eligible: false };
		const duplicate = owner(["a.b", 0]);
		const conflicts = overlappingOwners([dotted, split, indexed, ui, parent, duplicate]);
		expect(conflicts.has(split)).toBe(false);
		expect(conflicts.has(ui)).toBe(false);
		for (const field of [dotted, indexed, parent, duplicate]) expect(conflicts.has(field)).toBe(true);
		expect(overlappingOwners([dotted, split, indexed, ui]).size).toBe(0);
	});
});
