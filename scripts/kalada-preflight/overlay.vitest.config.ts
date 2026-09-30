import { defineConfig } from "vitest/config";
import base from "../../vitest.config";

export default defineConfig({
	...base,
	test: {
		...base.test,
		include: [
			"scripts/kalada-preflight/fixtures/*408-checkpoint.test.ts",
			"packages/declarative/src/__tests__/*408-checkpoint.test.ts",
			"packages/declarative/src/__tests__/kalada-policy.test.ts",
		],
	},
});
