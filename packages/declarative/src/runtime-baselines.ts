import type { ValidatedFormDefinition } from "./definition.js";
import type { FormNode } from "./nodes.js";
import type {
	RuntimeDiagnostic,
	RuntimeFieldBaseline,
	RuntimeNodeInstance,
	RuntimeRepeaterBaseline,
} from "./runtime-contracts.js";
import { runtimeDiagnostic } from "./runtime-diagnostics.js";

export interface RuntimeBaselines {
	readonly fields: ReadonlyMap<string, RuntimeFieldBaseline>;
	readonly repeaters: ReadonlyMap<string, RuntimeRepeaterBaseline>;
}

export function normalizeBaselines(
	definition: ValidatedFormDefinition,
	fields: readonly RuntimeFieldBaseline[],
	repeaters: readonly RuntimeRepeaterBaseline[],
	diagnostics: RuntimeDiagnostic[],
): RuntimeBaselines {
	return {
		fields: normalize(fields, nodeIds(definition.root, "field"), validField, diagnostics),
		repeaters: normalize(repeaters, nodeIds(definition.root, "repeater"), validRepeater, diagnostics),
	};
}

function normalize<T extends { readonly nodeId: string }>(
	input: readonly T[],
	allowed: ReadonlySet<string>,
	valid: (entry: T) => boolean,
	diagnostics: RuntimeDiagnostic[],
): ReadonlyMap<string, T> {
	const grouped = new Map<string, T[]>();
	input.forEach((entry, index) => {
		if (!valid(entry) || !allowed.has(entry.nodeId)) {
			diagnostics.push(runtimeDiagnostic("invalid-baseline", baselineInstance(entry, index), "baseline"));
			return;
		}
		grouped.set(entry.nodeId, [...(grouped.get(entry.nodeId) ?? []), entry]);
	});
	const output = new Map<string, T>();
	for (const [nodeId, entries] of grouped) {
		if (entries.length > 1)
			diagnostics.push(runtimeDiagnostic("duplicate-baseline", baselineInstance(entries[0], 0), "baseline"));
		else output.set(nodeId, Object.freeze({ ...entries[0] }));
	}
	return output;
}

function validField(value: RuntimeFieldBaseline): boolean {
	if (!baseValid(value)) return false;
	if (value.required !== undefined && typeof value.required !== "boolean") return false;
	if (value.label !== undefined && typeof value.label !== "string") return false;
	return Object.keys(value).every((key) => ["nodeId", "required", "label"].includes(key));
}

function validRepeater(value: RuntimeRepeaterBaseline): boolean {
	if (!baseValid(value)) return false;
	if (!optionalLimit(value.minItems) || !optionalLimit(value.maxItems)) return false;
	if (value.label !== undefined && typeof value.label !== "string") return false;
	return Object.keys(value).every((key) => ["nodeId", "minItems", "maxItems", "label"].includes(key));
}

function baseValid(value: { readonly nodeId: string }): boolean {
	return Boolean(value && typeof value === "object" && typeof value.nodeId === "string");
}

function optionalLimit(value: number | undefined): boolean {
	return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}

function baselineInstance(value: { readonly nodeId: string }, index: number): RuntimeNodeInstance {
	const nodeId = value && typeof value.nodeId === "string" ? value.nodeId : "";
	return Object.freeze({ nodeId, instanceKey: `baseline:${nodeId}:${index}`, scopes: Object.freeze([]) });
}

function nodeIds(root: FormNode, type: "field" | "repeater"): ReadonlySet<string> {
	const ids = new Set<string>();
	const visit = (node: FormNode): void => {
		if (node.type === type) ids.add(node.id);
		for (const child of nodeChildren(node)) visit(child);
	};
	visit(root);
	return ids;
}

function nodeChildren(node: FormNode): readonly FormNode[] {
	if (node.type === "group" || node.type === "section" || node.type === "repeater") return node.children;
	if (node.type === "conditional") return [...node.then, ...(node.else ?? [])];
	if (node.type === "tabs") return node.tabs.flatMap((tab) => tab.children);
	if (node.type === "accordion") return node.items.flatMap((item) => item.children);
	if (node.type === "custom") return node.children ?? [];
	return [];
}
