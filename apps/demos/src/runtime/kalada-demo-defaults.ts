import type { JsonValue } from "@formbar/declarative";

type Node = Record<string, unknown>;
const object = (value: unknown): value is Node => !!value && typeof value === "object" && !Array.isArray(value);

export function schemaDefaults(schema: Node, prefix: readonly string[] = []): { path: string[]; value: JsonValue }[] {
	const defaults: { path: string[]; value: JsonValue }[] = [];
	if (!object(schema.properties)) return defaults;
	for (const [name, child] of Object.entries(schema.properties)) {
		if (!object(child)) continue;
		const path = [...prefix, name];
		if (child.default !== undefined) defaults.push({ path, value: child.default as JsonValue });
		if (child.type === "object") defaults.push(...schemaDefaults(child, path));
	}
	return defaults;
}
