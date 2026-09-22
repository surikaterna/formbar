import type { OutputNode, ResolvedOutputState } from "@formbar/declarative";
import { fieldId } from "@formbar/react";
import type { ReactElement } from "react";
import { formatOutput } from "./output-formatters.js";
import { DiagnosticFallback } from "./renderer-elements.js";
import type { LayoutProps } from "./renderer-elements.js";
import { domIdToken } from "./renderer-evidence.js";
import type { RendererEnvironment } from "./renderer-types.js";

export function OutputNodeView(props: {
	readonly node: OutputNode;
	readonly state: ResolvedOutputState;
	readonly environment: RendererEnvironment;
	readonly layout: LayoutProps;
}): ReactElement | null {
	const { node, state, environment, layout } = props;
	if (state.output.status === "hidden") return null;
	if (state.output.status === "error")
		return <DiagnosticFallback code="output-unresolved" nodeId={node.id} layout={layout} />;
	const formatted = formatOutput(state.output.value, node.format);
	if (!formatted.ok) return <DiagnosticFallback code={formatted.diagnostic} nodeId={node.id} layout={layout} />;
	const labelId = fieldId(`${domIdToken(state.instance.instanceKey)}-label`, environment.prefix);
	return (
		<div data-formbar-node={node.id} {...layout.attributes} style={layout.style}>
			<span id={labelId}>{node.label ?? "Calculated value"}</span>
			<output aria-labelledby={labelId}>{formatted.text}</output>
		</div>
	);
}
