# @formbar/expressions

Framework-neutral authorized, reactive expression capabilities powered by Kuery's
strict whole-AST expression core.
Implemented by #90 (parent #60, contracts #61). See the
[package ADR](docs/adr/0001-expression-service-and-reactive-props.md) for boundaries,
limits, lifecycle, and the native Arbitre arithmetic/scheduling gap.

## Pure evaluation and direct writes

```ts
import { createExpressionService } from "@formbar/expressions";
import { createCoreExpressionNamespaces, createForm } from "@formbar/core";

const form = createForm({ initialData: { quantity: 2, unitPrice: 12 } });
const runtime = createExpressionService({
  namespaces: createCoreExpressionNamespaces(form),
  // Omit to grant registered capabilities. Unregistered namespaces always deny.
  authorize: (ref, operation) => operation === "read" || ref.namespace === "data",
});
const quantity = { kind: "ref", ref: { namespace: "data", segments: ["quantity"] } } as const;
const total = runtime.compile({
  kind: "op", op: "mul",
  args: [quantity, { kind: "ref", ref: { namespace: "data", segments: ["unitPrice"] } }],
});
if (total.ok) {
  console.log(runtime.evaluate(total.value)); // { ok: true, value: 24 }
  const projection = runtime.observe(total.value);
  const stop = projection.subscribe(() => console.log(projection.getSnapshot()));
  form.setValue("quantity", 3); // projection becomes 36, never writes a total field
  stop();
  projection.dispose();
}
const direct = runtime.compile(quantity);
if (direct.ok) {
  const writable = runtime.resolveWritable(direct.value);
  if (writable.ok) console.log(writable.value(4)); // original core dispatch result
}
runtime.dispose();
form.dispose();
```

Programs belong to one service. Errors are `{ ok: false, diagnostics: [{ code }] }`.
Missing refs fail with `missing`; literal/ref `null` succeeds. Root reads are
permitted by registered authorization; core root writes are intentionally read-only.
References use safe segments, not dot strings. Numeric and numeric-string segments
have the same canonical dependency key. Scopes are resolved once at compile time:

```ts
const scopes = {
  order: { namespace: "data", segments: ["orders", 0] },
  item: { namespace: "data", scope: "order", segments: ["items", 2] },
};
// { namespace: "data", scope: "item", segments: ["price"] }
// resolves to data / orders / 0 / items / 2 / price.
```

## Reactive ordinary props

```ts
const props = runtime.resolveProps({
  value: { mode: "write", expression: quantity },
  label: { mode: "literal", value: "Quantity" },
  disabled: { mode: "read", expression: {
    kind: "op", op: "lte", args: [quantity, { kind: "literal", value: 0 }],
  } },
  customWidgetProp: { mode: "read", expression: quantity },
});
const stop = props.subscribe(() => render(props.getSnapshot()));
const { values, setters, diagnostics } = props.getSnapshot();
setters.value?.(5); // direct write only; never infer setters for derived/read props
stop();            // retained binding setters now fail with stale
props.dispose();
```

`render` above is a host callback. All read/write expression props react, regardless
of prop name. React hosts can use `useExpressionProps` from `@formbar/react`.
`values` are JSON/undefined, not an unchecked component prop assertion. Use
`forwardExpressionProp(snapshot, "value", (v): v is number => typeof v === "number")`
to obtain a typed `{ value, setValue? }` result. A read-only prop has no setter.

## External namespaces and custom profiles

```ts
let pricing = { rate: 1.2 };
const listeners = new Set<() => void>();
runtime.registerNamespace("pricing", {
  getSnapshot: () => pricing,
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
}); // read-only: no write method
pricing = { rate: 1.3 };
for (const listener of listeners) listener();
runtime.registerNamespace("pricing"); // unregister, clear values, invalidate setters
```

Providers must supply immutable, stable snapshots and notify invalidations. Optional
`getVersion` identifies capability/target generation; `isDisposed` checks provider
lifetime. Permission changes require `runtime.invalidateAuthorization()` so mounted
views clear prior values. Writes also reauthorize synchronously. Setters become stale
after parent replacement (including immutable sibling edits), provider replacement,
authorization invalidation or binding replacement, and reject disposal. Service
construction/getSnapshot are resource-free; the last unsubscribe releases providers.
Caller owns service/provider disposal. Profile and scope replacement require a new
service; React releases the old binding on replacement.

Kuery's immutable `standardExpressionProfile` is the default. Hosts can pass an
explicit `ExpressionProfile`, built with Kuery's `ExpressionProfileBuilder`, to add
namespaced custom operators. Formbar compiles the complete AST exactly once and
preauthorizes/captures every static dependency before evaluation, including refs in
short-circuited branches. Operator code must be pure, bounded and synchronous;
Promise results are rejected. The host may explicitly override evaluation
namespace providers using `evaluate(program, context)` (used for actual Arbitre RHS
scope); the service's authorization still applies. This is a trusted-host API,
not an expression feature. There is no global registry or per-expression engine.
Shape, operator names, and arity are compile-time checks. Operand and result types
are runtime checks unless a custom profile performs additional static analysis.

## Limits and non-goals

### Callback failure and disposal policy

All captured cleanup and notification callbacks are attempted even if an earlier
callback throws. Disposal detaches owned handles and finalizes lifetimes before
callbacks, is reentrant/idempotent, clears current values, and revokes retained
setters. Inspect `runtime.getLifecycleDiagnostics()` or
`observation.getLifecycleDiagnostics()` afterward: the sticky, non-reactive result
is `[]` or `[{ code: "adapter" }]`, never a raw exception or secret. A bad cleanup
cannot prevent other providers from being cleaned up. A host that throws before
actually releasing an external resource remains responsible for that resource.
Failed subscription setup throws a code-only `adapter` error; reference reads
remain failed closed until successful reconnection. Ordinary descriptor-verified
same/cross-realm native Promise callback results are rejected and consumed,
including snapshots, target/version checks, authorization, subscriptions,
forwarding guards, notifications and cleanups. A shape with own/altered
`constructor`, `then`, or species behavior is rejected without reading those
properties or attaching an observer. Trusted hosts must handle a hostile rejected
Promise before returning it: Promise species semantics make getter-free attachment
impossible. No arbitrary thenable getter is executed and no asynchronous provider
feature or hostile-Promise sandbox is implied.

### JSON bounds

`LIMITS`: JSON depth 32 / 1,024 values, 16,384-character strings/keys, 32 operator
arguments, 64 resolved path segments. Prop maps have at most 128 entries within
the JSON budget. No getters, functions, sparse arrays, nonfinite numbers or unsafe
keys; no `eval`, regular-expression operators or serialized engine selection.
Arrays must have every own canonical in-range index and no extra properties;
numeric-looking non-index keys cannot disguise holes. Expression/prop/scope shape
guards run after JSON validation, before constructing their typed contracts.
Untrusted JSON never enters Promise detection: Promise objects are rejected by
their non-JSON prototype without reading `then`, `constructor`, or species accessors.
Plain JSON data keys named `then` are allowed and preserved; only their value must
still satisfy the ordinary JSON contract. Promise-specific hazard checks run only
after a native Promise prototype candidate is established.
Notifications compare JSON values/diagnostics and write-target identity; evaluation
may repeat on coarse invalidations/reads. This is not a renderer, markup parser,
stored-computation scheduler, effect system or full component registry.
