import { defineConfig } from "tsup";
import { baseConfig } from "../../tsup.config.base";

export default defineConfig({
	...baseConfig,
	entry: ["src/index.ts", "src/internal/scoped-sync.ts", "src/internal/omission-supplier.ts"],
});
