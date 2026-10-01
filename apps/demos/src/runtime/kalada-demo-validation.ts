import type { JsonValue } from "@formbar/declarative";
import { clone } from "./kalada-demo-state";
import type { OwnedIssue, Validators } from "./kalada-demo-store";

/** Origin is the exact installed registration and original ordinal, not a callback name or matching path. */
export async function runDemoValidation(
	validators: Validators,
	data: JsonValue,
	signal: AbortSignal,
	origins: readonly object[] = [],
): Promise<readonly OwnedIssue[]> {
	try {
		return (
			await Promise.all(
				validators.map(async (validator, index) => {
					const origin = origins[index] ?? {};
					return (await validator(clone(data), signal)).map((issue, ordinal) =>
						Object.freeze({ ...issue, path: Object.freeze([...issue.path]), validator, origin, ordinal }),
					);
				}),
			)
		).flat();
	} catch {
		const failure: Validators[number] = () => [];
		return [
			{ path: [], message: "Validation failed", source: "extension", validator: failure, origin: {}, ordinal: 0 },
		];
	}
}
