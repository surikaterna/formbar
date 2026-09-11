# ADR 0001: Shared pure expression service and reactive prop capabilities

- Status: implemented design, pending independent audit of #90
- Issues: #90; parent #60; contract coordination #61
- Consumers/follow-ups: #64 runtime snapshots, #68 stored computations, #69 widgets, #70 field policy

## Ownership and dependencies

The approved #90 clarification supersedes expression ownership in the earlier
#60/#61 sketches. `@formbar/expressions` owns JSON expressions, namespace references,
backend interfaces, compilation/results, dependency identity, authorization, and
reactive read/write bindings. It has **no dependencies**. Definitions/nodes and
the complete declarative renderer remain downstream work, not this package.

`@formbar/expressions-kuery` depends on the neutral package and the public `kuery`
entry. Core depends only on the neutral package; its adapter reads actual
`FormApi.getState()` data/UI and writes through `dispatch`, preserving transforms,
middleware vetoes and dispatch results. Core `Namespace` remains `data | ui`.
The React hook depends on the neutral service, not the provider. The optional
Arbitre bridge accepts a backend; neither core nor React selects Kuery implicitly.
Hosts explicitly instantiate the default provider once per service. There is no
per-expression backend selector, global registry, or new reverse package dependency.
Existing core/from-schema development coupling is not extended.

## JSON contract and execution bounds

Expressions have `kind: literal | ref | op`. A reference has `namespace: string`,
`segments: (string | number)[]`, and optional named `scope`. Named scopes reference
other scopes in the same namespace; resolution prepends parent segments and freezes
the absolute result at compilation. Cycles, absent scopes, and namespace mismatches
are invalid. To replace scopes/backend, replace the service and recompile/rebind.

Only finite, dense, plain JSON is accepted. Compilation copies and freezes inputs;
evaluation similarly copies authorized read values and results. `undefined` is
missing, distinct from JSON `null`; negative zero normalizes to JSON zero. Accessors,
symbols, functions, non-plain prototypes, sparse arrays and unsafe object keys are
rejected. Path traversal uses **own data descriptors**, never getters, inherited
properties, dot-string interpretation or prototype traversal. Segment names must
be nonempty, at most 256 characters, and not `__proto__`, `prototype`, or
`constructor`; numeric segments are nonnegative safe integers. Empty segment lists
read roots; the core adapter does not permit root writes (use the form reset API).
The core adapter also refuses an ambiguous data path starting with `$ui`, rather
than accidentally writing the UI namespace. Escaped dots, slashes and tildes in
other segment names are supported through checked JSON Pointers.

Array validation checks bounded native length before allocation, exactly length + 1
own keys, and every enumerable own **data** index from `0` through `length - 1`.
This rejects a hole disguised by a numeric-looking non-index property (including
`4294967295`), leading-zero/exponent keys, symbols, extras and accessor indices.
JSON copying does not assert an AST schema: expression, prop and scope parsers
accept copied JSON and construct typed contracts only after explicit shape guards.

`LIMITS` bounds each copied JSON document to 1,024 values, depth 32, and strings/keys
16,384 characters; structural AST containers count toward those budgets. Each op
has at most 32 arguments; a resolved path has at most 64 segments. A prop definition
document has the same JSON budget and at most 128 props. Each dependency/result
copy has its own JSON budget. Thus evaluation work is bounded by the validated AST
size times the bounded dependency/result size; there are no serialized loops,
recursion operators, regular expressions, callbacks or source execution. Trusted
backend/capability code must itself be synchronous and bounded: JavaScript cannot
preempt a hostile host callback or Proxy trap.

Untrusted JSON/expression paths do **not** perform Promise or thenable detection.
They first classify primitives, arrays, and plain objects through prototype and own
data descriptors. A Promise is rejected as a non-JSON prototype without reading
own/inherited `then`, `constructor`, or `Symbol.species`; nested values, expressions,
props, scopes, namespace reads, backend results, and write payloads use that same
rule. Proxy internal traps cannot be sandboxed; a thrown trap becomes code-only
`invalid-input`, and proxy objects are outside the supported serialized input.

Trusted callback return handling is separate. Ordinary same-realm and cross-realm
native Promises with descriptor-verified native Promise constructor, prototype,
`then`, and species shapes are rejected and receive an intrinsic rejection handler.
Own `then`, `constructor`, or `Symbol.species` properties and altered native
constructor/species/prototype descriptors (including Promise subclasses) make the result unsupported: it is
rejected synchronously without reading those property values or attaching a
Promise observer. ECMAScript Promise chaining necessarily performs species
construction, so safely consuming a *rejected* hostile Promise with poisoned
constructor/species accessors while also executing none of them is impossible.
Trusted hosts must not return that shape; if they do, they retain responsibility
for settling/handling its rejection before return. This is a precise best-effort
containment boundary, not asynchronous provider support or a sandbox claim.
Promise-specific own-property hazard checks run only after the prototype chain is
identified as a native Promise candidate. Consequently an ordinary JSON object may
freely contain own data properties named `then` (including string, null, object, or
other JSON values); those values survive literal compilation, backend results and
namespace reads unchanged. Functions remain invalid JSON independently.

Programs are frozen handles owned by their compiling service (WeakMap identity),
not transferable serialized executable objects. Diagnostics expose fixed codes
only: no source snippets, values, paths, backend exception messages, or secrets.
Core dispatch errors are deliberately returned unchanged to the calling writer;
they are the existing host mutation API result, not expression diagnostics.

## Pure backend and explicit arithmetic extension

Kuery's public `evaluate` supplies equality, ordered comparison, logical and
membership evaluation. Only compiler-generated **private argument slots** reach
that evaluator. It never receives a form/session object or user-controlled path.
All dependencies are eagerly authorized/read, including refs in logically unused
branches; repeated canonical refs share one read value in an evaluation. A root
snapshot is captured once per namespace per program evaluation. The backend can
only request the compiled dependency set. JSON object equality is Kuery's native
identity behavior, **not deep structural equality**. Independent object copies
compare unequal; callers should compare scalar fields for portable predicates.

The default allowlist is `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `and`, `or`, `not`,
`in`, `nin`, `add`, `subtract`, `multiply`, `divide`. Comparisons and membership are
binary; `not` is unary; `and`/`or` accept 1–32 boolean arguments. Ordered comparisons
require two numbers or two strings of the same type. Membership's second argument
must be an array. Logical operators do not coerce truthiness.

The four arithmetic operators are mandatory in #90. They are intentionally
implemented as a **strict finite v1 profile**, registered through Kuery's public
`OperatorRegistry.register`, with private `$formbar*` operator names. Each is
exactly binary; compose nested expressions for sums/products with more terms.
Only finite numbers are accepted, without string/null/boolean coercion; nonfinite
results and division by either sign of zero fail. Arity, known literal types, and
unsupported operators are checked at compile time; dynamic types/results are
checked at evaluation time. Overflow fails; finite IEEE-754 rounding/underflow is
retained. This is **not a claim of native Arbitre arithmetic compatibility**.
Arbitre 0.2's arithmetic handlers are not public runtime exports and have their own
null/coercion semantics. No private import, copied upstream evaluator, temporary
rule session, or speculative upstream arithmetic blocker is used.

## Capabilities, read/write props and reactions

Unregistered namespaces are denied. Registering a provider grants its read
capability; a `write` method grants write capability unless the optional host
authorization function restricts it. External namespaces remain named neutral
providers, never additions to core's namespace union. Providers expose immutable
snapshots, synchronous invalidation subscriptions, and optional lifetime/version
tokens. They must notify when values or capability/target generations change.
Hosts must call `invalidateAuthorization()` after changing authorization state;
an unchanged boolean closure cannot be observed magically. Read/write checks still
run on every resolution/mutation even if the host omitted notification.

`mode: literal` forwards literal JSON; `mode: read` evaluates any expression;
`mode: write` requires a direct ref both statically and at runtime. Prop names are
ordinary names (`value`, `disabled`, `label`, custom widget props), not a selected
reactivity allowlist. **Every expression prop is reactive.** Derived values never
receive implicit writeback. A read-mode direct ref is also read-only. Typed host
forwarding uses `forwardExpressionProp` with a trusted component type guard; it
never adds a full component registry or infers types from arbitrary widget names.

Setters recheck read and write permissions and reject stale namespace registration,
provider version, authorization generation, parent identity, service disposal,
or binding lifetime. Parent replacement is deliberately conservative: replacing
an immutable parent, even with equal contents or a sibling edit, invalidates its
old setters. This can refresh a writable prop snapshot on an otherwise unrelated
sibling edit; read-only projection observers do not notify for unchanged results.
Root/reset/array-parent replacements therefore cannot make old setters address a
former logical target. Mutation payloads are validated/copied before the final
capability check. Form lifecycle signals (`isDisposed`/`onDispose`) let adapters
invalidate views and reject retained setters when the actual form is disposed,
without monkey-patching the form or constructing a shadow store.

Observation construction and `getSnapshot` acquire no resources. Subscriptions
are lazy, shared at service level, and released after the last observer subscriber.
Providers may emit coarse invalidations; snapshots are reevaluated and compared by
JSON value/diagnostics plus write-target identity. No value cache survives failed
authorization. An evaluation reads each namespace once; a props resolution evaluates
programs synchronously against provider snapshots (providers must not mutate during
reads). Repeated unchanged `getSnapshot` calls return the same object. Backend
evaluation may repeat on an unchanged snapshot; notifications are value-filtered,
not a promise of zero evaluator calls. Unsubscribe invalidates retained binding
setters, while direct `resolveWritable` setters last until target/capability/service
invalidation. Explicit observation/service disposal clears visible values as well.
React uses `useSyncExternalStore`; StrictMode probe subscriptions and abandoned
renders do not leak observer registrations. Keep definitions stable with `useMemo`.

Lifecycle errors use a contained, bounded diagnostic policy. The shared
`CallbackBoundary` attempts every captured notification/cleanup callback, records
only the fixed `adapter` code, and never retains or rethrows host exception text.
Services and their observations expose sticky, non-reactive
`getLifecycleDiagnostics()` results (`[]` or `[{ code: "adapter" }]`). Core exposes
`form.getDisposalDiagnostics()` for its disposal callbacks. Supported ordinary
native Promise returns are consumed and reported by the same boundary; suspicious
Promise shapes are rejected without observing them. Reporting does
not invoke a user error callback that could itself interrupt teardown.

Owned cleanup handles and listeners are detached, lifetime generations advanced,
and disposal flags set before callbacks run. Disposal is reentrant/idempotent;
disposal during subscription immediately releases a late-returned cleanup handle,
and disposal during namespace replacement wins over reconnection. A failed
subscription setup still throws a code-only `adapter` error and leaves reference
evaluation failed closed until a successful reconnect/registration. Cleanup errors
do not abort namespace replacement, later cleanups, notifications, or final state
clearing; a last-unsubscribe cleanup failure also fails reference reads closed
until reconnection. Disposal clears current observer values and revokes setters
even when the first callback throws. Core teardown is sequenced in a separate
helper, so disposal observers cannot skip plugins, plugin-owned handles,
middleware, field-cache clearing or store disposal. Every cleanup is attempted
once; a host cleanup that throws before releasing its own external resource must
still be repaired by the host. The runtime cannot force external resource release,
but detached callbacks cannot resurrect disposed observations or setters.

## Optional Arbitre integration is not an effect scheduler

`createExpressionOperator({ backend, programs, authorize?, namespaces? })` compiles
a host-registered ID map once. Register its `operator` through the public session
`operators.custom` option, for example `$formbarValue`. IDs are strings in rule
RHS expressions; arbitrary serialized programs cannot be registered from a rule.
Each invocation adapts the **actual current RHS scope**, including prior stages'
native arithmetic writes, rather than reading stale committed core state. Data
roots exclude reserved `$` keys; UI maps to `$ui`; hosts explicitly select external
roots from the scope. No subscriptions/session ownership are acquired by this pure
bridge. Errors throw code-only `ExpressionError`s; native strict session error and
transaction behavior remains authoritative. Host callback code is trusted.

The bridge never replaces the native `when` compiler, calculates hidden native
dependency indexes for IDs, or changes activation/refiring/TMS semantics. Real
session tests explicitly deactivate/reactivate the native condition for a second
firing; a continuously true native condition is **not promised** to recompute on
every RHS dependency edit. #68 owns stored computation scheduling/cycles/effects;
#70 owns broader custom-namespace/field-policy normalization. Dispose the bridge
and its externally owned session explicitly. There is no public session operator
unregister API in the inspected version; bridge disposal revokes its ID map so a
retained operator fails rather than evaluating old programs.

## Rejected alternatives

- Expression contracts in core, React, or declarative: wrong dependency direction
  or competing engines. Provider-specific AST as the shared contract: leaks ownership.
- Broad form scope passed to Kuery: bypasses per-reference capability checks.
- `eval`, serialized callbacks, permissive operators, private Arbitre arithmetic,
  copied native evaluator internals, or rule sessions for pure props: unsafe or coupled.
- Inferring setters through derived expressions: ambiguous inverse and authorization.
- Eager observers/useEffect-only snapshots: render leaks or tearing/stale initial props.
- Automatic output persistence: confuses pure projections with scheduled effects.
- Global backend/operator registration: cross-form coupling and lifecycle ambiguity.

## Verification, releases and principles

Risk-based tests cover malformed/deep inputs, pollution/accessors, missing/null,
provider injection/conformance, finite arithmetic, stable snapshots, vetoes,
revocation/stale setters, real core resets, mounted DOM edits, StrictMode/rebind/
unmount, real Arbitre RHS evaluation and existing regressions. New packages expose
ESM/CJS/declarations and build before dependent packages. Initial-release minor
changesets start at 0.0.0; additive core/react/arbiter changes are minor. Both new
packages join the existing linked family.

New production responsibilities are cohesive, files remain below 400 lines and
new functions below 50 lines with nesting at most three levels. **Builder approved
a narrow inherited exception** during the #90 changes-requested handoff for the
existing `createForm` factory (288 lines at base, approximately 292 with expression
lifecycle wiring). Rationale: avoid an unrelated broad core refactor while fixing
the audited expression boundaries. Only small disposal wiring is permitted there;
new teardown logic lives in `form-disposer.ts` and other bounded helpers. This is
an explicit approved exception, not a claim that the factory meets the function
limit. The existing core/from-schema development cycle remains baseline and is
not worsened. Exact quality-gate evidence belongs in the #90 handoff; this ADR
alone does not claim gates or independent audit passed.
