// @vitest-environment jsdom
import { it } from "vitest";
import {
	runAttemptFences,
	runFirstSubmit,
} from "../../../../tests/consumers/formbar-kalada-v1/feedback-attempt-case.mjs";
import {
	runFeedback,
	runFeedbackOwnership,
	runFeedbackRefusal,
	runScopedFeedback,
} from "../../../../tests/consumers/formbar-kalada-v1/feedback-case.mjs";
import { feedbackFixture } from "../../../../tests/consumers/formbar-kalada-v1/feedback-fixture";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it.each([
	{ messages: ["Correct the name"] },
	{},
	{ messages: [] },
	{ mode: "demo" as const, messages: ["Correct the name"] },
	{ validationFirst: true, messages: ["Correct the name"] },
])("R21 real installed validation feedback %# resolves owned lifecycle and original messages/reset/a11y", (options) =>
	runFeedback(feedbackFixture, options),
);
it("R21 feedback never exempts independent same-path issues or bypasses field visibility", () =>
	runFeedbackOwnership(feedbackFixture));
it("R21 nested repeated aliases retain exact field-row ownership and refuse wrong/stale scopes", () =>
	runScopedFeedback(feedbackFixture));
it("R21 duplicate ownership and denied/stale lifecycle refuse at exact diagnostic paths", () =>
	runFeedbackRefusal(feedbackFixture));
it.each([
	{ messages: ["Correct the name"] },
	{},
	{ messages: [] },
	{ mode: "demo" as const, messages: ["Correct the name"] },
])(
	"first owned invalid submit exposes untouched corrective feedback %# without successful submission metadata",
	(options) => runFirstSubmit(feedbackFixture, options),
);
it("stale async/revoked/missing attempts cannot set feedback visibility and hidden feedback stays hidden", () =>
	runAttemptFences(feedbackFixture));
