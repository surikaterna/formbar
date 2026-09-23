import type { FormState, FormStateCapture } from "@formbar/core";
import { createExpressionService } from "@formbar/expressions";
import type { Expression, JsonValue, Result, Scopes } from "@formbar/expressions";
import type { RuntimeFormStatus, RuntimeNodeInstance } from "./runtime-contracts.js";
import { contextualFieldSnapshot, createSnapshotProviders, directFieldLifecycle } from "./runtime-references.js";
import type { ConcreteFieldReference } from "./runtime-references.js";

export interface RuntimeExpressionFrame {
	readonly capture: FormStateCapture<unknown, unknown>;
	readonly state: FormState<unknown, unknown>;
	readonly formStatus: RuntimeFormStatus;
	readonly fields: readonly ConcreteFieldReference[];
	readonly instance: RuntimeNodeInstance;
	readonly scopes: Scopes;
}

export function evaluateRuntimeExpression(frame: RuntimeExpressionFrame, expression: Expression): Result<JsonValue> {
	const fieldSnapshot = contextualFieldSnapshot(frame.instance, frame.fields, (binding) =>
		directFieldLifecycle(frame.capture, binding),
	);
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
