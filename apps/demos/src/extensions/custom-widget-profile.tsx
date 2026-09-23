import type { JsonValue } from "@formbar/declarative";
import type { WidgetProps } from "@formbar/react-schema";
import type { CSSProperties, ReactNode } from "react";

function stateAttributes(props: WidgetProps, labelledBy = props.a11y.labelId) {
	return {
		"aria-labelledby": labelledBy,
		...(props.a11y.describedBy ? { "aria-describedby": props.a11y.describedBy } : {}),
		...(props.a11y.invalid ? { "aria-invalid": true } : {}),
		...(props.a11y.required ? { "aria-required": true } : {}),
		...(props.a11y.busy ? { "aria-busy": true } : {}),
		...(props.policy.readOnly ? { "aria-readonly": true, "aria-disabled": true } : {}),
	};
}

function WidgetState({ props, children }: { readonly props: WidgetProps; readonly children: ReactNode }) {
	return (
		<div
			data-widget={props.widget}
			data-binding={props.binding.path}
			data-touched={props.touched || undefined}
			data-dirty={props.dirty || undefined}
			data-valid={props.valid}
			data-validating={props.validating || undefined}
			data-issue-count={props.issues.length}
		>
			{children}
		</div>
	);
}

function numericValue(value: WidgetProps["value"], fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function ratingValues(props: WidgetProps): readonly number[] {
	const minimum = props.constraints.minimum ?? 0;
	const maximum = props.constraints.maximum ?? minimum;
	const step = props.constraints.multipleOf ?? 1;
	const first = minimum === 0 ? step : minimum;
	if (step <= 0 || maximum < first) return [];
	const count = Math.min(100, Math.floor((maximum - first) / step) + 1);
	return Array.from({ length: count }, (_, index) => first + index * step);
}

export function RatingWidget(props: WidgetProps) {
	const current = numericValue(props.value, props.constraints.minimum ?? 0);
	const icon = props.props.icon === "heart" ? "♥" : "★";
	return (
		<WidgetState props={props}>
			<div className="flex flex-wrap items-center gap-1">
				{ratingValues(props).map((rating, index) => {
					const nameId = `${props.a11y.controlId}-rating-${index}`;
					return (
						<button
							key={rating}
							{...(index === 0 ? { id: props.a11y.controlId } : {})}
							type="button"
							className="text-xl"
							aria-label={`${props.metadata.label}: ${rating}`}
							aria-pressed={current >= rating}
							disabled={props.policy.disabled}
							{...stateAttributes(props, `${props.a11y.labelId} ${nameId}`)}
							onClick={() => !props.policy.readOnly && props.onChange(rating)}
							onBlur={props.onBlur}
						>
							{icon}
							<span id={nameId} className="sr-only">
								{rating}
							</span>
						</button>
					);
				})}
				<output className="ml-2 text-sm text-muted-foreground">
					{current}/{props.constraints.maximum ?? current}
				</output>
			</div>
		</WidgetState>
	);
}

export function ColorWidget(props: WidgetProps) {
	return (
		<WidgetState props={props}>
			<div className="flex flex-wrap items-center gap-2">
				{props.options.map((option, index) => {
					const color = String(option.value);
					const nameId = `${props.a11y.controlId}-color-${index}`;
					return (
						<button
							key={color}
							{...(index === 0 ? { id: props.a11y.controlId } : {})}
							type="button"
							className="h-8 w-8 rounded-full border-2"
							style={{ backgroundColor: color }}
							aria-label={`${props.metadata.label}: ${option.label}`}
							aria-pressed={props.value === option.value}
							disabled={props.policy.disabled}
							{...stateAttributes(props, `${props.a11y.labelId} ${nameId}`)}
							onClick={() => !props.policy.readOnly && props.onChange(option.value)}
							onBlur={props.onBlur}
						>
							<span id={nameId} className="sr-only">
								{option.label}
							</span>
						</button>
					);
				})}
				{typeof props.value === "string" && props.value ? (
					<output className="ml-2 text-xs text-muted-foreground">{props.value}</output>
				) : null}
			</div>
		</WidgetState>
	);
}

function selectedValues(value: WidgetProps["value"]): readonly JsonValue[] {
	return Array.isArray(value) ? value : [];
}

type RichOption = Readonly<{ value: string | number | boolean | null; title: string; disabled?: boolean }>;

function richOptions(props: WidgetProps): readonly RichOption[] {
	const configured = props.props.richOptions;
	if (!Array.isArray(configured)) return props.options.map(({ value, label }) => ({ value, title: label }));
	return configured.flatMap((candidate) => {
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
		const { value, title, disabled } = candidate;
		const scalar = value === null || ["string", "number", "boolean"].includes(typeof value);
		if (!scalar || typeof title !== "string" || (disabled !== undefined && typeof disabled !== "boolean")) return [];
		return [{ value: value as RichOption["value"], title, ...(disabled === undefined ? {} : { disabled }) }];
	});
}

export function RichOptionsWidget(props: WidgetProps) {
	const options = richOptions(props);
	return (
		<WidgetState props={props}>
			<div className="flex flex-col gap-2" role="radiogroup" {...stateAttributes(props)}>
				{options.map((option, index) => {
					const id = index === 0 ? props.a11y.controlId : `${props.a11y.controlId}-${index}`;
					return (
						<label
							key={`${typeof option.value}:${String(option.value)}:${index}`}
							htmlFor={id}
							className="flex items-center gap-2"
						>
							<input
								id={id}
								type="radio"
								name={`${props.a11y.controlId}-options`}
								checked={Object.is(props.value, option.value)}
								disabled={props.policy.disabled || option.disabled}
								onChange={() => !props.policy.readOnly && props.onChange(option.value)}
								onBlur={props.onBlur}
							/>
							<span>{option.title}</span>
						</label>
					);
				})}
			</div>
		</WidgetState>
	);
}

export function CheckboxGroupWidget(props: WidgetProps) {
	const selected = selectedValues(props.value);
	const toggle = (value: JsonValue) => {
		if (props.policy.readOnly) return;
		props.onChange(
			selected.some((item) => Object.is(item, value))
				? selected.filter((item) => !Object.is(item, value))
				: [...selected, value],
		);
	};
	return (
		<WidgetState props={props}>
			<div className="flex flex-col gap-2">
				{props.options.map((option, index) => {
					const id = index === 0 ? props.a11y.controlId : `${props.a11y.controlId}-${index}`;
					const nameId = `${id}-name`;
					return (
						<label key={`${option.value}`} htmlFor={id} className="flex items-center gap-2">
							<input
								id={id}
								type="checkbox"
								checked={selected.some((item) => Object.is(item, option.value))}
								disabled={props.policy.disabled}
								{...stateAttributes(props, `${props.a11y.labelId} ${nameId}`)}
								onChange={() => toggle(option.value)}
								onBlur={props.onBlur}
							/>
							<span id={nameId}>{option.label}</span>
						</label>
					);
				})}
			</div>
		</WidgetState>
	);
}

function RangeControl({ props, suffix = "" }: { readonly props: WidgetProps; readonly suffix?: string }) {
	const minimum = props.constraints.minimum;
	const maximum = props.constraints.maximum;
	const value = numericValue(props.value, minimum ?? 0);
	const step = props.constraints.multipleOf ?? (props.constraints.primitive === "number" ? 0.1 : 1);
	const liveLabel = props.props.liveLabel === true;
	return (
		<div className="flex items-center gap-2">
			<input
				id={props.a11y.controlId}
				type="range"
				value={value}
				{...(minimum === undefined ? {} : { min: minimum })}
				{...(maximum === undefined ? {} : { max: maximum })}
				step={step}
				disabled={props.policy.disabled}
				{...stateAttributes(props)}
				onChange={(event) => !props.policy.readOnly && props.onChange(event.currentTarget.valueAsNumber)}
				onBlur={props.onBlur}
			/>
			<output
				htmlFor={props.a11y.controlId}
				{...(liveLabel ? { "aria-live": "polite" as const } : {})}
				className="text-right text-sm text-muted-foreground"
			>
				{liveLabel ? `${props.metadata.label}: ` : ""}
				{value}
				{suffix}
			</output>
		</div>
	);
}

export function RangeWidget(props: WidgetProps) {
	return (
		<WidgetState props={props}>
			<RangeControl props={props} />
		</WidgetState>
	);
}

export function ProgressWidget(props: WidgetProps) {
	const minimum = props.constraints.minimum ?? 0;
	const maximum = props.constraints.maximum ?? 1;
	const value = numericValue(props.value, minimum);
	const progressStyle = { width: "100%" } satisfies CSSProperties;
	return (
		<WidgetState props={props}>
			<progress aria-label={`${props.metadata.label} progress`} value={value} max={maximum} style={progressStyle} />
			<RangeControl props={props} suffix="%" />
		</WidgetState>
	);
}

export const customWidgetRegistrations = Object.freeze([
	Object.freeze({ id: "demo16.rating", component: RatingWidget }),
	Object.freeze({ id: "demo16.color", component: ColorWidget }),
	Object.freeze({ id: "demo16.checkbox-group", component: CheckboxGroupWidget }),
	Object.freeze({ id: "demo16.rich-options", component: RichOptionsWidget }),
	Object.freeze({ id: "demo16.range", component: RangeWidget }),
	Object.freeze({ id: "demo16.progress", component: ProgressWidget }),
]);

export const customWidgetIds = Object.freeze(customWidgetRegistrations.map(({ id }) => id));
