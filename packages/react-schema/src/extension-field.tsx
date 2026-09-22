import type { FieldNode, JsonValue, ResolvedFieldState } from "@formbar/declarative";
import type { NormalizedEvidence } from "@formbar/from-schema";
import { useEffect } from "react";
import type { ReactElement } from "react";
import { ExtensionBoundary } from "./extension-boundary.js";
import { resolveWidget } from "./extension-registry.js";
import type {
	WidgetA11y,
	WidgetBinding,
	WidgetConstraints,
	WidgetMetadata,
	WidgetOption,
	WidgetProps,
	WidgetRegistration,
} from "./extension-types.js";
import { DiagnosticFallback } from "./renderer-elements.js";
import { editablePath, optionEvidence } from "./renderer-evidence.js";
import type { RendererEnvironment } from "./renderer-types.js";

export interface ExtensionFieldWiring {
	readonly controlId: string;
	readonly labelId: string;
	readonly descriptionId?: string;
	readonly issueId: string;
	readonly describedBy?: string;
	readonly hasErrors: boolean;
}

interface ExtensionFieldProps {
	readonly node: FieldNode;
	readonly state: ResolvedFieldState;
	readonly environment: RendererEnvironment;
	readonly evidence: NormalizedEvidence;
	readonly description?: string;
	readonly wiring: ExtensionFieldWiring;
}

export function ExtensionField(props: ExtensionFieldProps): ReactElement {
	const resolved = resolveWidget(props.environment.extensions, props.node);
	if (!resolved.ok)
		return <DiagnosticFallback code={resolved.code} nodeId={props.node.id} extensionId={props.node.widget} />;
	const path = editablePath(props.state.binding);
	if (!path)
		return <DiagnosticFallback code="unsupported-binding" nodeId={props.node.id} extensionId={props.node.widget} />;
	const Component = resolved.registration.component;
	return (
		<ExtensionBoundary
			code={props.environment.extensionFailureCode ?? "extension-render-failed"}
			nodeId={props.node.id}
			extensionId={props.node.widget}
			resetKey={{
				rendererId: props.node.widget,
				normalizedProps: resolved.props,
				instanceKey: props.state.instance.instanceKey,
				binding: props.state.binding,
				component: Component,
				...(resolved.registration.validateProps ? { validateProps: resolved.registration.validateProps } : {}),
			}}
			onFailure={props.environment.extensionFailed}
			onRecovery={props.environment.extensionRecovered}
		>
			<CommittedWidget {...props} extensionProps={resolved.props} path={path} Component={Component} />
		</ExtensionBoundary>
	);
}

interface CommittedWidgetProps extends ExtensionFieldProps {
	readonly extensionProps: WidgetProps["props"];
	readonly path: string;
	readonly Component: WidgetRegistration["component"];
}

function CommittedWidget({ Component, extensionProps, path, ...props }: CommittedWidgetProps): ReactElement {
	const lease = { active: false };
	useEffect(() => {
		lease.active = true;
		return () => {
			lease.active = false;
		};
	});
	return <Component {...widgetProps(props, extensionProps, path, lease)} />;
}

function widgetProps(
	props: ExtensionFieldProps,
	extensionProps: WidgetProps["props"],
	path: string,
	lease: { active: boolean },
): WidgetProps {
	const { node, state, environment, evidence, wiring } = props;
	const field = environment.form.fieldDynamic(path);
	const policy = Object.freeze({
		visible: true as const,
		disabled: state.disabled,
		readOnly: state.readOnly,
		required: state.required,
	});
	return Object.freeze({
		nodeId: node.id,
		instanceKey: state.instance.instanceKey,
		widget: node.widget,
		binding: binding(state, path),
		value: state.value,
		props: extensionProps,
		constraints: constraints(evidence),
		options: options(node, evidence),
		metadata: metadata(state, evidence, props.description),
		policy,
		issues: state.issues,
		valid: state.valid,
		validating: state.validating,
		touched: state.touched,
		dirty: state.dirty,
		a11y: a11y(state, wiring),
		onChange: (value: JsonValue | undefined) => {
			if (lease.active && !state.disabled && !state.readOnly) field.handleChange(value as never);
		},
		onBlur: () => {
			if (lease.active) field.handleBlur();
		},
	});
}

function binding(state: ResolvedFieldState, path: string): WidgetBinding {
	return Object.freeze({
		namespace: state.binding.namespace as "data" | "ui",
		segments: Object.freeze([...state.binding.segments]),
		path,
	});
}

function constraints(evidence: NormalizedEvidence): WidgetConstraints {
	const keys = [
		"primitive",
		"minimum",
		"maximum",
		"exclusiveMinimum",
		"exclusiveMaximum",
		"multipleOf",
		"minLength",
		"maxLength",
		"minItems",
		"maxItems",
		"pattern",
		"format",
	] as const;
	const output: Record<string, string | number> = {};
	for (const key of keys) if (evidence[key] !== undefined) output[key] = evidence[key] as string | number;
	return Object.freeze(output);
}

function options(node: FieldNode, evidence: NormalizedEvidence): readonly WidgetOption[] {
	const resolved = optionEvidence(node, evidence);
	if (!resolved.ok) return Object.freeze([]);
	return Object.freeze(
		resolved.values.map((value) => Object.freeze({ value, label: value === null ? "null" : String(value) })),
	);
}

function metadata(
	state: ResolvedFieldState,
	evidence: NormalizedEvidence,
	description: string | undefined,
): WidgetMetadata {
	return Object.freeze({
		label: state.label,
		...(description === undefined ? {} : { description }),
		...(evidence.default === undefined ? {} : { defaultValue: evidence.default as JsonValue }),
	});
}

function a11y(state: ResolvedFieldState, wiring: ExtensionFieldWiring): WidgetA11y {
	return Object.freeze({
		controlId: wiring.controlId,
		labelId: wiring.labelId,
		...(wiring.descriptionId ? { descriptionId: wiring.descriptionId } : {}),
		errorId: wiring.issueId,
		...(wiring.describedBy ? { describedBy: wiring.describedBy } : {}),
		invalid: wiring.hasErrors,
		required: state.required,
		busy: state.validating,
	});
}
