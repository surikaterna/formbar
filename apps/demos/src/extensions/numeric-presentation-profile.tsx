import type { WidgetProps } from "@formbar/react-schema";

function numericProp(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

export function NumericPresentationWidget(props: WidgetProps) {
	const value = numericProp(props.value) ? props.value : "";
	return (
		<input
			id={props.a11y.controlId}
			type="number"
			value={value}
			min={numericProp(props.props.min) ? props.props.min : props.constraints.minimum}
			step={numericProp(props.props.step) && props.props.step > 0 ? props.props.step : "any"}
			disabled={props.policy.disabled}
			readOnly={props.policy.readOnly}
			required={props.policy.required}
			aria-labelledby={props.a11y.labelId}
			aria-describedby={props.a11y.describedBy}
			aria-errormessage={props.a11y.invalid ? props.a11y.errorId : undefined}
			aria-invalid={props.a11y.invalid || undefined}
			aria-required={props.a11y.required || undefined}
			aria-busy={props.a11y.busy || undefined}
			onChange={(event) => {
				const control = event.currentTarget;
				props.onChange(
					control.value === "" || !Number.isFinite(control.valueAsNumber) ? undefined : control.valueAsNumber,
				);
			}}
			onBlur={props.onBlur}
		/>
	);
}

export const numericPresentationRegistrations = Object.freeze([
	Object.freeze({
		id: "demo19.numeric-presentation",
		component: NumericPresentationWidget,
		validateProps: (props: WidgetProps["props"]) => props.min === 0 && props.step === 0.01,
	}),
]);
