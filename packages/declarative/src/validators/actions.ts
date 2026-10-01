import type { DiagnosticPathSegment } from "../diagnostics.js";
import type { BaseNode } from "../nodes.js";
import type { NodeContext } from "./context.js";
import { ProgramAdmissionError } from "./kalada-program.js";
import type { JsonRecord } from "./shape.js";

/** Built-in and extension actions require a separate host action contract. */
export function actionNode(
	_source: JsonRecord,
	path: readonly DiagnosticPathSegment[],
	_context: NodeContext,
	_base: BaseNode,
): never {
	throw new ProgramAdmissionError(path.join("."), "UNSUPPORTED_V1_RE-AUTHOR");
}
