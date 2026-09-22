import type { CustomNode, FormNode, ResolvedNodeState } from "@formbar/declarative";
import type { ReactElement } from "react";
import { ExtensionBoundary } from "./extension-boundary.js";
import { resolveCustomNode } from "./extension-registry.js";
import { DiagnosticFallback } from "./renderer-elements.js";
import type { LayoutProps } from "./renderer-elements.js";
import type { RendererEnvironment } from "./renderer-types.js";

interface CustomNodeViewProps {
	readonly node: CustomNode;
	readonly state: ResolvedNodeState;
	readonly environment: RendererEnvironment;
	readonly renderChild: (node: FormNode) => ReactElement;
	readonly layout: LayoutProps;
}

export function CustomNodeView(props: CustomNodeViewProps): ReactElement {
	const resolved = resolveCustomNode(props.environment.extensions, props.node.renderer, props.node.props);
	if (!resolved.ok)
		return (
			<DiagnosticFallback
				code={resolved.code}
				nodeId={props.node.id}
				extensionId={props.node.renderer}
				layout={props.layout}
			/>
		);
	const Component = resolved.registration.component;
	const children = (props.node.children ?? []).map((child) => (
		<ExtensionBoundary key={child.id} code="extension-child-failed" nodeId={child.id} extensionId={props.node.renderer}>
			{props.renderChild(child)}
		</ExtensionBoundary>
	));
	return (
		<div data-formbar-node={props.node.id} {...props.layout.attributes} style={props.layout.style}>
			<ExtensionBoundary
				code={props.environment.extensionFailureCode ?? "extension-render-failed"}
				nodeId={props.node.id}
				extensionId={props.node.renderer}
				resetKey={resolved.registration}
			>
				<Component
					nodeId={props.node.id}
					instanceKey={props.state.instance.instanceKey}
					renderer={props.node.renderer}
					props={resolved.props}
					policy={Object.freeze({
						visible: true,
						disabled: props.state.disabled,
						readOnly: props.state.readOnly,
					})}
				>
					{children}
				</Component>
			</ExtensionBoundary>
		</div>
	);
}
