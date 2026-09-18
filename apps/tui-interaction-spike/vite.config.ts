import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { type PluginOption, defineConfig } from "vite";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
	base: process.env.FORMBAR_TUI_BASE ?? "/formbar/tui/",
	// The workspace and spike resolve separate compatible Vite patch versions.
	plugins: [tailwindcss() as unknown as PluginOption],
	esbuild: { target: "esnext" },
	optimizeDeps: { esbuildOptions: { target: "esnext" } },
	resolve: {
		alias: {
			"@formbar/arbiter": local("../../packages/arbiter/src/index.ts"),
			"@formbar/core": local("../../packages/core/src/index.ts"),
			"@formbar/expressions": local("../../packages/expressions/src/index.ts"),
			"@formbar/from-schema": local("../../packages/from-schema/src/index.ts"),
			"@formbar/react": local("../../packages/react/src/index.ts"),
			"@formbar/react-schema": local("../../packages/react-schema/src/index.ts"),
			"@formbar/tui": local("../../packages/tui/src/index.ts"),
			module: local("src/browser-shims/module.ts"),
			"node:buffer": local("src/browser-shims/buffer.ts"),
			"node:events": local("src/browser-shims/events.ts"),
			"node:fs": local("src/browser-shims/fs.ts"),
			"node:os": local("src/browser-shims/os.ts"),
			"node:process": local("src/browser-shims/process.ts"),
			"node:stream": local("src/browser-shims/stream.ts"),
			"signal-exit": local("src/browser-shims/signal-exit.ts"),
		},
	},
	build: { sourcemap: true, target: "esnext" },
});
