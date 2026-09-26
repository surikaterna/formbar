import type { CanonicalSegment } from "./path.js";
import { type AsyncProjection, asyncProjectionCurrent, runScopedAsyncField } from "./scoped-async-execution.js";
import type { ScopedAsyncField } from "./scoped-async.js";
import type { ValidationIssue } from "./state.js";

function overlaps(a: readonly CanonicalSegment[], b: readonly CanonicalSegment[]): boolean {
	const length = Math.min(a.length, b.length);
	for (let index = 0; index < length; index++) if (a[index] !== b[index]) return false;
	return true;
}

export function selectForegroundKeys(
	fields: readonly ScopedAsyncField[],
	emitted: ReadonlyMap<string, readonly ValidationIssue[]>,
	segments: readonly CanonicalSegment[] | undefined,
): Set<string> {
	const keys = new Set(fields.map((field) => JSON.stringify([field.id, field.instanceKey])));
	if (segments === undefined) for (const key of emitted.keys()) keys.add(key);
	else {
		for (const [key, issues] of emitted) {
			if (issues.some((issue) => overlaps(issue.path.segments, segments))) keys.add(key);
		}
	}
	return keys;
}

export async function runScopedForeground<TData, TUi>(
	fields: readonly ScopedAsyncField[],
	projection: AsyncProjection<TData, TUi>,
	results: Map<string, readonly ValidationIssue[]>,
): Promise<readonly ValidationIssue[]> {
	await Promise.all(
		fields.map(async (field) => {
			const issues = await runScopedAsyncField(field, projection);
			results.set(JSON.stringify([field.id, field.instanceKey]), issues);
		}),
	);
	if (!asyncProjectionCurrent(projection)) throw new Error("Stale scoped async foreground");
	return [...results.values()].flat();
}
