// Re-export core types that React consumers need
export type {
	CreateFormOptions,
	DeepKeys,
	DeepValue,
	FieldApi,
	FieldConfig,
	FormAction,
	FormApi,
	FormDispatchResult,
	FormState,
	SubmitContext,
	SubmitResult,
	ValidationIssue,
	ValidatorFn,
	ValidatorInput,
} from "@formbar/core";
export {
	type DescriptionA11yProps,
	descriptionId,
	errorId,
	type FieldA11yProps,
	fieldId,
	findFirstErrorPath,
	focusFirstError,
	getDescriptionProps,
	getErrorProps,
	getFieldProps,
	getLabelProps,
	type LabelA11yProps,
} from "./a11y.js";
export { useField } from "./use-field.js";
export { type UseFormOptions, useForm } from "./use-form.js";
export { useFormSelector } from "./use-form-selector.js";
export { useExpressionProps } from "./use-expression-props.js";
