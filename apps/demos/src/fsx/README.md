# Experimental FSX playground

The demo app has two source-first examples, separate from the JSON Schema
playground. Open **Experimental FSX playground** from the demo toolbar, or use:

- `/formbar/?mode=fsx&demo=quote` — native scalar writes, guarded numeric `Output`,
  and a reactive `Conditional`.
- `/formbar/?mode=fsx&demo=line-items` — object rows (`line`) and whole primitive
  rows (`tagEntry`), scoped typed output, host-owned move/remove controls, and
  submission.

These query URLs work with the existing Pages base without server routing.
Unknown FSX IDs canonicalize to `quote`; JSON demo/playground routes retain their
existing meaning. This feature is **fsx-v1-experimental**, not JavaScript/JSX or
a stable language promise.

## Editing and lifecycle

Edit FSX source and initial JSON, then **Compile and Apply**. Source-only Apply
preserves the current preview data. Changing the initial JSON explicitly replaces
that data. Source-only Apply captures a detached, bounded draft from the current
installed host and checks target types/shape, not submission validity. Invalid
values (for example a negative quantity or cleared customer name) remain invalid
in the new preview and still block submission. Edited initial JSON instead must
satisfy the fixed schema, including nonempty customer name and numeric bounds.
**Reset example** restores the preset source and data and clears the
submitted payload. The preview's **Reset** resets its own last installed data.
Preview edits update outputs immediately, without compiling again.

### Numeric drafts

Clearing a numeric input stores **null**, not zero, in the strategy-owned model.
The fixed FINAL schemas still require numbers, so blanks deny submission and
edited initial JSON containing null is rejected. Installed numeric read bindings
use the public compiler's `dynamic` type: an exact-number proof would be untrue
for these nullable drafts. Public Kalada conditional expressions guard null before
arithmetic; they show “Enter both numbers” / “Enter amount”, and the bulk condition
short-circuits on null. No runtime numeric conversion or fabricated zero is used.

Source-only Apply uses three distinct app-owned transfer phases:

1. Capture records an immutable deep own-JSON snapshot, separate from the returned
   mutable display/data copy, and binds the live installed origin host/revision,
   fixed schema/preset and form identity. A raw capture token cannot initialize a form.
2. A preflight permit binds exactly one intended document identity, schema,
   definition/data bytes, preset, source text and opaque source-revision identity.
   It checks origin freshness and exact payload bytes without running accessors or
   `toJSON`. Preflight temporary hosts do not redeem a mount grant.
3. Successful Apply redeems the pending permit while the origin is still live,
   then retires the old installation. The accepted destination lifecycle has its
   own owner and grant. Mounts use one-shot invocations; StrictMode/SSR hydration
   replay is limited to that same document/source revision and owner. Reset,
   source/preset replacement and unmount retire the destination and its sessions.

All phases preserve installed model type/shape validation and unchanged FINAL
schema validation. Mutating the exposed capture or returned document data,
cloning the document, changing form identity/preset/source revision, or redeeming
after origin revision change/disposal fails closed. Source-only form-id changes
require a fresh strict initial-JSON installation rather than retained transfer.
JSON and DOM state never install transfer grants. Source correction can retain
null in the same form without reviving a general capability from a closed origin.

Computed preview failures are isolated from the editors. Subscription observation
does not throw into a write; it reports a contextual preview diagnostic. A failed
computed source Apply keeps the previous preview. If an applied computation fails
on a later draft, correcting source can still capture the actual owned model
without evaluating the broken view, and both Reset controls remain available.

An unapplied draft is labeled separately from the applied revision. Failed Apply
shows compiler diagnostics (declaration paths and original half-open UTF-16
ranges where available) and keeps the last successful preview active. Clicking
a ranged diagnostic selects its source. Editing the draft clears old diagnostic
ranges. Failed source never produces a partial form.

Successful Apply/reset creates a new installation and retires old callbacks.
Preset changes retire the previous preview. Existing demo installation retirement
handles StrictMode replay, unmount, and independent form instances. Repeater data
and row identities remain strategy-owned; reorder/remove use atomic host actions,
not positional JSON edits or callbacks built from source.

## Trust boundary

`registry.ts` owns fixed schemas, allowlisted typed references, writable locations
and exact lexical item/property evidence. Editable JSON supplies values only;
unsafe keys and invalid schema data fail closed. No schema/profile/policy editor
or custom renderer is installed here.

`compile.ts` calls the public `@formbar/fsx-authoring` entry (workspace version
`0.1.0-rc.0`) with an app-owned strategy and fixed admission policy. Compilation
may inspect identity metadata, not read/capture/write/evaluate runtime data.
There is no second parser, grammar, or test-fixture authority in the app.

The nonportable validated proof is never cloned or transferred. The portable
compiled definition is re-admitted by `installDemo` in the destination host's own
trusted installation. `array-controls.ts` adds only app-owned standard move/remove
actions and fixed schema bounds; these are not FSX syntax or source-defined
capabilities, and destination admission checks them as well. Destination preflight
and the actual preview are runtime operations, distinct from source compilation.
The preview uses the existing `useDemoInstallation` lifecycle with a trusted
app-only installer, public `FormRenderer`/host, installed renderers, and atomic
demo strategy. Its error boundary leaves the surrounding source editors intact.

Tests cover compiler fail-closed behavior, diagnostic ranges, unsafe JSON, scoped
and primitive writes, reactive reads, stale writers/actions, failed-Apply retention,
reset/data/preset retirement, two-form isolation, SSR/hydration, and real desktop
and narrow-browser navigation/editing/submission. No runtime package or release
contract is changed; this private app-only change requires no Changeset.
