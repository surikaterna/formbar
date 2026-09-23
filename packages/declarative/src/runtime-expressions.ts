import type { FormState } from "@formbar/core";
import { createExpressionService } from "@formbar/expressions";
import type { Expression, JsonValue, Result, Scopes } from "@formbar/expressions";
import type { RuntimeFormStatus, RuntimeNodeInstance } from "./runtime-contracts.js";
import { createSnapshotProviders } from "./runtime-references.js";
import type { RuntimeReferenceIndex } from "./runtime-references.js";

export interface RuntimeExpressionFrame {
	readonly state: FormState<unknown, unknown>;
	readonly formStatus: RuntimeFormStatus;
	readonly references: RuntimeReferenceIndex;
	readonly instance: RuntimeNodeInstance;
	readonly scopes: Scopes;
}

export function evaluateRuntimeExpression(frame: RuntimeExpressionFrame, expression: Expression): Result<JsonValue> {
	const fieldSnapshot = frame.references.contextual(frame.instance);
	const service = createExpressionService({
		scopes: frame.scopes,
		namespaces: createSnapshotProviders(frame.state, frame.formStatus, fieldSnapshot),
		authorize: (reference) => ["data", "ui", "form", "field"].includes(reference.namespace),
	});
	try {
		const compiled = service.compile(expression);
		return compiled.ok ? service.evaluate(compiled.value) : compiled;
	} finally {
		service.dispose();
	}
}
