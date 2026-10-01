import { type JsonValue, copyJson } from "@formbar/expressions";
import { checkKaladaV1DirectLocation } from "@kalada/syntax";
import type { KaladaDirectLocationBinding, KaladaDirectLocationOutcome } from "@kalada/syntax";
import type { AdmittedDefinition } from "./kalada-definition.js";
import { writeNode } from "./kalada-write-node.js";
import { resolveStaticReference, staticDependencyKey } from "./static-references.js";

export type TrustedDirectLocations = Readonly<
	Record<
		string,
		Readonly<Record<string, KaladaDirectLocationBinding>> & {
			readonly primitiveItem?: {
				readonly scope: string;
				readonly type: "string" | "number" | "integer" | "boolean";
				readonly writable: true;
			};
		}
	>
>;

/** Trusted installation metadata is static evidence, never a grant to commit. */
export function checkPrivateDirectLocation(
	path: string,
	source: string,
	admitted: AdmittedDefinition,
	locations: TrustedDirectLocations | undefined,
): KaladaDirectLocationOutcome | undefined {
	const field = writeNode(path, admitted);
	const reference = admitted.targets.get(path);
	if (!field || !reference || reference.namespace !== "data") return;
	if (!reference.path.length) return;
	if (reference.path.some((part) => typeof part === "number")) return;
	if (admitted.computations.some(({ target }) => staticDependencyKey(target) === staticDependencyKey(reference)))
		return;
	const bindings = bindingsFor(locations, path);
	if (!bindings) return;
	const wholeRow = typeof reference.path.at(-1) === "object";
	const descriptor = primitiveDescriptor(bindings);
	const last = reference.path.at(-1);
	if (
		wholeRow &&
		(!field.enclosingScope ||
			!descriptor ||
			descriptor.scope !== field.enclosingScope ||
			typeof last !== "object" ||
			last.row !== descriptor.scope)
	)
		return;
	const outcome = checkKaladaV1DirectLocation(source, { bindings });
	if (!outcome.ok) return outcome;
	if (wholeRow && !wholeRowMatches(outcome, descriptor)) return;
	try {
		const checked = resolveStaticReference(outcome.location.target, admitted.scopes, field.enclosingScope);
		if (staticDependencyKey(checked) !== staticDependencyKey(reference)) return;
		return outcome;
	} catch {
		return;
	}
}

function wholeRowMatches(
	outcome: Extract<KaladaDirectLocationOutcome, { ok: true }>,
	descriptor: ReturnType<typeof primitiveDescriptor>,
) {
	return (
		outcome.location.type.kind === "primitive-type" &&
		outcome.location.type.name === descriptor?.type &&
		outcome.location.target.namespace === "data" &&
		outcome.location.target.scope === descriptor?.scope &&
		outcome.location.target.segments.length === 0
	);
}

function primitiveDescriptor(bindings: TrustedDirectLocations[string]) {
	try {
		const property = Object.getOwnPropertyDescriptor(bindings, "primitiveItem");
		if (!property || !("value" in property)) return;
		const value = copyJson(property.value);
		if (!metadataRecord(value) || Object.keys(value).length !== 3) return;
		if (typeof value.scope !== "string" || !value.scope.length || value.writable !== true) return;
		if (typeof value.type !== "string" || !["string", "number", "integer", "boolean"].includes(value.type)) return;
		return { scope: value.scope, type: value.type };
	} catch {
		return;
	}
}

function bindingsFor(
	locations: TrustedDirectLocations | undefined,
	path: string,
): TrustedDirectLocations[string] | undefined {
	try {
		if (!locations) return;
		const descriptor = Object.getOwnPropertyDescriptor(locations, path);
		return descriptor && "value" in descriptor ? descriptor.value : undefined;
	} catch {
		return;
	}
}
function metadataRecord(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
