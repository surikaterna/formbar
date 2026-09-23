import { describe, expect, it } from "vitest";
import { applyRowOperation, initialRowKeys } from "../repeater-keys.js";

describe("renderer-private repeater keys", () => {
	it("preserves exact tokens for all five structural operations with duplicate values", () => {
		const initial = initialRowKeys("duplicate-primitives", 3);
		const appended = applyRowOperation(initial, { type: "append" });
		expect(appended.keys.slice(0, 3)).toEqual(initial.keys);

		const inserted = applyRowOperation(initial, { type: "insert", index: 1 });
		expect(inserted.keys.filter((key) => initial.keys.includes(key))).toEqual(initial.keys);

		const removed = applyRowOperation(initial, { type: "remove", index: 1 });
		expect(removed.keys).toEqual([initial.keys[0], initial.keys[2]]);

		const moved = applyRowOperation(initial, { type: "move", from: 0, to: 2 });
		expect(moved.keys).toEqual([initial.keys[1], initial.keys[2], initial.keys[0]]);

		const swapped = applyRowOperation(initial, { type: "swap", from: 0, to: 2 });
		expect(swapped.keys).toEqual([initial.keys[2], initial.keys[1], initial.keys[0]]);
	});
});
