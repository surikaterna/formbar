import { structuredEqual } from "@formbar/core";
import type { ValidationIssue } from "@formbar/core";
import type { FieldNode, ResolvedFieldState, ValidationNode } from "@formbar/declarative";
import type { NormalizedEvidence } from "@formbar/from-schema";
import { descriptionId, errorId, fieldId, useFormSelector } from "@formbar/react";
import type { ChangeEvent, ReactElement } from "react";
import { DiagnosticFallback } from "./renderer-elements.js";
import type { LayoutProps } from "./renderer-elements.js";
import { domIdToken, editablePath, literalProp, resolveFieldEvidence } from "./renderer-evidence.js";
import type { FieldRenderEvidence, ScalarOption } from "./renderer-evidence.js";
import type { RendererEnvironment } from "./renderer-types.js";

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

type SupportedFieldEvidence = Extract<FieldRenderEvidence, { readonly ok: true }>;

export function FormField({ node, state, environment, layout }: FieldProps): ReactElement | null {
	if (!state.visible) return null;
	const resolved = resolveFieldEvidence(node, state, environment.descriptors);
	if (!resolved.ok)
		return <DiagnosticFallback code={resolved.diagnostic} nodeId={node.id} widget={node.widget} layout={layout} />;
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
			{renderControl(node, state, environment, resolved, wiring)}
			{wiring.description ? (
				<div id={descriptionId(domIdToken(node.id), environment.prefix)}>{wiring.description}</div>
			) : null}
			<IssueList issues={visibleIssues} id={wiring.issueId} />
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
	resolved: SupportedFieldEvidence,
	wiring: Wiring,
): ReactElement {
	if (resolved.kind === "options" && resolved.widget === "radio")
		return radioControl(node, state, environment, resolved.options, wiring, resolved.path);
	if (resolved.kind === "options") return selectControl(state, environment, resolved.options, wiring, resolved.path);
	if (node.widget === "textarea")
		return textareaControl(node, state, environment, resolved.evidence, wiring, resolved.path);
	return inputControl(node, state, environment, resolved.evidence, wiring, resolved.path, resolved.widget);
}

function inputControl(
	node: FieldNode,
	state: ResolvedFieldState,
	environment: RendererEnvironment,
	evidence: NormalizedEvidence,
	wiring: Wiring,
	path: string,
	type: string,
): ReactElement {
	const field = environment.form.fieldDynamic(path);
	const checkbox = node.widget === "checkbox";
	const interactionDisabled = state.disabled || (checkbox && state.readOnly);
	const value = inputControlValue(state.value);
	return (
		<input
			{...controlA11y(state, wiring)}
			type={type}
			{...(checkbox ? { checked: state.value === true } : { value })}
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
	evidence: NormalizedEvidence,
	wiring: Wiring,
	path: string,
): ReactElement {
	const field = environment.form.fieldDynamic(path);
	return (
		<textarea
			{...controlA11y(state, wiring)}
			value={typeof state.value === "string" ? state.value : ""}
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
	options: readonly ScalarOption[],
	wiring: Wiring,
	path: string,
): ReactElement {
	const field = environment.form.fieldDynamic(path);
	const token = optionToken(options, state.value);
	return (
		<select
			{...controlA11y(state, wiring)}
			value={token}
			disabled={state.disabled || state.readOnly}
			aria-readonly={state.readOnly || undefined}
			required={state.required}
			onChange={(event) => field.handleChange(optionValue(options, event.currentTarget.value) as never)}
			onBlur={() => field.handleBlur()}
		>
			<option value="" />
			{options.map((option, index) => (
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
	options: readonly ScalarOption[],
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
			{options.map((option, index) => {
				const id =
					index === 0 ? wiring.controlId : fieldId(`${domIdToken(node.id)}-option-${index}`, environment.prefix);
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
	const token = domIdToken(node.id);
	const description = stringProp(node, "description");
	const hasErrors = issues.some((issue) => issue.severity === "error");
	const issueId = errorId(token, prefix);
	const describedBy = [description ? descriptionId(token, prefix) : undefined, issues.length ? issueId : undefined]
		.filter(Boolean)
		.join(" ");
	return {
		controlId: fieldId(token, prefix),
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
				issues: state.issues.filter((issue) => sameCanonical(issue.path, field.path)),
				dirty: field.isDirty(),
				touched: field.isTouched(),
				submitted: state.meta.submitted === true,
			};
		},
		structuredEqual,
	);
}

function nativeConstraints(type: string, evidence: NormalizedEvidence) {
	if (type === "number")
		return { min: evidence.minimum, max: evidence.maximum, step: evidence.primitive === "integer" ? 1 : "any" };
	return stringConstraints(evidence);
}

function stringConstraints(evidence: NormalizedEvidence) {
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

function inputControlValue(value: ResolvedFieldState["value"]): string | number {
	return typeof value === "string" || typeof value === "number" ? value : "";
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
