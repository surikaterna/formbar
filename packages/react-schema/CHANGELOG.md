# @formbar/react-schema

## 1.0.0

### Minor Changes

- 70f01ad: Enable validated definition-bound omit-inactive submission through prepared schema factories and forward the opt-in from useSchemaForm. Generated definitions accept a serialized submission policy and field-ID include-hidden overrides; default full-draft submission is unchanged.
- 772a12e: Surface failed checked outgoing-candidate validation in native form summaries and field errors so opted-in schema forms can guide users to correct the actual submitted request.
- 10b4eaa: Forward prepared async field validator options through the deferred schema-form hook without changing the React core form API.

### Patch Changes

- c460d74: Expose the public trusted definition-field issue input and concrete data-binding types for authored and generated scoped validators. Document registration, full-draft and candidate execution, and legacy migration without enabling omission.
  Install prepared schema and caller validators exactly once through the eager/deferred factory; React delegates preparation validators to the factory while retaining its separate Standard Schema source validation.
- Updated dependencies [cbb9d59]
- Updated dependencies [b4340af]
- Updated dependencies [7698998]
- Updated dependencies [0ed966b]
- Updated dependencies [1bf5761]
- Updated dependencies [08c1a2b]
- Updated dependencies [439a847]
- Updated dependencies [75454ce]
- Updated dependencies [ed3d7c3]
- Updated dependencies [70f01ad]
- Updated dependencies [ba13b66]
- Updated dependencies [be5b55a]
- Updated dependencies [10b4eaa]
- Updated dependencies [10b4eaa]
- Updated dependencies [10b4eaa]
- Updated dependencies [cd7009c]
- Updated dependencies [81c9913]
- Updated dependencies [c460d74]
- Updated dependencies [ca15dcb]
- Updated dependencies [ceaf702]
  - @formbar/core@1.0.0
  - @formbar/declarative@1.0.0
  - @formbar/from-schema@1.0.0
  - @formbar/react@1.0.0

## 0.22.0

### Patch Changes

- Updated dependencies [cc416cd]
  - @formbar/core@0.22.0
  - @formbar/declarative@0.22.0
  - @formbar/from-schema@0.22.0
  - @formbar/react@0.22.0

## 0.21.0

### Minor Changes

- 4ad7834: Add opt-in, definition-field-scoped synchronous draft validation through prepared schema forms, including deferred React construction and concrete typed field bindings. Submission and async validation are unchanged.

### Patch Changes

- Updated dependencies [4ad7834]
  - @formbar/core@0.21.0
  - @formbar/declarative@0.21.0
  - @formbar/from-schema@0.21.0
  - @formbar/react@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [ef1c667]
  - @formbar/core@0.20.0
  - @formbar/declarative@0.20.0
  - @formbar/from-schema@0.20.0
  - @formbar/react@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [8bb23bd]
  - @formbar/core@0.19.0
  - @formbar/declarative@0.19.0
  - @formbar/from-schema@0.19.0
  - @formbar/react@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [5faa6a5]
  - @formbar/core@0.18.0
  - @formbar/declarative@0.18.0
  - @formbar/from-schema@0.18.0
  - @formbar/react@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [6cfe157]
  - @formbar/core@0.17.0
  - @formbar/declarative@0.17.0
  - @formbar/from-schema@0.17.0
  - @formbar/react@0.17.0

## 0.16.1

### Patch Changes

- 10214c6: Restore safe shallow JSON Schema default initialization in the core form before its first render.

## 0.16.0

### Patch Changes

- 28e360c: Install one automatic Draft 2020-12 validator for plain JSON Schema forms, with fail-closed validation diagnostics and shared preflight exports. Forward prepared validators to the React hook without duplicate demo injection.
- Updated dependencies [28e360c]
  - @formbar/from-schema@0.16.0

## 0.15.3

### Patch Changes

- afc7725: Restore direct JSON Schema option titles and disabled state in generated native choice controls without changing schema validation.
- Updated dependencies [afc7725]
  - @formbar/from-schema@0.15.3

## 0.15.0

### Patch Changes

- Updated dependencies [b998e2b]
  - @formbar/core@0.15.0
  - @formbar/react@0.15.0
  - @formbar/declarative@0.15.0
  - @formbar/from-schema@0.15.0

## 0.14.3

### Patch Changes

- ae3c091: Select CJS declarations for require consumers and ESM declarations for import consumers via paired conditional type exports (#154).
- Updated dependencies [ae3c091]
  - @formbar/core@0.14.3
  - @formbar/declarative@0.14.3
  - @formbar/from-schema@0.14.3
  - @formbar/react@0.14.3

## 0.14.2

### Patch Changes

- 87071ad: Publish source-free package artifacts with synchronized licenses and validated self-contained source maps.
- Updated dependencies [87071ad]
  - @formbar/core@0.14.2
  - @formbar/declarative@0.14.2
  - @formbar/from-schema@0.14.2
  - @formbar/react@0.14.2

## 0.14.0

### Patch Changes

- Updated dependencies [e12e761]
  - @formbar/declarative@0.14.0
  - @formbar/core@0.14.0
  - @formbar/from-schema@0.14.0
  - @formbar/react@0.14.0

## 0.13.0

### Minor Changes

- bea9fd1: Add form-backed repeater projection, generated actions, constraint guards, scoped React rendering, and stable renderer-private row coordination. Preserve nested field metadata when moving array items.

### Patch Changes

- Updated dependencies [bea9fd1]
  - @formbar/core@0.13.0
  - @formbar/declarative@0.13.0
  - @formbar/from-schema@0.13.0
  - @formbar/react@0.13.0

## 0.12.0

### Minor Changes

- ce05dcf: Add serialized declarative actions with core-authoritative built-ins, abort-safe instance concurrency, trusted host handlers, and accessible React action controls.

### Patch Changes

- Updated dependencies [ce05dcf]
  - @formbar/core@0.12.0
  - @formbar/declarative@0.12.0
  - @formbar/from-schema@0.12.0
  - @formbar/react@0.12.0

## 0.11.0

### Minor Changes

- ea15d6b: Add pure declarative output evaluation with strict built-in format IDs and semantic accessible React rendering.

### Patch Changes

- Updated dependencies [ea15d6b]
  - @formbar/declarative@0.11.0
  - @formbar/from-schema@0.11.0

## 0.10.0

### Minor Changes

- dca4052: Add JSON-only schema widget hints and renderer-scoped trusted widget and custom-node registrations, including built-in tabs and accordion rendering.

### Patch Changes

- Updated dependencies [dca4052]
  - @formbar/from-schema@0.10.0

## 0.9.0

### Minor Changes

- 3a03925: Add the native `FormRenderer` for validated schema form artifacts and make core form selectors server-renderable.

### Patch Changes

- Updated dependencies [3a03925]
  - @formbar/react@0.9.0

## 0.8.0

### Minor Changes

- 141ef96: Add deterministic framework-neutral runtime projection, coherent core lifecycle captures, and occurrence-derived schema baselines.

### Patch Changes

- Updated dependencies [141ef96]
  - @formbar/declarative@0.8.0
  - @formbar/core@0.8.0
  - @formbar/from-schema@0.8.0
  - @formbar/react@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [23caf3b]
  - @formbar/core@0.7.0
  - @formbar/declarative@0.7.0
  - @formbar/from-schema@0.7.0
  - @formbar/react@0.7.0

## 0.6.0

### Minor Changes

- 46c8479: Replace renderer and resolved-state APIs with the preparation-only useSchemaForm hook.

### Patch Changes

- Updated dependencies [46c8479]
  - @formbar/from-schema@0.6.0

## 0.4.0

### Minor Changes

- cb90a21: Introduce the authorized reactive expression runtime powered directly by Kuery's
  strict whole-AST expression core (#90, parent #60, contract coordination #61). Add authorized core namespace
  adapters and form disposal notifications, the public reactive ordinary-prop React
  hook, and an opt-in Arbitre 0.3 then-stage operator that reads actual rule RHS scope,
  evaluates each stage atomically, and records writes through Arbitre's tracked callback. Derived
  expressions stay read-only; direct bindings preserve core write/veto results and
  reject stale capabilities. This does not add a declarative renderer or stored
  computation scheduler. The new expressions package begins at 0.0.0 and joins the
  coordinated linked release family; existing integration APIs are additive minor changes.

  Harden the JSON boundary against holes disguised by non-index array properties;
  parse expression/prop/scope shapes before constructing typed contracts. Contain
  throwing or asynchronous lifecycle callbacks, finalize reentrant disposal, expose
  bounded code-only lifecycle diagnostics, and consume supported ordinary native Promise
  snapshot/target/callback results without enabling asynchronous providers.
  Untrusted JSON rejects Promise objects structurally without touching Promise
  accessors; trusted callbacks consume only descriptor-verified ordinary native
  Promises and reject suspicious species shapes without observing them.
  Plain JSON objects with data fields named `then` remain valid and are not
  misclassified as callback Promise results.

  Validate writable object/array targets and immutable core path copies through own
  data descriptors before dispatch, including dense canonical append-only array
  rules and transaction rollback. Harden disposal registration races, count JSON
  limits by Unicode code point, and keep the installed Kuery runtime external so
  root, subpath, ESM, and CJS profile identities remain shared. Consume the released
  Kuery 2.1 and Arbitre 0.3 public registries without temporary preparation scripts.

### Patch Changes

- Updated dependencies [cb90a21]
  - @formbar/core@0.4.0
  - @formbar/react@0.4.0
  - @formbar/from-schema@0.4.0

## 0.3.0

### Minor Changes

- 7abf551: Expose normalized schema choices, option warnings, and call-level option title resolution through `useSchemaForm`.
- 5b06137: Adopt `@scheman/core` 1.0 and narrow optional Zod support to `>=3.24.0 <4 || >=4.0.0 <5`. `@formbar/react-schema` inherits this breaking schema contract through its public `@formbar/from-schema` dependency.

### Patch Changes

- acf2011: Omit absent initial data from schema form options while preserving schema-default merging.
- Updated dependencies [0f180e2]
- Updated dependencies [5b06137]
- Updated dependencies [e0d7171]
  - @formbar/from-schema@0.3.0
  - @formbar/core@0.3.0
  - @formbar/react@0.3.0

## 0.2.1

### Patch Changes

- c09f1b7: Fix the repository lint gate without changing public APIs, and repair package dependency metadata by replacing workspace-link ranges with publishable semver ranges for the patch release.
- Updated dependencies [c09f1b7]
  - @formbar/core@0.2.1
  - @formbar/from-schema@0.2.1
  - @formbar/react@0.2.1

## 0.2.0

### Minor Changes

- a48f14d: Initial 0.1.0 release of the @formbar form engine.

  @formbar/core:

  - Headless form state management with reactive field API
  - Generic plugin system for extensible form behavior
  - Validation pipeline with async support and Standard Schema v1 compatibility
  - Transform system (ingress/egress) for data normalization
  - Middleware hooks for submit lifecycle
  - Path system supporting dot-notation and JSON Pointer
  - Transaction system for batched updates

  @formbar/from-schema:

  - JSON Schema ingestion with conditional-required resolution
  - Zod v3 and v4 schema extraction (via @scheman/core)
  - Layout compiler with pluggable node registry
  - Layout middleware pipeline for extensible field arrangement
  - UI schema validation utilities

  @formbar/react:

  - useForm hook with reactive re-rendering
  - useField hook with scoped field state
  - Full a11y utilities (labels, descriptions, errors, focus management)

  @formbar/react-schema:

  - useSchemaForm for schema-driven forms
  - Renderer registry with layout tree rendering
  - Field state resolution from plugin metadata

  @formbar/arbiter:

  - Bridge plugin connecting @arbitre/core rule engine to @formbar/core
  - Declarative UI governance via production rules (visibility, disabled, calculated fields)
  - Expression evaluation utilities via kuery
  - Automatic state synchronization between form and rule session

### Patch Changes

- Updated dependencies [a48f14d]
  - @formbar/core@0.2.0
  - @formbar/from-schema@0.2.0
  - @formbar/react@0.2.0
