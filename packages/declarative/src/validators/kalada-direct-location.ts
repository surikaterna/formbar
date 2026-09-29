import { checkKaladaV1DirectLocation } from "@kalada/syntax";
import type { KaladaDirectLocationBinding, KaladaDirectLocationOutcome } from "@kalada/syntax";
import type { AdmittedDefinition } from "./kalada-definition.js";
import { writeNode } from "./kalada-write-node.js";
import { resolveStaticReference, staticDependencyKey } from "./static-references.js";

export type TrustedDirectLocations = Readonly<Record<string, Readonly<Record<string, KaladaDirectLocationBinding>>>>;

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
	if (!reference.path.length || typeof reference.path.at(-1) !== "string") return;
	if (reference.path.some((part) => typeof part === "number")) return;
	if (admitted.computations.some(({ target }) => staticDependencyKey(target) === staticDependencyKey(reference)))
		return;
	const bindings = locations?.[path];
	if (!bindings) return;
	const outcome = checkKaladaV1DirectLocation(source, { bindings });
	if (!outcome.ok) return outcome;
	try {
		const checked = resolveStaticReference(outcome.location.target, admitted.scopes, field.enclosingScope);
		if (staticDependencyKey(checked) !== staticDependencyKey(reference)) return;
		return outcome;
	} catch {
		return;
	}
}
