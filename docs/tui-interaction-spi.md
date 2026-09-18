# TUI interaction SPI

Status: public experimental interaction contract for `FB-TUI-INTERACTION-SPI`. The package remains private at `0.0.0`.

The process-free `@formbar/tui` root exports a host-injected `ScopedInteractionCapability`, a separate
`TextInputSource`, a private experimental editable Ink renderer, semantic themes, a synchronous field-adapter registry,
and the navigation runtime used by the spike parity fixture. It does not ship a resolver, dispatcher, or terminal host.

## Normative contract

- Targets are local field paths or group IDs. Their strings are opaque logical identifiers; the SPI does not parse,
  normalize, globalize, or attach form/scope identity to them.
- A binding lookup always returns `bound`, `conflicted`, or `unbound`, never `undefined`.
- Each registration method accepts one atomic batch. It either registers the complete batch or throws synchronously
  with no residue. The returned cleanup does not throw, is idempotent, and removes only that batch.
- A capability revision increases monotonically before listeners are notified of a change. `subscribe` does not emit
  an initial synchronization event. Consumers that cannot miss an update read the revision, subscribe, and read it
  again, as required by external-store protocols.
- Registered invocation errors propagate to the host caller. They are not converted to an unhandled result.
- `TextInputSource` carries direct printable and pasted text. Named controls use logical binding resolution instead;
  the two channels are intentionally independent.

Capability, form, schema, layout, text-input, and adapter-registry replacements are lifecycle boundaries. The renderer
cleans all registrations and subscriptions before acquiring replacements. The contract is compatible with
setup/cleanup/setup sequences, including React StrictMode-shaped development lifecycles. Printable text and paste enter
through `TextInputSource`; named controls remain capability-scoped.

## Host-owned, non-normative policy

The contract intentionally says nothing about resolver precedence, scope selection, conflict selection, dispatch
ordering, physical-key decoding, or physical-key-to-logical-input mapping. A host owns those policies and must
document them. The spike memory engine demonstrates only one possible policy and is not exported by `@formbar/tui`.

Ghost likewise owns its layer precedence, overlay and scope activation, expression evaluation, persistence, dispatch,
and physical-key policy. No Ghost-specific behavior or type is implied by this SPI.
