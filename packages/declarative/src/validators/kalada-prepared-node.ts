import type { JsonValue } from "@formbar/expressions";
import { type RecordValue, object } from "./kalada-definition-shape.js";
import { nativeWidgets } from "./kalada-policy.js";
import type { PreparedKaladaV1Definition } from "./kalada-prepared-definition.js";
import { ProgramAdmissionError } from "./kalada-program.js";

export function nodeAt(definition: JsonValue, path: string): RecordValue {
	let current = object(definition, "definition").root;
	if (path === "root") return object(current, path);
	const parts = path.slice("root".length).match(/\.[a-zA-Z]+\[\d+\]/g);
	if (!parts || parts.join("") !== path.slice("root".length))
		throw new ProgramAdmissionError(path, "INVALID_NODE_PATH");
	for (const part of parts) {
		const item = /^\.([a-zA-Z]+)\[(\d+)\]$/.exec(part);
		if (!item) throw new ProgramAdmissionError(path, "INVALID_NODE_PATH");
		const list = object(current, path)[item[1] as string];
		if (!Array.isArray(list)) throw new ProgramAdmissionError(path, "INVALID_NODE_PATH");
		current = list[Number(item[2])];
	}
	return object(current, path);
}

export function checkRenderers(
	prepared: PreparedKaladaV1Definition,
	installed: { readonly widgets?: ReadonlySet<string>; readonly renderers?: ReadonlySet<string> },
): void {
	for (const node of prepared.admitted.nodes.values()) {
		if (node.type !== "field" && node.type !== "custom") continue;
		const source = nodeAt(prepared.definition, node.path);
		const name = node.type === "field" ? source.widget : source.renderer;
		const path = `${node.path}.${node.type === "field" ? "widget" : "renderer"}`;
		if (typeof name !== "string") throw new ProgramAdmissionError(path, "MISSING_RENDERER");
		if (node.type === "field" && name === "unsupported") throw new ProgramAdmissionError(path, "UNSUPPORTED_WIDGET");
		if (node.type === "field" && nativeWidgets.has(name)) continue;
		const registry = node.type === "field" ? installed.widgets : installed.renderers;
		if (!registry?.has(name)) throw new ProgramAdmissionError(path, "MISSING_RENDERER");
	}
}
