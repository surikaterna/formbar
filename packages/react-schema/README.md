# @formbar/react-schema

Preparation-only React integration for schema-compiled forms.

```tsx
import { jsonSchemaProvider } from "@formbar/from-schema";
import { useSchemaForm } from "@formbar/react-schema";

function PreparationInspector() {
	const { form, descriptors, definition, diagnostics, warnings } = useSchemaForm(schema, {
		provider: jsonSchemaProvider(),
		side: "input",
		initialData: {},
	});
	// Inspect or pass these artifacts to future runtime/rendering layers.
	return null;
}
```

`useSchemaForm` requires an explicit Scheman provider and `input`/`output` side. It returns a core form, neutral descriptors, a validated FormDefinition, separated diagnostic channels, and derived preparation warnings. A retained Standard Schema handle is installed through core's executable `validators` path alongside, but independently from, caller validators; structural capability is not treated as validation.

This package currently has **no renderer**. The former tree renderer, renderer registry/types/built-ins, resolved field state, visibility pruning, and layout exports were intentionally deleted with no private bridge. Runtime resolution awaits #64 and React DOM/ARIA rendering awaits #65. Current demos are truthful read-only compilation previews, not FormDefinition renderers.

Use `@formbar/from-schema` directly outside React, `@formbar/react` for hand-authored React controls, and `@formbar/declarative` to author presentation intent.

See [Schema compilation architecture](../../docs/architecture/schema-compilation.md).
