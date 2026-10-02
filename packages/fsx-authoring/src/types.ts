import type {
	DefinitionProgram,
	FormDefinition,
	FormDefinitionAdmission,
	StoredComputation,
	ValidatedFormDefinition,
} from "@formbar/declarative";
import type { JsonValue } from "@formbar/expressions";
import type { KaladaDirectLocationBinding, KaladaReferenceBinding } from "@kalada/syntax";

export type Reference = {
	namespace: "data" | "ui" | "form" | "field";
	segments: (string | number)[];
	[key: string]: string | (string | number)[];
};
export interface SourceRange {
	readonly start: number;
	readonly end: number;
}
export interface SourceEntry {
	readonly path: string;
	readonly range: SourceRange;
}
export interface FsxDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly path: string;
	readonly range?: SourceRange;
	readonly related?: readonly FsxDiagnosticLocation[];
}
export interface FsxDiagnosticLocation {
	readonly message: string;
	readonly path: string;
	readonly range?: SourceRange;
}
export interface RendererDescriptor {
	readonly renderer: string;
	readonly props: Readonly<
		Record<
			string,
			{
				readonly mode: "literal" | "read" | "write";
				readonly expected: "string" | "number" | "integer" | "boolean" | "json";
			}
		>
	>;
}
export interface FsxCompileOptions {
	readonly profile: "fsx-v1-experimental";
	readonly admission: FormDefinitionAdmission;
	/** Already canonical trusted declarations; public admission checks the entire static graph. */
	readonly computations?: readonly StoredComputation[];
	readonly references: Readonly<Record<string, KaladaReferenceBinding<Reference>>>;
	readonly locations: Readonly<Record<string, KaladaDirectLocationBinding>>;
	/** Item evidence is installed by the host, never inferred from a schema path. */
	readonly items?: Readonly<Record<string, KaladaDirectLocationBinding>>;
	readonly renderers?: Readonly<Record<string, RendererDescriptor>>;
}
export type FsxCompileResult =
	| {
			readonly ok: true;
			readonly definition: FormDefinition;
			readonly validated: ValidatedFormDefinition;
			readonly sourceMap: readonly SourceEntry[];
	  }
	| { readonly ok: false; readonly diagnostics: readonly FsxDiagnostic[] };
export type AttributeValue =
	| { readonly kind: "literal"; readonly value: JsonValue }
	| { readonly kind: "guest"; readonly source: string };
export interface Attribute {
	readonly name: string;
	readonly value: AttributeValue;
	readonly range: SourceRange;
	readonly valueRange: SourceRange;
}
export interface Element {
	readonly authoringPath: string;
	readonly name: string;
	readonly attributes: ReadonlyMap<string, Attribute>;
	readonly children: readonly Element[];
	readonly range: SourceRange;
}
