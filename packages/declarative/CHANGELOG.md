# @formbar/declarative

## 1.0.0

### Minor Changes

- 10b4eaa: Add validated definition field async registrations, typed per-instance ownership projection, and fail-closed overlapping-binding checks.
- cd7009c: Run every configured definition-scoped async instance on the guarded post-egress FINAL candidate alongside legacy validators, even when sync validation fails. Keep candidate issues in the attempt lane and leave retained draft validation unchanged. Pass captured submit stage and context to definition-scoped async callbacks.
- c460d74: Expose the public trusted definition-field issue input and concrete data-binding types for authored and generated scoped validators. Document registration, full-draft and candidate execution, and legacy migration without enabling omission.
  Install prepared schema and caller validators exactly once through the eager/deferred factory; React delegates preparation validators to the factory while retaining its separate Standard Schema source validation.
- ceaf702: Validate and retain an optional serialized hidden-values submission policy and field-only include-hidden override, and project the override onto each concrete field instance. This does not activate omission or change default submission.

### Patch Changes

- b4340af: Certify existing typed descendant diagnostics from uniquely bound object fields against the callback's draft or FINAL candidate data, without making unknown sibling data eligible for omission.
- 08c1a2b: Preserve original certified scoped-issue evidence through a metadata-only guarded submit checkpoint and bind it to the real checked final omission and attempt-owned validation generations. Snapshot both generation lanes before pipeline hooks so competing validation cannot claim the attempt's FINAL transitions. This private receipt does not activate omission or change default submission.
- ba13b66: Connect prepared definition-bound omission projections to the private guarded candidate checkpoint and preserve its single checked final witness for later submit work. No public submit activation is added.
- be5b55a: Provide a private definition/form-bound, single-capture omission supplier and final structural checker seam without enabling hidden-value submission or changing the default submit path.
- Updated dependencies [cbb9d59]
- Updated dependencies [7698998]
- Updated dependencies [0ed966b]
- Updated dependencies [1bf5761]
- Updated dependencies [08c1a2b]
- Updated dependencies [439a847]
- Updated dependencies [75454ce]
- Updated dependencies [ed3d7c3]
- Updated dependencies [ba13b66]
- Updated dependencies [be5b55a]
- Updated dependencies [10b4eaa]
- Updated dependencies [cd7009c]
- Updated dependencies [81c9913]
- Updated dependencies [ca15dcb]
  - @formbar/core@1.0.0

## 0.22.1

### Patch Changes

- 599f707: Bound concrete ownership overlap lookups during nested-row projections without changing fail-closed binding semantics.

## 0.22.0

### Minor Changes

- cc416cd: Let trusted definition-scoped sync callbacks validate a guarded final candidate with its captured UI, stage and submit context. Preserve original certified issues across same-form attempt metadata writes while invalidating stale ownership on data, UI and lifecycle changes. The guarded candidate helper is not yet called by the public submit path; this does not enable hidden-field omission or scoped async validation.

### Patch Changes

- Updated dependencies [cc416cd]
  - @formbar/core@0.22.0

## 0.21.0

### Minor Changes

- 4ad7834: Add opt-in, definition-field-scoped synchronous draft validation through prepared schema forms, including deferred React construction and concrete typed field bindings. Submission and async validation are unchanged.

### Patch Changes

- Updated dependencies [4ad7834]
  - @formbar/core@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [ef1c667]
  - @formbar/core@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [8bb23bd]
  - @formbar/core@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [5faa6a5]
  - @formbar/core@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [6cfe157]
  - @formbar/core@0.17.0

## 0.15.1

### Patch Changes

- 66527c7: Bound each concrete action queue to 32 waiting intents so a stalled host handler cannot retain unbounded pending executions.

## 0.15.0

### Patch Changes

- Updated dependencies [b998e2b]
  - @formbar/core@0.15.0

## 0.14.3

### Patch Changes

- ae3c091: Select CJS declarations for require consumers and ESM declarations for import consumers via paired conditional type exports (#154).
- Updated dependencies [ae3c091]
- Updated dependencies [1ceb6f1]
  - @formbar/expressions@0.14.3
  - @formbar/core@0.14.3

## 0.14.2

### Patch Changes

- 87071ad: Publish source-free package artifacts with synchronized licenses and validated self-contained source maps.
- Updated dependencies [87071ad]
  - @formbar/expressions@0.14.2
  - @formbar/core@0.14.2

## 0.14.0

### Minor Changes

- e12e761: Add the bounded default-profile `sumBy` collection projection and support it in declarative output nodes.

### Patch Changes

- Updated dependencies [e12e761]
  - @formbar/expressions@0.14.0
  - @formbar/core@0.14.0

## 0.13.0

### Minor Changes

- bea9fd1: Add form-backed repeater projection, generated actions, constraint guards, scoped React rendering, and stable renderer-private row coordination. Preserve nested field metadata when moving array items.

### Patch Changes

- Updated dependencies [bea9fd1]
  - @formbar/core@0.13.0

## 0.12.0

### Minor Changes

- ce05dcf: Add serialized declarative actions with core-authoritative built-ins, abort-safe instance concurrency, trusted host handlers, and accessible React action controls.

### Patch Changes

- Updated dependencies [ce05dcf]
  - @formbar/core@0.12.0

## 0.11.0

### Minor Changes

- ea15d6b: Add pure declarative output evaluation with strict built-in format IDs and semantic accessible React rendering.

## 0.8.0

### Minor Changes

- 141ef96: Add deterministic framework-neutral runtime projection, coherent core lifecycle captures, and occurrence-derived schema baselines.

### Patch Changes

- Updated dependencies [141ef96]
  - @formbar/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [23caf3b]
  - @formbar/core@0.7.0

## 0.5.0

### Minor Changes

- 4a581b4: Publish the version 1 serialized form definition, node, binding, action, computation, runtime, renderer, and widget contracts with deterministic all-or-nothing structural validation.

See Changesets-generated release entries for published versions.
