import type { FormState } from "@formbar/core";
import type { JsonValue, Segment, StateRef, WriteResult } from "@formbar/expressions";

export type RuntimeFormState<TData = unknown, TUi = unknown> = Readonly<
	Pick<FormState<TData, TUi>, "data" | "uiState">
>;

export interface RuntimeSnapshot extends RuntimeFormState<JsonValue, JsonValue> {
	readonly namespaces?: Readonly<Record<string, JsonValue>>;
}

export interface RuntimePort {
	getSnapshot(): RuntimeSnapshot;
	read(reference: StateRef): JsonValue | undefined;
	write(namespace: string, segments: readonly Segment[], value: JsonValue): WriteResult;
	subscribe(listener: () => void): () => void;
}
