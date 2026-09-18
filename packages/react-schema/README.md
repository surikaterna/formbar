# @formbar/react-schema

Schema-driven React helpers that combine `@formbar/from-schema` ingestion with `@formbar/react` hooks, field-state resolution, layout pruning, and layout-node rendering.

Field-state resolution, hidden-layout pruning, and deterministic presentation IDs are compatibility exports backed by
`@formbar/from-schema`. Existing `resolveFieldStates(uiState, string[])` callers retain the same Boolean coercion and
default behavior.

## Install

```bash
bun add @formbar/react-schema @formbar/react @formbar/from-schema @formbar/core react
# or
npm install @formbar/react-schema @formbar/react @formbar/from-schema @formbar/core react
```

Install Zod only if you ingest Zod schemas:

```bash
bun add zod
# or
npm install zod
```

## Minimal usage

```tsx
import { RendererRegistry, renderLayoutTree, useSchemaForm } from "@formbar/react-schema";

const registry = new RendererRegistry();

const schema = {
	type: "object",
	properties: {
		name: { type: "string" },
		email: { type: "string", format: "email" },
	},
	required: ["name", "email"],
} as const;

export function ProfileForm() {
	const { form, fields, layout } = useSchemaForm(schema, {
		onSubmit: async ({ payload }) => {
			await saveProfile(payload);
			return { ok: true, submitId: "profile-save" };
		},
	});
	const requiredPaths = new Set(fields.filter((field) => field.required).map((field) => field.path));

	return (
		<form onSubmit={(event) => void event.preventDefault()}>
			{renderLayoutTree(layout, registry, {
				issues: form.getState().issues,
				requiredPaths,
			})}
			<button type="button" onClick={() => void form.submit()}>
				Save
			</button>
		</form>
	);
}
```

## Formbar options

`useSchemaForm` forwards the framework-neutral option preparation API from `@formbar/from-schema`. Normalized `x-formbar.options` are available by field path, and structured preparation warnings remain observable without becoming validation issues:

```tsx
const { optionsByPath, warnings } = useSchemaForm(schema, {
	resolveOptionTitle: ({ value, literalTitle }) => (value === "any" ? "All fields" : literalTitle),
});

const scopeOptions = optionsByPath.get("scope");
```

The resolver is synchronous and call-scoped. Consumers render and store each option's typed `value`; `title` is presentation-only. See `@formbar/from-schema` for enum authority, warning, fallback-title, and disabled-option semantics.

## When to use this package

- Use `@formbar/react-schema` when your React forms should be generated from JSON Schema, Zod, or Standard Schema and rendered from Formbar layout nodes.
- Use `@formbar/react` when form fields and layout are authored directly in React.
- Use `@formbar/from-schema` without this package for server-side or non-React schema preparation.

## Dependencies

- Depends on `@formbar/core`, `@formbar/react`, and `@formbar/from-schema`.
- Peer dependency: `react >=18.0.0`.
- Zod remains an optional peer of `@formbar/from-schema` and is needed only for Zod schema ingestion.
