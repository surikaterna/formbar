import type { FormApi, FormStateCapture } from "@formbar/core";
import { inspectDataContainer } from "@formbar/expressions";
import type { Segment } from "@formbar/expressions";
import type { AbsoluteBinding } from "./bindings.js";
import type { ValidatedFormDefinition } from "./definition.js";
import type { FormNode } from "./nodes.js";
import type { RuntimeNodeInstance, RuntimeSnapshot } from "./runtime-contracts.js";
import { projectRuntime } from "./runtime-projection.js";

export interface ConcreteOwner {
	readonly instance: RuntimeNodeInstance;
	readonly binding: AbsoluteBinding;
	readonly visible: boolean;
	readonly eligible: boolean;
	readonly protected: boolean;
}

export interface ConcreteOwnership {
	readonly fields: readonly ConcreteOwner[];
	readonly repeaters: readonly ConcreteOwner[];
	readonly unknown: readonly AbsoluteBinding[];
	readonly diagnostics: boolean;
	readonly current: () => boolean;
	readonly forField: (fieldId: string) => readonly ConcreteOwner[] | undefined;
}

const unsafe = new Set(["__proto__", "constructor", "prototype"]);

function prefix(a: readonly Segment[], b: readonly Segment[]): boolean {
	return a.length <= b.length && a.every((part, index) => part === b[index]);
}

function overlaps(a: AbsoluteBinding, b: AbsoluteBinding): boolean {
	return a.namespace === b.namespace && (prefix(a.segments, b.segments) || prefix(b.segments, a.segments));
}

function bound(root: unknown, binding: AbsoluteBinding): boolean {
	if (binding.namespace !== "data" || !binding.segments.length) return false;
	let value = root;
	try {
		for (const [index, segment] of binding.segments.entries()) {
			if (value === null || typeof value !== "object") return false;
			const array = Array.isArray(value);
			if (array !== (typeof segment === "number")) return false;
			if (array && index === binding.segments.length - 1) return false;
			if (typeof segment === "string" && (!segment || unsafe.has(segment))) return false;
			if (typeof segment === "number" && (!Number.isSafeInteger(segment) || segment < 0)) return false;
			const entries = inspectDataContainer(value);
			const entry = entries.find(([key]) => key === String(segment));
			if (!entry) return false;
			value = entry[1];
		}
		return value !== undefined;
	} catch {
		return false;
	}
}

function copyBinding(binding: AbsoluteBinding): AbsoluteBinding {
	return Object.freeze({ namespace: binding.namespace, segments: Object.freeze([...binding.segments]) });
}

function copyInstance(instance: RuntimeNodeInstance): RuntimeNodeInstance {
	const scopes = Object.freeze(instance.scopes.map((scope) => Object.freeze({ ...scope })));
	return Object.freeze({ nodeId: instance.nodeId, instanceKey: instance.instanceKey, scopes });
}

function definitionFields(node: FormNode, ids: Map<string, "field" | "other">): void {
	if (ids.has(node.id)) throw new Error("Duplicate definition node ID");
	ids.set(node.id, node.type === "field" ? "field" : "other");
	if (node.type === "conditional") {
		for (const child of [...node.then, ...(node.else ?? [])]) definitionFields(child, ids);
		return;
	}
	if (node.type === "tabs" || node.type === "accordion") {
		for (const entry of node.type === "tabs" ? node.tabs : node.items)
			for (const child of entry.children) definitionFields(child, ids);
		return;
	}
	if (!("children" in node) || !node.children) return;
	for (const child of node.children) definitionFields(child, ids);
}

function owners(snapshot: RuntimeSnapshot, root: unknown): { fields: ConcreteOwner[]; repeaters: ConcreteOwner[] } {
	const fields = snapshot.fields.map((field) => ({
		instance: copyInstance(field.instance),
		binding: copyBinding(field.binding),
		visible: field.visible,
		eligible: bound(root, field.binding),
		protected: false,
	}));
	const repeaters = snapshot.repeaters.map((repeater) => ({
		instance: copyInstance(repeater.instance),
		binding: copyBinding(repeater.binding ?? { namespace: "", segments: [] }),
		visible: repeater.visible,
		eligible: repeater.status === "ready" && !!repeater.binding && bound(root, repeater.binding),
		protected: false,
	}));
	return { fields, repeaters };
}

function unknownBindings(
	root: unknown,
	fields: readonly ConcreteOwner[],
	repeaters: readonly ConcreteOwner[],
): AbsoluteBinding[] {
	const unknown: AbsoluteBinding[] = [];
	function visit(value: unknown, segments: readonly Segment[]): void {
		if (value === null || typeof value !== "object") return;
		let entries: readonly (readonly [string, unknown])[];
		try {
			entries = inspectDataContainer(value);
		} catch {
			unknown.push(copyBinding({ namespace: "data", segments }));
			return;
		}
		for (const [key, child] of entries) {
			const segment = Array.isArray(value) ? Number(key) : key;
			const path = [...segments, segment];
			const binding = { namespace: "data", segments: path };
			const exact = fields.some(
				(field) =>
					field.binding.namespace === "data" &&
					field.binding.segments.length === path.length &&
					prefix(path, field.binding.segments),
			);
			const descendant = fields.some(
				(field) => field.binding.namespace === "data" && prefix(path, field.binding.segments),
			);
			const structural = repeaters.some(
				(item) =>
					item.binding.namespace === "data" &&
					(prefix(path, item.binding.segments) || prefix(item.binding.segments, path)),
			);
			if (!exact && !descendant && (!structural || child === null || typeof child !== "object")) {
				unknown.push(copyBinding(binding));
				continue;
			}
			visit(child, path);
		}
	}
	visit(root, []);
	return unknown;
}

/** Private, attempt-local read model; the caller supplies the one already captured core state. */
export function projectConcreteOwnership(options: {
	readonly form: FormApi<unknown, unknown>;
	readonly definition: ValidatedFormDefinition;
	readonly capture: FormStateCapture<unknown, unknown>;
}): ConcreteOwnership {
	const ids = new Map<string, "field" | "other">();
	definitionFields(options.definition.root, ids);
	const snapshot = projectRuntime(options);
	const { fields, repeaters } = owners(snapshot, options.capture.state.data);
	const unknown = Object.freeze(unknownBindings(options.capture.state.data, fields, repeaters));
	const diagnostics = snapshot.diagnostics.length > 0;
	const protect = (item: ConcreteOwner, container: boolean): ConcreteOwner => {
		const protectedByField = fields.some(
			(field) => field !== item && field.visible && overlaps(field.binding, item.binding),
		);
		const protectedByContainer =
			!container &&
			repeaters.some(
				(repeater) =>
					!prefix(repeater.binding.segments, item.binding.segments) &&
					repeater.visible &&
					overlaps(repeater.binding, item.binding),
			);
		const protectedPath = protectedByField || protectedByContainer;
		return Object.freeze({
			...item,
			eligible:
				item.eligible && !diagnostics && !protectedPath && !unknown.some((path) => overlaps(path, item.binding)),
			protected: protectedPath,
		});
	};
	const ownedFields = Object.freeze(fields.map((item) => protect(item, false)));
	const ownedRepeaters = Object.freeze(repeaters.map((item) => protect(item, true)));
	return Object.freeze({
		fields: ownedFields,
		repeaters: ownedRepeaters,
		unknown,
		diagnostics,
		current: () => options.form.captureState().state === options.capture.state,
		forField: (id: string) =>
			ids.get(id) === "field" ? Object.freeze(ownedFields.filter((item) => item.instance.nodeId === id)) : undefined,
	});
}
