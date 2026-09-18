import { describe, expect, it } from "vitest";
import config from "../../vite.config";

describe("browser development targets", () => {
	it("preserves top-level await in transforms and optimized dependencies", () => {
		expect(config.base).toBe("/formbar/tui/");
		expect(config.esbuild).toMatchObject({ target: "esnext" });
		expect(config.optimizeDeps?.esbuildOptions).toMatchObject({ target: "esnext" });
		expect(config.build?.target).toBe("esnext");
	});
});
