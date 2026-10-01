import type { KaladaV1Control, KaladaV1Host } from "@formbar/declarative";
import { type JsonValue, copyJson } from "@formbar/expressions";

function canonical(value: JsonValue): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, JsonValue>)[key] as JsonValue)}`)
		.join(",")}}`;
}

function sourceAt(definition: JsonValue, path: string) {
	let node = (definition as Record<string, JsonValue>).root;
	for (const match of path.matchAll(/\.([a-zA-Z]+)\[(\d+)\]/g)) {
		const entries = (node as Record<string, JsonValue>)[match[1] as string] as JsonValue[];
		node = entries[Number(match[2])];
	}
	return node as Record<string, JsonValue>;
}

function bindings(source: Record<string, JsonValue>) {
	if (source.type === "field") return source.binding;
	const result: Record<string, JsonValue> = Object.create(null);
	for (const [key, value] of Object.entries((source.props ?? {}) as Record<string, JsonValue>)) {
		const prop = value as Record<string, JsonValue>;
		if (prop.mode === "write") result[key] = prop.reference as JsonValue;
		if (prop.mode === "read") result[key] = prop.expression as JsonValue;
	}
	return result;
}

function projectedProps(props: KaladaV1Control["props"]) {
	const descriptors = Object.getOwnPropertyDescriptors(props);
	const keys = copyJson(Object.keys(descriptors)) as readonly string[];
	return `{${[...keys]
		.sort()
		.map((key) => {
			const property = descriptors[key];
			if (!property?.enumerable || !("value" in property)) throw new TypeError("Recovery props require JSON data.");
			return `${JSON.stringify(key)}:${canonical(copyJson(property.value))}`;
		})
		.join(",")}}`;
}

/** Admission-owned JSON only; bounded copies reject accessors and never stringify channels or opaque tokens. */
export function extensionRecovery(control: KaladaV1Control, host: KaladaV1Host, label?: string) {
	const source = sourceAt(host.definition, control.path);
	const data = [
		[control.key, control.path, control.nodeId, control.type, control.rendererId],
		bindings(source) ?? null,
		control.value === undefined,
		control.value ?? null,
		[label ?? null, control.disabled, control.readOnly, control.required ?? false],
	];
	return [...data.map((part) => canonical(copyJson(part))), projectedProps(control.props)].join("\n");
}
