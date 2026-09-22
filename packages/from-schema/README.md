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
```

`projectSchema` performs ingestion plus projection. `projectSchemaDocument` projects an existing Scheman v2 document. `compileDefaultFormDefinition` compiles descriptors without choosing union/intersection branches. `createSchemaForm` combines those steps and accepts either an authored `definition` or `generation` options, never both.

`createRuntimeFieldBaseline(descriptors, definition)` is the narrow descriptor adapter for declarative runtime state. It matches authored or generated field bindings against occurrence paths, normalizes nested array scopes, preserves shared occurrences, ORs required property evidence, and retains a provider-owned title only when matching titles agree. No descriptor pointer, provider metadata, constraint, default, or validator handle crosses into the baseline.

## Descriptor graph

`DescriptorDocument` has a node table that preserves graph identity and a separate occurrence table that preserves path-bound uses. References, sharing, cycles, wrappers, ordered unions/intersections, tuples, records, applicators, definitions, boolean schemas, unknown/opaque/unavailable evidence, capabilities, raw metadata/constraints, and source diagnostics remain observable. Unsupported presentation choices become explicit fallback nodes and diagnostics rather than disappearing.

Raw owned metadata and constraints are preserved. Equivalent supported JSON Schema and passive Zod checks normalize to the same primitive, integer, literal, enum, effective numeric/string/array bounds, pattern, and format evidence. Exact lengths produce matching minimum and maximum evidence; repeated bounds reduce to their restrictive intersection. Concrete default annotations/wrappers may normalize, but deferred factory sentinels never become values. `const` is a literal, not a default, and factories are never run.

Formbar presentation metadata is read only from exact provider locations: JSON/Standard JSON `metadata.extensions["x-formbar"]` and Zod `metadata.extensions.formbar`. Container annotations likewise use only provider-owned locations: JSON/Standard JSON and Zod 4 `metadata.annotations`, and the Zod 3 top-level `metadata.description`. There is no deep alias lookup or metadata merge.

JSON Schema may select a trusted host widget with `x-formbar.widget` and provide finite JSON values through `x-formbar.props`. Each prop is compiled to a literal declarative prop; malformed props produce a deterministic compilation diagnostic. An explicit authored definition remains authoritative instead of being merged with generated presentation, while descriptor constraints and annotations remain available to the renderer.

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

`SchemaFormResult.diagnostics` keeps `source`, `projection`, `compilation`, and declarative `definition` diagnostics separate and deterministically ordered. The optional source Standard validator handle is returned as `sourceValidator`; caller-provided core validators remain in `validators`. Structural availability is not a validation promise.

## Greenfield migration

The Scheman v1 flat result/extractor registry/detection/dereference exports and Formbar 0.4 layout compiler, registry, middleware, overrides, UI helpers, handwritten JSON validator, and compatibility aliases were removed. Migrate by selecting a provider and side, reading `descriptors`, and supplying or compiling a FormDefinition. There is no flat-field or layout translation API.

See [Schema compilation architecture](../../docs/architecture/schema-compilation.md).
