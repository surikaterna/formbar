import type { feedbackFixture } from "./feedback-fixture.js";
export function runFirstSubmit(
	factory: typeof feedbackFixture,
	options: NonNullable<Parameters<typeof feedbackFixture>[0]>,
): Promise<void>;
export function runAttemptFences(factory: typeof feedbackFixture): Promise<void>;
