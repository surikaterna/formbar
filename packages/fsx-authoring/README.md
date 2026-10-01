# @formbar/fsx-authoring — internal candidate

**Not released. Do not publish or merge from candidate evidence.** #305 uses the
independently audited Formbar V1 baseline at `4879fcc5987095b2f91095d96e6dde1dc9c79e2a`.
#317 still gates normal-registry dependencies and release-owner approval.

`compileFsx(text, installation)` compiles trusted authoring text, not JavaScript,
to a portable `FormDefinition`. Success also retains the public validator's
nonportable `validated` admission proof and a separate transient source map.
Failure contains diagnostics **and no executable definition**. Use
`createFormRuntime({ definition: result.validated, installed })` from
`@formbar/declarative`, then `KaladaFormRenderer` from `@formbar/react-schema`.
Do not JSON-copy an admission proof. JSON-copy only `result.definition` and
re-admit it with the destination host's installation.

## First profile: `fsx-v1-experimental`

The semantics follow #179/#183; this particular punctuation is a small,
versioned **internal candidate pending owner freeze**, not a stable FSX language
specification. No reverse #153 embedding, editor, LSP, TypeScript or handler
JavaScript is implemented.

```xml
<Form id="admin" defaultLanguage="Kalada">
  <Field id="name" widget="text" value={name}/>
  <Alias as="displayName" value={name}>
    <Output id="echo" value={displayName}/>
  </Alias>
  <Conditional id="show" condition={name == "ready" && true}>
    <Output id="ready" value={"Ready"}/>
  </Conditional>
  <Repeater id="lines" value={rows} as="line">
    <Field id="quantity" widget="text" value={line.quantity}/>
    <CUSTOM id="editor" renderer="Editor" title="Quantity"
      current={quantity} edit={line.quantity}/>
  </Repeater>
</Form>
```

* Only `Form`, `Group`, `Alias`, `Field`, `Repeater`, `Conditional`, `Output`,
  and `CUSTOM` are accepted. Whitespace separates elements; free text, comments,
  arbitrary JSX, spreads, fragments, dynamic handlers, unknown tags/attributes,
  and children of leaf declarations are rejected. `Conditional` children form
  its `then` branch; this profile has no `else` punctuation.
* `Form` requires static double-quoted `id` and `defaultLanguage="Kalada"`.
  Other emitted nodes require static unique `id`. The generated root group id
  starts with the first 220 UTF-16 units of the form id plus `:root`, then appends
  the first collision-free numeric suffix if needed. This stays within V1 id limits.
* `Group` accepts `label`. `Field` requires `widget` and `value`, and accepts
  `label`/`required`. `Repeater` requires `value` and globally unique `as`.
  `Output` requires `value` and accepts `label`; `Conditional` requires `condition`.
  These nodes accept Kalada `visible`, `disabled`, and `readOnly` guests.
* Static strings use JSON double-quote escaping. Guest interiors use `{...}`.
  All currently supported Kalada syntax goes through **public** guest-prefix
  parsing, parse and lower APIs, with typed trusted references. Quoted braces
  belong to the guest. A failed guest aborts; it never scans forward to recover
  a sibling. Source offsets are original JavaScript UTF-16, half-open.
* `Alias` requires `as` and a guest `value` naming an installed read reference or
  enclosing alias. Nested aliases retain namespace, field identity and relative
  scope; names are globally unique and never shadow installed names. Aliases are
  lexical and disappear during lowering; they do not leak to following siblings.
* `Field.value`, repeater locations and custom write props use the **public**
  `checkKaladaV1DirectLocation` with installed writable bindings and typed property
  evidence. They emit checked data `StateRef`s, never evaluated path expressions.
  Optional/computed writes are rejected. A schema path is not permission.
* `items[as]` supplies trusted row-item evidence relative to that exact scope.
  Static `line.quantity` is writable with installed property evidence. Whole
  primitive rows support native and custom writers through the same public proof,
  with exact primitive item type and lexical scope metadata. Alias names are not
  magic: `value={ item }` and `value={(product)}` are accepted when the public
  checker proves their empty-segment scoped target. Neither source spelling nor
  schema path substitutes for installed typed evidence or use-time authorization.
  An authoring alias named `primitiveItem` is also valid: if it collides with the
  legacy transient evidence key, the compiler materializes a canonical checked
  binder for that proof without changing its target, type, scope, or source map.
* `CUSTOM renderer="Editor"` selects an installed descriptor alias, never source
  code. Its descriptor fixes the serialized renderer id and every prop's mode and
  expected type. Literal props accept strings or Kalada literal guests; read props
  lower Kalada; write props lower checked locations. The public admission policy
  independently validates the renderer and prop contract. No arbitrary handlers
  are generated. The runtime must install and authorize actual renderers/writers.
* `computations` may supply trusted canonical V1 computations. Public admission
  checks their complete dependency graph (including cycles and write collisions)
  without evaluating them. They have diagnostic paths but no invented source
  spans, because they were not declared in this source profile.

## Trust, limits and diagnostics

The host installs references, locations, item evidence, renderer descriptors,
policy, identity, and strategy. Source never installs capabilities. The compiler
rejects accessor metadata and performs no read, capture, subscription, write,
renderer or action callback. The public validator may inspect trusted strategy
artifact identity metadata. Runtime strategy authorization is independent at
every use, including retained writer freshness across row reorder/removal.

Returned identity receipts must contain exactly the own data string fields
`artifact`, `policyGeneration`, and `policyFingerprint`, each nonempty and at
most 2,048 UTF-16 units. Admission inspects the complete receipt before consuming
any field; getters, inherited fields and throwing proxy traps fail closed without
invoking property getters. The identity callback itself remains an allowed trusted
metadata inspection, never an authorization to evaluate/read/capture/write.

Diagnostics carry an exact declaration path and an original source range when
one can be mapped. Admission diagnostics without an exact map retain their path
and omit `range`; a parent span is not fabricated. Authoring-only attributes
(`defaultLanguage`, `as`) retain authoring paths. Source is limited to 100,000
UTF-16 units, 1,000 elements and 32 element nesting levels, plus public guest and
admission limits. This is trusted host-installed authoring, not a sandbox.

Alias diagnostics retain physical authoring child indexes, including nested Alias
constructs. Emitted declaration indexes and source maps separately count only
flattened declarations; transparent aliases never manufacture definition nodes.

Kalada typing is its public syntax contract: use explicitly typed reference
names for scalar operations, including scoped read references such as `quantity`.
Writable property evidence does not manufacture a richer guest read type.
Unsupported Kalada grammar/type combinations return the public diagnostic.

## Candidate-only dependencies and evidence

No unpublished Kalada version is recorded in normal manifests or `bun.lock`.
The guarded overlay temporarily installs exact local archives from Kalada
`1ed0ec83a7673dffa2ae3cda062e5c4176b4143a`: core 0.6.0, syntax 0.1.0,
provider-routing 0.1.0, alongside the distinct published core 0.1.0 required by
Kuery. It verifies SHA/SRI, physical graphs and a clean frozen reinstall, snapshots
all source (including this package and Changeset), and restores manifests, lock
and `.npmrc` on success and failure. The package becomes publishable only after
#317 supplies approved matching normal-registry dependencies; the current
manifest is deliberately not a release-ready production dependency declaration.

```sh
KALADA_REPO=/home/sprawl/projects/kalada node scripts/kalada-preflight/overlay.mjs
```

The candidate lane runs compiler goldens/adversarial tests, public-host writable
React integration and packed real authoring consumers under React 18/19, ESM/CJS
and strict NodeNext. The browser-target source fixture uses the installed compiler
without a parser dependency flowing into the declarative runtime. Baseline
normal-registry tests remain explicitly failed while core 0.1 lacks V1 exports.
