# @formbar/declarative

Framework-neutral, serialized version 1 form-definition contracts for Formbar.

## Contract

`FormDefinition` contains a stable `id`, `version: 1`, one `root` node, and optional stored computations. Domain schemas are separate inputs; this package neither stores nor projects JSON Schema, Zod, or other domain schema objects.

The closed node union contains `group`, `section`, `field`, `repeater`, `action`, `output`, `conditional`, `tabs`, `accordion`, `validation`, and `custom`. Host extensions use explicit string widget, action, and renderer IDs. Their props use the JSON-safe `PropDefinitions` contract from `@formbar/expressions`.

Bindings use `{ namespace, segments, scope? }`. Each segment is a string key or non-negative integer index. A `scope` names a lexically enclosing repeater; nested repeater scopes compose without dotted-path ambiguity.

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
if (!result.ok) console.error(result.diagnostics);
```

## Validation boundary

`validateFormDefinition(unknown)` returns either one complete canonical definition or sorted, path-aware diagnostics. It rejects unsupported versions, unknown keys and built-in node types, malformed or inaccessible scopes, duplicate IDs/scopes/computation targets, invalid expressions, computation self-dependencies/cycles, executable values, accessors, symbols, sparse arrays, non-finite numbers, cycles, and unsafe prototypes.

Expressions, references, prop definitions, compilation, and dependency discovery come from the public `@formbar/expressions` API. This package does not define expression operators, parse expression source, evaluate expressions, or import Kuery/Kalada directly. Conditions are structurally valid expressions; runtime boolean-result enforcement belongs to the runtime layer.

## Deliberate non-goals

This package does not compile schemas, render React, execute actions or computations, mutate form state, merge runtime snapshots, or implement registries. Runtime, renderer, action, and widget exports are type-only host ports.
