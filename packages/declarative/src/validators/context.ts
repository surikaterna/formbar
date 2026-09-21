import type { Scopes } from "@formbar/expressions";
import type { DefinitionDiagnostic, DefinitionDiagnosticCode, DiagnosticPathSegment } from "../diagnostics.js";

export interface ValidationContext {
	readonly diagnostics: DefinitionDiagnostic[];
	readonly nodeIds: Map<string, readonly DiagnosticPathSegment[]>;
	readonly scopeIds: Map<string, readonly DiagnosticPathSegment[]>;
}

export interface NodeContext extends ValidationContext {
	readonly scopes: Scopes;
}

export function diagnostic(
	context: ValidationContext,
	code: DefinitionDiagnosticCode,
	path: readonly DiagnosticPathSegment[],
	message: string,
): void {
	context.diagnostics.push(Object.freeze({ code, path: Object.freeze([...path]), message }));
}
