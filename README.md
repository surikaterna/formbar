# Formbar

Headless, schema-driven form tooling for TypeScript and React.

## Packages

| Package | Description |
| --- | --- |
| [`@formbar/core`](./packages/core) | Headless form state, validation, transforms, middleware, and plugin runtime. |
| [`@formbar/from-schema`](./packages/from-schema) | JSON Schema, Zod, and Standard Schema ingestion with layout compilation. |
| [`@formbar/react`](./packages/react) | React hooks and accessibility helpers for forms built with `@formbar/core`. |
| [`@formbar/react-schema`](./packages/react-schema) | Schema-driven React form hook, layout rendering, and renderer registry. |
| [`@formbar/arbiter`](./packages/arbiter) | Bridge from Arbitre production rules into the Formbar plugin pipeline. |
| [`@formbar/expressions`](./packages/expressions) | Authorized reactive expressions using Kuery's strict whole-AST core. |

Private workspace apps:

| App | Description |
| --- | --- |
| `@formbar/demos` | Private demo app used for local development; not published. |

Use only the packages needed for your stack: `@formbar/core` for a headless engine, `@formbar/react` for React bindings, `@formbar/from-schema` for schema ingestion, `@formbar/react-schema` for schema-driven React rendering, and `@formbar/arbiter` for rule-engine integration.

## Quick Start

```bash
bun install
bun run build
bun test
```

## Development

```bash
bun run dev  # starts demo app at localhost:5174
```

## License

MIT
