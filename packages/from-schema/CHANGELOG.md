# @formbar/from-schema

## 0.8.0

### Minor Changes

- 141ef96: Add deterministic framework-neutral runtime projection, coherent core lifecycle captures, and occurrence-derived schema baselines.

### Patch Changes

- Updated dependencies [141ef96]
  - @formbar/declarative@0.8.0
  - @formbar/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [23caf3b]
  - @formbar/core@0.7.0
  - @formbar/declarative@0.7.0

## 0.6.0

### Minor Changes

- 46c8479: Replace flat Scheman v1 and layout APIs with explicit Scheman v2 descriptor projection and validated FormDefinition compilation.

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

## 0.3.1

### Patch Changes

- 29a10d4: Prefer Standard Schema validation when a schema also resembles JSON Schema, preserving Zod 4 validation in generated forms.
- e827864: Validate JSON Schema `format: "date"` strings as canonical real calendar dates.
- Updated dependencies [40e0d87]
  - @formbar/core@0.3.1

## 0.3.0

### Minor Changes

- 0f180e2: Add typed `x-formbar.options` normalization, per-field normalized choices, title resolution, and observable warnings while preserving standard schema validation semantics.
- 5b06137: Adopt `@scheman/core` 1.0 and narrow optional Zod support to `>=3.24.0 <4 || >=4.0.0 <5`. `@formbar/react-schema` inherits this breaking schema contract through its public `@formbar/from-schema` dependency.

### Patch Changes

- Updated dependencies [e0d7171]
  - @formbar/core@0.3.0

## 0.2.1

### Patch Changes

- c09f1b7: Fix the repository lint gate without changing public APIs, and repair package dependency metadata by replacing workspace-link ranges with publishable semver ranges for the patch release.
- Updated dependencies [c09f1b7]
  - @formbar/core@0.2.1

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
