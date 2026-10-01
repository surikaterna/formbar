import type { JsonValue } from "@formbar/declarative";

type Schema = Record<string, unknown>;
const object = (value: unknown): value is Schema => !!value && typeof value === "object" && !Array.isArray(value);

/** Editing may leave required fields absent; type/domain authority is separate from FINAL schema validation. */
export function schemaValueAllowed(node: Schema, value: JsonValue): boolean {
	if (value === null) return true;
	if (Array.isArray(node.enum) && !node.enum.some((choice) => Object.is(choice, value))) return false;
	if (node.type === "integer") return typeof value === "number" && Number.isSafeInteger(value);
	if (node.type === "number") return typeof value === "number" && Number.isFinite(value);
	if (node.type === "string") return typeof value === "string";
	if (node.type === "boolean") return typeof value === "boolean";
	if (node.type === "array")
		return (
			Array.isArray(value) &&
			object(node.items) &&
			value.every((item) => schemaValueAllowed(node.items as Schema, item))
		);
	if (node.type === "object") {
		if (!object(value) || !object(node.properties)) return false;
		const properties = node.properties;
		return Object.entries(value).every(
			([name, item]) =>
				Object.hasOwn(properties, name) &&
				object(properties[name]) &&
				schemaValueAllowed(properties[name], item as JsonValue),
		);
	}
	return false;
}
