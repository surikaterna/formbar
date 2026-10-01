import type { JsonValue } from "@formbar/expressions";
import type { DiagnosticPathSegment } from "../diagnostics.js";
import type { NodeContext } from "./context.js";
import { ProgramAdmissionError } from "./kalada-program.js";

/** Public node validation is owned by prepared Kalada V1 admission, not the Kuery reader. */
export function node(
	_value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	_context: NodeContext,
): never {
	throw new ProgramAdmissionError(path.join("."), "UNSUPPORTED_V1_RE-AUTHOR");
}
