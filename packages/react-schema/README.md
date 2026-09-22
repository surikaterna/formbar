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

`FormRenderer` creates and owns a declarative runtime around those prepared artifacts. It renders semantic native controls, labeled `<output>` elements, and built-in tabs and accordion nodes, while unsupported nodes and bindings remain visible diagnostics. Values, policy, lifecycle, and issues remain core-owned.

Output formatting uses fixed `en-US` built-ins: `plain`, up-to-two-decimal `number`, USD `currency-usd`, and fractional `percent` (`0.1` renders as `10%`). Null renders as `Not available`; unsupported values and expression failures render an accessible value-unavailable status. Outputs are read-only projections and never enter core data or submitted payloads. Stored computations remain validation-only until [#129](https://github.com/surikaterna/formbar/issues/129).

Trusted host components can be supplied through one immutable, renderer-scoped registration list:

```tsx
const extensions = {
	widgets: [{ id: "app.rating", component: Rating }],
	nodes: [{ id: "app.card", component: Card }],
} as const;

<FormRenderer {...prepared} extensions={extensions} />;
```

Definitions and schemas contain only allowlisted IDs and JSON props. Components, validators, imports, form APIs, runtime ports, and recursive render callbacks never enter serialized data. Unknown, colliding, invalid, or throwing extensions fail closed with accessible diagnostics. Extension components receive only the typed `WidgetProps` or `RendererContext` contract; custom-node children are pre-rendered by the same renderer traversal.

Use `@formbar/from-schema` directly outside React, `@formbar/react` for hand-authored React controls, and `@formbar/declarative` to author presentation intent. Registrations are local to a `FormRenderer`; there is no global registry, remote loading, built-in override, runtime injection, styling system, or demo-specific behavior.

See [Schema compilation architecture](../../docs/architecture/schema-compilation.md).
