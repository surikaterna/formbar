import { describe, expect, it, vi } from "vitest";
import { formatOutput } from "../output-formatters.js";

describe("built-in output formatters", () => {
	it.each([
		["plain", "exact", "exact"],
		["plain", 12.345, "12.345"],
		["plain", true, "True"],
		["plain", false, "False"],
		["number", 1234.567, "1,234.57"],
		["currency-usd", 1234.5, "$1,234.50"],
		["percent", 0.1234, "12.34%"],
	] as const)("formats %s deterministically", (format, value, text) => {
		expect(formatOutput(value, format)).toEqual({ ok: true, text });
	});

	it.each(["plain", "number", "currency-usd", "percent"] as const)("renders null as unavailable for %s", (format) => {
		expect(formatOutput(null, format)).toEqual({ ok: true, text: "Not available" });
	});

	it.each([
		["plain", { nested: true }],
		["plain", [1, 2]],
		["number", "12"],
		["currency-usd", false],
		["percent", { value: 0.1 }],
	] as const)("fails closed for unsupported %s values", (format, value) => {
		expect(formatOutput(value, format)).toEqual({ ok: false, diagnostic: "unsupported-output-value" });
	});

	it("contains Intl failures", () => {
		const formatter = vi.spyOn(Intl, "NumberFormat").mockImplementation(() => {
			throw new Error("host Intl failed");
		});
		expect(formatOutput(12, "number")).toEqual({ ok: false, diagnostic: "unsupported-output-value" });
		formatter.mockRestore();
	});
});
