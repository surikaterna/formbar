import { fail } from "./errors.js";
import type { Attribute, Element, SourceEntry } from "./types.js";

export function attribute(element: Element, name: string, path: string): Attribute {
	const value = element.attributes.get(name);
	if (!value) fail("MISSING_ATTRIBUTE", `${path}.${name}`, element.range);
	return value;
}
export function literal(element: Element, name: string, path: string): string {
	const entry = attribute(element, name, path);
	if (entry.value.kind !== "literal" || typeof entry.value.value !== "string")
		fail("STATIC_STRING_REQUIRED", `${path}.${name}`, entry.valueRange);
	return entry.value.value;
}
export function permitted(element: Element, names: readonly string[], path: string): void {
	for (const entry of element.attributes.values())
		if (!names.includes(entry.name)) fail("UNKNOWN_ATTRIBUTE", `${path}.${entry.name}`, entry.range);
}
export function leaf(element: Element, path: string): void {
	const child = element.children[0];
	if (child) fail("INVALID_CHILD", `${path}.children[0]`, child.range);
}
export function mapAttribute(map: SourceEntry[], element: Element, source: string, path: string): void {
	const entry = element.attributes.get(source);
	if (entry) map.push({ path, range: entry.valueRange });
}
