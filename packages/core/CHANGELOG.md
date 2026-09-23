# @formbar/core

## 0.15.0

### Minor Changes

- b998e2b: Fix #160: defer hook-owned plugin and middleware initialization to committed React effects and release resources synchronously on StrictMode replay and unmount. The opt-in core factory leaves imperative `createForm` eager. Hook-owned stores now survive replay and are not permanently disposed on unmount; externally held APIs require explicit `dispose()` to fire `onDispose`.

## 0.14.3

### Patch Changes

- ae3c091: Select CJS declarations for require consumers and ESM declarations for import consumers via paired conditional type exports (#154).
- Updated dependencies [ae3c091]
- Updated dependencies [1ceb6f1]
  - @formbar/expressions@0.14.3

## 0.14.2

### Patch Changes

- 87071ad: Publish source-free package artifacts with synchronized licenses and validated self-contained source maps.
- Updated dependencies [87071ad]
  - @formbar/expressions@0.14.2

## 0.14.0

### Patch Changes

- Updated dependencies [e12e761]
  - @formbar/expressions@0.14.0

## 0.13.0

### Patch Changes

- bea9fd1: Add form-backed repeater projection, generated actions, constraint guards, scoped React rendering, and stable renderer-private row coordination. Preserve nested field metadata when moving array items.

## 0.12.0

### Minor Changes

- ce05dcf: Add serialized declarative actions with core-authoritative built-ins, abort-safe instance concurrency, trusted host handlers, and accessible React action controls.

## 0.8.0

### Minor Changes

- 141ef96: Add deterministic framework-neutral runtime projection, coherent core lifecycle captures, and occurrence-derived schema baselines.

## 0.7.0

### Minor Changes

- 23caf3b: Add producer-aware reactive field-policy contributions and generation-safe scoped async validation and submission lifecycles. Remove legacy plugin field metadata and Arbiter's interim `$meta` policy extraction.

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
  - @formbar/expressions@0.4.0

## 0.3.1

### Patch Changes

- 40e0d87: Warn outside production when form creation receives unknown option keys, including targeted guidance for migrating
  the removed `arbiterRules` option. Keep React-only options out of core diagnostics.

## 0.3.0

### Patch Changes

- e0d7171: Preserve form data and UI state generic types when invoking submit plugin hooks.

## 0.2.1

### Patch Changes

- c09f1b7: Fix the repository lint gate without changing public APIs, and repair package dependency metadata by replacing workspace-link ranges with publishable semver ranges for the patch release.

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
