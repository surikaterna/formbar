import type { CSSProperties, ReactElement } from "react";
import type { RendererDiagnostic, SpanOutput } from "./renderer-evidence.js";

export interface LayoutProps {
	readonly attributes: Readonly<Record<string, string>>;
	readonly style?: CSSProperties;
}

export function layoutProps(output: SpanOutput | undefined): LayoutProps {
	if (!output) return { attributes: {} };
	return { attributes: output.attributes, style: output.style as CSSProperties };
}

export function DiagnosticFallback(props: {
	readonly code: RendererDiagnostic;
	readonly nodeId: string;
	readonly widget?: string;
	readonly layout?: LayoutProps;
}): ReactElement {
	return (
		// biome-ignore lint/a11y/useSemanticElements: The public diagnostic contract requires an explicit status role.
		<div
			role="status"
			data-formbar-diagnostic={props.code}
			data-formbar-node={props.nodeId}
			{...(props.widget ? { "data-formbar-widget": props.widget } : {})}
			{...props.layout?.attributes}
			style={props.layout?.style}
		>
			This form item cannot be rendered.
		</div>
	);
}
