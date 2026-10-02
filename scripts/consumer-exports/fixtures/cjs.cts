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
const parsedRef: expressions.StateRef = expressions.parseRef({ namespace: "data", segments: ["0", 0], scope: "row" });
const unscopedRef: expressions.StateRef = expressions.parseRef({ namespace: "data", segments: ["0", 0] });
import * as fromSchema from "@formbar/from-schema";
import type { FsxDiagnostic, FsxDiagnosticLocation } from "@formbar/fsx-authoring";
const firstId: FsxDiagnosticLocation = { message: "First declaration", path: "root.id", range: { start: 9, end: 12 } };
export const duplicateId: FsxDiagnostic = {
	code: "DUPLICATE_ID",
	message: "Choose a unique ID",
	path: "root.children[0].id",
	related: [firstId],
};
export const oldDiagnostic: FsxDiagnostic = { code: "OTHER", message: "Existing consumer", path: "root" };
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
declare const hostOptions: Omit<fromSchema.CreateKaladaSchemaFormOptions, "provider" | "side">;
const publicHookOptions: fromSchema.CreateKaladaSchemaFormOptions = {
	...hostOptions,
	provider: fromSchema.jsonSchemaProvider(),
	side: "input",
	initialData: { show: false, secret: "draft" },
};
const publicOmission = fromSchema.createKaladaSchemaForm(
	{
		type: "object",
		additionalProperties: false,
		properties: { show: { type: "boolean" }, secret: { type: "string" } },
	},
	publicHookOptions,
);
const omittedForm: declarative.KaladaV1Host = publicOmission.host;
const rendererProps: reactSchema.KaladaFormRendererProps = { host: omittedForm };
export {
	parsedRef,
	unscopedRef,
	publicOmission,
	omittedForm,
	publicHookOptions,
	rendererProps,
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
