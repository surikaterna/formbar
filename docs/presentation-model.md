# Renderer-neutral schema presentation model

Status: accepted first slice for `FB-PRESENTATION-MODEL`, under `FB-TUI-DUAL-PLAYGROUND`.

## Decision

The renderer-neutral presentation model lives in `@formbar/from-schema`. It is derived from an already prepared
`SchemaFormResult` plus a snapshot of UI state and validation issues. It is pure and synchronous: it does not own a
`FormApi`, subscribe to state, ingest a schema, mutate prepared input, or perform renderer lifecycle work.

This placement keeps schema field metadata, normalized options, and layout interpretation together without adding a
UI-framework edge. The intended dependency graph is acyclic:

```text
@scheman/core ─┐
               ├─> @formbar/from-schema <─ @formbar/react-schema
@formbar/core ─┘              ^
                              └─ @formbar/tui

@formbar/core ─> @formbar/react ─> @formbar/react-schema
React/DOM/Ink/application code ─X─> @formbar/from-schema
```

`@formbar/from-schema` imports only public types and behavior from `@formbar/core` and `@scheman/core`; it never
imports React, Ink, DOM helpers, `@formbar/react-schema`, `@formbar/tui`, or a private application.

## Ownership and state precedence

`createFormPresentation(source, state)` returns a new field list, field index, issue groups, and visible layout. The
caller owns both inputs and may discard the result after any state transition. Renderers own subscriptions and decide
when to recompute it.

Malformed prepared sources fail before presentation is derived. Duplicate schema field paths throw a `TypeError`
with `Duplicate schema field path: <JSON-quoted path>.`; a layout `field` node whose path is absent from the schema
fields throws `Layout field path is not present in schema fields: <JSON-quoted path>.`. Validation is deterministic:
schema field order is checked first, followed by layout depth-first order. Messages include only the safely
JSON-quoted path and no field values, metadata, or issue contents.

Every layout node with `type: "field"` must have a string path containing at least one non-whitespace character.
Missing, non-string, empty, and whitespace-only paths throw the fixed safe `TypeError` message
`Layout field path must be a non-blank string.` before field membership is checked. Duplicate schema paths are still
validated before any layout traversal; layout failures retain depth-first order.

Resolved state follows the existing React-schema convention. Dynamic keys are
`<path>.visible`, `<path>.readOnly`, and `<path>.disabled`. A value other than `undefined` is coerced with `Boolean`;
therefore `0` and `""` are false while non-empty strings are true. Dynamic read-only state takes precedence over
public schema `metadata.readOnly`. Defaults are visible `true`, read-only `false`, and disabled `false`. There is no
public static disabled field annotation in the schema metadata contract, so none is invented.

Visibility pruning is immutable. Hidden fields are removed only from the returned layout; they remain in `fields`
and `fieldsByPath` so state, issues, and metadata remain addressable. Containers remain even when all children are
hidden, matching the current React-schema pruning behavior. When the layout root is itself a hidden field, `layout`
is `null`; a renderer requiring a non-null root owns its compatibility fallback.

## Field presentation

Each `PresentationField` carries the public schema type and metadata reference, required flag, resolved state,
prepared options, exact-path issues, and deterministic IDs. Its title uses `metadata.label`, then `metadata.title`,
then the final dot-delimited path segment. Description comes directly from public metadata. Prepared options retain
their array identity, value identity, and schema-defined order; the model does not normalize or reorder them.

Issue ownership uses the canonical data path rendered as `segments.join(".")` and an exact field-path match. Issues
without a matching field, including empty-path form issues, are retained in `formIssues`; they are never dropped or
assigned by prefix. The field, description, and error IDs use the current React helpers' normalization, including
`items[0].name` becoming `field-items-0-name`.

The model exposes only narrow compatibility primitives: field-state resolution, immutable visibility pruning, and
deterministic field/description/error IDs. React-schema now delegates its compatibility exports to these primitives;
its hook still owns subscriptions and non-null root fallback, and its renderer still owns ARIA composition.

## Extraction threshold and renderer strategy

Behavior belongs here only when both React and terminal renderers need the same pure interpretation of public schema
or form snapshots. Framework lifecycle, events, host resources, accessibility attributes, and visual policy stay in
their renderer packages. A second real renderer use, or a demonstrated parity defect between renderers, is the
threshold for extracting additional behavior.

Custom layout node types and custom controls remain renderer-owned. The presentation model preserves layout node
types/props and field metadata without importing a registry or choosing a component. Each renderer maps those public
hints through its own per-renderer registry and reports unsupported controls according to its host contract. No
global or cross-renderer control registry is introduced.

## Dual-playground delivery order

1. Land and audit this pure model in `@formbar/from-schema`.
2. Migrate `@formbar/react-schema` to consume it, retaining React-specific subscriptions and ARIA composition. (Done.)
3. Consume the same snapshot model in `@formbar/tui`, retaining Ink interaction and host ownership there. (Done.)
4. Wire the browser and terminal playgrounds only after both package integrations are independently verified. (Next.)

This order keeps both playgrounds downstream of one audited contract and avoids either renderer becoming the other's
dependency.

## Deferred work

This slice does not define array instance expansion, custom-control execution, asynchronous option resolution,
focus/navigation policy, submission state or commands, renderer subscriptions, or lifecycle. Arrays are preserved as
prepared fields/layout only; indexed ID normalization is supported for compatibility. Those capabilities require
separate issues and renderer-specific acceptance criteria.
