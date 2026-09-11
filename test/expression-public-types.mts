import type { OperatorFunction } from "@arbitre/core";
import { createExpressionOperator } from "@formbar/arbiter";
import { createCoreExpressionNamespaces, createForm } from "@formbar/core";
import { createExpressionService, forwardExpressionProp } from "@formbar/expressions";
import type { Diagnostic, ExpressionBackend, JsonValue, PropDefinitions, PropSpec } from "@formbar/expressions";
import { createKueryBackend } from "@formbar/expressions-kuery";
import { useExpressionProps } from "@formbar/react";

const backend: ExpressionBackend = createKueryBackend();
const form = createForm({ initialData: { quantity: 1 } });
const service = createExpressionService({ backend, namespaces: createCoreExpressionNamespaces(form) });
const props: PropDefinitions = {
	value: { mode: "write", expression: { kind: "ref", ref: { namespace: "data", segments: ["quantity"] } } },
};
const invalid: PropSpec = {
	mode: "write",
	// @ts-expect-error Derived expressions are not writable prop contracts.
	expression: { kind: "op", op: "add", args: [] },
};
void invalid;
const number = (value: JsonValue): value is number => typeof value === "number";
const forwarded = forwardExpressionProp(service.resolveProps(props).getSnapshot(), "value", number);
if (forwarded.ok) {
	const value: number = forwarded.value.value;
	forwarded.value.setValue?.(value);
	// @ts-expect-error Forwarding retains the host's guarded type.
	forwarded.value.setValue?.("wrong");
}
const bridge = createExpressionOperator({ backend, programs: {} });
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
