# Schema compilation architecture

## Three categories

1. **Schema evidence** belongs to `@formbar/from-schema`: raw and normalized constraints, property presence, defaults, metadata/extensions, source identity and pointers, provider/selected side, capabilities, source diagnostics, and validation handles.
2. **Authored presentation intent** belongs to `@formbar/declarative`: FormDefinition nodes, bindings/scopes, widget/action/renderer IDs, labels/placeholders, responsive spans, conditions, actions, outputs, and computations.
3. **Resolved runtime state** is not schema compilation. Current values, visibility, disabled/read-only/required state, issues, and lifecycle are resolved by the schema-agnostic declarative runtime with core inputs. `@formbar/react-schema` owns React DOM/ARIA and view identity.

There is no generic `PresentationModel`. Declarative is schema-agnostic and the dependency direction is `from-schema -> declarative`.

## Graph and occurrence behavior

Scheman v2 provides a recursive graph. Projection keeps a Formbar-owned descriptor node table keyed by stable source node IDs; it never flattens that graph. A second occurrence table records each path-bound use, relation, local property presence, shared identity, and expansion status. Recursive back-edges are explicit cycle occurrences and point at the same descriptor node. Shared nodes may have multiple occurrences and bindings.

The selected `input` or `output` root is mandatory. Projection traverses only that root and same-side definitions; a missing or unavailable side is never replaced with the other side. Ordered union alternatives and intersection operands are retained. Refs, unresolved refs, wrappers, tuple/rest, records, applicators, additional properties, definitions, unknown/opaque/unconstrained/never nodes, boolean schemas, and capabilities remain evidence even where default presentation cannot represent them.

## Limits

Scheman's `maxDepth`, `maxNodes`, `maxDefinitions`, `maxDiagnostics`, `maxEdges`, and metadata budgets are forwarded unchanged. Formbar adds positive bounded expansion budgets: `maxOccurrences` (default 20,000), `maxOccurrenceDepth` (128), and `maxDefinitionExpansions` (2,000). Every selected edge at an exhausted frontier receives a non-expanded fallback occurrence and diagnostic; fallback count remains bounded by Scheman's edge budget. Definition exhaustion is represented the same way. No selected branch silently disappears.

## Metadata and evidence

Scheman's owned raw `metadata` and `constraints` values are retained exactly. Normalization is passive, provider-neutral, and narrow: primitive/integer kind, local presence, literals/enums, concrete defaults, effective bounds, pattern, and format. Exact lengths become equal minimum/maximum evidence, while repeated inclusive/exclusive bounds reduce to their restrictive intersection. Equivalent supported JSON Schema and Zod checks produce equivalent evidence. Deferred factory markers are not defaults and factories are never executed. `const` remains literal evidence, never default evidence.

Formbar metadata has exact locations only: JSON and Standard JSON use `extensions["x-formbar"]`; Zod uses `extensions.formbar`. Container title/description annotations use JSON/Standard JSON and Zod 4 `metadata.annotations`, while Zod 3 descriptions use `metadata.description`. Compiler presentation allowlisting performs no deep aliases, cross-side/branch merge, or arbitrary UI metadata interpretation.

Zod `>=3.24 <4` and `>=4 <5` are the supported peer ranges, with 3.24.0, 3.25.76, 4.0.0, and 4.5.4 in the fixture matrix. Zod 4.5 moved public methods to prototype getters that materialize an own bound method on first access, while Scheman v2 intentionally accepts only own evidence. Formbar's explicit `zod4Provider` boundary adapts that public API only under `execution.metadata: "allow"`, including nested visits; deny mode does not access it. This is not provider autodetection and reads no private Zod internals.

## Default definitions and repeater scopes

Compilation is deterministic. IDs derive from provider/side and occurrence IDs. Titled/described objects become sections; other objects become groups. Object properties become structured data bindings. Arrays become repeaters with lexical scopes; primitive items bind to an empty path in that scope, object properties bind relative segments, and nested arrays introduce a new nested scope. Unsupported primitives and constructs produce diagnosed `unsupported` fallback fields. Generated definitions pass the public `validateFormDefinition` API.

Composed options remain descriptor evidence. The default compiler emits an explicit unsupported field and compilation diagnostic rather than selecting a union/intersection branch; #49 owns future composed presentation semantics.

## Diagnostic boundaries

- **Source diagnostics:** emitted by Scheman during ingestion.
- **Projection diagnostics:** missing nodes, cycles, and Formbar occurrence/definition limits.
- **Compilation diagnostics:** evidence that cannot produce an unambiguous default presentation.
- **Definition diagnostics:** emitted only by `@formbar/declarative` structural validation.

Channels are independently sorted and never converted into core validation issues. Structural availability and executable validation are separate; source validator handles are returned independently from caller validators.

## Greenfield removal sequence

Issue #63 removes Scheman v1 flat ingestion, extractor registries/autodetection/dereference, from-schema layout compiler/registry/middleware/override and UI compatibility helpers, React-schema tree rendering/registry/resolved-state/pruning, app-local renderers, and playground layout documents. No alias, shim, private bridge, or persisted-document migration remains.

The playground remains a read-only compiler view, while numbered demos exercise the interactive production renderer. #69 may add future registries, and #101/TUI work remains separate.
