import type { PlaygroundExample } from "./contracts";

/** Supplied only by the selected host preset. Never read from any authored source document. */
export type PlaygroundRuntimeContext = Pick<
	PlaygroundExample["runtime"],
	"profileIds" | "initialUiState" | "arbiterRules"
> &
	Partial<Pick<PlaygroundExample["runtime"], "actionControls">>;
export const standardPlaygroundContext: PlaygroundRuntimeContext = Object.freeze({
	profileIds: Object.freeze(["formbar.standard.v1"] as const),
	initialUiState: Object.freeze({}),
});

function frozen<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) frozen(child);
		Object.freeze(value);
	}
	return value;
}

export function snapshotPlaygroundContext(context: PlaygroundRuntimeContext): PlaygroundRuntimeContext {
	return frozen({
		profileIds: [...context.profileIds],
		initialUiState: structuredClone(context.initialUiState),
		...(context.actionControls ? { actionControls: context.actionControls } : {}),
		...(context.arbiterRules ? { arbiterRules: structuredClone(context.arbiterRules) } : {}),
	});
}
