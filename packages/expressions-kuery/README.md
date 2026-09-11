# @formbar/expressions-kuery

Default provider for `@formbar/expressions`, implemented in #90 (#60/#61).
Import `createKueryBackend` from the public package entry and pass one instance
to `createExpressionService({ backend, namespaces })`. No global registration or
per-expression provider selector is used.

| Operators | Contract |
| --- | --- |
| `eq`, `neq` | Binary public Kuery equality; not deep object equality. |
| `gt`, `gte`, `lt`, `lte` | Binary; both numbers or both strings. |
| `and`, `or` | 1–32 boolean arguments. |
| `not` | One boolean argument. |
| `in`, `nin` | Binary; second argument is an array; public Kuery membership. |
| `add`, `subtract`, `multiply`, `divide` | Exactly two finite numbers; no coercion. |

```ts
import { createExpressionService } from "@formbar/expressions";
import { createKueryBackend } from "@formbar/expressions-kuery";

const service = createExpressionService({ backend: createKueryBackend() });
const compiled = service.compile({ kind: "op", op: "add", args: [
  { kind: "op", op: "multiply", args: [
    { kind: "literal", value: 2 }, { kind: "literal", value: 12 },
  ] },
  { kind: "literal", value: 3 },
] });
if (compiled.ok) console.log(service.evaluate(compiled.value)); // 27
service.dispose();
```

The provider uses only Kuery's **public** `evaluate` and `OperatorRegistry` APIs.
The evaluator receives generated private slots, never the form/session object or
user-controlled lookup paths. The arithmetic profile is registered with private
`$formbar*` names; it is an intentional strict-finite extension, **not** reuse of
or compatibility with native Arbitre arithmetic's null/coercion behavior. Native
Arbitre arithmetic handlers are not public exports in the inspected 0.2 runtime.

Arity/unsupported operators/known literal types fail compilation. Dynamic types,
division by zero and overflow fail evaluation with `type`, `division-zero` or
`non-finite`. `NaN`/infinity are invalid literals/read results as well. Finite
IEEE-754 rounding and underflow remain ordinary number behavior. Conditions and
dependencies are eagerly evaluated/authorized; do not depend on short-circuiting
to hide an unauthorized reference. JSON object values use native identity equality;
compare scalar fields for portable conditions.

See the neutral package's [ADR](../expressions/docs/adr/0001-expression-service-and-reactive-props.md)
and README for reference scopes, permissions, reactive props, limits and disposal.
