import type { feedbackFixture } from "./feedback-fixture.js";
export function runFeedback(
	factory: typeof feedbackFixture,
	options: Parameters<typeof feedbackFixture>[0],
): Promise<void>;
export function runFeedbackOwnership(factory: typeof feedbackFixture): Promise<void>;
export function runScopedFeedback(factory: typeof feedbackFixture): Promise<void>;
export function runFeedbackRefusal(factory: typeof feedbackFixture): void;
