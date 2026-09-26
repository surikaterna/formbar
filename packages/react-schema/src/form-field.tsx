import { structuredEqual } from "@formbar/core";
import type { ValidationIssue } from "@formbar/core";
import type { FieldNode, ResolvedFieldState, ResolvedValidationState, ValidationNode } from "@formbar/declarative";
import { descriptionId, errorId, fieldId, useFormSelector } from "@formbar/react";
import type { ReactElement } from "react";
import { ExtensionField } from "./extension-field.js";
import { renderNativeControl } from "./native-controls.js";
import { DiagnosticFallback } from "./renderer-elements.js";
import type { LayoutProps } from "./renderer-elements.js";
import {
	NATIVE_WIDGET_IDS,
	descriptorDescription,
	descriptorEvidence,
	domIdToken,
	editablePath,
	fieldDescriptorKey,
	literalProp,
	resolveFieldEvidence,
} from "./renderer-evidence.js";
import type { FieldRenderEvidence } from "./renderer-evidence.js";
import type { RendererEnvironment } from "./renderer-types.js";

interface FieldProps {
	readonly node: FieldNode;
	readonly state: ResolvedFieldState;
	readonly environment: RendererEnvironment;
	readonly layout: LayoutProps;
}

interface Wiring {
	readonly controlId: string;
	readonly labelId: string;
	readonly descriptionId?: string;
	readonly description?: string;
	readonly issueId: string;
	readonly describedBy?: string;
	readonly hasErrors: boolean;
}

type SupportedFieldEvidence = Extract<FieldRenderEvidence, { readonly ok: true }>;

export function FormField({ node, state, environment, layout }: FieldProps): ReactElement | null {
	if (!state.visible) return null;
	if (node.widget === "unsupported")
		return <DiagnosticFallback code="unsupported-widget" nodeId={node.id} widget={node.widget} layout={layout} />;
	const native = NATIVE_WIDGET_IDS.has(node.widget)
		? resolveFieldEvidence(node, state, environment.descriptors)
		: undefined;
	if (native && !native.ok)
		return <DiagnosticFallback code={native.diagnostic} nodeId={node.id} widget={node.widget} layout={layout} />;
	const visibleIssues =
		state.dirty || state.touched || environment.submitted
			? [...state.issues, ...environment.attemptIssues.filter((issue) => sameCanonical(issue.path, state.binding))]
			: [];
	const description = fieldDescription(node, state, environment);
	const wiring = fieldWiring(state.instance.instanceKey, visibleIssues, environment.prefix, description);
	return (
		<div
			data-formbar-node={node.id}
			data-formbar-dirty={state.dirty || undefined}
			data-formbar-touched={state.touched || undefined}
			{...layout.attributes}
			style={layout.style}
		>
			{node.widget === "radio" ? null : (
				<label id={wiring.labelId} htmlFor={wiring.controlId}>
					{state.label}
				</label>
			)}
			{fieldControl(node, state, environment, wiring, description, native)}
			{wiring.description ? <div id={wiring.descriptionId}>{wiring.description}</div> : null}
			<IssueList issues={visibleIssues} id={wiring.issueId} />
		</div>
	);
}

function fieldControl(
	node: FieldNode,
	state: ResolvedFieldState,
	environment: RendererEnvironment,
	wiring: Wiring,
	description: string | undefined,
	native: FieldRenderEvidence | undefined,
): ReactElement {
	if (!NATIVE_WIDGET_IDS.has(node.widget))
		return (
			<ExtensionField
				node={node}
				state={state}
				environment={environment}
				evidence={descriptorEvidence(environment.descriptors, state.binding, fieldDescriptorKey(node))}
				{...(description === undefined ? {} : { description })}
				wiring={wiring}
			/>
		);
	return renderNativeControl(node, state, environment, native as SupportedFieldEvidence, wiring);
}

export function FormValidation(props: {
	readonly node: ValidationNode;
	readonly state: ResolvedValidationState;
	readonly environment: RendererEnvironment;
	readonly layout: LayoutProps;
}): ReactElement | null {
	const path = editablePath(props.state.binding);
	if (!props.state.visible) return null;
	if (!path) return <DiagnosticFallback code="unsupported-binding" nodeId={props.node.id} layout={props.layout} />;
	return <ValidationIssues {...props} path={path} />;
}

function ValidationIssues(props: {
	readonly node: ValidationNode;
	readonly environment: RendererEnvironment;
	readonly layout: LayoutProps;
	readonly path: string;
}): ReactElement {
	const lifecycle = useValidationLifecycle(props.environment, props.path);
	const visible = lifecycle.dirty || lifecycle.touched || lifecycle.submitted;
	const messages = props.node.messages ?? lifecycle.issues.map((issue) => issue.message);
	return (
		<div data-formbar-node={props.node.id} {...props.layout.attributes} style={props.layout.style}>
			{visible && lifecycle.issues.length > 0 ? (
				<ul>
					{messages.map((message, index) => (
						<li key={`${index}:${message}`}>{message}</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

function fieldWiring(
	instanceKey: string,
	issues: readonly ValidationIssue[],
	prefix: string,
	description: string | undefined,
): Wiring {
	const token = domIdToken(instanceKey);
	const hasErrors = issues.some((issue) => issue.severity === "error");
	const issueId = errorId(token, prefix);
	const descriptionToken = description ? descriptionId(token, prefix) : undefined;
	const describedBy = [descriptionToken, issues.length ? issueId : undefined].filter(Boolean).join(" ");
	return {
		controlId: fieldId(token, prefix),
		labelId: fieldId(`${token}-label`, prefix),
		...(description ? { description } : {}),
		...(descriptionToken ? { descriptionId: descriptionToken } : {}),
		issueId,
		...(describedBy ? { describedBy } : {}),
		hasErrors,
	};
}

function fieldDescription(
	node: FieldNode,
	state: ResolvedFieldState,
	environment: RendererEnvironment,
): string | undefined {
	const explicit = stringProp(node, "description");
	return explicit ?? descriptorDescription(environment.descriptors, state.binding, fieldDescriptorKey(node));
}

function IssueList(props: { readonly issues: readonly ValidationIssue[]; readonly id: string }) {
	if (props.issues.length === 0) return null;
	return (
		<ul id={props.id}>
			{props.issues.map((issue, index) => (
				<li key={`${issue.code}:${index}`}>{issue.message}</li>
			))}
		</ul>
	);
}

function useValidationLifecycle(environment: RendererEnvironment, path: string) {
	return useFormSelector(
		environment.form,
		(state) => {
			const field = environment.form.fieldDynamic(path);
			return {
				issues: [...state.issues, ...environment.attemptIssues].filter((issue) =>
					sameCanonical(issue.path, field.path),
				),
				dirty: field.isDirty(),
				touched: field.isTouched(),
				submitted: state.meta.submitted === true,
			};
		},
		structuredEqual,
	);
}

function stringProp(node: FieldNode, key: string): string | undefined {
	const value = literalProp(node, key);
	return typeof value === "string" ? value : undefined;
}

function sameCanonical(
	left: { readonly namespace: string; readonly segments: readonly (string | number)[] },
	right: { readonly namespace: string; readonly segments: readonly (string | number)[] },
): boolean {
	return (
		left.namespace === right.namespace &&
		left.segments.length === right.segments.length &&
		left.segments.every((v, i) => v === right.segments[i])
	);
}
