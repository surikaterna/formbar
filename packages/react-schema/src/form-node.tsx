import type {
	FormNode,
	ResolvedActionState,
	ResolvedFieldState,
	ResolvedOutputState,
	ResolvedRepeaterState,
	ResolvedValidationState,
	RuntimeResolvedNodeState,
	RuntimeScopeInstance,
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
import { RepeaterNodeView } from "./repeater-node.js";
import { runtimeInstanceKey, useNodeObservation } from "./use-runtime-observation.js";

interface FormNodeProps {
	readonly node: FormNode;
	readonly environment: RendererEnvironment;
	readonly scopes?: readonly RuntimeScopeInstance[];
}

export const FormNodeView = memo(function FormNodeView({
	node,
	environment,
	scopes = [],
}: FormNodeProps): ReactElement | null {
	const state = useNodeObservation(environment.runtime, runtimeInstanceKey(node.id, scopes));
	const layout = layoutProps(spanOutput(node.presentation?.span));
	if (!state) return <DiagnosticFallback code="unsupported-node" nodeId={node.id} layout={layout} />;
	if (!state.visible) return null;
	return renderNode({ node, environment, scopes }, state, layout);
});

function renderNode(
	props: Required<FormNodeProps>,
	state: RuntimeResolvedNodeState,
	layout: ReturnType<typeof layoutProps>,
): ReactElement {
	const { node, environment, scopes } = props;
	if (node.type === "field") return renderField(node, state, environment, layout);
	if (node.type === "output") return renderOutput(node, state, environment, layout);
	if (node.type === "action") return renderAction(node, state, environment, layout);
	if (node.type === "repeater") return renderRepeater(node, state, environment, layout);
	if (node.type === "validation") return renderValidation(node, state, environment, layout);
	return renderCompositeNode(node, state, environment, scopes, layout);
}

function renderCompositeNode(
	node: Exclude<FormNode, { type: "field" | "output" | "action" | "repeater" | "validation" }>,
	state: RuntimeResolvedNodeState,
	environment: RendererEnvironment,
	scopes: readonly RuntimeScopeInstance[],
	layout: ReturnType<typeof layoutProps>,
): ReactElement {
	if (node.type === "group") return renderGroup(node, state, environment, scopes, layout);
	if (node.type === "section") return renderSection(node, state, environment, scopes, layout);
	if (node.type === "conditional") return renderConditional(node, state.branch, environment, scopes, layout);
	if (node.type === "tabs" || node.type === "accordion") return renderCollection(node, environment, scopes, layout);
	if (node.type === "custom") return renderCustom(node, state, environment, scopes, layout);
	return <DiagnosticFallback code="unsupported-node" nodeId={state.instance.nodeId} layout={layout} />;
}

function renderRepeater(
	node: Extract<FormNode, { type: "repeater" }>,
	state: RuntimeResolvedNodeState,
	environment: RendererEnvironment,
	layout: ReturnType<typeof layoutProps>,
): ReactElement {
	if (!isResolvedRepeaterState(state))
		return <DiagnosticFallback code="unsupported-node" nodeId={node.id} layout={layout} />;
	return (
		<RepeaterNodeView
			node={node}
			state={state}
			environment={environment}
			layout={layout}
			renderChildren={(children, itemScopes) => renderChildren(children, environment, itemScopes)}
		/>
	);
}

function renderValidation(
	node: Extract<FormNode, { type: "validation" }>,
	state: RuntimeResolvedNodeState,
	environment: RendererEnvironment,
	layout: ReturnType<typeof layoutProps>,
): ReactElement {
	return isResolvedValidationState(state) ? (
		<FormValidation node={node} state={state} environment={environment} layout={layout} />
	) : (
		<DiagnosticFallback code="unsupported-node" nodeId={node.id} layout={layout} />
	);
}

function renderCollection(
	node: Extract<FormNode, { type: "tabs" | "accordion" }>,
	environment: RendererEnvironment,
	scopes: readonly RuntimeScopeInstance[],
	layout: ReturnType<typeof layoutProps>,
): ReactElement {
	const render = (children: readonly FormNode[]) => renderChildren(children, environment, scopes);
	return node.type === "tabs" ? (
		<TabsView node={node} environment={environment} layout={layout} renderChildren={render} />
	) : (
		<AccordionView node={node} environment={environment} layout={layout} renderChildren={render} />
	);
}

function renderCustom(
	node: Extract<FormNode, { type: "custom" }>,
	state: RuntimeResolvedNodeState,
	environment: RendererEnvironment,
	scopes: readonly RuntimeScopeInstance[],
	layout: ReturnType<typeof layoutProps>,
): ReactElement {
	return (
		<CustomNodeView
			node={node}
			state={state}
			environment={environment}
			layout={layout}
			renderChild={(child) => (
				<FormNodeView
					node={child}
					scopes={scopes}
					environment={{ ...environment, extensionFailureCode: "extension-child-failed" }}
				/>
			)}
		/>
	);
}

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
	state: RuntimeResolvedNodeState,
	environment: RendererEnvironment,
	scopes: readonly RuntimeScopeInstance[],
	layout: ReturnType<typeof layoutProps>,
): ReactElement {
	const legend = node.label
		? fieldId(`${domIdToken(state.instance.instanceKey)}-legend`, environment.prefix)
		: undefined;
	return (
		<fieldset
			data-formbar-node={node.id}
			{...(legend ? { "aria-labelledby": legend } : {})}
			{...layout.attributes}
			style={layout.style}
		>
			{node.label ? <legend id={legend}>{node.label}</legend> : null}
			<NodeChildren nodes={node.children} environment={environment} scopes={scopes} />
		</fieldset>
	);
}

function renderSection(
	node: Extract<FormNode, { type: "section" }>,
	state: RuntimeResolvedNodeState,
	environment: RendererEnvironment,
	scopes: readonly RuntimeScopeInstance[],
	layout: ReturnType<typeof layoutProps>,
): ReactElement {
	const token = domIdToken(state.instance.instanceKey);
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
			<NodeChildren nodes={node.children} environment={environment} scopes={scopes} />
		</section>
	);
}

function renderConditional(
	node: Extract<FormNode, { type: "conditional" }>,
	branch: "then" | "else" | "none" | undefined,
	environment: RendererEnvironment,
	scopes: readonly RuntimeScopeInstance[],
	layout: ReturnType<typeof layoutProps>,
): ReactElement {
	if (branch === "none") return <DiagnosticFallback code="conditional-unresolved" nodeId={node.id} layout={layout} />;
	const children = branch === "then" ? node.then : (node.else ?? []);
	return (
		<div data-formbar-node={node.id} {...layout.attributes} style={layout.style}>
			<NodeChildren nodes={children} environment={environment} scopes={scopes} />
		</div>
	);
}

function NodeChildren(props: {
	readonly nodes: readonly FormNode[];
	readonly environment: RendererEnvironment;
	readonly scopes: readonly RuntimeScopeInstance[];
}) {
	return props.nodes.map((node) => (
		<FormNodeView key={node.id} node={node} environment={props.environment} scopes={props.scopes} />
	));
}

function renderChildren(
	nodes: readonly FormNode[],
	environment: RendererEnvironment,
	scopes: readonly RuntimeScopeInstance[],
): ReactElement {
	return (
		<>
			{nodes.map((node) => (
				<FormNodeView key={node.id} node={node} environment={environment} scopes={scopes} />
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

function isResolvedRepeaterState(state: RuntimeResolvedNodeState): state is ResolvedRepeaterState {
	return state.type === "repeater" && "status" in state && "items" in state;
}

function isResolvedValidationState(state: RuntimeResolvedNodeState): state is ResolvedValidationState {
	return state.type === "validation" && "binding" in state;
}
