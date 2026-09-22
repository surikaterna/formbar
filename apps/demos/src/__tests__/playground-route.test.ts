import { describe, expect, it } from "vitest";
import { readRoute, routeUrl } from "../playground/route";

const ids = ["basic-contact", "multi-schema"];
const playgroundIds = ["multi-schema"];

describe("playground route", () => {
	it("round-trips mode, demo, and preset while preserving base path and unrelated URL state", () => {
		const current = new URL("https://example.test/formbar/?theme=dark#docs");
		const next = routeUrl(current, { mode: "playground", demoId: "multi-schema", preset: "explicit" });
		expect(next.pathname).toBe("/formbar/");
		expect(next.hash).toBe("#docs");
		expect(next.searchParams.get("theme")).toBe("dark");
		expect(readRoute(next, ids, playgroundIds)).toEqual({
			mode: "playground",
			demoId: "multi-schema",
			preset: "explicit",
		});
	});

	it("canonicalizes unsupported playground requests to normal demo routes", () => {
		expect(
			readRoute(
				new URL("https://example.test/formbar/?mode=playground&demo=basic-contact&preset=fallback"),
				ids,
				playgroundIds,
			),
		).toEqual({ mode: "demo", demoId: "basic-contact" });
	});

	it("uses stable defaults for invalid query values", () => {
		expect(readRoute(new URL("https://example.test/formbar/?mode=other&demo=missing"), ids, playgroundIds)).toEqual({
			mode: "demo",
			demoId: "basic-contact",
		});
	});
});
