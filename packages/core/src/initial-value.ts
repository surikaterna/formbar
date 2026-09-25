import type { CanonicalPath } from "./path.js";

export function resolveInitialValue(path: CanonicalPath, data: unknown, uiState: unknown): unknown {
	let current: unknown = path.namespace === "data" ? data : uiState;
	for (const segment of path.segments) {
		if (current === null || current === undefined) return undefined;
		current = (current as Record<string | number, unknown>)[segment];
	}
	return current;
}
