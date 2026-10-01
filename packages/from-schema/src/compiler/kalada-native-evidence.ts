import type { FieldNode } from "@formbar/declarative";
import type { NormalizedEvidence } from "../descriptors/contracts.js";

const strings = new Set(["text", "textarea", "email", "url", "tel", "password", "search"]);

/** Preserve descriptor evidence as inert, independently validated native literals; never claim host authority. */
export function nativeEvidenceProps(evidence: NormalizedEvidence | undefined, widget: string): FieldNode["props"] {
	if (!evidence) return;
	const props: Record<string, NonNullable<FieldNode["props"]>[string]> = {};
	const add = (key: string, value: string | number | undefined) => {
		if (value !== undefined) props[key] = { mode: "literal", value };
	};
	if (widget === "number") {
		add("min", evidence.minimum);
		add("max", evidence.maximum);
		add("step", evidence.multipleOf ?? (evidence.primitive === "integer" ? 1 : "any"));
	}
	if (strings.has(widget)) {
		add("minLength", evidence.minLength);
		add("maxLength", evidence.maxLength);
		add("pattern", evidence.pattern);
		add("format", evidence.format);
	}
	return Object.keys(props).length ? props : undefined;
}
