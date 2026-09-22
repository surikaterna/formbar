import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { workspaceSourceModules } from "./test/workspace-source-aliases";

const workspaceAliases = Object.fromEntries(
	Object.entries(workspaceSourceModules).map(([specifier, source]) => [specifier, fileURLToPath(source)]),
);

export default defineConfig({
	resolve: {
		alias: workspaceAliases,
	},
	test: {
		include: [
			"packages/*/src/__tests__/**/*.test.{ts,tsx}",
			"apps/demos/src/__tests__/**/*.test.{ts,tsx}",
			"scripts/release/__tests__/**/*.test.ts",
			"scripts/workflows/__tests__/**/*.test.ts",
			"test/**/*.test.ts",
		],
	},
});
