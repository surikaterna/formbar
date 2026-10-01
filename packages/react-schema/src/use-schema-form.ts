/** Legacy hook cannot install a FormApi through the strategy-owned V1 renderer. */
export type UseSchemaFormOptions = never;

export interface SchemaPreparationWarning {
	readonly channel: "source" | "projection" | "compilation" | "initialization";
	readonly code: string;
	readonly message: string;
}

export type UseSchemaFormResult = never;

export function useSchemaForm(_schema: unknown, _options: unknown): never {
	throw new TypeError(
		"useSchemaForm is no longer supported; use createKaladaSchemaForm and FormRenderer with its host.",
	);
}
