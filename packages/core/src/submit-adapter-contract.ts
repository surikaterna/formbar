/** A data path uses typed segments: an object key "0" is not array index 0. */
export type SubmitDataSegment =
	| { readonly kind: "key"; readonly key: string }
	| { readonly kind: "index"; readonly index: number };
export type SubmitDataPath = readonly SubmitDataSegment[];

export type SubmitJson =
	| null
	| boolean
	| number
	| string
	| readonly SubmitJson[]
	| { readonly [key: string]: SubmitJson };

/** Owned, bounded, immutable capture; never contains FormState or an API reference. */
export interface SubmitAdapterCapture {
	readonly data: SubmitJson;
	readonly uiState: SubmitJson;
	readonly stage?: string;
	readonly fieldPolicy?: SubmitJson;
}

/** Explicit classification of the only permitted capture-to-projection changes: deletions.
 * An indexed omission must keep its row; indexed row anchors distinguish shifts from cell edits.
 * An empty no-omission plan is not evidence of hidden-field ownership or privacy. */
export interface SubmitStructuralWitness {
	readonly kind: "no-omission" | "omission";
	readonly omitted: readonly SubmitDataPath[];
	readonly protected: readonly { readonly path: SubmitDataPath; readonly value: SubmitJson }[];
	readonly rowAnchors: readonly { readonly array: SubmitDataPath; readonly key: SubmitDataPath }[];
}

export interface SubmitAdapterProjection {
	readonly data: SubmitJson;
	readonly witness: SubmitStructuralWitness;
}

/** #226 must supply ownership from the same declarative runtime projection, not core path guesses. */
export type SubmitDefinitionAdapter = (capture: SubmitAdapterCapture) => SubmitAdapterProjection;
