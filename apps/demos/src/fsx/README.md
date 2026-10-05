# Experimental FSX playground

The shared demo catalogue includes two source-first **FSX (experimental)** entries
alongside the JSON Schema demos. Each has a writable Demo preview and source
summary, and the same **Open in Playground** action. The common playground header
groups JSON/schema and FSX examples; switching formats starts the selected preset's
own session and defaults, and **← Demo** returns to that same selected demo.

- `/formbar/?mode=playground&demo=fsx-quote` — native scalar writes, guarded numeric `Output`,
  and a reactive `Conditional`.
- `/formbar/?mode=playground&demo=fsx-line-items` — object rows (`line`) and whole primitive
  rows (`tagEntry`), scoped typed output, host-owned move/remove controls, and
  submission.

These query URLs work with the existing Pages base without server routing.
`?mode=demo&demo=fsx-quote|fsx-line-items` selects the corresponding sidebar demo.
Already deployed `?mode=fsx&demo=quote|line-items` URLs remain aliases and are
canonicalized to the shared playground URL without adding a history entry.
Unknown legacy FSX IDs retain the old fallback to quote; unknown canonical IDs
use the existing first-JSON-demo fallback. Unrelated query/hash/base state is
preserved, but never grants permissions. JSON routes and preset semantics retain
their existing meaning. This feature is **fsx-v1-experimental**, not JavaScript/JSX
or a stable language promise.

The shared shell is navigation/presentation only. JSON Document v1 and FSX source,
models, compilation and sessions remain distinct. **Copy active** copies the last
focused FSX source or initial JSON editor. **Download FSX + initial JSON** exports
the draft strings in an explicitly labeled source/data bundle (even invalid JSON
can be saved); it is not a Document v1 export or a format conversion. FSX has no
Format action. JSON's Schema/Definition/Initial Data tabs and formatting remain
unchanged. Switching examples intentionally retires the old live preview rather
than transferring data or authority between formats.

## Editing and lifecycle

The source editor follows the demo's fixed dark appearance under both light and
dark system preferences. Its app-owned CodeMirror theme draws a bright focused
caret and contrasting selection, with blue host tag identifiers, purple attribute
identifiers and green quoted host strings. Embedded Kalada interiors remain plain
foreground text: this is host highlighting, not guest lexical highlighting.
The source viewport is 28rem tall on desktop and 20–28rem on smaller screens,
with line wrapping and internal scrolling. Wide playgrounds split editor/preview
space evenly while retaining the preview's 32rem minimum; narrower containers
stack them. These presentation choices do not change the reusable editor packages.

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
ranges where available) and keeps the last successful preview active. Primary FSX
errors also get a red underline (a point marker for empty ranges), a lint gutter
marker and a plain-text hover message. This displays the existing failed Apply
result, never a live compiler/provider. Source and initial-JSON bytes must match
the failed Apply snapshot and the mounted editor must have that exact source.
Clicking a valid ranged diagnostic selects its source using the same CRLF-to-editor
UTF-16 conversion as lint. Source transactions (including undo/redo) clear lint
immediately, before React callbacks render; JSON edits, reset, successful Apply
and unmount also clear it. Related locations remain list-only. Missing, invalid,
split-CRLF/surrogate ranges and JSON/preview locations never underline unrelated
FSX text. Failed source never produces a partial form.

The app owns the diagnostic gutter hover separately from ordinary CodeMirror
range hover. Every diagnostic replacement clears its active tooltip and cancels
pending hover work; delayed hover also checks marker lifetime and report generation.
Keyboard focus on a gutter marker shows the same plain-text message. Disposing
the view cancels its pending timer, without dependency patches or live compilation.
Gutter content remains visible while the pointer or focus is on either the marker
or tooltip, with a short grace period for crossing the gap. Escape dismisses it
without moving the pointer; only a new hover/focus interaction can reopen it.
Invalidation clears content immediately even during transfer or tooltip interaction.

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

`compile.ts` calls the public `@formbar/fsx-authoring` entry
with an app-owned strategy and fixed admission policy. Compilation
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
