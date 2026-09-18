# `@formbar/tui` (unreleased)

Private pre-1.0 ESM-only Ink renderer. It exports a process-free editable renderer, synchronous immutable field-adapter
registry, and experimental navigation functions used by the interaction spike. Masked fields are enforced before
custom registry resolution, and unsupported runtime values block interaction until they recover. See
[`docs/tui-architecture.md`](../../docs/tui-architecture.md) for boundaries and release gates and
[`docs/tui-interaction-spi.md`](../../docs/tui-interaction-spi.md) for the experimental interaction contract.

The renderer derives the shared `createFormPresentation` model from the caller's schema result and current form state.
Hidden fields are omitted from rendering and interaction ownership. Visible read-only or disabled fields remain in the
layout but cannot be edited, while value and issue updates preserve the active controller and draft.

The `@formbar/tui` root is process-free. Node terminal composition is available from
`@formbar/tui/standalone` through `renderStandaloneForm` and `normalizeStandaloneInput`. The host requires interactive
TTY stdin/stdout and raw-mode support; non-TTY use fails synchronously. Linux is the automated reference platform,
while Windows terminal behavior remains experimental.

Forms remain caller-owned unless `formOwnership: "host"` is explicit. Host ownership transfers only after Ink starts,
and disposal occurs after terminal resources are restored. Successful interactive submission exits by default; set
`exitOnSubmit: false` to remain mounted. Process signal handling is disabled by default and enabled only through the
explicit `signals` list. Signals request a normal host exit: the host neither re-signals nor changes process exit state.

The standalone local resolver is host policy, not a normative resolver for Ghost or other integrations. It has no
global overrides or application metadata. Do not depend on this package until its private marker is removed for
`0.1.0`.
