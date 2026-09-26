import type { FormApi, FormStateCapture } from "@formbar/core";
import { scopedCaptureCurrent, scopedLifecycleRevision } from "@formbar/core/internal/scoped-sync";
import { inspectDataContainer } from "@formbar/expressions";
import type { Segment } from "@formbar/expressions";
import type { AbsoluteBinding } from "./bindings.js";
import type { ValidatedFormDefinition } from "./definition.js";
import type { FormNode } from "./nodes.js";
import { OwnershipOverlapIndex } from "./ownership-overlap-index.js";
import type { RuntimeNodeInstance, RuntimeSnapshot } from "./runtime-contracts.js";
import { projectRuntime } from "./runtime-projection.js";

export interface ConcreteOwner {
	readonly instance: RuntimeNodeInstance;
	readonly binding: AbsoluteBinding;
	readonly visible: boolean;
	readonly submitWhenHidden?: "include";
	readonly eligible: boolean;
	readonly protected: boolean;
}

export interface ConcreteOwnership {
	readonly hiddenValues: "include" | "omit-inactive";
	readonly fields: readonly ConcreteOwner[];
	readonly repeaters: readonly ConcreteOwner[];
	readonly unknown: readonly AbsoluteBinding[];
	readonly diagnostics: boolean;
	readonly current: () => boolean;
	readonly capturedCurrent: () => boolean;
	readonly forField: (fieldId: string) => readonly ConcreteOwner[] | undefined;
}

const unsafe = new Set(["__proto__", "constructor", "prototype"]);
const projectedOwnership = new WeakSet<ConcreteOwnership>();

/** Private identity check; a path, issue, or hand-crafted read model is not ownership evidence. */
export function isProjectedOwnership(value: ConcreteOwnership): boolean {
	return projectedOwnership.has(value);
}

type Entries = ReadonlyMap<string, unknown> | undefined;

function captureEntries(): (value: object) => Entries {
	const cache = new WeakMap<object, Entries>();
	return (value) => {
		if (cache.has(value)) return cache.get(value);
		let entries: Entries;
		try {
			entries = new Map(inspectDataContainer(value));
		} catch {
			entries = undefined;
		}
		cache.set(value, entries);
		return entries;
	};
}

function bound(root: unknown, binding: AbsoluteBinding, entries: (value: object) => Entries): boolean {
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
			const container = entries(value);
			if (!container?.has(String(segment))) return false;
			value = container.get(String(segment));
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

function owners(
	snapshot: RuntimeSnapshot,
	root: unknown,
	entries: (value: object) => Entries,
): { fields: ConcreteOwner[]; repeaters: ConcreteOwner[] } {
	const fields = snapshot.fields.map((field) => ({
		instance: copyInstance(field.instance),
		binding: copyBinding(field.binding),
		visible: field.visible,
		...(field.submitWhenHidden === "include" ? { submitWhenHidden: "include" as const } : {}),
		eligible: bound(root, field.binding, entries),
		protected: false,
	}));
	const repeaters = snapshot.repeaters.map((repeater) => ({
		instance: copyInstance(repeater.instance),
		binding: copyBinding(repeater.binding ?? { namespace: "", segments: [] }),
		visible: repeater.visible,
		eligible: repeater.status === "ready" && !!repeater.binding && bound(root, repeater.binding, entries),
		protected: false,
	}));
	return { fields, repeaters };
}

function unknownBindings(
	root: unknown,
	fields: OwnershipOverlapIndex,
	repeaters: OwnershipOverlapIndex,
	entriesFor: (value: object) => Entries,
): AbsoluteBinding[] {
	const unknown: AbsoluteBinding[] = [];
	function visit(value: unknown, segments: readonly Segment[]): void {
		if (value === null || typeof value !== "object") return;
		const entries = entriesFor(value);
		if (!entries) {
			unknown.push(copyBinding({ namespace: "data", segments }));
			return;
		}
		for (const [key, child] of entries) {
			const segment = Array.isArray(value) ? Number(key) : key;
			const path = [...segments, segment];
			const binding = { namespace: "data", segments: path };
			const fieldMatches = fields.query(binding);
			const exact = fieldMatches.exact > 0;
			const descendant = fieldMatches.descendants > 0;
			const structural = repeaters.query(binding).overlaps > 0;
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

function ownerIndexes(fields: readonly ConcreteOwner[], repeaters: readonly ConcreteOwner[]) {
	const allFields = new OwnershipOverlapIndex();
	const allRepeaters = new OwnershipOverlapIndex();
	const visibleFields = new OwnershipOverlapIndex();
	const visibleRepeaters = new OwnershipOverlapIndex();
	for (const field of fields) {
		allFields.add(field.binding);
		if (field.visible) visibleFields.add(field.binding);
	}
	for (const repeater of repeaters) {
		allRepeaters.add(repeater.binding);
		if (repeater.visible) visibleRepeaters.add(repeater.binding);
	}
	return { allFields, allRepeaters, visibleFields, visibleRepeaters };
}

/** Private, attempt-local read model; the caller supplies the one already captured core state. */
export function projectConcreteOwnership(options: {
	readonly form: FormApi<unknown, unknown>;
	readonly definition: ValidatedFormDefinition;
	readonly capture: FormStateCapture<unknown, unknown>;
	readonly currentCapture?: FormStateCapture<unknown, unknown>;
	/** Supply the projectRuntime result from this very capture when already available. */
	readonly snapshot?: RuntimeSnapshot;
}): ConcreteOwnership {
	const ids = new Map<string, "field" | "other">();
	definitionFields(options.definition.root, ids);
	const snapshot = options.snapshot ?? projectRuntime(options);
	const lifecycle = scopedLifecycleRevision(options.form);
	const entries = captureEntries();
	const { fields, repeaters } = owners(snapshot, options.capture.state.data, entries);
	const { allFields, allRepeaters, visibleFields, visibleRepeaters } = ownerIndexes(fields, repeaters);
	const unknown = Object.freeze(unknownBindings(options.capture.state.data, allFields, allRepeaters, entries));
	const unknownIndex = new OwnershipOverlapIndex();
	for (const path of unknown) unknownIndex.add(path);
	const diagnostics = snapshot.diagnostics.length > 0;
	const protect = (item: ConcreteOwner, container: boolean): ConcreteOwner => {
		const protectedByField = visibleFields.query(item.binding).overlaps > (container || !item.visible ? 0 : 1);
		const protectedByContainer = !container && visibleRepeaters.query(item.binding).descendants > 0;
		const protectedPath = protectedByField || protectedByContainer;
		return Object.freeze({
			...item,
			eligible: item.eligible && !diagnostics && !protectedPath && unknownIndex.query(item.binding).overlaps === 0,
			protected: protectedPath,
		});
	};
	const ownedFields = Object.freeze(fields.map((item) => protect(item, false)));
	const ownedRepeaters = Object.freeze(repeaters.map((item) => protect(item, true)));
	const result: ConcreteOwnership = Object.freeze({
		hiddenValues: options.definition.submission?.hiddenValues ?? "include",
		fields: ownedFields,
		repeaters: ownedRepeaters,
		unknown,
		diagnostics,
		current: () =>
			scopedLifecycleRevision(options.form) === lifecycle &&
			scopedCaptureCurrent(options.form, options.currentCapture ?? options.capture),
		capturedCurrent: () =>
			scopedLifecycleRevision(options.form) === lifecycle && scopedCaptureCurrent(options.form, options.capture),
		forField: (id: string) =>
			ids.get(id) === "field" ? Object.freeze(ownedFields.filter((item) => item.instance.nodeId === id)) : undefined,
	});
	projectedOwnership.add(result);
	return result;
}
