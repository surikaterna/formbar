# @formbar/declarative

Framework-neutral serialized Formbar presentation contracts.

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

## Non-ownership

This package does not import Scheman or `@formbar/from-schema`, compile schemas, own constraints/default/provenance evidence, render React, mutate form state, or choose policy for current visibility/disabled/read-only/required values. Resolved runtime state is #64; DOM and ARIA are #65. Runtime and renderer host ports remain type contracts, not implementations.

## Diagnostics boundary

`validateFormDefinition(unknown)` returns either one canonical `ValidatedFormDefinition` or sorted path-aware **definition diagnostics**. Source diagnostics belong to Scheman, while projection and compilation diagnostics belong to `@formbar/from-schema`; those channels must not be merged into definition diagnostics.

The validator rejects unsupported versions, unknown keys/node types, duplicate IDs/scopes, inaccessible scopes, invalid bindings/expressions/ranges, unsafe or executable data, and computation conflicts/cycles.

See [Schema compilation architecture](../../docs/architecture/schema-compilation.md).
