import type { JsonValue, Observation, Program, PropDefinitions, ResolvedProps, Result } from "./contracts.js";
import { copyJson, safeName } from "./json.js";
import { createObservation } from "./observation.js";
import { ExpressionError, failure } from "./result.js";
import type { ExpressionService } from "./service.js";
import { exactKeys, jsonRecord } from "./shape.js";

interface Entry {
	name: string;
	write: boolean;
	compiled: Result<Program>;
}
interface Snapshot {
	props: ResolvedProps;
	targets: readonly (readonly unknown[])[];
}

function compileProps(service: ExpressionService, definitions: PropDefinitions): Entry[] {
	try {
		const copied = jsonRecord(copyJson(definitions));
		if (Object.keys(copied).length > 128) throw new ExpressionError("limit");
		return Object.entries(copied).map(([name, spec]) => compileEntry(service, name, spec));
	} catch (error) {
		return [
			{ name: "*", write: false, compiled: failure(error instanceof ExpressionError ? error.code : "invalid-input") },
		];
	}
}

function compileEntry(service: ExpressionService, name: string, input: JsonValue): Entry {
	if (!safeName(name)) throw new ExpressionError("invalid-input");
	const spec = jsonRecord(input);
	const keys = spec.mode === "literal" ? ["mode", "value"] : ["mode", "expression"];
	exactKeys(spec, keys);
	if (!Object.hasOwn(spec, keys[1])) throw new ExpressionError("invalid-input");
	if (spec.mode !== "literal" && spec.mode !== "read" && spec.mode !== "write")
		throw new ExpressionError("invalid-input");
	const expression = spec.mode === "literal" ? { kind: "literal", value: spec.value } : spec.expression;
	const compiled = service.compile(expression);
	const write = spec.mode === "write";
	if (write && compiled.ok && compiled.value.expression.kind !== "ref")
		return { name, write, compiled: failure("read-only") };
	return { name, write, compiled };
}

function resolve(service: ExpressionService, entries: Entry[], active: () => boolean, disposed: boolean): Snapshot {
	const values: Record<string, JsonValue | undefined> = Object.create(null);
	const setters: Record<string, import("./contracts.js").Setter> = Object.create(null);
	const diagnostics: Record<string, readonly import("./contracts.js").Diagnostic[]> = Object.create(null);
	const targets: (readonly unknown[])[] = [];
	for (const entry of entries) {
		const result = disposed
			? failure("disposed")
			: entry.compiled.ok
				? service.evaluate(entry.compiled.value)
				: entry.compiled;
		values[entry.name] = result.ok ? result.value : undefined;
		if (!result.ok) diagnostics[entry.name] = result.diagnostics;
		if (disposed || !entry.write || !entry.compiled.ok) continue;
		targets.push(service.writeTarget(entry.compiled.value));
		const writable = service.resolveWritable(entry.compiled.value, active);
		if (writable.ok && result.ok) setters[entry.name] = writable.value;
		if (!writable.ok) diagnostics[entry.name] = writable.diagnostics;
	}
	return {
		props: Object.freeze({
			values: Object.freeze(values),
			setters: Object.freeze(setters),
			diagnostics: Object.freeze(diagnostics),
		}),
		targets,
	};
}

function equal(a: Snapshot, b: Snapshot): boolean {
	return (
		JSON.stringify(a.props) === JSON.stringify(b.props) &&
		a.targets.length === b.targets.length &&
		a.targets.every((parts, i) => parts.every((part, j) => Object.is(part, b.targets[i][j])))
	);
}

export function createPropObservation(
	service: ExpressionService,
	definitions: PropDefinitions,
): Observation<ResolvedProps> {
	const entries = compileProps(service, definitions);
	const observation = createObservation(
		(active, disposed) => resolve(service, entries, active, disposed),
		service.capabilities.subscribe,
		equal,
		service.capabilities.lifecycle,
	);
	return {
		subscribe: observation.subscribe,
		dispose: observation.dispose,
		getLifecycleDiagnostics: observation.getLifecycleDiagnostics,
		getSnapshot: () => observation.getSnapshot().props,
	};
}
