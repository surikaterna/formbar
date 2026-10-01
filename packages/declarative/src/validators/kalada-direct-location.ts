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
	const bindings = locations?.[path];
	if (!bindings) return;
	const wholeRow = typeof reference.path.at(-1) === "object";
	const descriptor = bindings.primitiveItem;
	if (
		wholeRow &&
		(field.type !== "field" ||
			!field.enclosingScope ||
			!descriptor ||
			descriptor.writable !== true ||
			descriptor.scope !== field.enclosingScope ||
			(reference.path.at(-1) as { row: string }).row !== descriptor.scope ||
			source !== "line")
	)
		return;
	const outcome = checkKaladaV1DirectLocation(source, {
		bindings: wholeRow ? { [source]: bindings[source] } : bindings,
	});
	if (!outcome.ok) return outcome;
	if (wholeRow && !wholeRowMatches(outcome, descriptor, source)) return;
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
	descriptor: TrustedDirectLocations[string]["primitiveItem"],
	source: string,
) {
	return (
		outcome.location.type.kind === "primitive-type" &&
		outcome.location.type.name === descriptor?.type &&
		outcome.location.target.namespace === "data" &&
		outcome.location.target.scope === descriptor?.scope &&
		outcome.location.target.segments.length === 0 &&
		outcome.location.range.start === 0 &&
		outcome.location.range.end === source.length
	);
}
