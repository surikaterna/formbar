import * as arbiter from "@formbar/arbiter";
import * as core from "@formbar/core";
// @ts-expect-error Raw host registration is not available at the public root.
import { registerScopedSync as publicRegister } from "@formbar/core";
import { registerScopedSync } from "@formbar/core/internal/scoped-sync";
import * as path from "@formbar/core/path";
import * as transforms from "@formbar/core/transforms";
import * as validation from "@formbar/core/validation";
// @ts-expect-error The host factory is not available at the public root.
import { prepareScopedSyncHost as publicPrepare } from "@formbar/declarative";
import * as declarative from "@formbar/declarative";
import { prepareScopedSyncHost } from "@formbar/declarative/internal/scoped-sync";
import * as expressions from "@formbar/expressions";
import * as fromSchema from "@formbar/from-schema";
import * as react from "@formbar/react";
import * as reactSchema from "@formbar/react-schema";
const scoped: fromSchema.DefinitionFieldValidator<{ name: string }, object> = {
	fieldId: "name-field",
	validate: ({ data, field }) => [
		{ code: String(data.name.length), message: field.instance.nodeId, severity: "error" },
	],
};
const scopedAsync: fromSchema.DefinitionAsyncFieldValidator<{ name: string }, object> = {
	id: "name-async",
	fieldId: "name-field",
	trigger: "onBlur",
	debounceMs: 0,
	validate: async ({ data, field, signal }) => [
		{ code: String(data.name.length), message: field.instance.nodeId + signal.aborted, severity: "error" },
	],
};
export { scoped, scopedAsync, registerScopedSync, prepareScopedSyncHost, publicRegister, publicPrepare };
export { expressions, core, path, transforms, validation, declarative, fromSchema, react, arbiter, reactSchema };
