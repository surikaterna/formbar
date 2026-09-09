# @formbar/react

## 0.3.1

### Patch Changes

- 40e0d87: Warn outside production when form creation receives unknown option keys, including targeted guidance for migrating
  the removed `arbiterRules` option. Keep React-only options out of core diagnostics.
- Updated dependencies [40e0d87]
  - @formbar/core@0.3.1

## 0.3.0

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
