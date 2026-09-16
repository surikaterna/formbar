# @formbar/arbiter

Formbar plugin bridge for Arbitre production rules. It syncs form data and `$ui` state into an Arbitre session, fires rules during Formbar evaluation, and applies resulting writes back to form state.

## Opt-in shared pure expressions (#90)

```ts
import { createSession } from "@arbitre/core";
import { registerExpressionThenOperator } from "@formbar/arbiter";

const handlers = new Map();
const thenOperators = {
  register: (name, handler) => handlers.set(name, handler),
  get: name => handlers.get(name),
  has: name => handlers.has(name),
};
const bridge = registerExpressionThenOperator(thenOperators, {
  programs: new Map([["adjusted", { kind: "op", op: "add", args: [
      { kind: "ref", ref: { namespace: "data", segments: ["nativeTotal"] } },
      { kind: "literal", value: 1 },
    ] }]]),
});
const session = createSession({
  thenOperators,
  rules: [{ name: "calculate", when: { ready: true }, then: [
    { $set: { nativeTotal: { $multiply: ["$quantity", "$unitPrice"] } } },
    { $formbarValue: { adjusted: "adjusted" } },
  ] }],
});
// Optional form integration: createArbiterPlugin({ session }).
session.assert("quantity", 2);
session.assert("unitPrice", 12);
session.assert("ready", true);
session.fire(); // nativeTotal 24; adjusted 25 from the actual current RHS scope
session.dispose();
bridge.dispose();
```

The bridge compiles all host-registered IDs before mutating Arbitre's public
`ThenOperatorRegistry`. A host may select one immutable Kuery `ExpressionProfile`. Data maps to
non-reserved current scope keys, UI to `$ui`, and explicit external roots can be selected with
`namespaces: scope => ({ pricing: scope.$pricing })`; configure the corresponding
native session namespace too. Optional authorization applies at every read.

Failures throw fixed-code `ExpressionError`s, not scope values. Native session
strict/lenient error behavior remains authoritative. Registration is opt-in and
not globally installed. Every entry evaluates against the same incoming stage scope
before any tracked write occurs, so failed stages write nothing. Prior stages are
visible, same-stage writes are not inputs, and separate stages can chain. Writes
remain visible to Arbitre changes and TMS. The host owns bridge/session disposal;
disposed retained handlers fail because Arbitre 0.3 has no unregister operation.

This does **not** replace the native `when` compiler, its dependency indexes,
refiring/TMS semantics or stored-computation scheduling. A continuously true
native condition is not promised to rerun after every RHS dependency edit. The
shared arithmetic profile is strictly finite/no-coercion, not a claim of matching
native Arbitre null/coercion behavior. Broader policy normalization remains #70;
stored computations/effects remain #68. See the
[ADR](../expressions/docs/adr/0001-expression-service-and-reactive-props.md).

## Package installation

```bash
bun add @formbar/arbiter @formbar/core @arbitre/core kuery
# or
npm install @formbar/arbiter @formbar/core @arbitre/core kuery
```

## Minimal usage

```ts
import { createArbiterPlugin } from "@formbar/arbiter";
import { createForm } from "@formbar/core";

const form = createForm({
	initialData: { qty: 0 },
	plugins: [
		createArbiterPlugin({
			rules: [
				{
					name: "showDiscount",
					when: { qty: { $gte: 10 } },
					then: [{ $set: { "$ui.showDiscount": true } }],
				},
			],
		}),
	],
});

form.setValue("qty", 12);
console.log(form.getState().uiState); // { showDiscount: true }
form.dispose();
```

Pass rules through `createArbiterPlugin` in the `plugins` option. The former top-level `arbiterRules` form option is
not supported; non-production core builds warn with this migration path when they encounter it.

## When to use this package

- Use `@formbar/arbiter` when visibility, requiredness, computed values, or other form behavior should be governed by Arbitre production rules.
- Use `@formbar/core` plugins or middleware directly for simple imperative form behavior.
- Combine with `@formbar/react-schema` when schema-driven React layouts should react to rule-produced `$ui` state.

## Dependencies

- Depends on `@formbar/core`.
- Peer dependencies: `@arbitre/core ^0.3.0` and `kuery ^2.1.0`.
