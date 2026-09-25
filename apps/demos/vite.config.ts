import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const demoBase = process.env.FORMBAR_DEMO_BASE || "/";

export default defineConfig({
	base: demoBase,
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: [
			{
				find: "@formbar/expressions",
				replacement: new URL("../../packages/expressions/src/index.ts", import.meta.url).pathname,
			},
			{
				find: "@formbar/arbiter",
				replacement: new URL("../../packages/arbiter/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@formbar\/core\/internal\/scoped-sync$/,
				replacement: new URL("../../packages/core/src/internal/scoped-sync.ts", import.meta.url).pathname,
			},
			{ find: /^@formbar\/core$/, replacement: new URL("../../packages/core/src/index.ts", import.meta.url).pathname },
			{
				find: "@formbar/from-schema",
				replacement: new URL("../../packages/from-schema/src/index.ts", import.meta.url).pathname,
			},
			{ find: "@formbar/react", replacement: new URL("../../packages/react/src/index.ts", import.meta.url).pathname },
			{
				find: "@formbar/react-schema",
				replacement: new URL("../../packages/react-schema/src/index.ts", import.meta.url).pathname,
			},
		],
	},
	server: {
		port: 5174,
		host: "127.0.0.1",
	},
});
