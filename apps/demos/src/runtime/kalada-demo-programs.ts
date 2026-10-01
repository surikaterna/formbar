import {
	type ManagedFieldPolicies,
	fieldPolicyKey,
	fieldPolicyProperties,
	managedFieldPolicies,
} from "./kalada-demo-managed-policy";

type Node = Record<string, unknown>;
const record = (value: unknown): value is Node => !!value && typeof value === "object" && !Array.isArray(value);

function scanUi(value: unknown, paths: Map<string, string[]>): void {
	if (!record(value)) {
		if (Array.isArray(value)) for (const item of value) scanUi(item, paths);
		return;
	}
	if (value.kind === "ref" && record(value.ref) && value.ref.namespace === "ui") {
		const parts = value.ref.segments;
		if (Array.isArray(parts) && parts.every((part) => typeof part === "string"))
			paths.set(JSON.stringify(parts), parts);
	}
	for (const item of Object.values(value)) scanUi(item, paths);
}

function managedPolicy(node: Node, at: string, managed: ManagedFieldPolicies) {
	const binding = node.binding;
	if (node.type !== "field" || !record(binding) || !Array.isArray(binding.segments)) return;
	if (binding.scope !== undefined || binding.segments.length !== 1) return;
	const name = binding.segments.at(-1);
	if (typeof name !== "string") return;
	for (const property of fieldPolicyProperties)
		if (managed[property].has(name)) applyPolicyGate(node, at, name, property);
}

function applyPolicyGate(node: Node, at: string, name: string, property: (typeof fieldPolicyProperties)[number]) {
	// Boolean composition preserves authored restrictions without lowering source syntax.
	const gate = {
		format: "kalada-program",
		version: 1,
		profile: "kalada-v1",
		expression: { kind: "ref", ref: { namespace: "ui", segments: [fieldPolicyKey(property, name)] } },
	};
	const prior = node[property];
	if (prior !== undefined && !canonical(prior))
		throw new TypeError(`${at}.${property}: RE-AUTHOR as a Kalada V1 program`);
	node[property] =
		prior === undefined
			? gate
			: {
					...gate,
					expression: {
						kind: "boolean-logical",
						operator: property === "visible" ? "and" : "or",
						left: (prior as Node).expression,
						right: gate.expression,
					},
				};
}

/** #305 will replace these fixture literals with compiler-produced programs; installation never lowers source ASTs. */
export function canonicalDefinition(definition: Node, managedFields: ManagedFieldPolicies = managedFieldPolicies()) {
	const copy = structuredClone(definition);
	const uiPaths = new Map<string, string[]>();
	const expressions = new Set(["condition", "visible", "disabled", "readOnly", "required", "value"]);
	const visit = (node: Node, at: string): void => {
		managedPolicy(node, at, managedFields);
		for (const name of expressions) {
			const value = node[name];
			if (value === undefined) continue;
			if (!canonical(value)) throw new TypeError(`${at}.${name}: RE-AUTHOR as a Kalada V1 program`);
			scanUi(value, uiPaths);
		}
		for (const name of ["children", "then", "else"]) {
			const children = node[name];
			if (Array.isArray(children))
				children.forEach((child, index) => {
					if (record(child)) visit(child, `${at}.${name}[${index}]`);
				});
		}
		for (const name of ["tabs", "items"]) {
			const items = node[name];
			if (Array.isArray(items))
				items.forEach((item, index) => {
					if (record(item) && Array.isArray(item.children))
						item.children.forEach((child, childIndex) => {
							if (record(child)) visit(child, `${at}.${name}[${index}].children[${childIndex}]`);
						});
				});
		}
	};
	if (record(copy.root)) visit(copy.root, "root");
	return { definition: copy, uiPaths: [...uiPaths.values()] };
}

function canonical(value: unknown): value is Node {
	return (
		record(value) &&
		Object.keys(value).length === 4 &&
		value.format === "kalada-program" &&
		value.version === 1 &&
		value.profile === "kalada-v1" &&
		Object.hasOwn(value, "expression")
	);
}
