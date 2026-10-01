import { copyJson } from "@formbar/expressions";
import type { DataContext, EnumeratedRow, FormbarDataStrategyV1, ReadScope } from "./kalada-data-strategy.js";
import type { AdmittedDefinition } from "./kalada-definition.js";
import { sameRowScope } from "./kalada-private-components.js";
import type { PrivateEvaluation } from "./kalada-private-runtime.js";
import { ProgramAdmissionError } from "./kalada-program.js";

function permitted(
	path: string,
	scope: ReadScope,
	admitted: AdmittedDefinition,
	evaluate: (path: string, scope: ReadScope) => PrivateEvaluation,
): boolean {
	const nodePath = path.slice(0, -".binding".length);
	for (const property of ["visible", "disabled", "readOnly"]) {
		const slot = `${nodePath}.${property}`;
		if (!admitted.slots.some((entry) => entry.path === slot)) continue;
		const result = evaluate(slot, scope);
		if (!result.ok || result.value !== (property === "visible")) return false;
	}
	return true;
}

export function privateNative(options: {
	readonly admitted: AdmittedDefinition;
	readonly strategy: FormbarDataStrategyV1;
	readonly context: DataContext;
	readonly live: () => boolean;
	readonly validScope: (scope: ReadScope, enclosing?: string) => boolean;
	readonly evaluate: (path: string, scope: ReadScope) => PrivateEvaluation;
	readonly bindDirect: (path: string, source: string) => ((value: unknown) => { status: string }) | undefined;
	readonly bindRow: (
		path: string,
		source: string,
		row: EnumeratedRow,
	) => ((value: unknown) => { status: string }) | undefined;
}) {
	return (path: string, scope: ReadScope = { rows: [] }, row?: EnumeratedRow, source?: string) => {
		const { admitted, strategy, context, live } = options;
		const node = [...admitted.fields.values()].find((entry) => `${entry.path}.binding` === path);
		const reference = admitted.targets.get(path);
		if (!node || !reference || !options.validScope(scope, node.enclosingScope) || !live())
			throw new ProgramAdmissionError(path, "INVALID_NATIVE_BINDING");
		if (node.enclosingScope ? !sameRowScope(scope, row) : row !== undefined)
			throw new ProgramAdmissionError(path, "INVALID_NATIVE_BINDING");
		if (typeof source !== "string") throw new ProgramAdmissionError(path, "MISSING_WRITER");
		const frame = strategy.capture(context);
		if (frame.instance !== context.instance || frame.token !== strategy.current(context))
			throw new ProgramAdmissionError(path, "STALE_CAPTURE");
		const read = frame.read(reference, scope);
		if (read.status !== "found") throw new ProgramAdmissionError(path, `TARGET_${read.status.toUpperCase()}`);
		const value = copyJson(read.value);
		if (!live() || frame.token !== strategy.current(context)) throw new ProgramAdmissionError(path, "STALE_CAPTURE");
		if (!permitted(path, scope, admitted, options.evaluate))
			throw new ProgramAdmissionError(path, "FIELD_NOT_EDITABLE");
		const callback = row ? options.bindRow(path, source, row) : options.bindDirect(path, source);
		if (!callback) throw new ProgramAdmissionError(path, "INVALID_WRITE_TARGET");
		return Object.freeze({
			value,
			onChange(next: unknown) {
				try {
					if (!live() || frame.token !== strategy.current(context)) return { status: "stale" };
					if (!permitted(path, scope, admitted, options.evaluate)) return { status: "denied" };
					if (!live() || frame.token !== strategy.current(context)) return { status: "stale" };
					return callback(next);
				} catch {
					return { status: "denied" };
				}
			},
		});
	};
}
