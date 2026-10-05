import { experimentalParseKaladaV1GuestExpressionPrefix } from "@kalada/syntax";
import { describe, expect, it } from "vitest";
import { analyzeFsxSyntax } from "../index.js";

describe("parser-owned syntax recognition", () => {
	it("classifies only host syntax, without semantic admission", () => {
		const source = '<Unknown attr="😀" other={"}"}></Unknown>';
		const result = analyzeFsxSyntax(source);
		expect(result.complete).toBe(true);
		expect(result.spans.map((s) => [s.kind, source.slice(s.start, s.end)])).toEqual([
			["punctuation", "<"],
			["tag", "Unknown"],
			["attribute", "attr"],
			["punctuation", "="],
			["string", '"😀"'],
			["attribute", "other"],
			["punctuation", "="],
			["punctuation", "{"],
			["punctuation", "}"],
			["punctuation", ">"],
			["punctuation", "</"],
			["tag", "Unknown"],
			["punctuation", ">"],
		]);
	});
	it.each(['"}"', "data.foo", '(true ? "{" : "}")'])("uses guest service boundary for %s", (guest) => {
		const source = `<Field value={${guest}} />`;
		const direct = experimentalParseKaladaV1GuestExpressionPrefix(source, source.indexOf("{") + 1);
		expect(analyzeFsxSyntax(source).guestRegions).toEqual([
			{ start: source.indexOf("{") + 1, end: direct.stop, boundary: "confirmed" },
		]);
	});
	it.each([
		"<",
		"<Field a",
		"<Field a=",
		'<Field a="',
		'<Field a={"} />',
		"<Field a={true",
		"<Field a={/* } */} />",
		'<Field a="x" ! />',
		"",
	])("keeps only trustworthy bounded partial spans: %s", (source) => {
		const result = analyzeFsxSyntax(source);
		expect(result.complete).toBe(false);
		let end = 0;
		for (const span of result.spans) {
			expect(span.start).toBeGreaterThanOrEqual(end);
			expect(span.end).toBeGreaterThan(span.start);
			expect(span.end).toBeLessThanOrEqual(source.length);
			end = span.end;
		}
	});
	it("preserves original CRLF and astral offsets", () => {
		const source = '<Root a="😀">\r\n<Field />\r\n</Root>';
		expect(analyzeFsxSyntax(source).spans.find((s) => source.slice(s.start, s.end) === "Field")?.start).toBe(
			source.indexOf("Field"),
		);
	});
	it("bounds oversized and deeply nested input", () => {
		expect(analyzeFsxSyntax("<".repeat(100001)).spans).toEqual([]);
		expect(analyzeFsxSyntax("<A>".repeat(1000)).diagnostics[0]?.code).toBe("STRUCTURE_LIMIT");
	});
	it("distinguishes invalid-but-confirmed guest boundaries from ambiguous ones", () => {
		const confirmed = analyzeFsxSyntax("<Field value={true +} />");
		expect(confirmed.complete).toBe(false);
		expect(confirmed.guestRegions[0]?.boundary).toBe("confirmed");
		const source = '<Field value={"} <Pretend />';
		const ambiguous = analyzeFsxSyntax(source);
		expect(ambiguous.guestRegions).toEqual([
			{ start: source.indexOf("{") + 1, end: source.length, boundary: "ambiguous" },
		]);
		expect(ambiguous.spans.filter((s) => s.kind === "tag")).toHaveLength(1);
	});
});
