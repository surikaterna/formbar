export const workspaceSourceModules = Object.freeze({
	"@formbar/expressions": new URL("../packages/expressions/src/index.ts", import.meta.url).href,
	"@formbar/arbiter": new URL("../packages/arbiter/src/index.ts", import.meta.url).href,
	"@formbar/core/path": new URL("../packages/core/src/path.entry.ts", import.meta.url).href,
	"@formbar/core/transforms": new URL("../packages/core/src/transforms.entry.ts", import.meta.url).href,
	"@formbar/core/validation": new URL("../packages/core/src/validation.entry.ts", import.meta.url).href,
	"@formbar/core": new URL("../packages/core/src/index.ts", import.meta.url).href,
	"@formbar/declarative": new URL("../packages/declarative/src/index.ts", import.meta.url).href,
	"@formbar/from-schema": new URL("../packages/from-schema/src/index.ts", import.meta.url).href,
	"@formbar/react-schema": new URL("../packages/react-schema/src/index.ts", import.meta.url).href,
	"@formbar/react": new URL("../packages/react/src/index.ts", import.meta.url).href,
});
