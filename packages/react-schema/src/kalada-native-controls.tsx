import type { KaladaV1Host } from "@formbar/declarative";
import type { ReactElement } from "react";
import { nativeAttributes, nativeInputType } from "./kalada-native-attributes.js";
import { nativeValueSupported } from "./kalada-native-values.js";

type Control = ReturnType<KaladaV1Host["snapshot"]>["controls"][number];
const invalid = (control: Control) =>
	control.lifecycle?.valid === false ||
	!!control.lifecycle?.issues.schema.length ||
	!!control.lifecycle?.issues.extension.length;

function scalar(control: Control): string | number | boolean | null {
	const value = control.value;
	if (value === undefined || value === null) return null;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
	throw new TypeError(`${control.path}.binding: NON_SCALAR_CONTROL_VALUE`);
}

function choicesFor(control: Control) {
	scalar(control);
	const options = control.props.options;
	if (!Array.isArray(options)) throw new TypeError(`${control.path}.props.options: MISSING_OPTIONS`);
	return options.map((raw, index) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("value" in raw))
			throw new TypeError(`${control.path}.props.options[${index}]: INVALID_OPTION`);
		if (raw.value !== null && !["string", "number", "boolean"].includes(typeof raw.value))
			throw new TypeError(`${control.path}.props.options[${index}]: INVALID_OPTION`);
		if (raw.disabled !== undefined && typeof raw.disabled !== "boolean")
			throw new TypeError(`${control.path}.props.options[${index}].disabled: INVALID_OPTION`);
		if (raw.title !== undefined && typeof raw.title !== "string")
			throw new TypeError(`${control.path}.props.options[${index}].title: INVALID_OPTION`);
		return raw as { value: string | number | boolean | null; title?: unknown; disabled?: unknown };
	});
}

function select(
	control: Control,
	id: string,
	disabled: boolean,
	change: (next: unknown) => void,
	describedBy?: string,
	focusRef?: (element: HTMLElement | null) => void,
): ReactElement {
	const choices = choicesFor(control);
	const selected = choices.findIndex((choice) => Object.is(choice.value, control.value));
	return (
		<select
			ref={focusRef}
			required={control.required}
			aria-required={control.required}
			id={id}
			onBlur={control.onBlur}
			aria-describedby={describedBy}
			aria-invalid={invalid(control)}
			disabled={disabled}
			value={selected < 0 ? "" : String(selected)}
			onChange={(event) => {
				if (event.currentTarget.value === "") {
					change(null);
					return;
				}
				const choice = choices[Number(event.currentTarget.value)];
				if (choice && choice.disabled !== true) change(choice.value);
			}}
		>
			{selected < 0 ? <option value="" disabled /> : null}
			{choices.map((choice, index) => (
				<option
					key={`${typeof choice.value}:${String(choice.value)}:${index}`}
					value={String(index)}
					disabled={choice.disabled === true}
				>
					{String(choice.title ?? choice.value)}
				</option>
			))}
		</select>
	);
}

function typedInput(
	control: Control,
	id: string,
	disabled: boolean,
	change: (next: unknown) => void,
	value: string | number | boolean | null,
	describedBy?: string,
	focusRef?: (element: HTMLElement | null) => void,
): ReactElement {
	const type = nativeInputType(control);
	if (!nativeValueSupported(type, value))
		return <span data-formbar-diagnostic="unsupported-widget">This form item cannot be rendered.</span>;
	return (
		<input
			ref={focusRef}
			aria-required={control.required}
			{...nativeAttributes(control, type)}
			id={id}
			onBlur={control.onBlur}
			aria-describedby={describedBy}
			aria-invalid={invalid(control)}
			type={type}
			value={value == null ? "" : String(value)}
			disabled={disabled}
			readOnly={control.readOnly}
			required={control.required}
			onChange={(event) =>
				change(
					type === "number"
						? event.currentTarget.value === "" || !Number.isFinite(event.currentTarget.valueAsNumber)
							? null
							: event.currentTarget.valueAsNumber
						: type === "date" || type === "time"
							? event.currentTarget.value || null
							: event.currentTarget.value,
				)
			}
		/>
	);
}

export function nativeControl(
	control: Control,
	describedBy?: string,
	prefix = "kalada",
	focusRef?: (element: HTMLElement | null) => void,
): ReactElement {
	const value = scalar(control);
	const writer = control.writers.value;
	const disabled = control.disabled || (!writer && !control.readOnly);
	const id = `${prefix}-${encodeURIComponent(control.key)}`;
	const change = (next: unknown) => {
		if (disabled || control.readOnly) return;
		const result = writer(next);
		if (result.status !== "applied") throw new Error(`${control.path}.binding: WRITE_${result.status.toUpperCase()}`);
	};
	if (control.rendererId === "checkbox") return checkbox(control, id, disabled, change, value, describedBy, focusRef);
	if (control.rendererId === "textarea")
		return (
			<textarea
				ref={focusRef}
				aria-required={control.required}
				{...nativeAttributes(control, "textarea")}
				id={id}
				onBlur={control.onBlur}
				value={value == null ? "" : String(value)}
				aria-describedby={describedBy}
				aria-invalid={invalid(control)}
				disabled={disabled}
				readOnly={control.readOnly}
				required={control.required}
				onChange={(event) => change(event.currentTarget.value)}
			/>
		);
	if (control.rendererId === "select")
		return select(control, id, disabled || control.readOnly, change, describedBy, focusRef);
	if (control.rendererId === "radio") {
		return radio(control, id, disabled || control.readOnly, change, value, describedBy, focusRef);
	}
	return typedInput(control, id, disabled, change, value, describedBy, focusRef);
}

function checkbox(
	control: Control,
	id: string,
	disabled: boolean,
	change: (next: unknown) => void,
	value: unknown,
	describedBy?: string,
	focusRef?: (element: HTMLElement | null) => void,
) {
	return (
		<input
			ref={focusRef}
			aria-required={control.required}
			id={id}
			onBlur={control.onBlur}
			type="checkbox"
			checked={value === true}
			aria-describedby={describedBy}
			aria-invalid={invalid(control)}
			disabled={disabled || control.readOnly}
			required={control.required}
			onChange={(event) => change(event.currentTarget.checked)}
		/>
	);
}

function radio(
	control: Control,
	id: string,
	disabled: boolean,
	change: (next: unknown) => void,
	value: string | number | boolean | null,
	describedBy?: string,
	focusRef?: (element: HTMLElement | null) => void,
) {
	const choices = choicesFor(control);
	return (
		<div
			ref={focusRef}
			aria-required={control.required}
			tabIndex={-1}
			id={id}
			role="radiogroup"
			onBlur={control.onBlur}
			aria-labelledby={`${id}-label`}
			aria-describedby={describedBy}
			aria-invalid={invalid(control)}
		>
			{choices.map((choice, index) => (
				<label key={`${typeof choice.value}:${String(choice.value)}:${index}`}>
					<input
						type="radio"
						name={id}
						checked={Object.is(value, choice.value)}
						disabled={disabled || choice.disabled === true}
						onChange={() => change(choice.value)}
					/>
					{String(choice.title ?? choice.value)}
				</label>
			))}
		</div>
	);
}
