# @formbar/react-schema

React preparation and native rendering for schema-compiled forms.

```tsx
import { jsonSchemaProvider } from "@formbar/from-schema";
import { FormRenderer, useSchemaForm } from "@formbar/react-schema";

function SchemaForm() {
	const prepared = useSchemaForm(schema, {
		provider: jsonSchemaProvider(),
		side: "input",
		initialData: {},
	});
	return <FormRenderer {...prepared} />;
}
```

`useSchemaForm` requires an explicit Scheman provider and `input`/`output` side. It returns a core form, neutral descriptors, a validated FormDefinition, its occurrence-derived declarative runtime baseline, separated diagnostic channels, and derived preparation warnings. A retained Standard Schema handle is installed through core's executable `validators` path alongside, but independently from, caller validators; structural capability is not treated as validation.

`FormRenderer` creates and owns a declarative runtime around those prepared artifacts. It renders the supported group, section, field, conditional, and validation nodes as semantic native controls, while unsupported nodes and bindings remain visible diagnostics. Values, policy, lifecycle, and issues remain core-owned; no renderer registry or runtime injection API is exposed.

Use `@formbar/from-schema` directly outside React, `@formbar/react` for hand-authored React controls, and `@formbar/declarative` to author presentation intent. The renderer deliberately provides no action controls, repeaters, custom registry, styling system, or demo-specific behavior.

See [Schema compilation architecture](../../docs/architecture/schema-compilation.md).
