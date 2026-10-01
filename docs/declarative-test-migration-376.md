# #376 Batch 4B1: declarative test inventory

This is a **behavior** inventory, not permission to exclude failing tests. A = re-author
against the installed Kalada V1 host (#184, #305, #316, #291); B = retire old
positive assertions and retain exact-path fail-closed negatives. Until each A
replacement is green, the old file stays in the normal test command; no Kuery
compatibility engine or fixture-generated fake grants may make it pass.

| Old test file | A: replacement obligation | B: old positive to retire / negative to retain |
| --- | --- | --- |
| `action-concurrency.test.ts` | host revision/submission retry and stale callback denial (#291) | action handler queues/abort/reset (#407) |
| `action-queue-bound.test.ts` | host stale-write denial under pressure | queued JS handlers and reset (#407) |
| `actions.test.ts` | host checked WRITE and submission (#316/#291) | handlers, built-in array operations, validation/reset actions (#407) |
| `built-artifact-parity.test.ts` | retain ESM/CJS public export parity | none |
| `computations.test.ts` | static V1 program dependency/graph validation | Kuery graph declarations and live calculation/collection (#409) |
| `definition.test.ts` | V1 admission, paths, widget policy, Boolean slots, direct write proof | Kuery expressions, actions (#407), omission (#408), layouts (#409) |
| `exclusive-binding-decision.test.ts` | direct-path write ownership and stale row evidence (#316) | omit-inactive ownership projection (#408) |
| `expressions-runtime.test.ts` | Kalada program evaluation and denial | Kuery operator compatibility (#409) |
| `field-state.test.ts` | host direct field flags and required Boolean | schema label fallback, plugin lifecycle (#408/#409) |
| `issue-provenance-ownership.test.ts` | host read/write capture and path isolation | old core issue/lifecycle provenance (#408) |
| `kalada-policy.test.ts` | retain private policy safety checks | none |
| `omission-supplier.test.ts` | host whole-data revision-bound submission (#291) | omission supplier, include-hidden and Arbiter projection (#408) |
| `output-runtime.test.ts` | **re-authored** basic `Output.value`, scalar/null/object/ref revision; keep plain output (#184) | old `sumBy`, currency/percent/number and reset/form lifecycle (#409/#408); exact-path format/old-expression denial added |
| `ownership-overlap-index.test.ts` | retain private typed path index safety | none |
| `public-api.test.ts` | retain public boundary, update dependency policy for candidate | old no-Kalada-dependency assertion |
| `repeater-runtime.test.ts` | host enumerated row tokens, scoped native/custom WRITE, stale reorder/remove guards (#316) | array mutation action and min/max action guards (#407) |
| `runtime-adversarial.test.ts` | fail closed on non-JSON/Option and stale read captures | old core snapshot equality/lifecycle (#408) |
| `runtime-ownership.test.ts` | host direct evidence and stable row token paths (#316) | old omission concrete ownership (#408) |
| `runtime-projection.test.ts` | host whole-data submission (#291) | old hidden-value projection/omit-inactive (#408) |
| `runtime-snapshot.test.ts` | **re-authored** host-installed field, flags, WRITE, output | old form lifecycle reference exact-path RE-AUTHOR retained (#408) |
| `runtime-subscriptions.test.ts` | installed-host subscription/dispose/revision updates | old core selector/connection semantics (#408) |
| `scoped-bindings.test.ts` | host row-token scopes across reorder and typed child writes (#316) | index-based lifecycle scopes (#408) |
| `static-references.test.ts` | retain private static StateRef safety tests | none |

`fixtures.ts` and `runtime-fixtures.ts` remain **legacy test-only** and may not
become a public adapter. New tests use `kalada-runtime-fixtures.ts` (real
`serialHost` installation). `#407` tracks actions, `#408` tracks lifecycle and
omission, `#409` tracks formatting/layout/collections. The candidate-scoped
declarative lane is green; this does not make the full candidate integration or
the published-core baseline green, so #376 must not be marked implemented.

`submitWhenHidden: "include"` is admitted only as an explicit whole-data
contract: a hidden field is not rendered, but the installed host supplies its
unchanged value to submission. It does not opt into field-level omission or
override host submission authorization. `submission.hiddenValues: "omit-inactive"`
is rejected at `submission.hiddenValues` (#408). The private
static StateRef checker already tests distinct graph identities for the string
segment `"0"` and numeric segment `0`; no numeric positional WRITE retargeting
is inferred from that read-only key test.

Guarded pinned candidate overlay after Batch 4B1 integration: the scoped
declarative lane (excluding the pre-existing incompatible public dependency
assertion) passed (23 files, 99 tests). The broad candidate lane still fails
(68 files, 466 tests) on old from-schema and React/demo entry points: for example `test/arbiter-policy-equivalence.test.ts`
requires policy-free admission, `packages/from-schema/src/__tests__` still
asserts Kuery definition compilation, and
`apps/demos/src/__tests__/playground-lifecycle.test.tsx` fails to collect when
`createSchemaForm` rejects a legacy definition. These failures belong to the
subsequent compiler/renderer migration; no compatibility adapter or skips were
introduced. The overlay restores manifests, lock and registry config. The
restored old-core full test run fails at module loading (`KaladaV1` missing)
and build (`compileKaladaV1Program` missing): release blocker #317.
