import { describe, expect, it } from "vitest";
import { readRoute, resolveRoute, routeUrl } from "../playground/route";

const ids = ["basic-contact", "multi-schema"];
const compatibility = [
	{
		demoId: "multi-schema",
		support: "full" as const,
		presets: [{ variant: "default" }, { variant: "explicit" }],
	},
];

describe("playground route", () => {
	it("round-trips mode, demo, and preset while preserving base path and unrelated URL state", () => {
		const current = new URL("https://example.test/formbar/?theme=dark#docs");
		const next = routeUrl(current, { mode: "playground", demoId: "multi-schema", preset: "explicit" });
		expect(next.pathname).toBe("/formbar/");
		expect(next.hash).toBe("#docs");
		expect(next.searchParams.get("theme")).toBe("dark");
		expect(readRoute(next, ids, compatibility)).toEqual({
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
				compatibility,
			),
		).toEqual({ mode: "demo", demoId: "basic-contact" });
	});

	it("canonicalizes invalid presets to the selected playground default", () => {
		const current = new URL("https://example.test/formbar/?theme=dark");
		const resolved = resolveRoute(
			current,
			{ mode: "playground", demoId: "multi-schema", preset: "bogus" },
			ids,
			compatibility,
		);
		expect(resolved.route).toEqual({ mode: "playground", demoId: "multi-schema", preset: "default" });
		expect(resolved.url.search).toBe("?theme=dark&mode=playground&demo=multi-schema&preset=default");
	});

	it("retains absent and valid presets without rewriting them", () => {
		expect(readRoute(new URL("https://example.test/?mode=playground&demo=multi-schema"), ids, compatibility)).toEqual({
			mode: "playground",
			demoId: "multi-schema",
		});
		expect(
			readRoute(new URL("https://example.test/?mode=playground&demo=multi-schema&preset=explicit"), ids, compatibility),
		).toEqual({ mode: "playground", demoId: "multi-schema", preset: "explicit" });
	});

	it("uses stable defaults for invalid query values", () => {
		expect(readRoute(new URL("https://example.test/formbar/?mode=other&demo=missing"), ids, compatibility)).toEqual({
			mode: "demo",
			demoId: "basic-contact",
		});
	});
});
