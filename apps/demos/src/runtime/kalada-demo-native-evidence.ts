import type { Node } from "./kalada-demo-schema";

/** The app installs its attested JSON schema, with the same native defaults as descriptor generation. */
export function addNativeEvidence(node: Node, schema: Node | undefined) {
	if (!schema || node.type !== "field") return;
	const props: Record<string, unknown> = {};
	const add = (key: string, value: unknown) => {
		if (value !== undefined) props[key] = { mode: "literal", value };
	};
	if (node.widget === "number" || node.widget === "demo16.range") {
		add("min", schema.minimum);
		add("max", schema.maximum);
		add("step", schema.multipleOf ?? (schema.type === "integer" || node.widget === "demo16.range" ? 1 : "any"));
	}
	if (["text", "textarea", "email", "url", "tel", "password", "search"].includes(String(node.widget))) {
		for (const key of ["minLength", "maxLength", "pattern", "format"]) add(key, schema[key]);
	}
	if (Object.keys(props).length)
		node.props = {
			...props,
			...(node.props && typeof node.props === "object" && !Array.isArray(node.props) ? node.props : {}),
		};
}
