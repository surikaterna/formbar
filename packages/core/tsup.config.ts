import { defineConfig } from "tsup";
import { baseConfig } from "../../tsup.config.base";

export default defineConfig({
	...baseConfig,
	entry: [
		"src/index.ts",
		"src/path.entry.ts",
		"src/transforms.entry.ts",
		"src/validation.entry.ts",
		"src/internal/scoped-sync.ts",
	],
	splitting: true,
});
