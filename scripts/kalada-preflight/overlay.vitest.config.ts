import { defineConfig } from "vitest/config";
import base from "../../vitest.config";

export default defineConfig({
	...base,
	test: {
		...base.test,
		include: [
			"scripts/kalada-preflight/fixtures/**/*.test.ts",
			"packages/declarative/src/__tests__/static-references.test.ts",
			"packages/declarative/src/__tests__/kalada-policy.test.ts",
			"scripts/kalada-preflight/fixtures/kalada-field-membership.test.ts",
		],
	},
});
