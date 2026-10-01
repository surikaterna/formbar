import type { ArbiterPluginOptions } from "@formbar/arbiter";

export const fieldPolicyProperties = ["visible", "required", "disabled", "readOnly"] as const;
export type ManagedFieldPolicies = Record<(typeof fieldPolicyProperties)[number], ReadonlySet<string>>;
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);

export function fieldPolicyKey(property: (typeof fieldPolicyProperties)[number], name: string) {
	return `field${property[0]?.toUpperCase()}${property.slice(1)}:${name}`;
}

/** A trusted directive manages only its actual Boolean properties at its declared flat field path. */
export function managedFieldPolicies(rules?: ArbiterPluginOptions["rules"]): ManagedFieldPolicies {
	const result = {
		visible: new Set<string>(),
		required: new Set<string>(),
		disabled: new Set<string>(),
		readOnly: new Set<string>(),
	};
	for (const rule of rules ?? []) {
		for (const action of rule.then ?? []) {
			collectDirective(action, result);
		}
	}
	return result;
}

function collectDirective(action: unknown, result: Record<(typeof fieldPolicyProperties)[number], Set<string>>) {
	if (!record(action) || !record(action.$set)) return;
	for (const [key, value] of Object.entries(action.$set)) {
		if (!key.startsWith("$formbar.fieldPolicy.") || !record(value) || typeof value.path !== "string") continue;
		const name = /^\/([a-zA-Z][a-zA-Z0-9]*)$/.exec(value.path)?.[1];
		if (!name) continue;
		for (const property of fieldPolicyProperties) if (typeof value[property] === "boolean") result[property].add(name);
	}
}

export function managedPolicyUi(fields: ManagedFieldPolicies) {
	return Object.fromEntries(
		fieldPolicyProperties.flatMap((property) =>
			[...fields[property]].map((name) => [fieldPolicyKey(property, name), false]),
		),
	);
}
