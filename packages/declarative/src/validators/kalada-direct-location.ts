import { checkKaladaV1DirectLocation } from "@kalada/syntax";
import type { KaladaDirectLocationBinding, KaladaDirectLocationOutcome } from "@kalada/syntax";
import type { AdmittedDefinition } from "./kalada-definition.js";
import { resolveStaticReference, staticDependencyKey } from "./static-references.js";

export type TrustedDirectLocations = Readonly<Record<string, Readonly<Record<string, KaladaDirectLocationBinding>>>>;

/** Trusted installation metadata is static evidence, never a grant to commit. */
export function checkPrivateDirectLocation(
	path: string,
	source: string,
	admitted: AdmittedDefinition,
	locations: TrustedDirectLocations | undefined,
): KaladaDirectLocationOutcome | undefined {
	const field = [...admitted.fields.values()].find((node) => `${node.path}.binding` === path);
	const reference = admitted.targets.get(path);
	if (!field || field.enclosingScope !== undefined || !reference || reference.namespace !== "data") return;
	if (!reference.path.length || reference.path.some((part) => typeof part !== "string")) return;
	if (admitted.computations.some(({ target }) => staticDependencyKey(target) === staticDependencyKey(reference)))
		return;
	const bindings = locations?.[path];
	if (!bindings) return;
	const outcome = checkKaladaV1DirectLocation(source, { bindings });
	if (!outcome.ok) return outcome;
	try {
		const checked = resolveStaticReference(outcome.location.target, admitted.scopes);
		if (staticDependencyKey(checked) !== staticDependencyKey(reference)) return;
		return outcome;
	} catch {
		return;
	}
}
