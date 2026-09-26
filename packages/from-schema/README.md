# @formbar/from-schema

Projects explicit Scheman v2 schema documents into Formbar-owned neutral descriptor documents and compiles deterministic, validated `@formbar/declarative` FormDefinition v1 values.

## Explicit provider and side

There is no provider autodetection and no fallback to the opposite side.

```ts
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";

const prepared = createSchemaForm(
	{ type: "object", properties: { email: { type: "string", format: "email" } } },
	{
		provider: jsonSchemaProvider({ dialect: "draft-2020-12" }),
		side: "input",
	},
);

console.log(prepared.descriptors);
console.log(prepared.definition); // already passed validateFormDefinition
console.log(prepared.baseline); // schema-neutral required/label evidence by field node ID
console.log(prepared.repeaterBaseline); // array limits/labels by repeater node ID
```

`projectSchema` performs ingestion plus projection. `projectSchemaDocument` projects an existing Scheman v2 document. `compileDefaultFormDefinition` compiles descriptors without choosing union/intersection branches. `createSchemaForm` combines those steps and accepts either an authored `definition` or `generation` options, never both.

`createRuntimeFieldBaseline` and `createRuntimeRepeaterBaseline` are narrow descriptor adapters for declarative runtime state. They match authored or generated bindings against occurrence paths, normalize nested array scopes, and retain agreed labels; repeater baselines also carry restrictive array limits.

Generated arrays compile to a group containing a repeater with explicit move/remove actions and an append sibling. Append uses a JSON schema default first, then a safe neutral item seed. Unsupported item shapes omit append with a diagnostic. Generation never populates `minItems` and runtime never coerces a missing or malformed value to an array.

## Descriptor graph

`DescriptorDocument` has a node table that preserves graph identity and a separate occurrence table that preserves path-bound uses. References, sharing, cycles, wrappers, ordered unions/intersections, tuples, records, applicators, definitions, boolean schemas, unknown/opaque/unavailable evidence, capabilities, raw metadata/constraints, and source diagnostics remain observable. Unsupported presentation choices become explicit fallback nodes and diagnostics rather than disappearing.

Raw owned metadata and constraints are preserved. Equivalent supported JSON Schema and passive Zod checks normalize to the same primitive, integer, literal, enum, effective numeric/string/array bounds, pattern, and format evidence. Exact lengths produce matching minimum and maximum evidence; repeated bounds reduce to their restrictive intersection. Concrete default annotations/wrappers may normalize, but deferred factory sentinels never become values. `const` is a literal, not a default, and factories are never run.

Formbar presentation metadata is read only from exact provider locations: direct JSON Schema `x-formbar` values captured before provider sanitization and Zod `metadata.extensions.formbar`. Standard JSON conversion output is not interpreted as Formbar presentation metadata. Container annotations use only provider-owned locations: JSON/Standard JSON and Zod 4 `metadata.annotations`, and the Zod 3 top-level `metadata.description`. There is no deep alias lookup or metadata merge.

JSON Schema may select a trusted host widget with `x-formbar.widget` and provide finite JSON values through `x-formbar.props`. Each prop is compiled to a literal declarative prop; malformed props produce a deterministic compilation diagnostic. An explicit authored definition remains authoritative instead of being merged with generated presentation, while descriptor constraints and annotations remain available to the renderer.

Direct JSON Schema `x-formbar.options` decorates native select/radio choices with literal `title` and `disabled` metadata. Entries are primitive values or `{ value, title?, disabled? }` records. A direct scalar enum sets the choice values and order; option metadata matches by exact type and value, with unmatched titles falling back to `String(value)`. Without an enum, options are presentation choices only, **not** validation rules. Duplicate metadata uses the first entry. Invalid, duplicate and unmatched entries appear as structured warnings (with occurrence and entry index) in `createSchemaForm().diagnostics.compilation` and `useSchemaForm().diagnostics`; they are not validation issues. Authored definitions win; within a schema hint, `x-formbar.props.options` wins over `x-formbar.options` for options-only fields, but is ignored with a warning for all generated native choices backed by a direct enum (bare or typed, select or radio). Native select/radio disable new selection but retain and display already selected disabled values. This supports direct properties, primitive array items and expanded local refs only; composed branches and host title callbacks are not interpreted.

## Trust and limits

Scheman document limits are forwarded with `limits`. Formbar occurrence expansion adds bounded `maxOccurrences`, `maxOccurrenceDepth`, and `maxDefinitionExpansions` under `projectionLimits`.

Zod shape, lazy, and metadata execution permissions remain independently deny-by-default:

```ts
import { projectSchema, zod4Provider } from "@formbar/from-schema";

projectSchema(trustedSchema, {
	provider: zod4Provider({ execution: { shape: "allow", lazy: "allow", metadata: "allow" } }),
	side: "input",
});
```

Only grant permissions to trusted schemas. Standard JSON conversion similarly requires `standardJsonSchemaProvider({ target, execution: "allow" })`; deny mode does not call conversion callbacks.

The supported peer range is Zod `>=3.24 <4` and `>=4 <5`; fixtures exercise 3.24.0, 3.25.76, 4.0.0, and 4.5.4. When and only when Zod 4 metadata execution is explicitly allowed, Formbar's provider wrapper reads the public `meta` method so Zod 4.5's lazy public method is materialized before Scheman performs its own-property evidence check. Deny mode delegates untouched and performs no metadata access. The wrapper does not inspect Zod internals or infer a provider.

## Diagnostics and validation

`SchemaFormResult.diagnostics` keeps `validation`, `source`, `projection`, `compilation`, and declarative `definition` diagnostics separate. The optional Standard Schema validator handle is returned as `sourceValidator`; plain JSON Schema validation precedes caller-provided core validators in `validators`. Structural availability is not a validation promise.

### Trusted definition-field validation (v1)

Register at **one** preparation boundary, for authored `definition` or generated `generation`:

```ts
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";

const prepared = createSchemaForm<{ email: string }, { tab: number }>(schema, {
  provider: jsonSchemaProvider(), side: "input", generation: {},
  fieldValidators: [{
    fieldId: generatedEmailFieldId, // read from prepared.definition in an initial preparation
    validate: ({ data, field, stage, context }) =>
      data.email === "blocked@example.test"
        ? [{ code: "blocked", message: "Unavailable", severity: "error" }]
        : [],
  }],
  asyncFieldValidators: [{
    id: "email-available", fieldId: generatedEmailFieldId,
    trigger: "onBlur", debounceMs: 300,
    validate: async ({ data, field, signal }) =>
      (await checkAvailability(data.email, signal))
        ? [] : [{ code: "taken", message: "Unavailable", severity: "error" }],
  }],
});
const form = prepared.createForm({ initialData: { email: "" }, initialUiState: { tab: 0 } });
```

`fieldId` is the globally unique **validated FieldNode.id**, not a data path, row ID, or runtime instance. Generated IDs can be inspected by preparing the schema without registrations first. Unknown/non-field/duplicate sync registrations and invalid/duplicate async IDs (including collisions with legacy async validator IDs) reject. `prepared.createForm(coreOptions)` and `prepared.createDeferredForm(coreOptions)` bind the same definition host before validation; passing `prepared.validators` to a bare core `createForm` installs only legacy/schema validators and **does not** register scoped validators. `useSchemaForm` forwards the same options through its deferred construction. No separate registry belongs on `useForm` or `createForm`.

Callbacks receive readonly typed data/UI views (not a hostile-JS sandbox), current `field.instance` (`nodeId`, `instanceKey`, ordered repeater `scopes` with numeric indexes), and `field.binding` (`namespace: "data"`, typed absolute `segments`). A literal string `"0"` differs from array index `0`; dots in keys remain literal. Every *existing* concrete row is invoked, including hidden conditional branches; zero rows produce zero invocations. Unbound, root/UI, ambiguous, shared or overlapping bindings fail closed. A `FieldIssueInput` supplies only `code`, `message`, `severity`, and optional nonempty typed `descendant` segments within an existing bound subtree. The host validates the shape/ownership, creates a new frozen canonical issue and attaches provenance to that original issue object; caller `source`, absolute path, stage, details, and certificates are not accepted. Spread/rehydrated or same-path unregistered issues have no scoped provenance. An existing typed child of a uniquely bound object field can be a certified issue target even if unknown siblings make its parent **ineligible for omission**. This never makes the unknown subtree omittable; parent diagnostics still require conservative whole-node proof.

Automatic async defaults to `onChange` and 300ms debounce; `onBlur` may be selected. Explicit `form.validate(stage?)` runs all configured sync validators, including every scoped current instance on **full retained draft data/UI**, without async. Explicit unscoped `validateAsync()` runs all configured async instances without trigger/debounce; scoped `validateAsync(path)` selects typed-overlapping instances. Both conditional branches remain eligible even when hidden. Final guarded validation (for future submit integration) executes **all** legacy/schema/global and scoped sync/async validators on the same post-egress candidate data/UI with identical stage/context; it cannot skip another validator after an error. Draft and candidate runs are distinct. These registrations do **not** activate request omission, change default retain-and-submit or full-draft semantics, certify Ajv/Standard Schema or generic validators, or exempt unregistered/root/global issues from blocking. In particular, migrate a *field-owned* legacy validator by registering it at this boundary and returning relative issue inputs, not by matching its old absolute path; retain independent legacy/Ajv validators for global constraints. A trusted same-realm callback can close over form/external state; this is not a privacy sandbox. Future request omission is not server deletion: backend authorization and persisted-data semantics remain the server's responsibility.

## Automatic JSON Schema validation

`createSchemaForm` and `useSchemaForm` automatically validate the complete stored data when
using `jsonSchemaProvider()` (default or `draft-2020-12`). Validation runs before caller
validators; Standard Schema continues using its independent source validator. Presentation
metadata (`x-formbar`, titles, disabled options) does not add JSON Schema constraints.
JSON Schema combinators validate stored data even where composed UI presentation is unavailable.

Only locally trusted, synchronous Draft 2020-12 schemas are supported. Supported formats are
`date`, `email`, and `uri`; refs must be local (including `$defs` and local anchors).
Unknown formats, remote refs, unsupported dialects and vocabularies, async schemas, invalid
schemas and malformed sources fail closed with `diagnostics.validation` and a root data issue.
No remote loading, data coercion, default assignment or stored-data pruning occurs. Schemas
are snapshotted via own data properties of plain objects/arrays before compilation; inherited
constraints and built-in objects are rejected, including within annotations. Limits are 262144
UTF-8 bytes of names and values, 8192 nodes, and depth 64; reported errors are limited to 100 plus a root
truncation issue. Cache entries are reused only for matching schema identity *and* serialized
snapshot. JavaScript regex evaluation in-process cannot guarantee a CPU timeout: do not use
attacker-controlled schemas without an isolated execution boundary.

## Greenfield migration

The Scheman v1 flat result/extractor registry/detection/dereference exports and Formbar 0.4 layout compiler, registry, middleware, overrides, UI helpers, handwritten JSON validator, and compatibility aliases were removed. Migrate by selecting a provider and side, reading `descriptors`, and supplying or compiling a FormDefinition. There is no flat-field or layout translation API.

See [Schema compilation architecture](../../docs/architecture/schema-compilation.md).
