# Formbar

Headless form state, schema compilation, and presentation contracts for TypeScript and React.

## Responsibility matrix

| Category | Owner | Includes | Does not include |
| --- | --- | --- | --- |
| Schema evidence | [`@formbar/from-schema`](./packages/from-schema) | Recursive descriptor documents, constraints, presence, defaults, metadata, provenance, capabilities, source diagnostics, validation handles | Visibility policy, current values, DOM, ARIA, rendering |
| Authored presentation intent | [`@formbar/declarative`](./packages/declarative) | Versioned `FormDefinition`, nodes, bindings/scopes, widget/action/renderer IDs, labels, conditions, outputs, computations | Scheman/provider concepts or resolved runtime state |
| Resolved runtime state | Future #64 with core inputs from #62 | Current values, visibility, disabled/read-only/required state, issues, lifecycle | Implemented by schema compilation |
| React DOM and ARIA | Future #65 | Rendering and view identity | Implemented by `@formbar/react-schema` today |

Other packages remain focused: `@formbar/core` owns headless form state, `@formbar/react` owns React bindings, `@formbar/expressions` owns authorized expressions, and `@formbar/arbiter` adapts Arbitre rules to the core plugin pipeline.

## Schema data flow

```text
schema + explicit Scheman provider + input/output side
  -> @scheman/core SchemaDocument
  -> @formbar/from-schema DescriptorDocument
  -> deterministic validated @formbar/declarative FormDefinition v1
  -> [future #64 runtime resolution]
  -> [future #65 React DOM/ARIA rendering]
```

The dependency direction is one-way: `from-schema -> declarative`. Declarative never imports Scheman or from-schema. From-schema never imports React, React-schema, Arbiter, or TUI packages.

## Greenfield policy and current demos

Formbar currently has no compatibility commitment to the removed Scheman v1 flat-field, layout, renderer-registry, or state-pruning APIs. They were deleted rather than translated or shimmed. Persisted playground documents use version 2 and older documents are rejected rather than migrated.

The demo app is intentionally a **read-only compilation preview**. It displays descriptors, a validated definition, separated diagnostics, and current core data. It does not render `FormDefinition` controls or claim interactive schema-form support; that awaits #64 and #65.

See [Schema compilation architecture](./docs/architecture/schema-compilation.md).

## Development

```bash
bun install
bun run lint
bun run test
bun run build
bun run --filter @formbar/demos typecheck
bun run --filter @formbar/demos build
```

## License

MIT
