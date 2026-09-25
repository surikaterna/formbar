import { inspect } from "./owned-issue-snapshot.js";
import type { CreateFormOptions } from "./state.js";
import { defaultStrategy } from "./transaction.js";

/** Reject caller-owned invalid input before cloning, constructing the store, or initializing resources. */
export function preflightOwnedCreation<TData, TUi>(options: CreateFormOptions<TData, TUi>): void {
	if (!options.ownedScheduling) return;
	if (options.stateStrategy !== undefined && options.stateStrategy !== defaultStrategy)
		throw new Error("OWNED_STATE_UNSUPPORTED");
	inspect({ data: options.initialData ?? {}, uiState: options.initialUiState ?? {} }, new Set(), { value: 0 }, 0);
}
