import { type JsonValue, copyJson } from "@formbar/expressions";
import type {
	DataContext,
	DataFrame,
	EnumeratedRow,
	FormbarDataStrategyV1,
	ReadScope,
} from "./kalada-data-strategy.js";
import type { AdmittedDefinition } from "./kalada-definition.js";
import type { TrustedDirectLocations } from "./kalada-direct-location.js";
import { checkPrivateDirectLocation } from "./kalada-direct-location.js";
import type { AdmissionPolicy, PropRule } from "./kalada-policy.js";
import type { PrivateEvaluation } from "./kalada-private-runtime.js";
import { ProgramAdmissionError } from "./kalada-program.js";

type Node = Record<string, JsonValue>;
type Component = Readonly<{ renderer: string; props: Node; enclosingScope?: string | undefined }>;
type Write = (value: unknown) => { readonly status: string };

export function sameRowScope(scope: ReadScope, row: EnumeratedRow | undefined): boolean {
	return (
		!!row &&
		scope.rows.length > 0 &&
		row.scope.rows.length === scope.rows.length &&
		scope.rows.every(
			(entry, index) => entry.name === row.scope.rows[index]?.name && entry.token === row.scope.rows[index]?.token,
		) &&
		scope.rows.at(-1)?.token === row.token
	);
}

function visitCollection(value: JsonValue, path: string, visit: (node: JsonValue, at: string) => void) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	const children = (value as Node).children;
	if (Array.isArray(children)) children.forEach((child, index) => visit(child, `${path}.children[${index}]`));
}

/** Indexed from the admitted JSON tree, not from caller-provided React props. */
export function components(definition: unknown, admitted: AdmittedDefinition): ReadonlyMap<string, Component> {
	const root = (copyJson(definition) as { root: JsonValue }).root;
	const result = new Map<string, Component>();
	const visit = (value: JsonValue, path: string) => {
		if (!value || typeof value !== "object" || Array.isArray(value)) return;
		const node = value as Node;
		if (node.type === "custom") {
			const admittedNode = [...admitted.nodes.values()].find((entry) => entry.path === path && entry.type === "custom");
			if (!admittedNode) throw new ProgramAdmissionError(path, "UNKNOWN_CUSTOM");
			result.set(path, {
				renderer: node.renderer as string,
				props: (node.props ?? {}) as Node,
				enclosingScope: admittedNode.enclosingScope,
			});
		}
		for (const key of ["children", "then", "else"]) {
			const children = node[key];
			if (Array.isArray(children)) children.forEach((child, index) => visit(child, `${path}.${key}[${index}]`));
		}
		for (const key of ["tabs", "items"]) {
			const entries = node[key];
			if (Array.isArray(entries))
				entries.forEach((item, index) => visitCollection(item, `${path}.${key}[${index}]`, visit));
		}
	};
	visit(root, "root");
	return result;
}

function typed(value: unknown, rule: PropRule | undefined, path: string): JsonValue {
	let safe: JsonValue;
	try {
		safe = copyJson(value);
	} catch {
		throw new ProgramAdmissionError(path, "NON_JSON_RESULT");
	}
	const expected = rule?.expected;
	if (!expected) throw new ProgramAdmissionError(path, "MISSING_POLICY");
	if (
		expected === "json" ||
		(expected === "array" && Array.isArray(safe)) ||
		(expected === "object" && safe !== null && typeof safe === "object" && !Array.isArray(safe)) ||
		(expected === "null" && safe === null) ||
		(expected === "boolean" && typeof safe === "boolean") ||
		(expected === "number" && typeof safe === "number") ||
		(expected === "string" && typeof safe === "string")
	)
		return safe;
	throw new ProgramAdmissionError(path, "INVALID_PROP_TYPE");
}

function readProp(
	at: string,
	scope: ReadScope,
	rule: PropRule | undefined,
	evaluate: (path: string, scope: ReadScope) => PrivateEvaluation,
) {
	const path = `${at}.expression`;
	const result = evaluate(path, scope);
	if (!result.ok) throw new ProgramAdmissionError(result.path, result.code);
	return typed(result.value, rule, path);
}

interface ComponentOptions {
	readonly admitted: AdmittedDefinition;
	readonly definition: unknown;
	readonly policy: AdmissionPolicy;
	readonly locations?: TrustedDirectLocations | undefined;
	readonly strategy: FormbarDataStrategyV1;
	readonly context: DataContext;
	readonly live: () => boolean;
	readonly validScope: (scope: ReadScope, enclosing?: string) => boolean;
	readonly evaluate: (path: string, scope: ReadScope) => PrivateEvaluation;
	readonly bindDirect: (path: string, source: string) => Write | undefined;
	readonly bindRow: (path: string, source: string, row: EnumeratedRow) => Write | undefined;
}

export function privateComponentProjector(options: ComponentOptions) {
	const { admitted, policy, strategy, context, live, validScope, evaluate, locations } = options;
	const declarations = components(options.definition, admitted);
	return (
		path: string,
		scope: ReadScope = { rows: [] },
		row?: EnumeratedRow,
		sources: Readonly<Record<string, string>> = {},
	) => {
		const component = declarations.get(path);
		if (!component) throw new ProgramAdmissionError(path, "UNKNOWN_CUSTOM");
		if (!live() || !validScope(scope, component.enclosingScope)) throw new ProgramAdmissionError(path, "STALE_SCOPE");
		if (component.enclosingScope && !sameRowScope(scope, row)) throw new ProgramAdmissionError(path, "STALE_SCOPE");
		if (!component.enclosingScope && row) throw new ProgramAdmissionError(path, "STALE_SCOPE");
		const rules = policy.renderers[component.renderer]?.props;
		if (!rules) throw new ProgramAdmissionError(`${path}.renderer`, "MISSING_POLICY");
		const frame = strategy.capture(context);
		if (frame.instance !== context.instance || frame.token !== strategy.current(context))
			throw new ProgramAdmissionError(path, "STALE_CAPTURE");
		const output: Record<string, unknown> = Object.create(null);
		for (const [name, raw] of Object.entries(component.props)) {
			const at = `${path}.props.${name}`;
			const prop = raw as Node;
			switch (prop.mode) {
				case "literal":
					output[name] = typed(prop.value, rules[name], `${at}.value`);
					break;
				case "read":
					output[name] = readProp(at, scope, rules[name], evaluate);
					break;
				case "write":
					output[name] = writeProp(at, name, scope, row, frame, sources, rules[name], options);
					break;
				default:
					throw new ProgramAdmissionError(`${at}.mode`, "INVALID_PROP_MODE");
			}
		}
		if (!live() || frame.token !== strategy.current(context)) throw new ProgramAdmissionError(path, "STALE_CAPTURE");
		return Object.freeze(output);
	};
}

function writeProp(
	at: string,
	name: string,
	scope: ReadScope,
	row: EnumeratedRow | undefined,
	frame: DataFrame,
	sources: Readonly<Record<string, string>>,
	rule: PropRule | undefined,
	options: ComponentOptions,
) {
	const path = `${at}.reference`;
	const reference = options.admitted.targets.get(path);
	const source = Object.hasOwn(sources, name) ? sources[name] : undefined;
	if (!reference || typeof source !== "string") throw new ProgramAdmissionError(path, "MISSING_WRITER");
	const proof = checkPrivateDirectLocation(path, source, options.admitted, options.locations);
	if (
		!proof?.ok ||
		!rule ||
		(rule.expected !== "json" &&
			(proof.location.type.kind !== "primitive-type" || proof.location.type.name !== rule.expected))
	)
		throw new ProgramAdmissionError(path, "INVALID_WRITE_TARGET");
	const read = frame.read(reference, scope);
	if (read.status !== "found") throw new ProgramAdmissionError(path, `TARGET_${read.status.toUpperCase()}`);
	const callback = row ? options.bindRow(path, source, row) : options.bindDirect(path, source);
	if (!callback) throw new ProgramAdmissionError(path, "MISSING_WRITER");
	const nodePath = at.slice(0, at.indexOf(".props."));
	const onChange = (next: unknown) => {
		if (!options.live() || frame.token !== options.strategy.current(options.context)) return { status: "stale" };
		for (const flag of ["disabled", "readOnly"]) {
			const slot = `${nodePath}.${flag}`;
			if (!options.admitted.slots.some((entry) => entry.path === slot)) continue;
			const outcome = options.evaluate(slot, scope);
			if (!outcome.ok || outcome.value !== false) return { status: "denied" };
		}
		return callback(next);
	};
	return Object.freeze({ value: typed(read.value, rule, path), onChange });
}
