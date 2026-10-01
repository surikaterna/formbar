import type { ValidatedFormDefinition } from "./definition.js";
import type { KaladaV1Host } from "./kalada-v1-host.js";
import { createPreparedKaladaV1Runtime } from "./validators/kalada-prepared-runtime.js";
import { ProgramAdmissionError } from "./validators/kalada-program.js";

export interface CreateFormRuntimeOptions {
	readonly definition: ValidatedFormDefinition;
	readonly installed?: {
		readonly widgets?: ReadonlySet<string>;
		readonly renderers?: ReadonlySet<string>;
	};
}

/** Only the admitted host strategy can capture, evaluate and write a public definition. */
export function createFormRuntime(options: CreateFormRuntimeOptions): KaladaV1Host {
	const prepared = options?.definition?.prepared;
	if (!prepared?.strategy || !prepared.context) throw new ProgramAdmissionError("root", "MISSING_STRATEGY");
	const runtime = createPreparedKaladaV1Runtime(prepared, options.installed);
	return Object.freeze({
		definition: prepared.definition,
		snapshot: runtime.snapshot,
		subscribe: runtime.subscribe,
		currentRevision: runtime.currentRevision,
		submit: runtime.submit,
		validate: runtime.validate,
		reset: runtime.reset,
		dispose: runtime.dispose,
	});
}
