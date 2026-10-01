import type { JsonValue } from "@formbar/expressions";
import type { DiagnosticPathSegment } from "../diagnostics.js";
import type { ValidationContext } from "./context.js";
import { ProgramAdmissionError } from "./kalada-program.js";

/** Public static computation admission is owned by kalada-definition and its graph check. */
export function computations(
	_value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	_context: ValidationContext,
): never {
	throw new ProgramAdmissionError(path.join("."), "UNSUPPORTED_V1_RE-AUTHOR");
}
