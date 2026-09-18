# TUI renderer architecture and release contract

Status: accepted productionization contract for `FB-TUI-API-CONTRACT`, `FB-TUI-PACKAGE-SCAFFOLD`,
`FB-TUI-INTERACTION-SPI`, `FB-TUI-RENDERER-LIFECYCLE`, and `FB-TUI-STANDALONE-HOST`.
The SPI and navigation runtime are experimental before 1.0. The package remains private and is not a release candidate.
The implementation in `apps/tui-interaction-spike` remains a behavioral reference; none of it is public API.
The interaction contract and host-policy boundary are specified in [`tui-interaction-spi.md`](./tui-interaction-spi.md).

## Package boundary

One future package, `@formbar/tui@0.1.0`, has two ESM-only entry points:

- `@formbar/tui` is the reusable Ink renderer and its host-facing contracts. It is process-free: no stdin,
  stdout, raw mode, resize listener, process lifecycle, global resolver, or application-specific policy. It must never
  import `@formbar/tui/standalone`.
- `@formbar/tui/standalone` is optional Node/Ink host composition. It owns physical-key normalization, terminal
  resize and lifecycle handling, and the default local resolver policy. It may import the root, never the reverse.

Applications compose the root renderer directly when they own a host. A future Ghost integration owns its adapter
and imports only the root entry. This contract defines no Ghost-specific types or policy. Standalone is a subpath,
not a second package.

## Ownership

| Resource or decision | Owner | Required behavior |
| --- | --- | --- |
| `FormApi` | Caller | Creates and disposes it; renderer observes and invokes it but never disposes it. |
| Prepared `SchemaFormResult` | Caller | Creates and retains it; renderer neither ingests schemas nor disposes caller data. |
| Focus, field presentation, and logical interaction | Root renderer | Uses injected capabilities and reports unsupported input explicitly. |
| stdin/stdout/stderr, raw mode, resize listeners | Host | Acquires, restores, and releases terminal resources on success, failure, signal, and unmount. |
| Physical key decoding | Standalone or another host adapter | Converts terminal input into renderer logical actions. |
| Option resolution | Caller, except standalone default local policy | Root accepts prepared synchronous primitive options; no global resolver exists. Standalone policy is not normative for Ghost. |
| Application adapter and policy | Integrating application | Kept outside this package. |

## Normative and non-normative behavior

“Must”, “must not”, and the ownership and release gates in this document are normative. The API names below are a
normative boundary sketch but remain experimental before 1.0. Visual styling, exact key bindings, copy, spacing,
and the spike's internal navigation/data structures are non-normative reference behavior.

The root must be deterministic from caller-owned form/schema state and injected host events. Unsupported schema
features must produce structured blocking diagnostics rather than silently coercing, hiding, or partially editing
data. The renderer must not log field values or masked input. Debug instrumentation and the spike memory resolver
are not public exports.

## API sketch

```ts
import type { FormApi } from "@formbar/core";
import type { SchemaFormResult } from "@formbar/from-schema";

type TuiRendererInput<TData, TUi> = {
  readonly form: FormApi<TData, TUi>;
  readonly schema: SchemaFormResult;
  readonly onDiagnostic?: (diagnostic: TuiDiagnostic) => void;
};

type TuiDiagnostic = {
  readonly code: TuiDiagnosticCode;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly path?: string;
};
```

The private package exports the editable `FormbarTui` renderer and synchronous immutable field-adapter registry. `normalizeNavigation` and
`createFormNavigationSession` are also deliberately exported as experimental pre-1.0 runtime APIs because the spike
parity fixture must consume the exact package implementation; lower-level mutable helpers remain private. Standalone
resolver implementations remain absent from the root. The root component consumes `TuiRendererInput`. The standalone
subpath exports only `renderStandaloneForm` and `normalizeStandaloneInput` at runtime. It accepts optional explicit
terminal streams, returns an imperative instance synchronously, and keeps form ownership with the caller unless
`formOwnership: "host"` is explicit.

## MVP support matrix

| Capability | 0.1.0 requirement |
| --- | --- |
| String, integer, number, boolean | Required |
| Masked text | Required; never reveal through diagnostics, logs, or snapshots |
| Static selects with primitive values | Required |
| Nested paths, groups, sections | Required |
| Validation display and submission | Required and release-blocking |
| Arrays and multiline editing | Deferred; blocking diagnostic |
| Remote/async options | Deferred; blocking diagnostic |
| Select options with object values | Deferred; blocking diagnostic |
| Date and file inputs | Deferred; blocking diagnostic |

Unknown field/layout kinds are also blocking errors. Prepared static options are synchronous; cancellation,
loading, and failure semantics for async options are intentionally outside 0.1.0.

## Runtime and support matrix

| Dimension | Contract |
| --- | --- |
| Modules | ESM only; no CommonJS condition or artifact |
| Node | `>=20` |
| React | peer `>=19.0.0` |
| Ink | peer `^6.5.0`, matching Ink's React 19 requirement |
| Linux terminal | Automated reference platform |
| macOS terminal | Best effort; manual release check |
| Windows terminal | Experimental; limitations documented at release |

The reusable root may be evaluated in non-Node hosts supported by Ink and must not inspect `process`. The standalone
subpath is Node-specific, requires interactive TTY stdin/stdout with raw-mode support, and rejects non-TTY streams
synchronously before changing terminal state. Distinct stream pairs may run concurrently; either shared input or
shared output is rejected while leased.

## Lifecycle

Mount subscribes to caller state and validates renderer capabilities. Unmount unsubscribes only renderer-owned
subscriptions. It never calls `form.dispose()`. A host that changes raw mode or installs terminal/signal/resize
listeners must restore prior state and remove every listener, including after render errors and interrupted submit.
Submission delegates to `FormApi.submit`; validation and submitting state remain owned by Formbar core. Standalone
exits after a successful host-initiated submit by default (configurable with `exitOnSubmit: false`), but an external
submit does not trigger host exit. Signal listeners are opt-in through `signals`, are always removed, and do not call
`process.exit`, set `exitCode`, or re-signal the process.

## Security and accessibility

- Treat labels, descriptions, validation text, option titles, and user values as untrusted terminal text. Strip or
  neutralize control sequences before output.
- Never include masked values in diagnostics, errors, debug output, clipboard behavior, or test snapshots.
- Do not execute schema content or resolve remote resources in the root.
- Every control needs a textual label, validation association, visible focus, and a keyboard-only path.
- Do not communicate required, invalid, selected, or disabled state by color alone. Respect non-color terminals and
  narrow/resize conditions; announcements must remain understandable in linear output.

## Migration phases

1. **Contract/scaffold:** private package, ESM build boundary, type contracts, metadata and isolation
   tests. The spike remains unchanged.
2. **Interaction SPI and editable renderer:** publish the process-free type boundary, migrate navigation and editing for
   spike parity, and prove committed React/Ink ownership. Validation and submission remain later slices.
3. **Standalone host:** completed Node-only key normalization and terminal lifecycle behind the subpath with
   cleanup/failure tests and a Linux PTY reference check.
4. **Release hardening:** complete validation/submission, supported-field parity, sanitization/accessibility review,
   package-consumer and tarball verification, then remove `private` and set `0.1.0` with a changeset.

## Release gates for 0.1.0

- Root renderer and every required MVP row have behavioral, validation, submission, and unsupported-feature tests.
- Static dependency and built-artifact checks prove the root has no Node/process/standalone edge.
- Standalone raw mode, resize, signal, render-failure, and unmount cleanup tests pass.
- Terminal control-sequence sanitization, masked-value non-disclosure, keyboard access, focus, and non-color-state
  audits pass.
- Linux terminal integration tests pass; macOS manual results and Windows experimental limitations are recorded.
- ESM consumer type/import smoke and packed tarball contents/exports are verified under Node 20 and a supported
  current Node release.
- Public API allowlist and docs are approved; package is changed to `0.1.0`, made publishable, and receives the
  appropriate changeset. No npm bootstrap or release occurs before all gates pass.

The private scaffold enforces export-map consumer compilation, built ESM imports, and an eight-file `npm pack
--dry-run` allowlist. Installing the produced tarball into clean consumers under both Node 20 and a supported current
Node release remains a release-hardening gate; creating that publish-like environment is deferred while the package
is private.
