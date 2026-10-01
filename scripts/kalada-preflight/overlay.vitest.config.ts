import { defineConfig } from "vitest/config";
import base from "../../vitest.config";

export default defineConfig({
	...base,
	test: {
		...base.test,
		include: [
			"scripts/kalada-preflight/fixtures/**/*.test.ts",
			"scripts/kalada-preflight/fixtures/**/*.test.tsx",
			"scripts/kalada-preflight/fixtures/kalada-private-runtime.test.ts",
			"packages/declarative/src/__tests__/static-references.test.ts",
			"packages/declarative/src/__tests__/kalada-policy.test.ts",
			"scripts/kalada-preflight/fixtures/kalada-field-membership.test.ts",
			"packages/from-schema/src/__tests__/kalada-defaults-408.test.ts",
			"packages/from-schema/src/__tests__/create-schema-form.test.ts",
			"apps/demos/src/__tests__/kalada-demo-host.test.tsx",
		],
	},
});
