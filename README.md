# Formbar

## Runtime security (CVE-2026-111497)

Use Bun1.4.4 and Node22.23.4 for CI and release provenance tooling. Consumers must also use a patched Node release (22.23.4,24.22.1 or26.12.1 on the supported major) or Bun1.4.4 or newer.

See the [Node October 2026 security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) and [Bun advisory](https://github.com/oven-sh/bun/security/advisories/GHSA-663w-cv8g-jj2p). Rebuild and redeploy affected images and artifacts; existing deployments and previously compiled executables are not updated by this source change.

Shared patched-runtime smoke safely round-tripped HTTP `Content-Encoding: br` through native fetch on Node22.23.4,24.22.1,26.12.1 and Bun1.4.4. This is runtime evidence, not an application-suite or exploit test.

The archived preflight bundle was regenerated with Bun1.4.4; its focused existing reproducibility test passed (1 test,27 skipped). Historical release/QA logs retain their original tool versions and are not new verification claims.


Headless form state, schema compilation, and presentation contracts for TypeScript and React.

## Responsibility matrix

| Category | Owner | Includes | Does not include |
| --- | --- | --- | --- |
| Schema evidence | [`@formbar/from-schema`](./packages/from-schema) | Recursive descriptor documents, constraints, presence, defaults, metadata, provenance, capabilities, source diagnostics, validation handles | Visibility policy, current values, DOM, ARIA, rendering |
| Authored presentation intent | [`@formbar/declarative`](./packages/declarative) | Versioned `FormDefinition`, nodes, bindings/scopes, widget/action/renderer IDs, labels, conditions, outputs, computations | Scheman/provider concepts or resolved runtime state |
| Resolved runtime state | `@formbar/declarative` with core inputs | Current values, visibility, disabled/read-only/required state, issues, lifecycle | Implemented by schema compilation |
| React DOM and ARIA | `@formbar/react-schema` | Production rendering and view identity | App-owned renderer or binding layers |

Other packages remain focused: `@formbar/core` owns headless form state, `@formbar/react` owns React bindings, `@formbar/expressions` owns authorized expressions, and `@formbar/arbiter` adapts Arbitre rules to the core plugin pipeline.

## Schema data flow

```text
schema + explicit Scheman provider + input/output side
  -> @scheman/core SchemaDocument
  -> @formbar/from-schema DescriptorDocument
  -> deterministic validated @formbar/declarative FormDefinition v1
  -> schema-agnostic runtime resolution
  -> @formbar/react-schema React DOM/ARIA rendering
```

The dependency direction is one-way: `from-schema -> declarative`. Declarative never imports Scheman or from-schema. From-schema never imports React, React-schema, Arbiter, or TUI packages.

## Greenfield policy and current demos

Formbar currently has no compatibility commitment to the removed Scheman v1 flat-field, layout, renderer-registry, or state-pruning APIs. They were deleted rather than translated or shimmed. Persisted playground documents use version 2 and older documents are rejected rather than migrated.

The interactive playground covers all 21 numbered demos (26 preset variants) plus a schema-compilation example (27 examples total). Its serializable JSON editors for schema, definition, and initial data feed the production `useSchemaForm` → `FormRenderer` path with validation; executable extensions come only from fixed, trusted host profiles, not editable JSON. This does not promise [composed-schema presentation (#49)](https://github.com/surikaterna/formbar/issues/49) or [stored computations (#129)](https://github.com/surikaterna/formbar/issues/129).

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
