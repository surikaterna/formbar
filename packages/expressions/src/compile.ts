import { canonicalizeExpression } from "kuery/expression";
import type { Expression, Scopes, StateRef } from "./contracts.js";
import { copyJson } from "./json.js";
import { parseRef, resolveRef } from "./references.js";
import { ExpressionError } from "./result.js";

export function validateExpression(input: unknown, scopes: Scopes = {}): Expression {
	// Preserve Formbar's stricter JSON-key and finite-number boundary before Kuery owns AST semantics.
	const safeInput = copyJson(input);
	const result = canonicalizeExpression<StateRef>(safeInput, {
		reference: stateReferenceCodec(scopes),
		limits: EXPRESSION_LIMITS,
	});
	if (!result.ok) throw new ExpressionError(diagnosticCode(result.diagnostic.code));
	return result.value;
}

export const EXPRESSION_LIMITS = Object.freeze({
	maxDepth: 32,
	maxNodes: 1024,
	maxArgs: 32,
	maxStringLength: 16384,
	maxReferenceLength: 16384,
});

export function stateReferenceCodec(scopes: Scopes = {}) {
	return {
		validate(input: unknown): input is StateRef {
			try {
				parseRef(input as never);
				return true;
			} catch {
				return false;
			}
		},
		canonicalize: (ref: StateRef): StateRef => resolveRef(parseRef(ref), scopes),
	};
}

function diagnosticCode(code: string): "invalid-input" | "limit" {
	return code === "EXPRESSION_LIMIT_EXCEEDED" ? "limit" : "invalid-input";
}
