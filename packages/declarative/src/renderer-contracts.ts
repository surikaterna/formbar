import type { JsonValue, ResolvedProps } from "@formbar/expressions";
import type { FormNode } from "./nodes.js";
import type { RuntimePort, RuntimeSnapshot } from "./runtime-contracts.js";

export interface RendererContext {
	readonly runtime: RuntimePort;
	readonly snapshot: RuntimeSnapshot;
	readonly renderNode: (node: FormNode) => unknown;
}

export interface WidgetProps {
	readonly nodeId: string;
	readonly value?: JsonValue;
	readonly expressionProps: ResolvedProps;
	readonly disabled: boolean;
	readonly readOnly: boolean;
}

export type NodeRenderer = (node: FormNode, context: RendererContext) => unknown;
export type WidgetRenderer = (props: WidgetProps, context: RendererContext) => unknown;
