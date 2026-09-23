import type { ValidatorFn } from "./contracts.js";
import { FormbarError } from "./errors.js";
import { createStandardSchemaValidator, isStandardSchemaLike } from "./standard-schema.js";
import type { CreateFormOptions } from "./state.js";

export function normalizeValidators(options: CreateFormOptions<unknown, unknown>): readonly ValidatorFn[] {
	return (options.validators ?? []).map((validator) => {
		if (typeof validator === "function") return validator as ValidatorFn;
		if (isStandardSchemaLike(validator)) return createStandardSchemaValidator(validator);
		throw new FormbarError("FORMBAR_INVALID_VALIDATOR", "Validator must be a function or a Standard Schema v1 object");
	});
}
