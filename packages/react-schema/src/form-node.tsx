import type {
	FormNode,
	ResolvedActionState,
	ResolvedFieldState,
	ResolvedOutputState,
	RuntimeResolvedNodeState,
} from "@formbar/declarative";
import { fieldId } from "@formbar/react";
import { memo } from "react";
import type { ReactElement } from "react";
import { ActionNodeView } from "./action-node.js";
import { AccordionView, TabsView } from "./collection-nodes.js";
import { CustomNodeView } from "./extension-node.js";
import { FormField, FormValidation } from "./form-field.js";
import { OutputNodeView } from "./output-node.js";
import { DiagnosticFallback, layoutProps } from "./renderer-elements.js";
import { domIdToken, spanOutput } from "./renderer-evidence.js";
import type { RendererEnvironment } from "./renderer-types.js";
import { rootInstanceKey, useNodeObservation } from "./use-runtime-observation.js";

interface FormNodeProps {
	readonly node: FormNode;
	readonly environment: RendererEnvironment;
}

export const FormNodeView = memo(function FormNodeView({ node, environment }: FormNodeProps): ReactElement | null {
	const state = useNodeObservation(environment.runtime, rootInstanceKey(node.id));
	const layout = layoutProps(spanOutput(node.presentation?.span));
	if (!state) return <DiagnosticFallback code="unsupported-node" nodeId={node.id} layout={layout} />;
	if (!state.visible) return null;
	if (node.type === "field") return renderField(node, state, environment, layout);
	if (node.type === "output") return renderOutput(node, state, environment, layout);
	if (node.type === "action") return renderAction(node, state, environment, layout);
	if (node.type === "validation")
		return <FormValidation node={node} environment={environment} visible={state.visible} layout={layout} />;
	if (node.type === "group") return renderGroup(node, environment, layout);
	if (node.type === "section") return renderSection(node, environment, layout);
	if (node.type === "conditional") return renderConditional(node, state.branch, environment, layout);
	if (node.type === "tabs")
		return (
			<TabsView
				node={node}
				environment={environment}
				layout={layout}
				renderChildren={(children) => renderChildren(children, environment)}
			/>
		);
	if (node.type === "accordion")
		return (
			<AccordionView
				node={node}
				environment={environment}
				layout={layout}
				renderChildren={(children) => renderChildren(children, environment)}
			/>
		);
	if (node.type === "custom")
		return (
			<CustomNodeView
				node={node}
				state={state}
				environment={environment}
				layout={layout}
				renderChild={(child) => (
					<FormNodeView node={child} environment={{ ...environment, extensionFailureCode: "extension-child-failed" }} />
				)}
			/>
		);
	return <DiagnosticFallback code="unsupported-node" nodeId={node.id} layout={layout} />;
});

function renderField(
	node: Extract<FormNode, { type: "field" }>,
	state: RuntimeResolvedNodeState,
	environment: RendererEnvironment,
	layout: ReturnType<typeof layoutProps>,
): ReactElement {
	if (!isResolvedFieldState(state))
		return <DiagnosticFallback code="unsupported-node" nodeId={node.id} widget={node.widget} layout={layout} />;
	return <FormField node={node} state={state} environment={environment} layout={layout} />;
}

function renderAction(
	node: Extract<FormNode, { type: "action" }>,
	state: RuntimeResolvedNodeState,
	environment: RendererEnvironment,
	layout: ReturnType<typeof layoutProps>,
): ReactElement {
	if (!isResolvedActionState(state))
		return <DiagnosticFallback code="unsupported-node" nodeId={node.id} layout={layout} />;
	return <ActionNodeView node={node} state={state} environment={environment} layout={layout} />;
}

function renderOutput(
	node: Extract<FormNode, { type: "output" }>,
	state: RuntimeResolvedNodeState,
	environment: RendererEnvironment,
	layout: ReturnType<typeof layoutProps>,
): ReactElement {
	if (!isResolvedOutputState(state))
		return <DiagnosticFallback code="output-unresolved" nodeId={node.id} layout={layout} />;
	return <OutputNodeView node={node} state={state} environment={environment} layout={layout} />;
}

function renderGroup(
	node: Extract<FormNode, { type: "group" }>,
	environment: RendererEnvironment,
	layout: ReturnType<typeof layoutProps>,
): ReactElement {
	const legend = node.label ? fieldId(`${domIdToken(node.id)}-legend`, environment.prefix) : undefined;
	return (
		<fieldset
			data-formbar-node={node.id}
			{...(legend ? { "aria-labelledby": legend } : {})}
			{...layout.attributes}
			style={layout.style}
		>
			{node.label ? <legend id={legend}>{node.label}</legend> : null}
			<NodeChildren nodes={node.children} environment={environment} />
		</fieldset>
	);
}

function renderSection(
	node: Extract<FormNode, { type: "section" }>,
	environment: RendererEnvironment,
	layout: ReturnType<typeof layoutProps>,
): ReactElement {
	const token = domIdToken(node.id);
	const heading = fieldId(`${token}-heading`, environment.prefix);
	const description = node.description ? fieldId(`${token}-description`, environment.prefix) : undefined;
	return (
		<section
			data-formbar-node={node.id}
			{...(node.title ? { "aria-labelledby": heading } : {})}
			{...(description ? { "aria-describedby": description } : {})}
			{...layout.attributes}
			style={layout.style}
		>
			{node.title ? <h2 id={heading}>{node.title}</h2> : null}
			{node.description ? <p id={description}>{node.description}</p> : null}
			<NodeChildren nodes={node.children} environment={environment} />
		</section>
	);
}

function renderConditional(
	node: Extract<FormNode, { type: "conditional" }>,
	branch: "then" | "else" | "none" | undefined,
	environment: RendererEnvironment,
	layout: ReturnType<typeof layoutProps>,
): ReactElement {
	if (branch === "none") return <DiagnosticFallback code="conditional-unresolved" nodeId={node.id} layout={layout} />;
	const children = branch === "then" ? node.then : (node.else ?? []);
	return (
		<div data-formbar-node={node.id} {...layout.attributes} style={layout.style}>
			<NodeChildren nodes={children} environment={environment} />
		</div>
	);
}

function NodeChildren(props: { readonly nodes: readonly FormNode[]; readonly environment: RendererEnvironment }) {
	return props.nodes.map((node) => <FormNodeView key={node.id} node={node} environment={props.environment} />);
}

function renderChildren(nodes: readonly FormNode[], environment: RendererEnvironment): ReactElement {
	return (
		<>
			{nodes.map((node) => (
				<FormNodeView key={node.id} node={node} environment={environment} />
			))}
		</>
	);
}

function isResolvedFieldState(state: RuntimeResolvedNodeState): state is ResolvedFieldState {
	return state.type === "field" && "binding" in state && "issues" in state && "dirty" in state && "touched" in state;
}

function isResolvedOutputState(state: RuntimeResolvedNodeState): state is ResolvedOutputState {
	return state.type === "output" && "output" in state;
}

function isResolvedActionState(state: RuntimeResolvedNodeState): state is ResolvedActionState {
	return state.type === "action" && "action" in state && "payload" in state;
}
