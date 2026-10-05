import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: { compilerOptions: { composite: false } },
	splitting: false,
	sourcemap: true,
	clean: true,
	external: ["@formbar/fsx-authoring", "@codemirror/state", "@codemirror/view"],
});
