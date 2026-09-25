import { describe, expect, it } from "vitest";
import config from "../../vite.config";

describe("demo source aliases", () => {
	it("routes the core internal subpath to its source entry, not index.ts/internal", () => {
		const aliases = config.resolve?.alias;
		expect(Array.isArray(aliases)).toBe(true);
		if (!Array.isArray(aliases)) return;

		const specifier = "@formbar/core/internal/scoped-sync";
		const matching = aliases.find(({ find }) =>
			typeof find === "string" ? specifier === find || specifier.startsWith(`${find}/`) : find.test(specifier),
		);
		expect(matching?.replacement).toBe(
			new URL("../../../../packages/core/src/internal/scoped-sync.ts", import.meta.url).pathname,
		);
		expect(aliases.find(({ find }) => find instanceof RegExp && find.test("@formbar/core"))?.replacement).toBe(
			new URL("../../../../packages/core/src/index.ts", import.meta.url).pathname,
		);
	});
});
