import type { PlaygroundDocument } from "./contracts";

const annotations = new Set(["title", "description", "$comment", "examples"]);
const maps = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
const schemas = new Set([
	"items",
	"additionalProperties",
	"unevaluatedProperties",
	"unevaluatedItems",
	"contains",
	"not",
	"if",
	"then",
	"else",
	"propertyNames",
]);
const arrays = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);

function dataContract(value: unknown): unknown {
	if (!record(value)) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.filter((key) => !annotations.has(key))
			.map((key) => {
				const child = value[key];
				if (maps.has(key) && record(child))
					return [
						key,
						Object.fromEntries(
							Object.keys(child)
								.sort()
								.map((name) => [name, dataContract(child[name])]),
						),
					];
				if ((arrays.has(key) || schemas.has(key)) && Array.isArray(child)) return [key, child.map(dataContract)];
				return [key, schemas.has(key) ? dataContract(child) : child];
			}),
	);
}

/** UI annotations may change without replacing user edits; data/schema constraint changes intentionally reinitialize. */
export function canRetainData(previous: PlaygroundDocument, next: PlaygroundDocument) {
	return (
		JSON.stringify(dataContract(previous.schema)) === JSON.stringify(dataContract(next.schema)) &&
		JSON.stringify(previous.initialData) === JSON.stringify(next.initialData)
	);
}
