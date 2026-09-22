import { structuredEqual } from "@formbar/core";
import type { ValidationIssue } from "@formbar/core";
import type { FieldNode, ResolvedFieldState, ValidationNode } from "@formbar/declarative";
import { descriptionId, errorId, fieldId, useFormSelector } from "@formbar/react";
import type { ChangeEvent, ReactElement } from "react";
import { DiagnosticFallback } from "./renderer-elements.js";
import type { LayoutProps } from "./renderer-elements.js";
import {
	conformingValue,
	descriptorEvidence,
	editablePath,
	literalProp,
	nativeInputType,
	optionEvidence,
} from "./renderer-evidence.js";
import type { OptionEvidence, ScalarOption } from "./renderer-evidence.js";
import type { RendererEnvironment } from "./renderer-types.js";

const WIDGETS = new Set([
	"text",
	"textarea",
	"number",
	"select",
	"checkbox",
	"radio",
	"date",
	"time",
	"email",
	"url",
	"tel",
	"password",
	"search",
]);

interface FieldProps {
	readonly node: FieldNode;
	readonly state: ResolvedFieldState;
	readonly environment: RendererEnvironment;
	readonly layout: LayoutProps;
}

interface Wiring {
	readonly controlId: string;
	readonly description?: string;
	readonly issueId: string;
	readonly describedBy?: string;
	readonly hasErrors: boolean;
}

export function FormField({ node, state, environment, layout }: FieldProps): ReactElement | null {
	if (!state.visible) return null;
	const path = editablePath(node.binding);
	if (!path)
		return <DiagnosticFallback code="unsupported-binding" nodeId={node.id} widget={node.widget} layout={layout} />;
	if (!WIDGETS.has(node.widget))
		return <DiagnosticFallback code="unsupported-widget" nodeId={node.id} widget={node.widget} layout={layout} />;
	const evidence = descriptorEvidence(environment.descriptors, node.binding);
	const options = node.widget === "select" || node.widget === "radio" ? optionEvidence(node, evidence) : undefined;
	if (options && (!options.ok || !conformingValue(node.widget, state.value, options)))
		return <DiagnosticFallback code="unsupported-options" nodeId={node.id} widget={node.widget} layout={layout} />;
	const widget = nativeInputType(node.widget, evidence);
	if (!options && !conformingValue(widget, state.value))
		return <DiagnosticFallback code="unsupported-widget" nodeId={node.id} widget={node.widget} layout={layout} />;
	const visibleIssues = state.dirty || state.touched || environment.submitted ? state.issues : [];
	const wiring = fieldWiring(node, visibleIssues, environment.prefix);
	return (
		<div
			data-formbar-node={node.id}
			data-formbar-dirty={state.dirty || undefined}
			data-formbar-touched={state.touched || undefined}
			{...layout.attributes}
			style={layout.style}
		>
			{node.widget === "radio" ? null : <label htmlFor={wiring.controlId}>{state.label}</label>}
			{renderControl(node, state, environment, evidence, options, wiring, path, widget)}
			{wiring.description ? <div id={descriptionId(node.id, environment.prefix)}>{wiring.description}</div> : null}
			<IssueList issues={visibleIssues} id={wiring.issueId} hasErrors={wiring.hasErrors} />
		</div>
	);
}

export function FormValidation(props: {
	readonly node: ValidationNode;
	readonly environment: RendererEnvironment;
	readonly visible: boolean;
	readonly layout: LayoutProps;
}): ReactElement | null {
	const path = editablePath(props.node.binding);
	if (!props.visible) return null;
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

function renderControl(
	node: FieldNode,
	state: ResolvedFieldState,
	environment: RendererEnvironment,
	evidence: ReturnType<typeof descriptorEvidence>,
	options: OptionEvidence | undefined,
	wiring: Wiring,
	path: string,
	widget: string,
): ReactElement {
	if (node.widget === "radio") return radioControl(node, state, environment, options as OptionEvidence, wiring, path);
	if (node.widget === "select") return selectControl(state, environment, options as OptionEvidence, wiring, path);
	if (node.widget === "textarea") return textareaControl(node, state, environment, evidence, wiring, path);
	return inputControl(node, state, environment, evidence, wiring, path, widget);
}

function inputControl(
	node: FieldNode,
	state: ResolvedFieldState,
	environment: RendererEnvironment,
	evidence: ReturnType<typeof descriptorEvidence>,
	wiring: Wiring,
	path: string,
	type: string,
): ReactElement {
	const field = environment.form.fieldDynamic(path);
	const checkbox = node.widget === "checkbox";
	const interactionDisabled = state.disabled || (checkbox && state.readOnly);
	const value = state.value as string | number | undefined;
	return (
		<input
			{...controlA11y(state, wiring)}
			type={type}
			{...(checkbox ? { checked: state.value === true } : { value: value ?? "" })}
			placeholder={stringProp(node, "placeholder")}
			disabled={interactionDisabled}
			readOnly={!checkbox && state.readOnly}
			aria-readonly={checkbox && state.readOnly ? true : undefined}
			required={state.required}
			{...nativeConstraints(type, evidence)}
			onChange={(event) => field.handleChange(inputValue(event, type) as never)}
			onBlur={() => field.handleBlur()}
		/>
	);
}

function textareaControl(
	node: FieldNode,
	state: ResolvedFieldState,
	environment: RendererEnvironment,
	evidence: ReturnType<typeof descriptorEvidence>,
	wiring: Wiring,
	path: string,
): ReactElement {
	const field = environment.form.fieldDynamic(path);
	return (
		<textarea
			{...controlA11y(state, wiring)}
			value={(state.value as string | undefined) ?? ""}
			placeholder={stringProp(node, "placeholder")}
			disabled={state.disabled}
			readOnly={state.readOnly}
			required={state.required}
			{...stringConstraints(evidence)}
			onChange={(event) => field.handleChange(event.currentTarget.value as never)}
			onBlur={() => field.handleBlur()}
		/>
	);
}

function selectControl(
	state: ResolvedFieldState,
	environment: RendererEnvironment,
	options: OptionEvidence,
	wiring: Wiring,
	path: string,
): ReactElement {
	const field = environment.form.fieldDynamic(path);
	const token = optionToken(options.values, state.value);
	return (
		<select
			{...controlA11y(state, wiring)}
			value={token}
			disabled={state.disabled || state.readOnly}
			aria-readonly={state.readOnly || undefined}
			required={state.required}
			onChange={(event) => field.handleChange(optionValue(options.values, event.currentTarget.value) as never)}
			onBlur={() => field.handleBlur()}
		>
			<option value="" />
			{options.values.map((option, index) => (
				<option key={optionKey(option, index)} value={`option-${index}`}>
					{optionLabel(option)}
				</option>
			))}
		</select>
	);
}

function radioControl(
	node: FieldNode,
	state: ResolvedFieldState,
	environment: RendererEnvironment,
	options: OptionEvidence,
	wiring: Wiring,
	path: string,
): ReactElement {
	const field = environment.form.fieldDynamic(path);
	return (
		<fieldset
			aria-labelledby={`${wiring.controlId}-legend`}
			aria-busy={state.validating || undefined}
			aria-readonly={state.readOnly || undefined}
			disabled={state.disabled || state.readOnly}
		>
			<legend id={`${wiring.controlId}-legend`}>{state.label}</legend>
			{options.values.map((option, index) => {
				const id = index === 0 ? wiring.controlId : fieldId(`${node.id}-option-${index}`, environment.prefix);
				return (
					<div key={optionKey(option, index)}>
						<input
							{...controlA11y(state, { ...wiring, controlId: id })}
							type="radio"
							name={wiring.controlId}
							checked={Object.is(state.value, option)}
							required={state.required}
							onChange={() => field.handleChange(option as never)}
							onBlur={() => field.handleBlur()}
						/>
						<label htmlFor={id}>{optionLabel(option)}</label>
					</div>
				);
			})}
		</fieldset>
	);
}

function fieldWiring(node: FieldNode, issues: readonly ValidationIssue[], prefix: string): Wiring {
	const description = stringProp(node, "description");
	const hasErrors = issues.some((issue) => issue.severity === "error");
	const issueId = errorId(node.id, prefix);
	const describedBy = [description ? descriptionId(node.id, prefix) : undefined, issues.length ? issueId : undefined]
		.filter(Boolean)
		.join(" ");
	return {
		controlId: fieldId(node.id, prefix),
		...(description ? { description } : {}),
		issueId,
		...(describedBy ? { describedBy } : {}),
		hasErrors,
	};
}

function controlA11y(state: ResolvedFieldState, wiring: Wiring) {
	return {
		id: wiring.controlId,
		...(wiring.describedBy ? { "aria-describedby": wiring.describedBy } : {}),
		...(wiring.hasErrors ? { "aria-invalid": true as const, "aria-errormessage": wiring.issueId } : {}),
		...(state.required ? { "aria-required": true as const } : {}),
		...(state.validating ? { "aria-busy": true as const } : {}),
	};
}

function IssueList(props: {
	readonly issues: readonly ValidationIssue[];
	readonly id: string;
	readonly hasErrors: boolean;
}) {
	if (props.issues.length === 0) return null;
	return (
		<ul id={props.id} role={props.hasErrors ? "alert" : undefined}>
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
				issues: state.issues.filter((issue) => sameCanonical(issue.path, field.path)),
				dirty: field.isDirty(),
				touched: field.isTouched(),
				submitted: state.meta.submitted === true,
			};
		},
		structuredEqual,
	);
}

function nativeConstraints(type: string, evidence: ReturnType<typeof descriptorEvidence>) {
	if (type === "number") return { min: evidence.minimum, max: evidence.maximum };
	return stringConstraints(evidence);
}

function stringConstraints(evidence: ReturnType<typeof descriptorEvidence>) {
	return { minLength: evidence.minLength, maxLength: evidence.maxLength, pattern: evidence.pattern };
}

function inputValue(event: ChangeEvent<HTMLInputElement>, type: string): string | number | boolean | undefined {
	if (type === "checkbox") return event.currentTarget.checked;
	if (type === "number")
		return event.currentTarget.value === "" ? undefined : finite(event.currentTarget.valueAsNumber);
	if (type === "date" || type === "time") return event.currentTarget.value || undefined;
	return event.currentTarget.value;
}

function finite(value: number): number | undefined {
	return Number.isFinite(value) ? value : undefined;
}

function optionToken(options: readonly ScalarOption[], value: unknown): string {
	const index = options.findIndex((option) => Object.is(option, value));
	return index < 0 ? "" : `option-${index}`;
}

function optionValue(options: readonly ScalarOption[], token: string): ScalarOption | undefined {
	if (token === "") return undefined;
	return options[Number(token.slice("option-".length))];
}

function optionLabel(value: ScalarOption): string {
	return value === null ? "null" : String(value);
}

function optionKey(value: ScalarOption, index: number): string {
	return `${typeof value}:${String(value)}:${index}`;
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
