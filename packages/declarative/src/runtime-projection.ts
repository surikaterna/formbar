import type { FormApi, FormStateCapture } from "@formbar/core";
import type { ValidatedFormDefinition } from "./definition.js";
import type { RuntimeFieldBaseline, RuntimeRepeaterBaseline, RuntimeSnapshot } from "./runtime-contracts.js";
import { ProgramAdmissionError } from "./validators/kalada-program.js";

export interface ProjectRuntimeOptions {
	readonly form: FormApi<unknown, unknown>;
	readonly definition: ValidatedFormDefinition;
	readonly baseline?: readonly RuntimeFieldBaseline[];
	readonly repeaterBaseline?: readonly RuntimeRepeaterBaseline[];
	readonly capture?: FormStateCapture<unknown, unknown>;
}

/** Positional captures cannot attest row identity or evaluate Kalada programs. */
export function projectRuntime(_options: ProjectRuntimeOptions): RuntimeSnapshot {
	throw new ProgramAdmissionError("root", "UNSUPPORTED_V1_RE-AUTHOR");
}
