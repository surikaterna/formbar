import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		standalone: "src/standalone.ts",
	},
	format: ["esm"],
	dts: {
		compilerOptions: {
			composite: false,
			exactOptionalPropertyTypes: false,
		},
	},
	clean: true,
	splitting: false,
	sourcemap: true,
	treeshake: true,
	outDir: "dist",
});
