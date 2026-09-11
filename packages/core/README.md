# @formbar/core

Headless form state engine with validation, transforms, middleware, typed field APIs, and plugin support. It has no UI framework dependency.

## Expression namespace adapter (#90)

`createCoreExpressionNamespaces(form)` exposes actual `data` and `ui` state as
capabilities for `@formbar/expressions`. Core depends on the neutral contracts,
never a backend. Reads are own-property segment reads; writes go through
`form.dispatch({ type: "set-value", ... })`, preserving transforms, vetoes and
dispatch results. Core's namespace union is unchanged. Add named external
providers to the expression service, not to core.

```ts
import { createCoreExpressionNamespaces, createForm } from "@formbar/core";
import { createExpressionService } from "@formbar/expressions";

const form = createForm({ initialData: { quantity: 2 } });
const runtime = createExpressionService({
	namespaces: createCoreExpressionNamespaces(form),
});
// form.onDispose(listener) / form.isDisposed() support adapter lifetime checks.
runtime.dispose();
form.dispose();
```

The adapter acquires subscriptions only when the service is observed. Disposal
invalidates retained setters and clears rendered values. Root reads are supported;
use `form.reset` for root replacement, not a writable root expression. See the
[expression ADR](../expressions/docs/adr/0001-expression-service-and-reactive-props.md)
for safe paths, authorization and stale-parent semantics.

Disposal observers cannot interrupt other observers or core teardown. All plugin,
plugin-owned, middleware, field-cache and store cleanup steps are attempted;
reentrant/repeated disposal is idempotent. Thrown errors and ordinary native
Promise callback results are contained, with fixed-code diagnostics available from
`form.getDisposalDiagnostics()` (`[]` or `[{ code: "adapter" }]`). Host error text
is not retained. A failed host cleanup still owns any external resource it failed
to release; its exception cannot prevent the remaining cleanup steps.
Suspicious Promise species/constructor shapes are rejected without observing
them; a trusted callback owns any hostile rejection it returns. See the expression
ADR for the exact callback trust boundary.

## Package installation

```bash
bun add @formbar/core
# or
npm install @formbar/core
```

## Minimal usage

```ts
import { createForm } from "@formbar/core";

type Contact = {
	name: string;
	email: string;
};

const form = createForm<Contact, Record<string, never>>({
	initialData: { name: "", email: "" },
	onSubmit: async ({ payload }) => {
		await saveContact(payload);
		return { ok: true, submitId: "contact-create" };
	},
});

form.field("email").handleChange("ada@example.com");
await form.submit();
form.dispose();
```

## When to use this package

- Use `@formbar/core` when you need framework-agnostic form state, validation, submission, transforms, middleware, or plugin integration.
- Use `@formbar/react` instead when you want React hooks around a core form.
- Add `@formbar/from-schema` when your fields, validators, or layouts should be derived from JSON Schema, Zod, or Standard Schema.
- Add `@formbar/arbiter` when form state should be governed by Arbitre production rules.

## Dependencies

No peer dependencies. The package is framework-agnostic and marked side-effect free.

## Unknown options

Outside production, `createForm` warns once per call about unknown own enumerable option keys. Warnings list only
option names, never values. The removed `arbiterRules` option receives a migration warning directing callers to
`@formbar/arbiter`. Warnings are suppressed when `process.env.NODE_ENV` is unavailable or unusable.
