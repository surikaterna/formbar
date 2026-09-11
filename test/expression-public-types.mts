import type { OperatorFunction } from "@arbitre/core";
import { createExpressionOperator } from "@formbar/arbiter";
import { createCoreExpressionNamespaces, createForm } from "@formbar/core";
import { ExpressionProfileBuilder, createExpressionService, forwardExpressionProp } from "@formbar/expressions";
import type { Diagnostic, JsonValue, PropDefinitions, PropSpec, ValueExpression } from "@formbar/expressions";
import { useExpressionProps } from "@formbar/react";

const form = createForm({ initialData: { quantity: 1 } });
const service = createExpressionService({ namespaces: createCoreExpressionNamespaces(form) });
const customProfile = new ExpressionProfileBuilder("app-v1")
	.add({
		name: "app:double",
		arity: 1,
		inputTypes: ["number"],
		execute: (values: readonly JsonValue[]) => (values[0] as number) * 2,
	})
	.build();
const customService = createExpressionService({ profile: customProfile });
const expression: ValueExpression<{ readonly id: string }> = { kind: "ref", ref: { id: "quantity" } };
void [customService, expression];
const props: PropDefinitions = {
	value: { mode: "write", expression: { kind: "ref", ref: { namespace: "data", segments: ["quantity"] } } },
};
// @ts-expect-error Derived expressions are not writable prop contracts.
const invalid: PropSpec = { mode: "write", expression: { kind: "op", op: "add", args: [] } };
void invalid;
const number = (value: JsonValue): value is number => typeof value === "number";
const forwarded = forwardExpressionProp(service.resolveProps(props).getSnapshot(), "value", number);
if (forwarded.ok) {
	const value: number = forwarded.value.value;
	forwarded.value.setValue?.(value);
	// @ts-expect-error Forwarding retains the host's guarded type.
	forwarded.value.setValue?.("wrong");
}
const bridge = createExpressionOperator({ profile: customProfile, programs: {} });
const operator: OperatorFunction = bridge.operator;
void operator;
const hook: typeof useExpressionProps = useExpressionProps;
void hook;
form.onDispose(() => {});
const disposed: boolean = form.isDisposed();
void disposed;
const lifecycle: readonly Diagnostic[] = service.getLifecycleDiagnostics();
const bindingLifecycle: readonly Diagnostic[] = service.resolveProps(props).getLifecycleDiagnostics();
const disposal: readonly Diagnostic[] = form.getDisposalDiagnostics();
void [lifecycle, bindingLifecycle, disposal];
