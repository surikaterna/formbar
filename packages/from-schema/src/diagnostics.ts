import type { DefinitionDiagnostic } from "@formbar/declarative";

export type ProjectionDiagnosticCode =
	| "missing-node"
	| "occurrence-cycle"
	| "occurrence-limit"
	| "definition-limit"
	| "unsupported-evidence";

export interface SourceDiagnostic {
	readonly code: string;
	readonly severity: "warning" | "error";
	readonly side: "input" | "output";
	readonly sourcePointer: string;
	readonly nodeId?: string;
}

export interface ProjectionDiagnostic {
	readonly code: ProjectionDiagnosticCode;
	readonly severity: "warning" | "error";
	readonly occurrenceId?: string;
	readonly nodeId?: string;
	readonly message: string;
}

export type CompilationDiagnosticCode =
	| "composed-schema"
	| "conflicting-baseline-label"
	| "cyclic-schema"
	| "missing-descriptor"
	| "opaque-schema"
	| "unsupported-schema";

export interface CompilationDiagnostic {
	readonly code: CompilationDiagnosticCode;
	readonly severity: "warning" | "error";
	readonly occurrenceId: string;
	readonly nodeId: string;
	readonly message: string;
}

export interface SchemaFormDiagnostics {
	readonly source: readonly SourceDiagnostic[];
	readonly projection: readonly ProjectionDiagnostic[];
	readonly compilation: readonly CompilationDiagnostic[];
	readonly definition: readonly DefinitionDiagnostic[];
}

export function sortProjectionDiagnostics(
	diagnostics: readonly ProjectionDiagnostic[],
): readonly ProjectionDiagnostic[] {
	return Object.freeze(
		[...diagnostics].sort(
			(left, right) =>
				(left.occurrenceId ?? "").localeCompare(right.occurrenceId ?? "") ||
				(left.nodeId ?? "").localeCompare(right.nodeId ?? "") ||
				left.code.localeCompare(right.code) ||
				left.message.localeCompare(right.message),
		),
	);
}

export function sortCompilationDiagnostics(
	diagnostics: readonly CompilationDiagnostic[],
): readonly CompilationDiagnostic[] {
	return Object.freeze(
		[...diagnostics].sort(
			(left, right) =>
				left.occurrenceId.localeCompare(right.occurrenceId) ||
				left.nodeId.localeCompare(right.nodeId) ||
				left.code.localeCompare(right.code) ||
				left.message.localeCompare(right.message),
		),
	);
}
