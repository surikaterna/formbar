# @formbar/react-schema

Preparation-only React integration for schema-compiled forms.

```tsx
import { jsonSchemaProvider } from "@formbar/from-schema";
import { useSchemaForm } from "@formbar/react-schema";

function PreparationInspector() {
	const { form, descriptors, definition, baseline, diagnostics, warnings } = useSchemaForm(schema, {
		provider: jsonSchemaProvider(),
		side: "input",
		initialData: {},
	});
	// Inspect or pass these artifacts to future runtime/rendering layers.
	return null;
}
```

`useSchemaForm` requires an explicit Scheman provider and `input`/`output` side. It returns a core form, neutral descriptors, a validated FormDefinition, its occurrence-derived declarative runtime baseline, separated diagnostic channels, and derived preparation warnings. A retained Standard Schema handle is installed through core's executable `validators` path alongside, but independently from, caller validators; structural capability is not treated as validation.

This package currently has **no renderer**. The former tree renderer, renderer registry/types/built-ins, visibility pruning, and layout exports were intentionally deleted with no private bridge. Framework-neutral runtime resolution lives in `@formbar/declarative`; React DOM/ARIA rendering remains separate. Current demos are truthful read-only compilation previews, not FormDefinition renderers.

Use `@formbar/from-schema` directly outside React, `@formbar/react` for hand-authored React controls, and `@formbar/declarative` to author presentation intent.

See [Schema compilation architecture](../../docs/architecture/schema-compilation.md).
