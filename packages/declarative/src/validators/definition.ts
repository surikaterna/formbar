import type { FormDefinition, FormDefinitionAdmission, ValidatedFormDefinition } from "../definition.js";
import type { DefinitionDiagnostic, DefinitionValidationResult, DiagnosticPathSegment } from "../diagnostics.js";
import { prepareKaladaV1Definition } from "./kalada-prepared-definition.js";
import { ProgramAdmissionError } from "./kalada-program.js";

function diagnosticPath(path: string): readonly DiagnosticPathSegment[] {
	if (path === "root" || path === "") return path ? [path] : [];
	const segments: DiagnosticPathSegment[] = [];
	for (const match of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
		if (match[2] !== undefined) segments.push(Number(match[2]));
		else if (match[1] !== undefined) segments.push(match[1]);
	}
	return segments;
}

/** Full host-backed admission; absence of any policy, strategy or static writer proof fails closed. */
export function validateFormDefinition(
	input: unknown,
	admission?: FormDefinitionAdmission,
): DefinitionValidationResult<ValidatedFormDefinition> {
	try {
		if (!admission) throw new ProgramAdmissionError("root", "MISSING_POLICY");
		const prepared = prepareKaladaV1Definition({ ...admission, definition: input });
		const value = Object.freeze(
			Object.defineProperty({ ...(prepared.definition as unknown as FormDefinition) }, "prepared", { value: prepared }),
		) as ValidatedFormDefinition;
		return Object.freeze({ ok: true, value });
	} catch (error) {
		if (!(error instanceof ProgramAdmissionError)) throw error;
		const diagnostic: DefinitionDiagnostic = Object.freeze({
			code: "kalada-admission",
			path: Object.freeze(diagnosticPath(error.path)),
			message: error.code,
		});
		return Object.freeze({ ok: false, diagnostics: Object.freeze([diagnostic]) });
	}
}
