import { describe, expect, it } from "vitest";
import { copyJson } from "../index.js";

const LIMIT = 16384;

describe("bounded JSON code-point limits", () => {
	it.each(["a", "😀", "\ud800"])("accepts exactly the value limit and rejects one more for %j", (unit) => {
		expect(copyJson(unit.repeat(LIMIT))).toBe(unit.repeat(LIMIT));
		expect(() => copyJson(unit.repeat(LIMIT + 1))).toThrow("limit");
	});

	it("counts mixed BMP, astral and unpaired surrogate values and keys", () => {
		const exact = `${"a".repeat(LIMIT - 2)}😀\ud800`;
		expect(copyJson(exact)).toBe(exact);
		expect(() => copyJson(`${exact}b`)).toThrow("limit");
		expect(copyJson({ [exact]: true })).toEqual({ [exact]: true });
		expect(() => copyJson({ [`${exact}b`]: true })).toThrow("limit");
	});
});
