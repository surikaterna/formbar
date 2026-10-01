import type { ExtensionProps } from "@formbar/declarative";
import type { JsonValue } from "@formbar/expressions";
import { leaf, literal, permitted } from "./attributes.js";
import { fail } from "./errors.js";
import { direct, read, recordWriter } from "./expressions.js";
import type { Environment, WriterState } from "./expressions.js";
import type { Element, FsxCompileOptions, SourceEntry } from "./types.js";

function matches(value: JsonValue, expected: string): boolean {
	if (expected === "json") return true;
	if (expected === "integer") return typeof value === "number" && Number.isSafeInteger(value);
	return (
		(expected === "string" && typeof value === "string") ||
		(expected === "number" && typeof value === "number") ||
		(expected === "boolean" && typeof value === "boolean")
	);
}
export function custom(
	element: Element,
	path: string,
	options: FsxCompileOptions,
	environment: Environment,
	map: SourceEntry[],
	writers: WriterState,
) {
	leaf(element, path);
	const installed = literal(element, "renderer", path);
	const descriptor = Object.hasOwn(options.renderers ?? {}, installed) ? options.renderers?.[installed] : undefined;
	if (!descriptor) fail("UNTRUSTED_RENDERER", `${path}.renderer`, element.attributes.get("renderer")?.valueRange);
	map.push({ path: `${path}.renderer`, range: element.attributes.get("renderer")?.valueRange ?? element.range });
	permitted(element, ["id", "renderer", ...Object.keys(descriptor.props)], path);
	const props: Record<string, ExtensionProps[string]> = Object.create(null);
	for (const [name, spec] of Object.entries(descriptor.props)) {
		const entry = element.attributes.get(name);
		if (!entry) fail("MISSING_PROP", `${path}.props.${name}`, element.range);
		const propPath = `${path}.props.${name}`;
		if (spec.mode === "write") {
			props[name] = { mode: "write", reference: direct(entry, `${propPath}.reference`, environment, map) };
			recordWriter(entry, `${propPath}.reference`, environment, writers);
		} else if (spec.mode === "read")
			props[name] = {
				mode: "read",
				expression: read(entry, `${propPath}.expression`, environment, map, spec.expected),
			};
		else props[name] = literalProp(entry, propPath, spec.expected, environment, map);
	}
	return { type: "custom" as const, renderer: descriptor.renderer, props };
}
function literalProp(
	entry: import("./types.js").Attribute,
	path: string,
	expected: string,
	environment: Environment,
	map: SourceEntry[],
): ExtensionProps[string] {
	let value: JsonValue;
	if (entry.value.kind === "literal") value = entry.value.value;
	else {
		const program = read(entry, `${path}.value`, environment, map);
		if (program.expression.kind !== "literal") fail("STATIC_LITERAL_REQUIRED", path, entry.valueRange);
		value = program.expression.value;
	}
	if (!matches(value, expected)) fail("PROP_TYPE_MISMATCH", path, entry.valueRange);
	map.push({ path: `${path}.value`, range: entry.valueRange });
	return { mode: "literal", value };
}
