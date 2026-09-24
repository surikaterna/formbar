import type { FieldNode, JsonValue } from "@formbar/declarative";
import type {
	DescriptorDocument,
	DescriptorNode,
	DescriptorOccurrence,
	DescriptorValue,
} from "../descriptors/contracts.js";
import { jsonPresentationHint } from "../json-presentation-hints.js";
import type { CompilationContext } from "./compile-occurrence.js";
import { directTypedEnum } from "./direct-typed-enum.js";
import type { CompiledPresentation } from "./presentation.js";

type Scalar = string | number | boolean | null;
type Choice = { value: Scalar; title?: string; disabled?: boolean };

export function canonicalEnum(
	document: DescriptorDocument,
	occurrence: DescriptorOccurrence,
	node: DescriptorNode,
): readonly DescriptorValue[] | undefined {
	if (document.source.provider !== "json-schema") return undefined;
	if (directTypedEnum(document, occurrence, node) && node.kind === "intersection") {
		const enumeration = document.nodes[node.operands[1].nodeId];
		return enumeration?.kind === "enum" ? enumeration.values : undefined;
	}
	if (
		node.kind !== "enum" ||
		(node.applicators && Object.values(node.applicators).some((value) => value && Object.keys(value).length))
	)
		return undefined;
	const values = node.values;
	return values.length > 0 && new Set(values).size === values.length && values.every(scalar) ? values : undefined;
}

export function canonicalEnumPresentation(
	context: CompilationContext,
	occurrence: DescriptorOccurrence,
	node: DescriptorNode,
	presentation: CompiledPresentation,
	canonical: readonly DescriptorValue[],
): CompiledPresentation {
	const { options, ...props } = presentation.props ?? {};
	if (options !== undefined)
		context.diagnostics.push({
			code: "unsupported-schema",
			severity: "warning",
			occurrenceId: occurrence.id,
			nodeId: occurrence.nodeId,
			message: "Native enum choice ignores x-formbar.props.options; schema enum choices are authoritative.",
		});
	const decorated = directOptions(context, occurrence, node, canonical);
	return {
		...presentation,
		widget: presentation.widget,
		props: Object.keys(props).length || decorated ? Object.freeze({ ...props, ...decorated }) : undefined,
	};
}

export function warnUnsafeOptions(
	context: CompilationContext,
	occurrence: DescriptorOccurrence,
	node: DescriptorNode,
): void {
	if (context.document.source.provider !== "json-schema") return;
	const hint = jsonPresentationHint(node.metadata);
	if (hint.status !== "invalid" || !hint.options) return;
	context.diagnostics.push({
		code: "invalid-option",
		severity: "warning",
		occurrenceId: occurrence.id,
		nodeId: occurrence.nodeId,
		message: "x-formbar.options contains unsafe JSON values.",
	});
}

export function directOptions(
	context: CompilationContext,
	occurrence: DescriptorOccurrence,
	node: DescriptorNode,
	canonical?: readonly unknown[],
): FieldNode["props"] | undefined {
	if (context.document.source.provider !== "json-schema") return undefined;
	const hint = jsonPresentationHint(node.metadata);
	if (hint.status !== "valid" || !Object.hasOwn(hint.value, "options")) return undefined;
	const raw = hint.value.options;
	const warn = (code: "invalid-option" | "duplicate-option" | "unmatched-option", index?: number) => {
		context.diagnostics.push({
			code,
			severity: "warning",
			occurrenceId: occurrence.id,
			nodeId: occurrence.nodeId,
			message:
				index === undefined
					? "x-formbar.options must be a nonempty bounded array."
					: `x-formbar.options[${index}]: ${code}.`,
			...(index === undefined ? {} : { index }),
		});
	};
	if (!Array.isArray(raw) || raw.length === 0 || raw.length > 256) {
		warn("invalid-option");
		return undefined;
	}
	const choices: Choice[] = [];
	for (const [index, entry] of raw.entries()) {
		const choice = parseChoice(entry);
		if (!choice) {
			warn("invalid-option", index);
			continue;
		}
		if (choices.some((item) => Object.is(item.value, choice.value))) {
			warn("duplicate-option", index);
			continue;
		}
		choices.push(choice);
	}
	if (!canonical) return choices.length ? { options: { mode: "literal", value: choices } } : undefined;
	return { options: { mode: "literal", value: decorate(canonical, raw, choices, warn) } };
}

function decorate(
	canonical: readonly unknown[],
	raw: readonly JsonValue[],
	choices: readonly Choice[],
	warn: (code: "unmatched-option", index: number) => void,
): JsonValue {
	for (const [index, entry] of raw.entries()) {
		const choice = parseChoice(entry);
		if (choice && !canonical.some((value) => scalar(value) && Object.is(value, choice.value)))
			warn("unmatched-option", index);
	}
	const decorated = canonical.map((value) => {
		const choice = choices.find((item) => Object.is(item.value, value));
		return choice ? { ...choice } : { value: value as Scalar };
	});
	return decorated as JsonValue;
}

function parseChoice(value: unknown): Choice | undefined {
	if (scalar(value)) return { value };
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (!Object.keys(record).every((key) => ["value", "title", "disabled"].includes(key))) return undefined;
	if (!Object.hasOwn(record, "value") || !scalar(record.value)) return undefined;
	if (record.title !== undefined && typeof record.title !== "string") return undefined;
	if (record.disabled !== undefined && typeof record.disabled !== "boolean") return undefined;
	return {
		value: record.value,
		...(typeof record.title === "string" ? { title: record.title } : {}),
		...(typeof record.disabled === "boolean" ? { disabled: record.disabled } : {}),
	};
}

function scalar(value: unknown): value is Scalar {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	);
}
