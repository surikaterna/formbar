# @formbar/core

## 1.0.0

### Major Changes

- ca15dcb: Own validation diagnostics at every core store ingress. Mutable caller issues are validated, detached and deeply frozen as new stored values; core-produced scoped issues keep their original certified identity. Unsupported issue graphs now fail atomically instead of entering the store. This is a major compatibility bump because applications relying on `storedIssue === suppliedIssue`, mutable stored issue arrays, or previously accepted non-JSON issue details must migrate to reading the owned issue from `getState()` and supplying plain, dense JSON-compatible diagnostics. Public `normalizeIssues`, `sortIssues` and `dedupeIssues` remain non-owning utilities. Draft validation invocation and default retained-draft submission payloads are unchanged.

### Minor Changes

- 7698998: Connect the private definition-bound checked FINAL submission attempt to the submit handler. Only an explicitly activated, real form-bound omission supplier can hand the handler the same frozen bytes validated by every FINAL validator and authorized by the retained-issue gate. Retained draft and default submission behavior are unchanged; this private integration switch does not expose a declarative omit-inactive mode or claim a callback sandbox.
- 75454ce: Add creation-time `ownedScheduling: true` for eager and deferred forms, including prepared schema and React factories. It validates and owns bounded JSON-compatible initial state before any initialization callback or render-visible snapshot; invalid direct writes reject before pipeline hooks, and invalid trusted callback output cannot publish. Trusted callbacks may still cause external side effects before their invalid output is detected at commit. Default forms retain existing behavior. Accepted writes replace the owned epoch while issue-only publications share it. The legacy trusted-host activation seam remains for existing integrations; caller-owned and prior snapshots remain unfrozen. In opt-in mode, each listener receives the current snapshot at invocation entry (also returned by `getState()` and `captureState()`); its argument becomes historical if its own callback writes. Reentrant commits are synchronous and may coalesce intermediate notifications for later listeners; use the current snapshot rather than expecting every intermediate state. A subscriber that continuously writes can trigger `OWNED_NOTIFICATION_OVERFLOW` after 1024 invocations in one drain, including when invoked by another form's subscriber; already accepted writes remain committed, and subsequent writes can notify again. No omission or release is enabled.
- 10b4eaa: Support trusted definition-scoped async instances on owned forms, with independent change/blur scheduling and guarded full-draft validation. Preserve original certified issues through issue-only publication and validation-status settlement; legacy and candidate validation remain separate.
- cd7009c: Run every configured definition-scoped async instance on the guarded post-egress FINAL candidate alongside legacy validators, even when sync validation fails. Keep candidate issues in the attempt lane and leave retained draft validation unchanged. Pass captured submit stage and context to definition-scoped async callbacks.

### Patch Changes

- cbb9d59: Allow the private bound submit lane to accept a real structurally verified zero-omission witness without bypassing final-candidate checks.
- 0ed966b: Track the exact private guarded FINAL sync and foreground async generation transitions, including unscoped and zero-async candidates, so competing validation cannot masquerade as the same submit attempt. Default validation and submission behavior remains unchanged.
- 1bf5761: Fail closed when independently blocking retained errors survive private final-candidate validation, while accepting only original issues covered by the bound submit receipt.
- 08c1a2b: Preserve original certified scoped-issue evidence through a metadata-only guarded submit checkpoint and bind it to the real checked final omission and attempt-owned validation generations. Snapshot both generation lanes before pipeline hooks so competing validation cannot claim the attempt's FINAL transitions. This private receipt does not activate omission or change default submission.
- 439a847: Settle a pending guarded submit as aborted when its form is disposed during async validation, without publishing late attempt metadata. Unsupported owned-state publications on live forms still fail closed.
- ed3d7c3: Keep opt-in owned scoped captures current while validation-status, owned issue, field metadata, attempt and submission-result publications deliver synchronous snapshots without consuming a semantic write or ownership epoch. Preserve original certified async issues across full-draft validation completion. Generic transactions still conservatively revoke captures; the default form mode is unchanged.
- ba13b66: Connect prepared definition-bound omission projections to the private guarded candidate checkpoint and preserve its single checked final witness for later submit work. No public submit activation is added.
- be5b55a: Provide a private definition/form-bound, single-capture omission supplier and final structural checker seam without enabling hidden-value submission or changing the default submit path.
- 81c9913: Track private scoped capture ownership across the first successful issue-only detachment while rejecting stale writes, failed publication, and external mutations to the captured baseline.

## 0.22.3

### Patch Changes

- 4090575: Isolate trusted internal issue-only publications from caller-owned state without changing ordinary transactions.

## 0.22.2

### Patch Changes

- 7505793: Clear finished or cancelled submit attempts by omitting the optional attempt state, keeping strict TypeScript state typing valid without changing attempt eligibility or retained issues (#265).

## 0.22.0

### Minor Changes

- cc416cd: Let trusted definition-scoped sync callbacks validate a guarded final candidate with its captured UI, stage and submit context. Preserve original certified issues across same-form attempt metadata writes while invalidating stale ownership on data, UI and lifecycle changes. The guarded candidate helper is not yet called by the public submit path; this does not enable hidden-field omission or scoped async validation.

## 0.21.0

### Minor Changes

- 4ad7834: Add opt-in, definition-field-scoped synchronous draft validation through prepared schema forms, including deferred React construction and concrete typed field bindings. Submission and async validation are unchanged.

## 0.20.0

### Minor Changes

- ef1c667: Add optional callback parameters to the exported `FormStore.commitTransaction`, `runVetoHooksSync`, and `runNotifyHooksSync` signatures. The commit callback runs after a dirty state commit and before subscribers; the middleware callbacks checkpoint between synchronous hooks. These signatures support internal guarded submit preparation; this release does not enable a public guarded-submit opt-in.

## 0.19.0

### Minor Changes

- 8bb23bd: Expose a type-only definition-backed submit adapter and structural omission witness for future opt-in integration.

## 0.18.0

### Minor Changes

- 5faa6a5: Expose separately attributed submit-attempt validation metadata and renderable issue/eligibility selectors without changing legacy submit behavior.

## 0.17.0

### Minor Changes

- 6cfe157: Allow internal candidate-only async validation with optional stage and context, without replacing retained draft issues.

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
