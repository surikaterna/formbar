import type { FieldNode, ResolvedFieldState } from "@formbar/declarative";
import type { NormalizedEvidence } from "@formbar/from-schema";
import type { ChangeEvent, ReactElement } from "react";
import { literalProp } from "./renderer-evidence.js";
import type { FieldRenderEvidence, RenderOption } from "./renderer-evidence.js";
import type { RendererEnvironment } from "./renderer-types.js";

interface Wiring {
	readonly controlId: string;
	readonly issueId: string;
	readonly describedBy?: string;
	readonly hasErrors: boolean;
}

type SupportedFieldEvidence = Extract<FieldRenderEvidence, { readonly ok: true }>;

export function renderNativeControl(
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
	return (
		<input
			{...controlA11y(state, wiring)}
			type={type}
			{...(checkbox ? { checked: state.value === true } : { value: inputControlValue(state.value) })}
			placeholder={stringProp(node, "placeholder")}
			disabled={state.disabled || (checkbox && state.readOnly)}
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
	options: readonly RenderOption[],
	wiring: Wiring,
	path: string,
): ReactElement {
	const field = environment.form.fieldDynamic(path);
	return (
		<select
			{...controlA11y(state, wiring)}
			value={optionToken(options, state.value)}
			disabled={state.disabled || state.readOnly}
			aria-readonly={state.readOnly || undefined}
			required={state.required}
			onChange={(event) => {
				const option = optionValue(options, event.currentTarget.value);
				if (state.disabled || state.readOnly || option?.disabled) return;
				field.handleChange(option?.value as never);
			}}
			onBlur={() => field.handleBlur()}
		>
			<option value="" />
			{options.map((option, index) => (
				<option key={optionKey(option.value, index)} value={`option-${index}`} disabled={option.disabled}>
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
	options: readonly RenderOption[],
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
				const id = index ? `${wiring.controlId}-option-${index}` : wiring.controlId;
				return (
					<div key={optionKey(option.value, index)}>
						<input
							{...controlA11y(state, { ...wiring, controlId: id })}
							type="radio"
							name={wiring.controlId}
							checked={Object.is(state.value, option.value)}
							disabled={option.disabled}
							required={state.required}
							onChange={() => {
								if (!state.disabled && !state.readOnly && !option.disabled) field.handleChange(option.value as never);
							}}
							onBlur={() => field.handleBlur()}
						/>
						<label htmlFor={id}>{optionLabel(option)}</label>
					</div>
				);
			})}
		</fieldset>
	);
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

function nativeConstraints(type: string, evidence: NormalizedEvidence) {
	if (type === "number")
		return {
			min: evidence.minimum,
			max: evidence.maximum,
			step: evidence.multipleOf ?? (evidence.primitive === "integer" ? 1 : "any"),
		};
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

function optionToken(options: readonly RenderOption[], value: unknown): string {
	const index = options.findIndex((option) => Object.is(option.value, value));
	return index < 0 ? "" : `option-${index}`;
}

function optionValue(options: readonly RenderOption[], token: string): RenderOption | undefined {
	return /^option-(?:0|[1-9]\d*)$/.test(token) ? options[Number(token.slice("option-".length))] : undefined;
}

function optionLabel(option: RenderOption): string {
	return option.title ?? (option.value === null ? "null" : String(option.value));
}

function optionKey(value: RenderOption["value"], index: number): string {
	return `${typeof value}:${String(value)}:${index}`;
}

function stringProp(node: FieldNode, key: string): string | undefined {
	const value = literalProp(node, key);
	return typeof value === "string" ? value : undefined;
}
