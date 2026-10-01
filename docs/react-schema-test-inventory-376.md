# #376 React-schema removed-test responsibility inventory (integration HOLD)

## R21 final Validation feedback responsibility (nineteen-suite mapping)

The final first-submit corrective-feedback assertion is covered by
`feedback-attempt-case.mjs`: untouched required `name=""` first authorized invalid
submit publishes original issues and host-owned `submitCount=1` while dirty/touched
and successful `submitted` stay false. Authored/generic/empty feedback and ARIA links
now appear without a writer/blur. Repeated attempts increment independently of
successful submission history; reset clears count/issues and restores untouched
initial feedback visibility. Validation alone does not record a submit attempt.
Attempt metadata is optional for legacy host fixtures (default zero), marked only
after current owned validation finishes and its operation accepts the publication,
before notification. Stale async edits, revocation and missing lifecycle authority
cannot mark attempts or publish stale feedback; hidden fields/nodes remain hidden.
These cases run through actual schema/demo hosts and packed React18/19 consumers.

The original `FormRenderer` semantic-container/Validation assertion and deleted
field-validation/accessibility responsibilities now map to
`kalada-audit-validation-feedback.test.tsx` and shared packed `feedback-case.mjs`.
The historical `ValidationIssues` contract is preserved: authored static `messages`
replace generic text when supplied; `messages: []` renders an empty list, never a
generic fallback. Feedback appears only for the invalid owned field with original
dirty/touched/submitted-or-authorized-attempt visibility and both field/Validation visibility satisfied.
Valid/reset/hidden fields do not show the authored error.

Admission resolves Validation binding + lexical scope to exactly ONE admitted field
resource. Missing ownership refuses `VALIDATION_FIELD_MISSING`; duplicate same-binding
ownership refuses `root.children[2].binding: AMBIGUOUS_VALIDATION_FIELD` in the regression
fixture. Concrete repeated aliases use the host's stable lexical row/control key,
not a rendered position. Deferred resolution is declaration-order independent and
reuses the SAME authorized field lifecycle object, with original schema/extension
issues and metadata unchanged. No lifecycle request is made for a Validation
declaration path, and no equal-path exemption/provenance rewrite is introduced.

Actual public schema factory and demo hosts cover initial valid→invalid edit plus
host validation→`Correct the name`→reset, generic/empty arrays, Validation-before-field,
independent same-path issue preservation and submit denial, field/feedback visibility,
nested repeated aliases, valid other-row isolation, forged token/name refusal, stale
frames/writers and exact denied/stale lifecycle diagnostics. Authored feedback is a
separate polite live list associated by `aria-describedby`; original field issues,
error summaries and FINAL validation remain authoritative. Empty feedback does not
replace the original field issue association.

Actual seven-package React18/19 consumers run the same installed-host cases with
app-relative fixture code bundled and package imports external. R1–R20 remain
enabled. This closes the final feedback implementation gap in the nineteen-suite
responsibility map; final Auditor verification/certification is still required.
Published dependency release HOLD (#317) remains separate, and FSX (#305) is outside
this candidate.

## R19/R20 inert initialization and caller-owned subtree equivalents

The deleted `schema-initial-data.test.tsx` assertions “never reads accessors and
rejects unsafe callers” and “uses own caller presence, not truthiness or recursive
fill” map to `kalada-audit-initialization.test.ts` and shared actual-host
`initialization-case.mjs` / bundled `initialization-fixture.ts`.

Public `createKaladaV1Host` and `createKaladaSchemaForm` capture defaults/overrides
before strategy identity/initialization calls. Actual Formbar `copyJson` supplies
bounded descriptor-based data capture; accessors (including option/default value
accessors), cycles, sparse arrays, unsupported prototypes, undefined/functions/
symbols/BigInt, NaN/Infinity and budget overflow refuse without stringify coercion.
Getter regressions count ZERO calls and ZERO host identity/initialize calls.
Authorization instance/revision envelopes are never JSON-copied: the direct real
initializer test uses a Map/function instance and Symbol-bearing revision identity.

The real demo initializer stages a detached store candidate and baseline plus a
detached trusted Arbiter projection. Schema paths and types are verified without
mutating live data. The final synchronous commit rechecks session activity, exact
context/revision and a monotonic revoke epoch. Revocation followed by artificial
reactivation/restoration of the old revision still refuses. Rejected input/default/
type/path/revision cases preserve live data/baseline identity, issues/status,
controllers, field/row metadata and notification counts. Successful initialization
publishes only the completed data+baseline+revision state and retires prior metadata.

Defaults apply to missing schema-owned locations first. Caller-owned top-level
subtrees then replace the corresponding default subtree WHOLESALE: `{address:
{city:"Lyon"}}` has no inherited Paris zip, and own false/0/empty string/null/empty
array survive submit and reset. Caller `{address:{}}` and `{rows:[{}]}` are not
recursively backfilled. Nested schema defaults may create missing schema-owned
objects; row-template `*` defaults fill only materialized schema-owned rows before
caller replacement. They never manufacture rows from an item default/minItems.
This explicitly documented V1 descriptor behavior is not a claim of all historical
shallow-default semantics. Own undefined is intentionally non-JSON and rejected;
unsafe/malformed defaults refuse instead of legacy warning-and-skip behavior.

Caller drafts remain allowed to be constraint-invalid (e.g. existing demo16 blank
enum placeholders), while unsupported types fail initialization and defaults must
have valid declared types/domains. Schema/FINAL validators remain submission
authority. The same public factory/host and real app initializer cases run in actual
seven-package React18/19 consumers with app-relative code bundled and package imports
external. R1–R18 remain enabled; this is final-review-ready candidate evidence, not
Auditor certification or release authorization.

## R18 authored demo21 property-policy regression

Trusted installation now collects `visible`, `required`, `disabled` and `readOnly`
management separately, from actual Boolean directive properties at the declared
flat field path. Required-only rules never seed or inject a visible gate. Demo18's
actual visibility management keeps its false/reset behavior; demo21's section
conditions independently own visibility. Authorized canonical `fieldRequired:<name>`
UI gates project required cues. Existing visible conditions are conjoined; authored
required/disabled/readOnly restrictions are retained with Boolean OR and cannot be
weakened by a false managed flag. Only managed property keys are reset/projected.

`kalada-audit-required-policy.test.tsx` and shared `sections-case.mjs` install the
REAL demo21 schema/definition/rules through `installDemoSession`. Auto→Home→Life→Clear
checks selected field presence, native `required`/`aria-required`, inactive branch
absence and retained draft, current typed writers and stale branch refusal. Separate
cases verify disabled/readOnly independence (no visibility suppression or write grant),
property reset on Clear, and profile removal/reinstall with stale callbacks denied.
An explicitly missing authored required UI operand refuses at
`root.children[1].then[0].then[0].children[0].required: KALADA_OPERATOR_TYPE`.

The original demo21 schema makes required cues presentation-only: browser checkbox
validity is not host authority. Its original schema-valid draft can submit even when
a native required checkbox is unchecked. Trusted validator variants test exact
`Selected make is required.` / `Selected address is required.` errors and successful
zero/false values; omit-inactive validates both full draft and FINAL candidate while
preserving inactive draft. An independent schema variant rejects hidden invalid data
with `Must contain at least 3 character(s).`. Neither path calls browser form validity.
No dynamic schema constraint or authored JavaScript handler is silently introduced.

Packed React18/19 consumers bundle only app-relative fixture/installer code using
`--packages=external`; Formbar/Kalada dependencies resolve from the actual installed
seven-package tarballs. They run the same demo21 transition, required/schema/FINAL,
restriction, missing-cue and profile-reinstall cases. This is supplemental R18 proof,
not Auditor verification or completion of the remaining schema/default equivalence
mapping. R1–R17 remain enabled and release remains held.

## R16/R17 scaling and concrete repeater focus equivalents

`kalada-audit-repeater-parity.test.tsx` and shared installed-host packed fixtures
`repeater-case.mjs`/`repeater-fixture.mjs` restore deterministic SSR scaling coverage
for 100/200/500 rows × five fields, plus five outputs per row. The renderer builds
control/output Maps once per view, rejects duplicate/invalid keys, verifies expected
control/output identity and performs one keyed lookup per rendered field/output.
The old triangular control inspections 125250/500500/3126250 become exactly
500/1000/2500 index entries and 500/1000/2500 lookups. Outputs have identical linear
counts. Tests fail if the renderer calls array `.find`, and negative installed-view
tests reject missing expected keys. These are operation counts, not wall-clock gates.

Each SSR render takes one host snapshot, one array enumeration and one submission
capture. Existing checked row-writer installation still takes one proof capture per
field: total strategy captures 501/1001/2501. This authority proof is explicitly
counted, not bypassed or concealed. Index creation and output lookup add no runtime
captures. The fixture owns a primitive row array, with five distinct field nodes
and optional five distinct Output nodes per row; repeated bindings grant nothing.

The deleted `repeater.test.tsx` move-button focus, append/inserted-row focus,
remove/next-surviving-row focus, exact-append final-row fallback, nested same-binding
fallback and missing/disabled append container fallback now run through real V1
atomic array actions. Additional cases cover swap focus, same-binding sibling
repeaters without wrapper separation, nested duplicate repeaters after outer-row
reorder, host denial without draft/focus change, and delayed results after unmount,
disposal or a newer mutation. All cases also run in installed seven-package React
18/19 consumers. Existing R1–R15 tests remain enabled.

Presentation association uses admitted static lexical array identity, concrete
repeater instance key and stable host row keys. A per-form registry owns direct
container/row/native-control/exact-append refs; it performs no cross-component DOM
search. Successful atomic array actions carry only a presentation commit-revision
receipt. Focus waits for that same view to commit, rechecks current installation
revision and latest ticket, then focuses the inserted/surviving logical row or the
clicked move/swap button. No row means the exact enabled append in that scope,
otherwise the concrete repeater container. Numeric positions select visual fallback
only, never writer ownership. Nested append/insert retain their parent lexical scope
instead of misidentifying the parent row as the target array's item. Ref cleanup
retires obsolete rows/scopes, and stale/disposed/unmounted receipts cannot steal focus.

## R15 extension recovery assertion equivalents

The deleted `widget-registry.test.tsx` assertion “retries failed widgets only when
a composite recovery input changes” and `custom-node-registry.test.tsx` assertion
“retries failed custom nodes for normalized props, renderer IDs, and implementation
changes” are exercised by `kalada-audit-extension-recovery.test.tsx` and the shared
installed-host `tests/consumers/formbar-kalada-v1/recovery-case.mjs` fixture.

For widget and CUSTOM renderer: initial render throws without writing; unchanged
parent rerenders, unrelated field writes and lifecycle-only validation changes do
not increase attempts. Widget value correction and CUSTOM normalized current/fail
prop correction retry in the same installation. Authored literal fail:true→false,
lexical binding and renderer-ID replacements are fresh immutable V1 installations
under the same React control key/component. Corrected input recovers, current
committed writes apply to the intended binding, and every leaked failed writer is
revoked. Same-host implementation replacement recovers without a semantic data
change; layout/passive cleanup and unmount channels cannot mutate.

Snapshot regressions isolate the data equality signals: actual normalized JSON
props (including nested key-order equivalence), value presence/value, renderer ID,
field/CUSTOM type, source path/node ID, logical host row/control key, field binding
or CUSTOM READ programs/WRITE references, label and policy flags. Trusted component
and installed host identities are compared separately, never serialized. Frame,
writer, lease, React children, lifecycle metadata and JSON object identity are not
recovery inputs. Accessors are rejected without executing them. Bounded immutable
JSON copies produce exact canonical strings, not lossy hashes.

The packed React18/19 lane executes the same recovery cases plus StrictMode
SSR/hydration: no hydration errors, render/layout channels uncommitted, data unchanged
before child commit, current committed writes successful, and unmount revocation.
Activation belongs to the committed editor inside Suspense, not its independently
hydrated parent. Existing R1–R14 tests remain enabled; isolated read-only presentation
fixtures gained lexical definition data only and still issue no authority grants.

## R14 native-widget assertion replacements

`apps/demos/src/__tests__/kalada-audit-native-constraints.test.tsx` uses installed
V1 schema hosts (actual generation with no authored definition, and authored
layout with explicit literal precedence). It replaces the deleted native suite's
text/textarea/number/select/checkbox/radio/date/time/email/url/tel/password/search,
formatted text and integer type matrix; min/max/step and text constraints;
string/temporal edits; typed choice changes; numeric/temporal/select empty-null
semantics; and the full supported/rejected temporal display-value matrix.
Additional safety cases cover decimal `1.5` with default `step="any"`, integer
step `1`, exact malformed/injected/oversized constraint refusals, unchanged draft
on nonfinite writer attempts, and DOM-valid authored presentation with schema-invalid
submission. The time widget fixture deliberately uses a widget hint, not the
unsupported JSON validator time format, so numeric submission refusal tests real
schema validation rather than an unavailable validator.

`tests/consumers/formbar-kalada-v1/native.mjs` adds installed seven-package
React 18/19 constraint checks to the guarded packed-consumer lane. This coverage
does not itself declare R14 verified; retained green candidate evidence is required.

The nineteen deleted legacy-positive suites below are **not** equivalent to the two
remaining positive suites. The old FormApi/Kuery harness cannot be retained as a
public success path. Each responsibility needs a real installed Kalada V1 host,
or an exact fail-closed rejection where the contract no longer admits the feature.
The twentieth deleted file, `renderer-test-utils.tsx`, was a helper: its FormApi fixture must not become a
permissive replacement host.

| Removed suite | Responsibility | Current replacement / gap |
| --- | --- | --- |
| `a11y-wiring.test.tsx` | label, described-by, summary focus and issue linkage | `form-renderer.test.tsx` checks label only; summary/focus gap |
| `action-renderer.test.tsx` | action availability, dispatch and disabled states | legacy actions unavailable; exact rejection and host submission checks needed |
| `bound-omission-hook.test.tsx` | omitted outgoing candidate, retained draft and handler gating | omission unsupported; host whole-data submission covered in `form-renderer.test.tsx`, explicit omit rejection needed |
| `custom-node-registry.test.tsx` | trusted renderer registration, READ/WRITE, missing renderer | READ/WRITE positive in `form-renderer.test.tsx`; missing renderer rejection needed |
| `direct-options-interop.test.tsx` | enum/option identity and disabled choice | host-backed option controls needed |
| `native-widgets.test.tsx` | text/boolean/select/numeric native control behavior | text positive only; Boolean and unsupported numeric negatives needed |
| `omission-renderer.test.tsx` | hidden-field visibility, outgoing validation and focus | omission unsupported; exact reject needed, no privacy assertion inferred |
| `output-renderer.test.tsx` | read-only Output.value and snapshot reactivity | `form-renderer.test.tsx` exercises text Output.value update; object/null and write refusal needed |
| `renderer-reactivity.test.tsx` | subscription and revision updates | text/Output update in `form-renderer.test.tsx`; disposal and stale capture needed |
| `renderer-ssr.test.tsx` | SSR and hydration identity | host-backed SSR/hydration gap |
| `repeater-a11y.test.tsx` | row label/error identity | nested token control in `form-renderer.test.tsx`; row a11y gap |
| `repeater-duplicate-binding.test.tsx` | duplicate owner/write rejection | exact-path negative gap |
| `repeater.test.tsx` | stable row identities/reorder/removal and writes | `form-renderer.test.tsx` nested token/stale callback fixture; active post-reorder row write gap |
| `schema-initial-data.test.tsx` | initial values and reset | host snapshot initial value positive; reset unsupported, explicit reject needed |
| `schema-validation-hook.test.tsx` | validation and submit failure gating | host submit success positive; blocking failure gap |
| `tabs-accordion-a11y.test.tsx` | tabs/accordion keyboard and ARIA | layout unavailable; exact fail-closed gap |
| `typed-enum-interop.test.tsx` | typed enum choice/value fidelity | host-backed typed choice gap |
| `use-schema-form.test.ts` | hook lifecycle, form identity and submission | `migration-rejections.test.ts` checks legacy rejection; positive host hook gap |
| `widget-registry.test.tsx` | widget registration and missing widget behavior | native text positive; registry availability negative gap |
Action handler error/abort transitions from `action-renderer.test.tsx` also
remain uncovered: host submit failure and denial checks are needed. This inventory
does not declare #376 implemented. Next coding owners: React-schema tests own
host-backed accessibility/registry/SSR/validation/identity replacements;
from-schema tests own canonical generated definitions and remaining legacy
positive migration; demos tests own the temporary fail-closed notice contract.

## Batch 4B2 diagnostic run (not a release gate pass)

Pinned core `1ed0ec83a7673dffa2ae3cda062e5c4176b4143a`, syntax and
provider-routing archives verified against the hashes in
`scripts/kalada-preflight/overlay.mjs`. One guarded overlay invocation logged to
`dist/kalada-preflight-logs/formbar-316-overlay-1790678831656-1335661.log`
(SHA256 `1e845b6c733ecfd8742f4a3d07743368a564b219e185aa6c435975a11177ae84`).
Source digest before and after restoration was
`443f3a7d0956869205ab88f446920e0825bc152debc8a32c2d3ef76f1e291b5f`.
Focused preflight and declarative lanes, lint and build passed. Schema scoped
failed (174 tests; full test names in the retained `formbar-316-failed-UtwXDZ/stderr.log`),
broad failed (details in `formbar-316-failed-OcV3nH`); packed ESM/CJS consumer
was blocked. A later edit to the nested row test and generated-definition
expectation has **not** been verified against candidate: do not treat this run
as a test of those edits. Published-core 0.1 restored baseline fails due to
missing V1 exports (#317); independent legacy demo positives also fail. Major
changesets for the three publishable packages are in
`.changeset/public-kalada-v1.md`. #412 tracks replacing the temporary demo
notice with a writable host strategy before a user-usable RC.

## Current #376/#412 correction coverage (September 30)

The inventory above records the earlier checkpoint, not current parity acceptance.
No legacy suite was deleted or skipped in this correction. Existing deletions remain
subject to audit; the following installed-host coverage is supplemental, not a
claim that every removed assertion has been replaced.

| Responsibility | Current executable coverage | Remaining audit requirement |
| --- | --- | --- |
| Canonical arithmetic and branch programs | `apps/demos/src/__tests__/kalada-demo-host.test.tsx` checks current subtotal and bulk branch, retained draft and retired writers; `runtime-demo-calculations.test.tsx` exercises demo 19 through the renderer | Order-entry final submission is still a separate failing broad gate |
| Aggregate JSON output | `kalada-demo-calculations.test.ts` checks finite amounts, missing amount identity, invalid JSON/type refusal, overflow and no input mutation | Installed `lineSubtotal` is app-owned, not a new Kalada operator or data field |
| Nested primitive row writers | `kalada-primitive-risk.test.ts` checks nested whole-item write, unchanged row identities, stale/wrong-type refusal, separate-instance draft and revoked callbacks | Reorder/remove/replacement and forged cross-instance requests still require full adversarial matrix; separate-instance independence is not forged-request proof |
| Omission and final validation | `packages/from-schema/src/__tests__/omission-supplier.test.ts` checks hidden field absence, denied outgoing validation, same-host show transition, visible control and unchanged draft | Visibility is a canonical authorized UI read; host inventory and read rotate at the same revision. This fixture is not an ordinary server-security claim |
| Native controls and presentation | `kalada-native-controls.test.tsx`, `kalada-presentation-409.test.tsx`, preflight generated/public React and component suites | Audit exact label/error/focus, SSR/hydration, keyboard and registry assertion mapping against removed suites |

Both source issues remain in-progress until broad candidate, complete risk matrix,
code-size/function decomposition and packed consumer gates are green. Major
Changesets are retained. Published core 0.1 missing V1 exports remains #317, not a
candidate defect. Kalada PR63 remains held; this correction authorizes no release.

## Remaining demo parity correction (#376/#412)

The preceding gaps are historical checkpoints, superseded by this correction's
guarded candidate results and the issue evidence notes. No additional legacy
suite was deleted, skipped, or replaced with a permissive host.

| Responsibility | Added/restored behavior and evidence |
| --- | --- |
| Trusted widgets/options | Installed schema hints and authored overrides retain their separate precedence. Color/checkbox widgets receive typed enum choices and labels; rich-select respects disabled choices. Unknown IDs still expose no interactive fallback (`custom-widget-demo`, `app-route`, `extension-demo-architecture`). |
| Conditional omitted submission | The app independently evaluates admitted canonical visibility/conditions and complete lexical field inventory at the same revision. It checks the observed inventory, derives its own candidate, FINAL-validates it and consumes an instance/revision/draft/candidate-bound one-shot receipt (`demo-submission`, `kalada-demo-host`, `kalada-demo-authority`). Browser observations are not grants; no ordinary server-security claim is made. |
| Current validation/lifecycle | Field writers use current grant, schema type/domain, same-frame flags and owned lexical tokens. Edits invalidate async validation; validation publishes issues; submit/reset preserve successful history. Authoritative action commits do not report their own frame retirement as failure (`runtime-demo-validation-actions`, `kalada-demo-authority`). |
| Primitive and nested row mutations | `kalada-demo-authority` checks reorder/remove, stale and wrong-type refusal, stolen form/scope tokens, reset replacement and revoke→regrant. `kalada-nested-action-risk` verifies nested primitive identity and writable ownership across outer reorder, inner removal and reset replacement. Existing dotted/nonrow and full candidate preflight regressions remain enabled. |
| Committed SSR lifecycle | Arbiter allocation occurs after commit, not server render; pending StrictMode installation is retained and retired hosts revoked. Schema-only SSR/hydration stays interactive (`conditional-plugin-lifecycle`, `playground-lifecycle`). |
| Architecture/diagnostic assertions | Whitespace/name-dependent checks track the refactored installed host. Profile rejection compares exact parsed diagnostic data. Retired `createSchemaForm` positives now use actual installed V1 admission and preserve descriptor evidence/domain assertions. Order tests explicitly select the required payment enum; swap/insert payloads are explicit canonical programs, not a legacy converter. |
| Code budgets | Strategy/store/read/write/lifecycle/inventory/omission/schema/policy are cohesive modules. The static `kalada-demo-code-principles` gate checks production files ≤400 and functions <50, including touched shared action/renderer functions and installation hooks. |

The shared production adjustments are limited to genuine parity defects: action
availability is projected to the button, and an authoritative array/submission/
lifecycle commit is distinguished from stale/replaced callbacks. Major
Changesets remain applicable. No new unrelated package API is introduced.

The first green broad/packed checkpoint was retained at
`dist/kalada-preflight-logs/formbar-316-overlay-1790784899337-237004.log`
(SHA256 `8d8de4f94907392abdbda63399d92efee3df1e60e0d43ae5a5b5fa0883290bf1`,
source digest `50f9af7b005e6765de21aed71089065fd4456ec0a904de41dbbf70a83198451e`).
Later action-budget/lifecycle refinements require the final rerun recorded on
#376/#412; that checkpoint alone does not attest the later bytes. Published-core
0.1 restoration/build failure is tracked independently by #317. No commit,
push, PR, merge or publication is authorized before Auditor.

## Auditor changes-requested remediation R1–R6

The previously green suite counts were not coverage certification. The concrete
audit counterexamples are now tracked by named regressions, not inferred from
the number of replacement suites:

| Deleted responsibility | Exact remediation regression / boundary |
| --- | --- |
| Widget/custom registry hook lifecycle and throwing components | `kalada-audit-react`: actual installed hook widget reorder/show/hide; trusted throw server fallback/hydration retry. Packed `hooks.mjs` repeats both widget and custom-renderer hook lifetime, SSR/hydration, reorder and throw isolation on React 18 and 19. |
| A11y wiring, labels/descriptions/issues/required and custom-node registry | `kalada-audit-react`: associated accessible names, description and issue IDs, invalid/required, live dirty/touched, read-only custom renderer. Live writers and blur stay outside serialized props/definition. |
| Schema validation/async hook lifecycle | `kalada-audit-validation`: actual deferred validation retired by edit/reset/reinstall/dispose; old settlement cannot clear a newer generation. |
| Field metadata, blur and scoped cancellation | `kalada-audit-field-lifecycle`: exact field metadata survives issue replacement; unrelated fields remain unchanged; deferred blur results belong to the exact owner. `kalada-nested-action-risk` also checks metadata follows lexical tokens through reorder and clears on replacement. |
| Omission hooks/renderers and FINAL handler gating | `kalada-audit-omission`: optional inactive invalid owned draft submits valid FINAL output with retained data/issues; independent equal-path and ancestor issues, include directive, and stale/revoked pending FINAL proof all block. No path-only issue suppression or client visibility grant. |
| Public migration/API documentation | `kalada-v1-migration.md` now documents canonical-only public V1, installed host/FormRenderer, generation/scoped ports, provenance-aware omission/FINAL receipt and #317 production HOLD. |

Same-frame metadata observations must not retire a pending action. The prepared
runtime caches only action bindings at the same authority revision and lexical
identity, then retires them on revision change or disposal. The static production
budget gate includes every R1–R6 changed/new production module, including the
prepared projection/runtime and React boundary/association/observation modules.
`kalada-audit-omission` additionally registers the identical schema callback
twice and verifies the independent origin still blocks, despite identical issue
source, path and message. Callback equality is not issue ownership.
The full older deleted-test responsibility inventory remains an Auditor task;
these named regressions do not claim unrelated gaps were proved by suite counts.

## R7–R12 original-assertion equivalents

| Original responsibility | Executable equivalent |
| --- | --- |
| Native/widget observation cannot poison action reads | `kalada-audit-operations`: installed snapshot→blur→reentrant snapshot→array append reads a fresh canonical payload once, retains its manager at the same authority revision, and rejects replay after mutation. |
| Action replace/drop/queue and disposal | `kalada-audit-operations`: public deferred draft and FINAL submissions abort the replaced attempt, latest commits once; drop/queue do not duplicate a retired-frame submission; disposal prevents commit. Existing bounded queue/subscription regressions remain enabled. |
| Deleted widget registry commit-only activation, failed render/lifecycle and unmount cleanup | `kalada-audit-commit-leases`: actual host failed SSR/client render and failed layout setup cannot mutate; committed callback works; old update/unmount cleanup channels are revoked; an already committed editor's throwing own rerender cannot flush its staged intent. Packed `commit.mjs` repeats installed-host lease/no-mutation/current callback/stale cleanup on React 18/19. |
| Actual demo11 positive handler effect and stale cancellation | `kalada-audit-filter-actions`: real Apply filters emits exactly one frozen snapshot after its own checked validation transition; replay/foreign edit cannot emit. The handler receives only a scoped owned-validation port, not unrestricted revision rebasing. |
| Deleted duplicate-form SSR/a11y assertion | `kalada-audit-focus` and packed `commit.mjs`: two forms in one SSR/hydration tree have distinct IDs, stable hydration IDs and labels contained in the corresponding form. DOM namespaces are never write authority. |
| Deleted summary links and first-invalid focus | `kalada-audit-focus`: denied submit links/focuses the first supported current invalid control; links focus that same control; hidden invalid values fall back to the summary and unmounted targets are never focused. |

React extension callbacks are commit-leased intents. A valid committed call can
return `queued` plus a settlement promise; only after failure/cleanup vetoes does
it invoke the unchanged checked host writer. Form submission flushes committed
intents first. SSR/render/setup has no activation; failed/later-retired channels
do not mutate data. React activation is not a host policy, row or revision grant.

The budget test now compares the explicit `kalada-production-inventory.ts`
against git base `d6de555a024053d835827bb4501c63d5cca50da2` plus new source files,
then statically parses EVERY scoped changed production source (not a passing
subset). Missing inventory/source fails. TS/TSX parsing is explicit and checks
accessors/constructors as well as ordinary functions; files ≤400/functions <50.
Small responsibility extractions preserve existing behavior rather than hide
the reported private-runtime/accordion boundary violations.

## R13 original registry/Apply responsibility

`demo-registry-playground.test` again requires every working catalogue example
to parse and successfully Apply with its SELECTED PRESET runtime context. It no
longer treats arbitrary errors outside schema-only mode as acceptable. The sole
explicit negative preset is `custom-renderers:extension-diagnostics`, whose
demo16 owner intentionally declares unregistered widget/renderer IDs; its exact
missing-registration refusal is checked separately, never auto-granted.

`kalada-audit-playground-context` checks untouched and label-edited Apply for
demo16 schema hints/authored widgets, all custom-layout variants, real demo11
actions and all Arbiter presets. It also checks retained live draft versus
authored Initial Data replacement, stale callbacks after Apply/preset switch,
unknown selected profiles and authored unknown-renderer refusal. The actual
`PlaygroundPage` Apply regression verifies custom widgets stay installed and
user-edited data survives an unchanged Apply.

Trusted profile IDs, initial UI state, rules and action-control choice are frozen
session metadata, separate from JSON editor sources/storage/downloads. Parse,
preflight and renderer all use that selected context; no authored renderer name
or JSON property selects capabilities. Apply increments the cancellation
revision; invalid Apply retains the live session. Only unchanged data contract
and authored Initial Data may retain a live draft, including UI-only schema
annotations; schema/data changes and reset intentionally reinitialize.
