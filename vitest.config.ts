import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sourcePath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			"@formbar/expressions-kuery": sourcePath("./packages/expressions-kuery/src/index.ts"),
			"@formbar/expressions": sourcePath("./packages/expressions/src/index.ts"),
			"@formbar/arbiter": sourcePath("./packages/arbiter/src/index.ts"),
			"@formbar/core/path": sourcePath("./packages/core/src/path.entry.ts"),
			"@formbar/core/transforms": sourcePath("./packages/core/src/transforms.entry.ts"),
			"@formbar/core/validation": sourcePath("./packages/core/src/validation.entry.ts"),
			"@formbar/core": sourcePath("./packages/core/src/index.ts"),
			"@formbar/from-schema": sourcePath("./packages/from-schema/src/index.ts"),
			"@formbar/react-schema": sourcePath("./packages/react-schema/src/index.ts"),
			"@formbar/react": sourcePath("./packages/react/src/index.ts"),
		},
	},
	test: {
		include: [
			"packages/*/src/__tests__/**/*.test.ts",
			"apps/demos/src/__tests__/**/*.test.ts",
			"scripts/release/__tests__/**/*.test.ts",
		],
	},
});
