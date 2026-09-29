import type { AdmittedDefinition } from "./kalada-definition.js";

/** An exact admitted target is never inferred from a read expression or a field binding alias. */
export function writeNode(path: string, admitted: AdmittedDefinition) {
	if (!admitted.targets.has(path)) return;
	return [...admitted.nodes.values()].find(
		(node) =>
			(node.type === "field" && `${node.path}.binding` === path) ||
			(node.type === "custom" && path.startsWith(`${node.path}.props.`) && path.endsWith(".reference")),
	);
}
