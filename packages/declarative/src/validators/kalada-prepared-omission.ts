import type { JsonValue } from "@formbar/expressions";
import type { OmissionRequest, ReadScope } from "./kalada-data-strategy.js";
import { object } from "./kalada-definition-shape.js";
import { type FrameReader, checked, children } from "./kalada-prepared-view.js";
import { ProgramAdmissionError } from "./kalada-program.js";

type Fields = OmissionRequest["fields"];

function visibleGate(frame: FrameReader, node: ReturnType<typeof object>, path: string, scope: ReadScope): boolean {
	if (node.visible === undefined) return true;
	const value = checked(frame.evaluate(`${path}.visible`, scope));
	if (typeof value !== "boolean") throw new ProgramAdmissionError(`${path}.visible`, "BOOLEAN_REQUIRED");
	return value;
}

function collectChildren(
	frame: FrameReader,
	node: ReturnType<typeof object>,
	branch: string,
	path: string,
	scope: ReadScope,
	active: boolean,
): Fields {
	return children(node, branch, path).flatMap((child, index) =>
		omissionFields(frame, child, `${path}.${branch}[${index}]`, scope, active),
	);
}

/** Inventory includes inactive descendants but never evaluates their expressions. Row
 * enumeration supplies lexical host identities even beneath a hidden ancestor. */
export function omissionFields(
	frame: FrameReader,
	source: JsonValue,
	path: string,
	scope: ReadScope,
	active = true,
): Fields {
	const node = object(source, path);
	const visible = active && visibleGate(frame, node, path, scope);
	if (node.type === "field")
		return [
			{
				field: { path, scope },
				visible,
				...(node.submitWhenHidden === "include" ? { submitWhenHidden: "include" as const } : {}),
			},
		];
	const collect = (branch: string, parent: ReadScope, enabled = visible) =>
		collectChildren(frame, node, branch, path, parent, enabled);
	if (node.type === "repeater") {
		const enumeration = frame.enumerateRows(path, scope);
		if (!enumeration.ok) throw new ProgramAdmissionError(enumeration.path, enumeration.code);
		return enumeration.rows.flatMap((row) => collect("children", row.scope));
	}
	if (node.type === "conditional") {
		let thenActive = false;
		if (visible) {
			const condition = checked(frame.evaluate(`${path}.condition`, scope));
			if (typeof condition !== "boolean") throw new ProgramAdmissionError(`${path}.condition`, "BOOLEAN_REQUIRED");
			thenActive = condition;
		}
		return [
			...collect("then", scope, visible && thenActive),
			...(node.else ? collect("else", scope, visible && !thenActive) : []),
		];
	}
	if (node.type === "tabs" || node.type === "accordion") {
		const branch = node.type === "tabs" ? "tabs" : "items";
		return children(node, branch, path).flatMap((entry, index) => {
			const at = `${path}.${branch}[${index}]`;
			return collectChildren(frame, object(entry, at), "children", at, scope, visible);
		});
	}
	return node.children ? collect("children", scope) : [];
}
