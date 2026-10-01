import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: { compilerOptions: { composite: false } },
	splitting: false,
	sourcemap: true,
	clean: true,
	external: [
		"@formbar/declarative",
		"@formbar/expressions",
		"@kalada/core",
		"@kalada/syntax",
		"@kalada/provider-routing",
	],
});
