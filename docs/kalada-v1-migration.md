# FormDefinition V1 Kalada re-authoring (#376)

The current #376/#412 **candidate public V1 API accepts canonical Kalada programs only**. Bare legacy Kuery expressions, old operator names in a program envelope, dotted-string references and positional row authority are rejected; no converter or dual-engine fallback is installed. This is a breaking replacement of V1 expression slots, not a version-2 converter. The candidate remains **on production HOLD** pending Auditor re-audit and #317 matching published Kalada dependencies plus a clean normal-registry frozen install. Restored published core 0.1 lacks the required V1 exports. `@formbar/react` and `@formbar/core` do not acquire a strategy adapter implicitly.

An old slot such as `visible: { kind: "literal", value: true }` must be re-authored as data:

```json
{
  "visible": {
    "format": "kalada-program",
    "version": 1,
    "profile": "kalada-v1",
    "expression": { "kind": "literal", "value": true }
  }
}
```

A field's value remains a **structured direct reference**, not an expression or a row index:

```json
{
  "type": "field",
  "id": "quantity",
  "widget": "number",
  "binding": { "namespace": "data", "segments": ["quantity"], "scope": "line" }
}
```

For a trusted custom renderer, a computed read and a direct write are separate declarations. Neither serializes a JavaScript callback:

```json
{
  "type": "custom",
  "id": "editor",
  "renderer": "host.editor",
  "props": {
    "current": {
      "mode": "read",
      "expression": {
        "format": "kalada-program",
        "version": 1,
        "profile": "kalada-v1",
        "expression": { "kind": "ref", "ref": { "namespace": "data", "segments": ["quantity"], "scope": "line" } }
      }
    },
    "edit": { "mode": "write", "reference": { "namespace": "data", "segments": ["quantity"], "scope": "line" } }
  }
}
```

`createKaladaV1Host` installs matching artifact/policy identity, complete input schema/path authority, renderer/widget declarations, per-target checked direct-location metadata and source, and a strategy that atomically authorizes reads, stable row-token enumeration, direct writes and revision-bound submission. Public `FormRenderer` receives `{ host, widgets?, renderers? }`, not a legacy prepared form or FormApi. `createKaladaSchemaForm` supplies schema projection/default/validator integration; `createSchemaForm` and the retired schema preparation hook reject use. A row token is logical host identity; its current order is **only presentation order**. Retained callbacks are denied on removal, reorder, revocation or stale form/row revision. No default FormApi mirror, permissive grant, computed inverse or FSX JavaScript handler is installed.

Trusted installations import `KALADA_V1_ARTIFACT` from `@formbar/declarative` and return it from `strategy.identity(context).artifact` alongside the matching policy generation and fingerprint. This pins the candidate artifact without asking applications to hardcode a private hash. The host, not the definition, owns the identity claim; installation still rejects any mismatch. This export is candidate-only until #317 validates the published artifact.

Unsupported field dynamic props fail admission with their exact path and re-authoring guidance; stored computations are checked as a static graph only and never run or write back. Generated array forms show and edit existing host rows but cannot append/remove/move rows without a separate host-owned operation contract. Boolean slots require an actual Boolean at use time; Option/Result, non-JSON, missing, denied, and stale values fail closed. Keep the old Kuery form definition and renderer out of the atomic public V1 cutover; do not expose both as a fallback.

## Native constraints (#376/#412 R14)

Native props are validated literals, never arbitrary DOM props or event handlers.
Number fields admit finite `min`/`max` and positive finite `step` or `"any"`;
the default number step is `"any"`. Schema integer evidence supplies `1`, and
`multipleOf` supplies its step. Date/time bounds must be supported calendar/time
strings with ordered bounds; step follows the numeric rule. Text/textarea admit
nonnegative safe integer `minLength`/`maxLength`, ordered lengths, and strings
bounded to 4096 characters for placeholder/description/format and 1024 for pattern.
Patterns must compile with HTML's `v` flag. Options belong only to select/radio.
Unknown props, wrong types, invalid patterns and reversed ranges refuse admission
at the exact prop/value path. READ/WRITE native props are not supported.

Generated and authored schema hosts supplement missing props with descriptor
evidence; authored literals take precedence. No HTML equivalent is emitted for
exclusive numeric bounds. Textarea pattern and placeholders on select/radio,
checkbox or temporal controls are validated metadata but intentionally have no DOM
attribute effect. Schema validation still applies independently. Schema `time`
format remains outside the existing JSON validator's supported formats; use a
`time` widget hint and a trusted validator when authoritative time validation is needed.

Empty/nonfinite numeric browser input and empty date/time/select changes send JSON
null through the installed writer. Unsupported retained temporal values display
a diagnostic without modifying the draft. Browser `checkValidity`/`reportValidity`
are never submission authority: DOM-valid authored bounds cannot weaken the host's
schema validation, identity, revision, grant or typed write checks.

# #408 validation scheduling

`createKaladaSchemaForm(schema, { definition, ...host })` accepts a canonical authored V1 definition in place of generated layout while continuing to project schema defaults and schema validation. Supplying `generation` alongside an authored definition is rejected. Authored omission and `submitWhenHidden: "include"` are admitted through the same host policy; the host alone captures and validates the final outgoing candidate.

Scoped validators are trusted registrations (`id`, admitted field path, `trigger`, `validate`, optional `debounceMs`) installed on the host strategy. A checked write notifies `onChange` against the new host revision; blur notifies `onBlur` without a draft write. The host is responsible for lexical row membership, touched and issue visibility, replacement by validator ID, and cancellation/fencing on reset, dispose and grant changes. No public V1 default debounce is promised: `debounceMs` is only an optional host scheduling hint, and no React timer grants authority. Missing scoped capabilities fail installation closed.

## Current #412 omit-inactive ownership and FINAL proof

`OmissionRequest` contains `contract: "formbar-lifecycle-v1"`, the exact host instance/revision, `hiddenValues`, and a complete field inventory with lexical row tokens, an observed Boolean `visible`, and optional admitted `submitWhenHidden: "include"`. These observations are **not grants**. The app host independently evaluates the admitted canonical visibility/conditions and current complete field inventory, verifies identity/revision/grant, and derives its own candidate. Missing, forged, mismatched or stale inventory is denied.

Draft validation still runs and records original issues. For authorized omission, draft invalidity alone is not the final decision: only an original issue from the exact installed schema validator at the exact omitted inactive field can be owned for exemption. Independent equal-path or ancestor issues, scoped issues, included hidden values, unavailable validation, and stale/revoked grants still block. The host FINAL-validates the derived candidate and issues a one-shot receipt bound to the instance, current revision, validators, original issue records, retained draft and exact candidate. It rechecks those facts before atomic submission. Omission never rewrites the draft or clears its issues. Remote applications must implement the same authority server-side or deny omission; these browser fixtures make no ordinary server-security claim.

## Trusted React extensions and field lifecycle

Validation nodes bind to one admitted logical field target in the same lexical scope.

Lifecycle `submitCount` optionally records completed authorized submit attempts,
defaulting to zero for older hosts. It is independent of successful `submitted`:
an untouched failed submit can show owned corrective feedback without fabricating
success or touch/write events. Hosts publish attempt metadata with current owned
validation issues only after grant/revision/operation fencing succeeds; reset clears
it. Browser validity and presentation never infer an attempt or grant authority.
They observe that owned field's existing lifecycle; they do not create field resources
at their declaration paths or exempt all issues sharing a data path. Missing/ambiguous
field ownership refuses explicitly. Visible invalid feedback uses authored static
`messages` when present (including empty-array suppression of generic text), otherwise
original schema/extension messages, with original dirty/touched/submitted visibility.
Feedback is accessible associated presentation only: original issue provenance,
field status, grants, summaries and FINAL validation are unchanged. Repeated aliases
retain stable host row ownership; no positional-index authority is introduced.

Initialization data is captured through bounded Formbar `copyJson` descriptors before
host calls. Defaults and overrides must be actual JSON data: getters are never read,
and non-JSON/prototype/cycle/sparse/nonfinite inputs refuse rather than being coerced.
Opaque authorization instance/revision objects are compared by identity, never cloned
as JSON. The demo host stages candidate/baseline/UI locally and checks current grant
epoch and revision immediately before its synchronous atomic commit; refusal leaves
live state and notifications unchanged.

Defaults fill missing schema-owned locations before caller overrides. A caller-owned
subtree replaces its parent default wholesale; child/template defaults never backfill
inside caller-owned objects or arrays. Own false, zero, empty string, null and empty
array remain present through submit/reset. Schema-owned nested defaults and templates
may fill missing locations in materialized schema-default rows only; no rows are
invented from item defaults/minItems. Caller undefined is rejected as non-JSON.
Initialization checks paths/types, while draft constraints and FINAL submission
validation remain independent authority.

Trusted field-policy directives manage their actual Boolean properties independently.
`required` does not imply managed visibility; demo21's native section conditions
control which fields are shown. Required cues use canonical authorized
`ui.fieldRequired:<name>` references and native required/ARIA presentation. Visibility
gates preserve authored conditions by conjunction; required/disabled/readOnly gates
preserve authored restrictions by disjunction. A required cue never grants a writer
or substitutes for schema/explicit host validation and FINAL checks. The original
demo21 required rules remain presentation-only, as documented by that fixture.

Repeater structural focus is presentation-only: admitted lexical array identities
associate actions with concrete repeater instances, and stable row keys plus direct
refs select inserted/surviving rows. Atomic array results may include a commit-revision
receipt; it grants no read/write authority. Focus is applied only after that exact
view commits and while the installation/revision/latest ticket remains current.
Move/swap retain the clicked logical action; an empty repeater focuses its exact
enabled append or its container. Disabled or unrelated same-binding append controls
are never substituted. No authored callback or numeric-index writer is introduced.

Failed widget/CUSTOM renders retry only after semantic projected input changes:
normalized JSON props/value, renderer/type, lexical binding/source/logical row
identity, label/policy flags, trusted component identity, or installation owner.
Equivalent JSON key ordering, new frame/writer/lease objects and unrelated lifecycle
observations do not retry. Recovery uses fresh commit leases and permanently denies
failed channels. JSON comparison uses bounded immutable copies (existing expression
JSON limits per projected value/prop) and exact sorted-key canonical strings; opaque
tokens, callbacks and React children are never serialized for equality. Writer
readiness is activated only after the editor inside Suspense commits, including
selective hydration and StrictMode replay. This remains a veto, not a host grant.

Playground Apply/preflight uses the SELECTED PRESET trusted context (profile IDs,
initial UI state and Arbiter rules) independently of the authored document. That
context is frozen into the session and cannot be changed by editing renderer IDs
or profile-like JSON. Working widget/layout/action/Arbiter presets apply normally;
the explicit demo16 unknown-ID diagnostic remains a fail-closed negative example.
UI-only Apply retains live user data without rewriting authored Initial Data;
successful Apply/preset replacement retires stale editor and runtime callbacks.

Issue provenance distinguishes registration instances even when two validators
reuse the same callback and emit identical source/path/message data. Only the
installed default schema registration is owned; duplicating its callback does
not extend that ownership to an independent registration.

Registered components render as React component boundaries, not function calls. An extension failure is isolated to its boundary; server Suspense fallback and client retry preserve the surrounding form. `KaladaControlProps` supplies live writers/blur notification separately from JSON props, plus accessible label/description IDs, issue association, required/invalid state and field dirty/touched/validating metadata. Components should apply that metadata to their actual controls. No live callback or React component is serialized into the definition.

Validation runs and scoped registrations are host-owned generations. Edits, reset, replacement, revoke and dispose cancel retiring runs; an old completion cannot clear a newer validating state. Field metadata belongs to the exact admitted field and lexical token chain, survives issue replacement/reorder, and retires with removal/reset. Observational metadata notifications do not extend an authority revision or cancel an otherwise current action frame.
