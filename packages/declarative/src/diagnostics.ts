export type DiagnosticPathSegment = string | number;

export type DefinitionDiagnosticCode =
	| "invalid-json"
	| "invalid-type"
	| "unknown-key"
	| "required"
	| "unsupported-version"
	| "duplicate-node-id"
	| "duplicate-scope"
	| "unknown-node-type"
	| "invalid-binding"
	| "unknown-scope"
	| "invalid-expression"
	| "invalid-range"
	| "duplicate-computation-id"
	| "duplicate-computation-target"
	| "self-dependency"
	| "computation-cycle";

export interface DefinitionDiagnostic {
	readonly code: DefinitionDiagnosticCode;
	readonly path: readonly DiagnosticPathSegment[];
	readonly message: string;
}

export type DefinitionValidationResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly diagnostics: readonly DefinitionDiagnostic[] };

export function sortDiagnostics(diagnostics: readonly DefinitionDiagnostic[]): readonly DefinitionDiagnostic[] {
	return Object.freeze([...diagnostics].sort(compareDiagnostic));
}

function compareDiagnostic(left: DefinitionDiagnostic, right: DefinitionDiagnostic): number {
	const path = pathKey(left.path).localeCompare(pathKey(right.path));
	return path || left.code.localeCompare(right.code) || left.message.localeCompare(right.message);
}

const pathKey = (path: readonly DiagnosticPathSegment[]): string =>
	path
		.map((segment) => (typeof segment === "number" ? `#${String(segment).padStart(10, "0")}` : `.${segment}`))
		.join("");
