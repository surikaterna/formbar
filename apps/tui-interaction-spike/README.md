# TUI interaction spike

This private app is an editable TypeScript and minimal Ink feasibility proof. It does not define a public package or a
production resolver.

## Normative SPI finding

The public interaction contract and its normative semantics now live in
[`docs/tui-interaction-spi.md`](../../docs/tui-interaction-spi.md). This app consumes those root contract types through
a compatibility re-export; its renderer, resolver, activation, and metadata remain private proof machinery.

The Formbar-facing boundary is `ScopedInteractionCapability`: target and local-action registration, default-binding
contribution, effective-binding lookup, and effective-binding subscription. A host creates and scopes this capability.
Formbar sends only a local action plus a group ID or field path; it neither receives nor supplies a runtime form/scope ID.
`createFormInteraction(layout, capability)` demonstrates that boundary against existing `LayoutNode` trees. It owns a
pure navigation session and dynamically contributes only currently applicable activate, back, and next defaults.
Layout analysis and interaction creation return a discriminated `NavigationResult`; blocking diagnostics contain no model and
perform no capability registration.

Host metadata (`formType` and `placement`) and the private symbol used to associate engine state remain host-side. They
are intentionally absent from the scoped capability.

## Non-normative proof machinery

`createMemoryInteractionEngine` is only legacy deterministic test machinery for embedded renderer scenarios. Its override precedence and conflict behavior
are evidence that the narrow SPI can support isolation, routing, and subscriptions; they are not proposed semantics.
The executable manual instead consumes the real Node-only `@formbar/tui/standalone` host. That package host has its own
local resolver and text source; its policy remains non-normative for Ghost and other integrations.

A future Ghost adapter owns Ghost's layer ordering, overlays, expression evaluation, persistence, physical-key
handling, and other Ghost semantics. This spike deliberately does not recreate them.

## Editable Ink boundary

`FormbarTui` receives a layout, schema result, public `FormApi`, scoped capability, direct text source, and viewport
width. It renders every group and field expanded, the selected group or field, metadata, values, visible issues,
edit/select state, a logical caret, and effective action labels in responsive columns. Labels come from effective-binding
lookup; JSX contains no hardcoded shortcut labels. It receives no host identity or terminal API.
Interaction registration starts only after the renderer commits. A stable numeric external-store revision drives all
form, navigation, issue, and binding updates; changing either layout or capability disposes the old interaction before
replacing it.

## Editable standalone slice

Printable text and paste bypass binding resolution and reach only the active text draft or select search. Named controls
are dispatched through the capability, and select mode gets first refusal. Draft and search carets use grapheme indices:
text inserts at the caret, Backspace removes before it, the action-layer forward-delete removes at it, and Left/Right
move it. Numeric commits
require complete finite grammar and schema bounds. Tab is always handled while editing: a valid draft commits and exits,
advancing when a later field exists, while an invalid draft remains open. The renderer never reads terminal/process APIs
and never disposes the supplied form.

Run the private Node 22 manual from the repository root (direct Node avoids workspace-filter PTY interception):

```sh
node --import tsx apps/tui-interaction-spike/src/manual.tsx
```

Controls: group focus starts on the first non-empty outer group. Arrow keys and Tab wrap groups, Enter enters the group,
and Escape returns field focus to its owning group. Within a group, arrows and Tab wrap only its descendant fields.
Enter activates/commits/accepts, Space activates booleans/selects, and the first Escape cancels an active edit or select.
Backspace removes the preceding grapheme. Left/Right move the caret, Up/Down move select options, printable text searches
or edits, Ctrl+S submits the form, and Ctrl+C exits. Ink-classified forward Delete removes at the caret. The package host
tracks terminal resize and restores raw input; the manual disposes its caller-owned fixture form and prints one
`FINAL_JSON` line.

The automated PTY evidence is Linux-only (`pty`, `ioctl`, and POSIX signals). Terminal rendering can differ by emulator;
the Formbar region itself remains platform-neutral and terminal-independent. The PTY script verifies Backspace grapheme
deletion and Ink-classified forward Delete separately. Some terminal configurations encode the Backspace key as DEL,
which Ink 6 classifies as Delete; this remains an upstream portability limitation.

## Private Web/TUI playground

The Vite page starts in an accessible Web mode and can switch to TUI or a responsive side-by-side Both mode. A runtime
boundary owns one form while the demo `DemoFormView` and lazily loaded `TuiTerminalPanel` receive that same form and
prepared schema. Renderer toggles preserve canonical state and identity; reset remounts renderer-local state without
replacing the form. The terminal panel alone owns xterm, Ink, interaction, input, routing, paste, and resize resources.

The panel mounts the actual `FormbarTui` with Ink's public `render` export and sends Ink's ANSI output to xterm.js.
xterm keyboard data is parsed by the private host and routed directly to the private capability or `TextInputSource`; it
is never sent to Ink stdin. Bracketed paste and browser `ClipboardEvent` payloads have explicit framing and are emitted as
one text event, so embedded controls are never reinterpreted as actions. A trusted Ctrl+V/Cmd+V in xterm uses its custom
key handler and `navigator.clipboard.readText()`, suppressing xterm's duplicate path; permission/read failures are contained
without dispatching input. Native DOM paste remains the platform fallback when the browser performs a paste event instead
of granting Clipboard API access. Set `FORMBAR_TUI_BASE` to configure the production base (default `/formbar/tui/`). Ink and
Yoga use top-level await, so both Vite's development transforms and dependency optimizer target `esnext`, matching the
production build.

```sh
bun run --filter @formbar/tui-interaction-spike dev -- --host 127.0.0.1
bun run --filter @formbar/tui-interaction-spike build:browser
bun run --filter @formbar/tui-interaction-spike scan:browser
bun run --filter @formbar/tui-interaction-spike e2e
```

Vite aliases used by the proof are deliberately explicit:

| Alias | Importer | Reason |
| --- | --- | --- |
| `@formbar/core`, `@formbar/expressions`, `@formbar/from-schema`, `@formbar/react`, `@formbar/react-schema`, `@formbar/arbiter`, `@formbar/tui` | private playground and workspace sources | Consume current workspace source and the demos' private view without changing package exports. |
| `node:process` | Ink, ansi-escapes, is-in-ci | Browser-safe environment and inert default streams; custom streams are passed to `render`. |
| `node:events` | Ink App/contexts | Minimal event emitter required while Ink stdin remains unused. |
| `node:stream` | Ink render, patch-console | `Stream` option detection and an unused `PassThrough` path; console patching is disabled. |
| `node:buffer` | Ink key parser | `isBuffer` compatibility for an unused Ink stdin parser. |
| `node:fs` | Ink error overview | Explicit unavailable-filesystem behavior for Ink's error-only source excerpt path. |
| `node:os` | ansi-escapes | Browser-safe release value for platform-specific escape selection. |
| `module` | stack-utils through Ink error overview | Empty builtin list for browser stack cleanup. |
| `signal-exit` | Ink and restore-cursor | No-op browser lifecycle registration; the host performs explicit cleanup. |

No Ink internal path is imported. The stream adapter runtime-validates every property Ink consumes and contains the sole
type assertion: Node stream types are nominal and cannot be implemented by browser objects, while Ink's public render
contract only consumes this smaller structural surface. The production scanner parses every emitted JS file, independently
validates module syntax, and fails closed on browser-external markers, `require`, nonliteral loading, forbidden bare/Node
edges, unresolved static/re-export/dynamic edges, and gzip JS+CSS above 750 KiB. The Pages workflow copies this successful
build into the existing demo artifact at `/tui/` after the demo build, leaving the demo root intact.

## Navigation normalization demonstrated here

The normalization and group-first session now come from the package's explicitly experimental pre-1.0 runtime exports;
the spike retains no divergent copy.

- Reject duplicate node IDs, duplicate interactive field paths, and field/array nodes whose path is missing or blank.
- Add an implicit root; treat sections and custom containers as transparent.
- Keep all groups visible, but use only non-empty outermost groups as non-overlapping focus boundaries.
- Include nested descendant fields in their owning outer group while skipping empty groups during focus traversal.
- Require Enter even when there is only one meaningful group.
- Collect otherwise unowned root fields into a visible synthetic General group at their first source position.
- Preserve deterministic source order for groups and fields within each boundary.
