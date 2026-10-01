import type { KaladaControlProps } from "@formbar/react-schema";

export function widgetAccessibility(props: KaladaControlProps) {
	return {
		id: props.a11y?.controlId,
		"aria-labelledby": props.a11y?.labelId,
		"aria-describedby": props.a11y?.describedBy,
		"aria-errormessage": props.a11y?.invalid ? props.a11y.issueId : undefined,
		"aria-invalid": props.a11y?.invalid ?? false,
		"aria-busy": props.validating || undefined,
		onBlur: () => {
			props.onBlur?.();
		},
	};
}
