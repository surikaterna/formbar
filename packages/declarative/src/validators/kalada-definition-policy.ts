import { type JsonValue, copyJson } from "@formbar/expressions";
import { object } from "./kalada-definition-shape.js";
import { type AdmittedDefinition, admitKaladaDefinition } from "./kalada-definition.js";
import { checkNativeConstraints } from "./kalada-native-constraints.js";
import { checkAttestedPath } from "./kalada-path-authority.js";
import {
	type AdmissionPolicy,
	type PolicyIdentity,
	builtInActions,
	checkPolicyDeclaration,
	checkPolicyNamespace,
	checkPolicySchemaSide,
	nativeWidgets,
} from "./kalada-policy.js";
import { ProgramAdmissionError } from "./kalada-program.js";

function declarationProps(source: Record<string, JsonValue>): Record<string, { mode: string; value?: JsonValue }> {
	const output: Record<string, { mode: string; value?: JsonValue }> = Object.create(null);
	if (source.props === undefined) return output;
	for (const [name, raw] of Object.entries(object(source.props, "props"))) {
		const spec = object(raw, `props.${name}`);
		output[name] =
			spec.mode === "literal" ? { mode: "literal", value: spec.value as JsonValue } : { mode: spec.mode as string };
	}
	return output;
}

function policyNode(
	source: Record<string, JsonValue>,
	path: string,
	policy: AdmissionPolicy,
	identity: PolicyIdentity,
): void {
	const type = source.type;
	const key = type === "field" ? "widget" : type === "custom" ? "renderer" : type === "action" ? "action" : undefined;
	const name = key ? source[key] : undefined;
	if (type === "field" && typeof name === "string" && nativeWidgets.has(name))
		checkNativeConstraints(name, source.props, `${path}.props`);
	if (
		key &&
		(typeof name !== "string" ||
			(key === "widget" && !nativeWidgets.has(name)) ||
			(key === "action" && !builtInActions.has(name)) ||
			key === "renderer")
	) {
		if (typeof name !== "string") throw new ProgramAdmissionError(`${path}.${key}`, "MISSING_POLICY");
		checkPolicyDeclaration(
			policy,
			identity,
			key,
			name,
			`${path}.${key}`,
			declarationProps(source),
			type === "custom" && source.children !== undefined,
		);
	}
	if (type === "field" || type === "validation" || type === "repeater") {
		const binding = object(source.binding, `${path}.binding`);
		checkPolicyNamespace(policy, identity, binding.namespace as string, `${path}.binding.namespace`);
	}
	if (type === "field" || type === "validation" || type === "repeater")
		if (bindingNamespace(source) === "data") checkPolicySchemaSide(policy, identity, "input", `${path}.binding`);
}

function bindingNamespace(source: Record<string, JsonValue>): JsonValue {
	return object(source.binding, "binding").namespace as JsonValue;
}

function groupsFor(source: Record<string, JsonValue>): readonly [string, JsonValue | undefined][] {
	return source.type === "conditional"
		? [
				["then", source.then],
				["else", source.else],
			]
		: source.type === "tabs"
			? [["tabs", source.tabs]]
			: source.type === "accordion"
				? [["items", source.items]]
				: [["children", source.children]];
}

function visitEntry(
	child: JsonValue,
	path: string,
	collection: boolean,
	policy: AdmissionPolicy,
	identity: PolicyIdentity,
): void {
	if (!collection) {
		visit(child, path, policy, identity);
		return;
	}
	const source = object(child, path);
	for (const [index, item] of (source.children as JsonValue[]).entries())
		visit(item, `${path}.children[${index}]`, policy, identity);
}

function visit(value: JsonValue, path: string, policy: AdmissionPolicy, identity: PolicyIdentity): void {
	const source = object(value, path);
	policyNode(source, path, policy, identity);
	const groups = groupsFor(source);
	for (const [key, entries] of groups) {
		if (!Array.isArray(entries)) continue;
		for (const [index, child] of entries.entries())
			visitEntry(child, `${path}.${key}[${index}]`, key === "tabs" || key === "items", policy, identity);
	}
}

/** Private full admission proof consumes host evidence; registries lack static descriptors (#291). */
export function admitKaladaDefinitionWithPolicy(
	input: unknown,
	policy: AdmissionPolicy,
	identity: PolicyIdentity,
): AdmittedDefinition {
	if (!policy || !identity) throw new ProgramAdmissionError("root", "MISSING_POLICY");
	if (policy.generation !== identity.generation || policy.fingerprint !== identity.fingerprint)
		throw new ProgramAdmissionError("root", "STALE_POLICY");
	const admitted = admitKaladaDefinition(input);
	const safe = copyJson(input);
	visit(object(safe, "definition").root as JsonValue, "root", policy, identity);
	for (const slot of admitted.slots)
		for (const reference of slot.dependencies) checkReference(reference, slot.path, policy, identity);
	for (const [path, reference] of admitted.targets) {
		const type = [...admitted.nodes.values()].find((node) => node.path === nodePath(path))?.type;
		checkReference(
			reference,
			path,
			policy,
			identity,
			type === "repeater" || (type === "action" && path.endsWith(".target")) ? "array" : undefined,
			true,
		);
	}
	return admitted;
}

function nodePath(path: string): string {
	return path.replace(/\.(binding|target)$/, "");
}

function checkReference(
	reference: import("./static-references.js").StaticReference,
	path: string,
	policy: AdmissionPolicy,
	identity: PolicyIdentity,
	kind?: "array",
	write = false,
): void {
	checkPolicyNamespace(policy, identity, reference.namespace, `${path}.namespace`);
	if (reference.namespace === "data" || reference.namespace === "ui") {
		if (reference.namespace === "data") checkPolicySchemaSide(policy, identity, "input", path);
		checkAttestedPath(reference, path, policy.schema, policy.ui, kind, write);
	}
}
