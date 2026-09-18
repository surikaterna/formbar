import type { TuiFieldCodec } from "./field-adapters.js";

export type TuiEditMode = "navigation" | "editing" | "select";

export interface TuiEditSnapshot {
	readonly mode: TuiEditMode;
	readonly draft: string;
	readonly search: string;
	readonly optionIndex: number;
	readonly caret: number;
	readonly error?: string;
	readonly stale: boolean;
	readonly masked: boolean;
}

export interface MutableEditState {
	mode: TuiEditMode;
	draft: string;
	search: string;
	optionIndex: number;
	optionOffset: number;
	caret: number;
	error: string | undefined;
	stale: boolean;
	canonical: unknown;
	codec: TuiFieldCodec | undefined;
	path: string | undefined;
	wroteCanonical: boolean;
	adapterFailed: boolean;
}

export function emptyEditState(): MutableEditState {
	return {
		mode: "navigation",
		draft: "",
		search: "",
		optionIndex: 0,
		optionOffset: 0,
		caret: 0,
		error: undefined,
		stale: false,
		canonical: undefined,
		codec: undefined,
		path: undefined,
		wroteCanonical: false,
		adapterFailed: false,
	};
}

export function resetEditState(state: MutableEditState): void {
	Object.assign(state, emptyEditState());
}

export function editSnapshot(state: MutableEditState): TuiEditSnapshot {
	return Object.freeze({
		mode: state.mode,
		draft: state.draft,
		search: state.search,
		optionIndex: state.optionIndex,
		caret: state.caret,
		...(state.error === undefined ? {} : { error: state.error }),
		stale: state.stale,
		masked: state.codec?.masked === true,
	});
}
