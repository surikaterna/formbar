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

Trusted `fieldValidators` and `asyncFieldValidators` may be passed to `useSchemaForm` at the same authored/generated definition preparation boundary as `createSchemaForm`; the hook binds the validated definition before its deferred form activates. Keep registry arrays stable across renders. See [definition-field validation](../from-schema/README.md#trusted-definition-field-validation-v1) for typed per-row bindings, full-draft/candidate execution, legacy-validator migration and the no-omission/no-sandbox boundary. Passing field IDs to the bare `useForm` hook cannot grant ownership.

For direct properties of a selected JSON Schema object root, concrete `default` annotations initialize core data before the form is created. They are copied as whole values; caller `initialData` own root keys replace them even when undefined, null, false, zero, empty, or a partial object. Root scalar/array defaults, child-only nested defaults, array item/minItems defaults, composed branches and deferred factories do not initialize data. Literal JSON `$type` keys are preserved by verifying descriptor-encoded defaults against the original local annotation. Unsafe defaults are skipped with an `initialization/unsafe-default` warning; unsafe caller records with defaults throw a TypeError. This is Formbar initialization, not JSON Schema validation assigning defaults. Reset restores the merged initial snapshot; no reapplication occurs after mount.

`FormRenderer` creates and owns a declarative runtime around those prepared artifacts. It renders semantic native controls, labeled `<output>` elements, built-in tabs and accordion nodes, and form-backed repeaters, while unsupported nodes and bindings remain visible diagnostics. Values, policy, lifecycle, and issues remain core-owned.

### Opt-in outgoing omission

The default is **retain and submit the full draft**, including hidden fields. To omit only provably exclusively inactive data bindings from an outgoing request, pass `submission: { hiddenValues: "omit-inactive" }` to `useSchemaForm` (or `createSchemaForm`). For an authored definition, put the same policy in `definition.submission`; the authored definition is authoritative and a conflicting hook option is rejected. Generated definitions accept the option directly. Individual validated FieldNode IDs can opt back into sending hidden values using `submitWhenHidden: "include"`; for generated definitions use `generation.submitWhenHidden` keyed by generated field ID. This applies to all concrete instances of that field, including repeater rows. It is not a renderer filter: use the prepared form factory/hook, not bare `useForm`/`createForm` with descriptors alone.

```tsx
const prepared = useSchemaForm(schema, {
  provider: jsonSchemaProvider(), side: "input",
  submission: { hiddenValues: "omit-inactive" },
  initialData: draft,
  onSubmit: async ({ payload }) => save(payload), // payload is the checked outgoing candidate
});
return <FormRenderer {...prepared} />;
```

Conditional then/else, Arbiter `visible: false`, shared bindings and per-ID include policy use the same captured definition-bound runtime that checks outgoing ownership. Showing a field restores its retained draft value; omission never clears local state. The native renderer displays failed final-candidate field and global issues in its error summary, links only to visible focusable fields and focuses the first such field (or the summary). SSR renders native markup without activating effects; hydration requires the **same initial data, UI state, definition, provider and policy** on server and client. Do not infer confidentiality from DOM visibility or a server render.

**Migration and server contract:** enabling this mode changes outgoing request bytes, not stored draft data or server-persisted records. Omitting a key in POST/PATCH/PUT is **not deletion**: define update/replace/merge semantics explicitly on the backend, enforce authorization and validation on every request, and set logging and retention policies for previously stored values and backups. For a real deletion send an explicit authorized delete operation according to your backend contract. Ajv/JSON Schema (including `required` and `if/then`) and all configured caller validators run on the final outgoing candidate; a schema that still requires a hidden key rejects omission. App-owned egress and validation callbacks are **trusted host code**: use their supplied candidate instead of closing over `form.getState()`, and do not reintroduce omitted values. Same-realm JavaScript closures or malicious Proxies are not sandboxed and this feature does not guarantee privacy against them. See [#210](https://github.com/surikaterna/formbar/issues/210) for the frozen boundary.

Repeaters render labeled fieldsets, ordered item groups, explicit empty/malformed states, scoped fields through the same `FormNodeView`, and authored action buttons through the declarative executor. Renderer-private row keys coordinate focus and structural identity for rendered actions but never enter form data, definitions, validation, UI state, or submit payloads. Index paths remain canonical; external equal-length replacement is intentionally positional.

Output formatting uses fixed `en-US` built-ins: `plain`, up-to-two-decimal `number`, USD `currency-usd`, and fractional `percent` (`0.1` renders as `10%`). Omitted, empty, and whitespace-only labels use the visible `Calculated value` fallback; nonblank authored labels are preserved verbatim. Null renders as `Not available`; unsupported values and expression failures render an accessible value-unavailable status. Outputs are read-only projections and never enter core data or submitted payloads. Stored computations remain validation-only until [#129](https://github.com/surikaterna/formbar/issues/129).

Trusted host components can be supplied through one immutable, renderer-scoped registration list:

```tsx
const extensions = {
	widgets: [{ id: "app.rating", component: Rating }],
	nodes: [{ id: "app.card", component: Card }],
} as const;

<FormRenderer {...prepared} extensions={extensions} />;
```

Definitions and schemas contain only allowlisted IDs and JSON props. Components, validators, imports, form APIs, runtime ports, and recursive render callbacks never enter serialized data. Unknown, colliding, invalid, or throwing extensions fail closed with accessible diagnostics. Extension components receive only the typed `WidgetProps` or `RendererContext` contract; custom-node children are pre-rendered by the same renderer traversal.

Trusted action handlers are a separate capability registry, not renderer
extensions:

```tsx
const actions = [{ id: "app.save-draft", handler: saveDraft }] as const;
<FormRenderer {...prepared} actions={actions} />;
```

An authored `ActionNode` renders one native accessible button at its declared
position. Submit actions use core submission and the root form's single lifecycle
announcement; other actions expose adjacent pending/result status. Unknown IDs
and invalid payloads or targets render disabled with code-only diagnostics.

Use `@formbar/from-schema` directly outside React, `@formbar/react` for hand-authored React controls, and `@formbar/declarative` to author presentation intent. Registrations are local to a `FormRenderer`; there is no global registry, remote loading, built-in override, runtime injection, styling system, or demo-specific behavior.

See [Schema compilation architecture](../../docs/architecture/schema-compilation.md).
