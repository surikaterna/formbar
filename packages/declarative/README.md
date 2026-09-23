# @formbar/declarative

Framework-neutral serialized Formbar presentation contracts and runtime projection.

## Owned category: authored presentation intent

`FormDefinition` v1 owns concepts meaningful in a hand-authored form with no source schema: node hierarchy, structured bindings and lexical repeater scopes, widget/action/renderer IDs, labels, placeholders expressed as props, responsive spans, conditions, actions, outputs, and computations.

The ownership test is: **if a concept is meaningful without ingesting a schema, it belongs here**. For example, a field widget and its binding belong here; a JSON Schema `minimum`, provider capability, or source pointer does not.

```ts
import { validateFormDefinition, type FormDefinition } from "@formbar/declarative";

const input: FormDefinition = {
	version: 1,
	id: "contact",
	root: {
		type: "field",
		id: "email",
		binding: { namespace: "data", segments: ["email"] },
		widget: "email",
	},
};

const result = validateFormDefinition(input);
```

Bindings are `{ namespace, segments, scope? }`. A repeater declares a lexical `scope`; descendants bind relative to it. Nested scopes compose without dotted-path parsing.

## Runtime projection

`createFormRuntime({ form, definition, baseline? })` projects one validated definition over current core state. Snapshots contain coherent form flags, ordered concrete node and field instances, exact-path issues and lifecycle, and sorted code-only diagnostics. Repeater instances retain lexical scope indices; duplicate bindings remain independent node instances.

Field policy merges conservatively: visibility uses restrictive AND; disabled/read-only use restrictive OR; requiredness ORs schema baseline, the field's optional `required` expression, and core plugin contributions. Labels prefer the last defined plugin label (including an empty string), then the authored field label, schema baseline, and absolute pointer. Expression failures fail closed. Hidden values remain in core state and conditional requiredness does not add validators or change submit authority.

The runtime uses the existing expression service and core namespaces. `form` references expose `valid`, `validating`, `submitting`, `dirty`, `touched`, and `submitted`. Contextual `field` references expose only direct `valid`, `validating`, `dirty`, and `touched` lifecycle for the current or enclosing repeater instance. Runtime writes continue through core and are not authorization checks for projected disabled/read-only state.

Output nodes are pure snapshot projections. A visible output evaluates its `value` expression against the same captured state as the rest of the runtime and exposes either its raw JSON value or a code-only failure. Hidden outputs are not evaluated. The optional `label` is presentation metadata, and `format` is one of `plain`, `number`, `currency-usd`, or `percent`; formatting is renderer-owned and never changes form data, field lifecycle, validation, reset state, or submission payloads.

Action nodes contain only a trusted string ID and optional JSON-valued payload
expression. `createActionExecutor({ form, runtime, actions? })` executes the
reserved `submit`, `reset`, `validate`, and five `array.*` IDs through existing
core authority. Other IDs resolve only through the immutable host registration
list. Execution is isolated per concrete node instance with `drop` (default),
`replace`, or FIFO `queue` concurrency; payloads and snapshots are re-evaluated
when a run starts. Results and diagnostics are code-only, and reset or disposal
aborts active and queued work even when a trusted handler ignores its signal.

`StoredComputation` declarations currently receive static duplicate-target and cycle validation only; the runtime does not execute or persist them. Atomic stored computation lifecycle is tracked separately in [#129](https://github.com/surikaterna/formbar/issues/129). Consumers must not treat accepted declarations as persisted calculations until that work is delivered.

## Non-ownership

This package does not import Scheman or `@formbar/from-schema`, compile schemas, own constraints/default/provenance evidence, render React/DOM, resolve registry membership, add validation rules, or own a second state store. Schema evidence is limited to the optional `{ nodeId, required?, label? }` baseline supplied by an adapter. DOM and ARIA remain outside this package.

## Diagnostics boundary

`validateFormDefinition(unknown)` returns either one canonical `ValidatedFormDefinition` or sorted path-aware **definition diagnostics**. Source diagnostics belong to Scheman, while projection and compilation diagnostics belong to `@formbar/from-schema`; those channels must not be merged into definition diagnostics.

The validator rejects unsupported versions, unknown keys/node types, duplicate IDs/scopes, inaccessible scopes, invalid bindings/expressions/ranges, unsafe or executable data, and computation conflicts/cycles.

See [Schema compilation architecture](../../docs/architecture/schema-compilation.md).
