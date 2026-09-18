# @formbar/from-schema

Schema ingestion utilities for turning JSON Schema, Zod, and Standard Schema definitions into Formbar field metadata, validators, defaults, and layout trees.

## Install

```bash
bun add @formbar/from-schema @formbar/core
# or
npm install @formbar/from-schema @formbar/core
```

Install Zod only if you ingest Zod schemas:

```bash
bun add zod
# or
npm install zod
```

## Minimal usage

```ts
import { createForm } from "@formbar/core";
import { createSchemaForm } from "@formbar/from-schema";

const schema = {
	type: "object",
	properties: {
		name: { type: "string" },
		email: { type: "string", format: "email" },
	},
	required: ["name", "email"],
} as const;

const prepared = createSchemaForm(schema);
const form = createForm({
	initialData: prepared.defaults,
	validators: prepared.validators,
});

console.log(prepared.fields.map((field) => field.path));
console.log(prepared.layout.type);
form.dispose();
```

## Renderer-neutral presentation

`createFormPresentation` derives a synchronous renderer-neutral snapshot from prepared schema data and current form
state. It resolves visible/read-only/disabled field state, immutably prunes hidden layout fields, groups issues by
exact data path, and exposes prepared metadata, options, and deterministic IDs without React, Ink, or DOM imports.

```ts
import { createFormPresentation, createSchemaForm } from "@formbar/from-schema";

const prepared = createSchemaForm(schema);
const presentation = createFormPresentation(prepared, {
	uiState: { "email.readOnly": true },
	issues: form.getState().issues,
});

const email = presentation.fieldsByPath.get("email");
console.log(email?.title, email?.state.readOnly, email?.ids.field);
```

Hidden fields remain in `fieldsByPath` but are absent from `layout`. Issues that do not exactly match a prepared field
path remain available as `formIssues`. The function is pure and does not subscribe to or dispose form state; renderer
adapters own that lifecycle.

`presentation.layout` is `null` when its root field is hidden. Malformed sources fail deterministically: duplicate
schema field paths and layout field paths absent from the schema fields throw `TypeError` rather than silently
overwriting or creating partial presentation state. Every `field` layout node must provide a non-blank string path;
missing, non-string, empty, and whitespace-only paths are rejected before schema membership is checked.

## When to use this package

- Use `@formbar/from-schema` when you need schema extraction, schema-backed validators, default values, or compiled layout nodes without React.
- Use `@formbar/core` alone when fields and validation are defined directly in application code.
- Use `@formbar/react-schema` when you want this schema preparation combined with React hooks and renderers.

## Formbar options and JSON Schema `enum`

Standard JSON Schema `enum` is a validation assertion. It remains authoritative for stored values and rendered order. `x-formbar.options` is a Formbar presentation annotation and cannot add, remove, coerce, or reorder enum values.

```ts
import { createSchemaForm, normalizeFormbarOptions } from "@formbar/from-schema";

const schema = {
	type: "object",
	properties: {
		scope: {
			type: "string",
			enum: ["any", "documents", "legacy"],
			"x-formbar": {
				options: [
					{ value: "documents", title: "Documents" },
					{ value: "any", title: "Any field" },
					{ value: "legacy", title: "Legacy scope", disabled: true },
				],
			},
		},
	},
} as const;

const prepared = createSchemaForm(schema);
const scopeField = prepared.fields.find((field) => field.path === "scope");
const normalized = normalizeFormbarOptions(scopeField?.metadata, { path: "scope" });
const preparedOptions = prepared.optionsByPath.get("scope");
// normalized.options stays ordered as: any, documents, legacy.
// The UI title never replaces the stored string value.
```

A structured option record has this exact public shape:

```ts
type FormbarOptionRecord = {
	value: string | number | boolean | null;
	title?: string;
	disabled?: boolean;
};
```

Primitive entries such as `options: ["small", "large"]` remain supported. Matching against `enum` uses exact primitive value and type, so `1` and `"1"` are different. Partial metadata is allowed; unmatched enum values remain available with fallback titles. Duplicate records use deterministic first-wins behavior.

Malformed, duplicate, and unmatched records are ignored and returned as structured warnings. `normalizeFormbarOptions` returns `{ options, warnings }`. `createSchemaForm` exposes normalized choices through `SchemaFormResult.optionsByPath` and aggregated warnings through `SchemaFormResult.warnings`. Every warning has a stable `code`, `path`, `index`, `value`, and `message`; it is not logged and is not a validation issue.

An optional synchronous resolver can supply a title for a call. Title resolution order is resolver result, literal `title`, then `String(value)`:

```ts
const prepared = createSchemaForm(schema, {
	resolveOptionTitle: ({ value, literalTitle }) => (value === "any" ? "All fields" : literalTitle),
});
```

`disabled` is presentation-only, not authorization or schema validation. A UI must prevent newly selecting a disabled option and combine it with whole-field disabled/read-only state. An already selected disabled value remains visible, stored, and schema-valid; it is never automatically cleared. Programmatic form updates and schema validation remain authoritative.

Without `enum`, `x-formbar.options` defines renderer choices and their order only. It does not constrain validation; use a standard schema keyword when values must be restricted.

With Zod, the same annotation flows through Scheman's generic metadata extraction:

```ts
const zodSchema = z.object({
	scope: z.enum(["any", "documents"]).meta({
		formbar: { options: [{ value: "documents", title: "Documents" }] },
	}),
});
```

Formbar intentionally does not inspect Zod internals. With the current Scheman metadata model, metadata attached to a Zod array element schema is not exposed as a field, so primitive-array item options from Zod cannot yet be prepared at `path[]`. Scalar Zod fields continue to work as shown above. JSON Schema array item annotations are prepared because their source structure is public, including supported local `$ref` item schemas.

Objects placed directly in standard `enum` are enum values and are stored as objects. They are not interpreted as Formbar option records; put presentation records in `x-formbar.options`.

## Dependencies

- Depends on `@formbar/core` and `@scheman/core`.
- Peer dependency: `zod >=3.24.0 <4 || >=4.0.0 <5`, marked optional. It is required only for Zod schema ingestion.
