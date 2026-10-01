import type { JsonValue } from "@formbar/declarative";
import { copyJson } from "@formbar/expressions";
import type { DescriptorDocument, DescriptorNode, DescriptorOccurrence } from "../descriptors/contracts.js";
import { jsonPresentationHint } from "../json-presentation-hints.js";
import { type BindingContext, binding, childBinding, repeaterItemBinding } from "./bindings.js";
import { directTypedEnum } from "./direct-typed-enum.js";
import { nodeId, scopeId } from "./ids.js";
import { nativeEvidenceProps } from "./kalada-native-evidence.js";
import { containerPresentationFor, presentationFor } from "./presentation.js";

const literal = (value: JsonValue): JsonValue =>
	copyJson({ format: "kalada-program", version: 1, profile: "kalada-v1", expression: { kind: "literal", value } });

function occurrences(document: DescriptorDocument, parent: DescriptorOccurrence, relation: string) {
	return parent.children
		.map((id) => document.occurrences[id])
		.filter((child): child is DescriptorOccurrence => child?.relation === relation);
}

function hasApplicators(node: DescriptorNode): boolean {
	return (
		!!node.applicators &&
		Object.values(node.applicators).some(
			(entry) => entry && (typeof entry !== "object" || Object.keys(entry).length > 0),
		)
	);
}

function choice(
	value: unknown,
): { value: string | number | boolean | null; title?: string; disabled?: boolean } | undefined {
	if (value === null || ["string", "number", "boolean"].includes(typeof value))
		return { value: value as string | number | boolean | null };
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (!Object.keys(record).every((key) => ["value", "title", "disabled"].includes(key))) return undefined;
	const base = choice(record.value);
	if (
		!base ||
		(record.title !== undefined && typeof record.title !== "string") ||
		(record.disabled !== undefined && typeof record.disabled !== "boolean")
	)
		return undefined;
	return {
		...base,
		...(typeof record.title === "string" ? { title: record.title } : {}),
		...(typeof record.disabled === "boolean" ? { disabled: record.disabled } : {}),
	};
}

function enumOptions(document: DescriptorDocument, node: DescriptorNode, values: readonly unknown[]) {
	const hint = document.source.provider === "json-schema" ? jsonPresentationHint(node.metadata) : undefined;
	if (hint?.status === "invalid") throw new TypeError("Unsafe enum presentation options.");
	const raw = hint?.status === "valid" ? hint.value.options : undefined;
	if (raw !== undefined && (!Array.isArray(raw) || raw.length === 0 || raw.length > 256))
		throw new TypeError("Invalid enum presentation options.");
	const decorated = raw?.map(choice);
	if (decorated?.some((item) => !item)) throw new TypeError("Invalid enum presentation choice.");
	return values.map((value) => {
		const match = decorated?.find((item) => Object.is(item?.value, value));
		return match ?? { value, title: String(value) };
	});
}

function fieldEnum(document: DescriptorDocument, source: DescriptorNode, typedEnum: boolean) {
	if (source.kind === "enum") return source.values;
	if (!typedEnum || source.kind !== "intersection") return undefined;
	const enumNode = source.operands.find((ref) => document.nodes[ref.nodeId]?.kind === "enum");
	return document.evidence[enumNode?.nodeId ?? ""]?.enum;
}

function field(
	document: DescriptorDocument,
	occurrence: DescriptorOccurrence,
	context: BindingContext,
	path: string,
): JsonValue {
	const source = document.nodes[occurrence.nodeId];
	if (!source) throw new TypeError(`${path}: missing descriptor node; re-author this field.`);
	const typedEnum = directTypedEnum(document, occurrence, source);
	const enumValues = fieldEnum(document, source, typedEnum);
	if (source.kind !== "primitive" && source.kind !== "enum" && source.kind !== "literal" && !typedEnum)
		throw new TypeError(`${path}: structural widget requires an authored field and writable host location.`);
	if (source.kind === "primitive" && !["string", "number", "integer", "boolean", "date"].includes(source.type))
		throw new TypeError(`${path}: non-JSON primitive requires an authored field.`);
	const scalar = (value: unknown) => value === null || ["string", "number", "boolean"].includes(typeof value);
	if (
		(enumValues && (!enumValues.length || enumValues.some((value) => !scalar(value)))) ||
		(source.kind === "literal" && !scalar(source.value))
	)
		throw new TypeError(`${path}: non-scalar options require an authored field.`);
	const display = presentationFor(source, document.source.provider);
	if (display.invalidProps || display.invalidWidget || (display.widget === "unsupported" && !typedEnum))
		throw new TypeError(`${path}: unsupported widget/props; re-author this field.`);
	const widget = typedEnum && !display.explicitWidget ? "select" : display.widget;
	const evidenceProps = nativeEvidenceProps(document.evidence[occurrence.nodeId], widget);
	const options = enumValues
		? enumOptions(document, source, enumValues)
		: source.kind === "literal"
			? [{ value: source.value, title: String(source.value) }]
			: undefined;
	return copyJson({
		type: "field",
		id: nodeId(occurrence.id, "field"),
		binding: binding(context),
		widget,
		...(display.label === undefined ? {} : { label: display.label }),
		...(display.presentation ? { presentation: display.presentation } : {}),
		...(occurrence.presence === "required" ? { required: literal(true) } : {}),
		...(options || display.props || evidenceProps
			? {
					props: {
						...evidenceProps,
						...display.props,
						...(options ? { options: { mode: "literal", value: options } } : {}),
					},
				}
			: {}),
	});
}

function group(
	document: DescriptorDocument,
	occurrence: DescriptorOccurrence,
	context: BindingContext,
	path: string,
): JsonValue {
	const source = document.nodes[occurrence.nodeId];
	if (
		!source ||
		source.kind !== "object" ||
		source.unknownKeys !== "reject" ||
		(source.additionalProperties && document.nodes[source.additionalProperties.nodeId]?.kind !== "never") ||
		hasApplicators(source)
	)
		throw new TypeError(`${path}: dynamic object requires an authored Kalada definition.`);
	const display = containerPresentationFor(source, document.source.provider);
	const properties = occurrences(document, occurrence, "property");
	if (
		properties.length !== source.properties.length ||
		new Set(properties.map((child) => child.key)).size !== properties.length ||
		properties.some(
			(child) =>
				!source.properties.some((property) => property.name === child.key && property.node.nodeId === child.nodeId),
		)
	)
		throw new TypeError(`${path}: incomplete object projection; re-author before rendering.`);
	const children = properties.map((child, index) => {
		const childPath = `${path}.children[${index}]`;
		if (typeof child.key !== "string" || ["__proto__", "constructor", "prototype"].includes(child.key))
			throw new TypeError(`${childPath}: unsafe property requires re-authoring.`);
		return compileKaladaOccurrence(document, child.id, childBinding(context, child.key), childPath);
	});
	return copyJson(
		display.title || display.description
			? { type: "section", id: nodeId(occurrence.id, "section"), ...display, children }
			: {
					type: "group",
					id: nodeId(occurrence.id, "group"),
					...(display.presentation ? { presentation: display.presentation } : {}),
					children,
				},
	);
}

function repeater(
	document: DescriptorDocument,
	occurrence: DescriptorOccurrence,
	context: BindingContext,
	path: string,
): JsonValue {
	const items = occurrences(document, occurrence, "items");
	if (items.length !== 1 || occurrence.children.length !== 1)
		throw new TypeError(`${path}: incomplete repeater item; re-author this array.`);
	const item = items[0];
	if (!item) throw new TypeError(`${path}: missing repeater item; re-author this array.`);
	const scope = scopeId(occurrence.id);
	const evidence = document.evidence[occurrence.nodeId];
	return copyJson({
		type: "repeater",
		id: nodeId(occurrence.id, "repeater"),
		binding: binding(context),
		scope,
		children: [compileKaladaOccurrence(document, item.id, repeaterItemBinding(scope), `${path}.children[0]`)],
		...(evidence?.minItems === undefined ? {} : { minItems: evidence.minItems }),
		...(evidence?.maxItems === undefined ? {} : { maxItems: evidence.maxItems }),
	});
}

/** Direct generated V1 programs; no legacy expression evaluation, converter or array-action fallback. */
export function compileKaladaOccurrence(
	document: DescriptorDocument,
	id: string,
	context: BindingContext,
	path: string,
): JsonValue {
	const occurrence = document.occurrences[id];
	if (!occurrence || occurrence.expansion !== "expanded")
		throw new TypeError(`${path}: missing/partial schema occurrence; re-author before rendering.`);
	const source = document.nodes[occurrence.nodeId];
	if (!source) throw new TypeError(`${path}: missing schema descriptor; re-author before rendering.`);
	if (source.kind === "wrapper" && ["catch", "readonly", "effect", "pipeline", "coerce"].includes(source.wrapper))
		throw new TypeError(`${path}: ${source.wrapper} requires authored host semantics.`);
	if (hasApplicators(source)) throw new TypeError(`${path}: schema applicators require authored Kalada presentation.`);
	const display = presentationFor(source, document.source.provider);
	if (
		display.explicitWidget &&
		(source.kind === "primitive" ||
			source.kind === "enum" ||
			source.kind === "literal" ||
			source.kind === "intersection")
	)
		return field(document, occurrence, context, path);
	if (source.kind === "intersection") return field(document, occurrence, context, path);
	if (source.kind === "object") return group(document, occurrence, context, path);
	if (source.kind === "array") return repeater(document, occurrence, context, path);
	if (source.kind === "wrapper" || source.kind === "ref") {
		const relation = source.kind === "wrapper" ? "wrapper" : "reference";
		const children = occurrences(document, occurrence, relation);
		if (children.length !== 1 || occurrence.children.length !== 1)
			throw new TypeError(`${path}: unresolved ${relation}; re-author before rendering.`);
		return compileKaladaOccurrence(document, children[0].id, context, path);
	}
	if (source.kind === "primitive" || source.kind === "enum" || source.kind === "literal")
		return field(document, occurrence, context, path);
	throw new TypeError(`${path}: ${source.kind} requires authored Kalada V1 presentation.`);
}
