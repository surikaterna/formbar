import type { ValidationIssue } from "@formbar/core";
import { issueProductionOwnership, issueSourceAtCapture } from "@formbar/core/internal/scoped-sync";
import { decideExclusiveBindings } from "./exclusive-binding-decision.js";
import { isProjectedOwnership, sameOwnershipCapture } from "./runtime-ownership.js";
import type { ConcreteOwnership } from "./runtime-ownership.js";

/** Private original-emission association; neither a diagnostic path nor a fresh projection is evidence. */
export function certifiedExclusiveBinding(issue: ValidationIssue): boolean {
	const projected = issueProductionOwnership(issue) as ConcreteOwnership | undefined;
	if (!projected || !isProjectedOwnership(projected)) return false;
	const source = issueSourceAtCapture(issue, projected);
	if (
		!source?.capture ||
		!sameOwnershipCapture(projected, source.capture) ||
		!projected.current() ||
		!projected.capturedCurrent()
	)
		return false;
	const decision = decideExclusiveBindings(projected).forField(source.fieldId, source.instanceKey);
	if (decision?.decision !== "exclusive") return false;
	const binding = decision.owner.binding;
	if (binding.namespace !== "data" || binding.segments.length !== source.binding.length) return false;
	return binding.segments.every((segment, index) => segment === source.binding[index]);
}
