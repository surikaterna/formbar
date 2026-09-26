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
const issueInput: fromSchema.FieldIssueInput = { code: "bad", message: "Bad", severity: "error", descendant: ["0", 0] };
const binding: fromSchema.FieldValidationBinding = { namespace: "data", segments: ["name", "0", 0] };
// @ts-expect-error Scoped public bindings cannot select UI state.
const uiBinding: fromSchema.FieldValidationBinding = { namespace: "ui", segments: ["name"] };
const scopedAsync: fromSchema.DefinitionAsyncFieldValidator<{ name: string }, object> = {
	id: "name-async",
	fieldId: "name-field",
	trigger: "onBlur",
	debounceMs: 0,
	validate: async ({ data, field, signal, stage, context }) => [
		{
			code: String(data.name.length),
			message: field.instance.nodeId + signal.aborted + stage + context?.requestId,
			severity: "error",
		},
	],
};
const publicOmission = fromSchema.createSchemaForm<{ show: boolean; secret: string }>(
	{ type: "object", properties: { show: { type: "boolean" }, secret: { type: "string" } } },
	{ provider: fromSchema.jsonSchemaProvider(), side: "input", submission: { hiddenValues: "omit-inactive" } },
);
const omittedForm = publicOmission.createForm({ initialData: { show: false, secret: "draft" } });
type HookOptions = reactSchema.UseSchemaFormOptions<{ show: boolean; secret: string }, object>;
const publicHookOptions: HookOptions = {
	provider: fromSchema.jsonSchemaProvider(),
	side: "input",
	initialData: { show: false, secret: "draft" },
	submission: { hiddenValues: "omit-inactive" },
};
export {
	publicOmission,
	omittedForm,
	publicHookOptions,
	scoped,
	scopedAsync,
	issueInput,
	binding,
	uiBinding,
	registerScopedSync,
	prepareScopedSyncHost,
	publicRegister,
	publicPrepare,
};
export { expressions, core, path, transforms, validation, declarative, fromSchema, react, arbiter, reactSchema };
