import type { JsonValue } from "@formbar/declarative";
import { expect, it } from "vitest";
import { lineSubtotal } from "../runtime/kalada-demo-calculations";

it("projects only finite numeric row amounts without coercing invalid JSON or storing output", () => {
	const rows: JsonValue = [{ amount: 2 }, {}, { amount: 3 }];
	expect(lineSubtotal(rows)).toBe(5);
	expect(rows).toEqual([{ amount: 2 }, {}, { amount: 3 }]);
	expect(lineSubtotal([])).toBe(0);
	for (const invalid of [undefined, null, false, [null], [{ amount: "2" }], [{ amount: null }]])
		expect(lineSubtotal(invalid)).toBeUndefined();
	expect(lineSubtotal([{ amount: Number.MAX_VALUE }, { amount: Number.MAX_VALUE }])).toBeUndefined();
});
