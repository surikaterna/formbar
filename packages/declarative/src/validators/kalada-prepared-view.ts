import { type JsonValue, copyJson } from "@formbar/expressions";
import type { ActionResult407 } from "./kalada-action-contract-407.js";
import type { EnumeratedRow, ReadScope } from "./kalada-data-strategy.js";
import type { LifecycleFrame, LifecycleStatus } from "./kalada-data-strategy.js";
import { type RecordValue, list, object } from "./kalada-definition-shape.js";
import type { AdmissionPolicy } from "./kalada-policy.js";
import type { KaladaFormat409, KaladaSpan409 } from "./kalada-private-presentation-409.js";
import type { PrivateEvaluation } from "./kalada-private-runtime.js";
import { ProgramAdmissionError } from "./kalada-program.js";

export type Writer = (value: unknown) => { readonly status: string };
export interface PreparedControl {
	readonly path: string;
	readonly nodeId: string;
	readonly key: string;
	readonly type: "field" | "custom";
	readonly rendererId: string;
	readonly visible: boolean;
	readonly disabled: boolean;
	readonly readOnly: boolean;
	readonly required?: boolean;
	readonly lifecycle?: LifecycleStatus;
	readonly presentation?: {
		readonly span?: KaladaSpan409 | Partial<Record<"base" | "sm" | "md" | "lg" | "xl", KaladaSpan409>>;
	};
	readonly value?: JsonValue;
	readonly props: Readonly<Record<string, JsonValue>>;
	/** Ephemeral host channel, never serialized into FormDefinition or props. */
	readonly writers: Readonly<Record<string, Writer>>;
	/** Ephemeral host notification; blur never writes draft data. */
	readonly onBlur?: () => { readonly status: string };
}
export interface PreparedRowView {
	readonly path: string;
	readonly key: string;
	readonly order: number;
}
export interface PreparedOutput {
	readonly path: string;
	readonly nodeId: string;
	readonly key: string;
	readonly value: JsonValue;
	readonly format: KaladaFormat409;
	readonly presentation?: PreparedControl["presentation"];
	readonly label?: string;
}
export interface PreparedNodeView {
	readonly path: string;
	readonly nodeId: string;
	readonly key: string;
	readonly type: string;
	/** Static lexical array identity for presentation association only. */
	readonly arrayTarget?: string;
	readonly label?: string;
	readonly title?: string;
	readonly description?: string;
	readonly presentation?: PreparedControl["presentation"];
	readonly children?: readonly PreparedNodeView[];
	readonly items?: readonly {
		readonly id: string;
		readonly label: string;
		readonly children: readonly PreparedNodeView[];
	}[];
	readonly rows?: readonly { readonly key: string; readonly children: readonly PreparedNodeView[] }[];
	readonly issues?: readonly string[];
	readonly validationFor?: string;
	readonly lifecycle?: LifecycleStatus;
	readonly action?: {
		readonly name: string;
		readonly disabled?: boolean;
		readonly pending: () => boolean;
		invoke(destinationKey?: string): Promise<ActionResult407>;
	};
}
export interface Guard {
	readonly path: string;
	readonly scope: ReadScope;
}

/** Notification is host-owned; this closure never mutates the draft. */
export function scopedBlur(enabled: boolean, notify: () => { readonly status: string }) {
	return enabled ? { onBlur: notify } : {};
}

export function nodeId(node: RecordValue, path: string): string {
	if (typeof node.id !== "string") throw new ProgramAdmissionError(`${path}.id`, "INVALID_NODE_ID");
	return node.id;
}

export function lifecycleField(frame: LifecycleFrame, path: string, scope: ReadScope) {
	const result = frame.field({ path, scope });
	if (result.status !== "found") throw new ProgramAdmissionError(path, `LIFECYCLE_${result.status.toUpperCase()}`);
	return result.value;
}

export interface FrameReader {
	revision(): object | undefined;
	evaluate(path: string, scope: ReadScope): PrivateEvaluation;
	readTarget(path: string, scope: ReadScope): PrivateEvaluation;
	enumerateRows(
		path: string,
		parent: ReadScope,
	):
		| { readonly ok: true; readonly rows: readonly EnumeratedRow[] }
		| { readonly ok: false; readonly path: string; readonly code: string };
}

export function checked(result: PrivateEvaluation): JsonValue {
	if (!result.ok) throw new ProgramAdmissionError(result.path, result.code);
	return result.value;
}

function matches(value: JsonValue, expected: string): boolean {
	if (expected === "json") return true;
	if (expected === "null") return value === null;
	if (expected === "array") return Array.isArray(value);
	if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
	return (
		(expected === "string" && typeof value === "string") ||
		(expected === "number" && typeof value === "number") ||
		(expected === "boolean" && typeof value === "boolean")
	);
}

export function typed(value: JsonValue, expected: string | undefined, path: string): JsonValue {
	if (!expected) throw new ProgramAdmissionError(path, "MISSING_POLICY");
	if (!matches(value, expected)) throw new ProgramAdmissionError(path, "INVALID_PROP_TYPE");
	return value;
}

export function flags(
	node: RecordValue,
	path: string,
	scope: ReadScope,
	frame: Pick<FrameReader, "evaluate">,
	parent: { visible: boolean; disabled: boolean; readOnly: boolean },
) {
	const boolean = (name: "visible" | "disabled" | "readOnly", fallback: boolean): boolean => {
		if (node[name] === undefined) return fallback;
		const value = checked(frame.evaluate(`${path}.${name}`, scope));
		if (typeof value !== "boolean") throw new ProgramAdmissionError(`${path}.${name}`, "BOOLEAN_REQUIRED");
		return value;
	};
	return Object.freeze({
		visible: parent.visible && boolean("visible", true),
		disabled: parent.disabled || boolean("disabled", false),
		readOnly: parent.readOnly || boolean("readOnly", false),
	});
}

export function literalProps(source: JsonValue | undefined, path: string): Record<string, JsonValue> {
	const result: Record<string, JsonValue> = Object.create(null);
	if (source === undefined) return result;
	for (const [name, raw] of Object.entries(object(source, path))) {
		const prop = object(raw, `${path}.${name}`);
		if (prop.mode === "literal") result[name] = copyJson(prop.value);
	}
	return result;
}

export function customProps(
	node: RecordValue,
	path: string,
	scope: ReadScope,
	frame: FrameReader,
	policy: AdmissionPolicy,
	write: (path: string) => Writer,
) {
	const props = literalProps(node.props, `${path}.props`);
	const writers: Record<string, Writer> = Object.create(null);
	const renderer = node.renderer;
	const rules = typeof renderer === "string" ? policy.renderers[renderer]?.props : undefined;
	if (!rules) throw new ProgramAdmissionError(`${path}.renderer`, "MISSING_RENDERER_POLICY");
	for (const [name, raw] of Object.entries(object(node.props ?? {}, `${path}.props`))) {
		const at = `${path}.props.${name}`;
		const prop = object(raw, at);
		if (prop.mode === "read")
			props[name] = typed(checked(frame.evaluate(`${at}.expression`, scope)), rules[name]?.expected, at);
		if (prop.mode !== "write") continue;
		const target = `${at}.reference`;
		props[name] = typed(checked(frame.readTarget(target, scope)), rules[name]?.expected, target);
		writers[name] = write(target);
	}
	return { props: Object.freeze(props), writers: Object.freeze(writers) };
}

export function children(node: RecordValue, key: string, path: string): readonly JsonValue[] {
	return list(node[key], `${path}.${key}`);
}
