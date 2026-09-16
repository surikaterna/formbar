import type { DiagnosticCode, Result } from "./contracts.js";

const codes = new Set<DiagnosticCode>([
	"invalid-input",
	"limit",
	"unsupported-operator",
	"arity",
	"type",
	"non-finite",
	"division-zero",
	"backend",
	"missing",
	"denied",
	"disposed",
	"stale",
	"read-only",
	"unknown-program",
	"adapter",
]);

export const diagnosticCode = (code: DiagnosticCode): DiagnosticCode => (codes.has(code) ? code : "backend");

export function failure<T = never>(code: DiagnosticCode): Result<T> {
	return { ok: false, diagnostics: [{ code: diagnosticCode(code) }] };
}

export class ExpressionError extends Error {
	readonly code: DiagnosticCode;
	constructor(code: DiagnosticCode) {
		super(diagnosticCode(code));
		this.code = diagnosticCode(code);
	}
}
