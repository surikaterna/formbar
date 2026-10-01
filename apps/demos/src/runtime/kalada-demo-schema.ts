import type { JsonValue } from "@formbar/declarative";
import { createJsonSchemaValidator } from "@formbar/from-schema";
export type Node = Record<string, unknown>;
export type Path = { path: readonly (string | { row: string })[]; kind: "array" | "value" };
const object = (value: unknown): value is Node => !!value && typeof value === "object" && !Array.isArray(value);
const property = (node: Node, part: string): Node | undefined =>
	object(node.properties) && Object.hasOwn(node.properties, part) && object(node.properties[part])
		? node.properties[part]
		: undefined;

export function schemaNode(schema: Node, path: Path["path"]): Node | undefined {
	let node: Node = schema;
	for (const part of path) {
		const child = typeof part === "string" ? property(node, part) : object(node.items) ? node.items : undefined;
		if (!child) return;
		node = child;
	}
	return node;
}

export function attestSchema(schema: Node, paths: readonly Path[]): void {
	for (const entry of paths) {
		const node = schemaNode(schema, entry.path);
		if (!node) throw new TypeError(`schema: UNATTESTED_PATH ${JSON.stringify(entry.path)}`);
		if (entry.kind === "array" && node.type !== "array") throw new TypeError("schema: ARRAY_AUTHORITY_REQUIRED");
		if (entry.kind === "value" && !["string", "number", "integer", "boolean", "array"].includes(String(node.type)))
			throw new TypeError("schema: SCALAR_AUTHORITY_REQUIRED");
	}
}

export function schemaPaths(schema: Node, prefix: Path["path"] = []): Path[] {
	if (!object(schema.properties)) return [];
	return Object.entries(schema.properties).flatMap(([name, child]) => {
		if (!object(child)) return [];
		const path = [...prefix, name];
		return [
			{ path, kind: child.type === "array" ? ("array" as const) : ("value" as const) },
			...schemaPaths(child, path),
		];
	});
}

export function schemaValidators(schema: Node) {
	const validate = createJsonSchemaValidator(schema);
	return [
		(value: JsonValue) =>
			validate({ data: value, uiState: {} }).map((issue) => ({
				path: issue.path.segments.filter(
					(part): part is string | number => typeof part === "string" || typeof part === "number",
				),
				message: issue.message,
				source: "schema" as const,
			})),
	];
}

export function arrayBounds(schema: Node, paths: readonly Path[]) {
	return Object.fromEntries(
		paths
			.filter((entry) => entry.kind === "array")
			.map((entry) => {
				const node = schemaNode(schema, entry.path);
				return [
					JSON.stringify(entry.path),
					{
						...(typeof node?.minItems === "number" ? { minItems: node.minItems } : {}),
						...(typeof node?.maxItems === "number" ? { maxItems: node.maxItems } : {}),
					},
				];
			}),
	);
}
