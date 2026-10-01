import type { JsonValue } from "@formbar/declarative";
import type { Node } from "./kalada-demo-session";

const record = (value: unknown): value is Node => !!value && typeof value === "object" && !Array.isArray(value);

/** Caller draft constraints remain FINAL validation; schema defaults additionally require their enum domain. */
export function initialTypeAllowed(schema: Node, value: JsonValue, mode: "draft" | "default" = "draft"): boolean {
	if (Array.isArray(schema.anyOf))
		return schema.anyOf.some((node) => record(node) && initialTypeAllowed(node, value, mode));
	if (Array.isArray(schema.oneOf))
		return schema.oneOf.filter((node) => record(node) && initialTypeAllowed(node, value, mode)).length === 1;
	if (Array.isArray(schema.type))
		return schema.type.some((type) => initialTypeAllowed({ ...schema, type }, value, mode));
	if (mode === "default" && Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value)))
		return false;
	if (value === null)
		return (
			schema.type === "null" || (schema.type === undefined && Array.isArray(schema.enum) && schema.enum.includes(null))
		);
	if (schema.type === "object") {
		if (!record(value) || !record(schema.properties)) return false;
		const properties = schema.properties;
		return Object.entries(value).every(
			([name, item]) => record(properties[name]) && initialTypeAllowed(properties[name], item as JsonValue, mode),
		);
	}
	if (schema.type === "array")
		return (
			Array.isArray(value) &&
			record(schema.items) &&
			value.every((item) => initialTypeAllowed(schema.items as Node, item, mode))
		);
	if (schema.type === "integer") return typeof value === "number" && Number.isSafeInteger(value);
	if (schema.type === "number") return typeof value === "number" && Number.isFinite(value);
	if (schema.type === "boolean") return typeof value === "boolean";
	if (schema.type === "string") return typeof value === "string";
	return (
		schema.type === undefined &&
		Array.isArray(schema.enum) &&
		schema.enum.some((entry) => typeof entry === typeof value)
	);
}
