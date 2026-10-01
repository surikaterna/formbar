import { type JsonValue, copyJson } from "@formbar/expressions";
import type { DescriptorDocument } from "../descriptors/contracts.js";
import { nativeEvidenceProps } from "./kalada-native-evidence.js";

type RecordNode = Record<string, JsonValue>;
type Scopes = Readonly<Record<string, readonly string[]>>;
const record = (value: JsonValue | undefined): value is RecordNode =>
	!!value && typeof value === "object" && !Array.isArray(value);

function visit(node: JsonValue, scopes: Scopes, document: DescriptorDocument): JsonValue {
	if (!record(node)) return node;
	let output = { ...node };
	const binding = record(node.binding) ? node.binding : undefined;
	const segments = binding?.segments;
	const prefix = typeof binding?.scope === "string" ? scopes[binding.scope] : [];
	const path =
		binding?.namespace === "data" &&
		Array.isArray(segments) &&
		segments.every((part) => typeof part === "string") &&
		prefix
			? [...prefix, ...segments]
			: undefined;
	if (node.type === "field" && path && typeof node.widget === "string") {
		const occurrence = Object.values(document.occurrences).find(
			(item) => JSON.stringify(item.path) === JSON.stringify(path),
		);
		const evidence = occurrence && document.evidence[occurrence.nodeId];
		const props = nativeEvidenceProps(evidence, node.widget);
		const captured = props && copyJson(props);
		if (captured && record(captured))
			output = { ...output, props: { ...captured, ...(record(node.props) ? node.props : {}) } };
	}
	const next =
		node.type === "repeater" && typeof node.scope === "string" && path
			? { ...scopes, [node.scope]: [...path, "*"] }
			: scopes;
	for (const key of ["children", "then", "else", "tabs", "items"]) {
		const children = node[key];
		if (Array.isArray(children)) output[key] = children.map((child) => visit(child, next, document));
	}
	return output;
}

/** Schema integration supplements only missing native literals; authored values keep their explicit precedence. */
export function authoredNativeEvidence(definition: unknown, document: DescriptorDocument): JsonValue {
	const copy = structuredClone(copyJson(definition));
	if (record(copy) && copy.root !== undefined) return { ...copy, root: visit(copy.root, {}, document) };
	return copy;
}
