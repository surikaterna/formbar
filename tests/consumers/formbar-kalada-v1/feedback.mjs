import { JSDOM } from "jsdom";
import * as React from "react";
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.window.document,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});
const { feedbackFixture } = await import("./feedback-fixture.mjs");
const { runFirstSubmit, runAttemptFences } = await import("./feedback-attempt-case.mjs");
const { runFeedback, runFeedbackOwnership, runScopedFeedback, runFeedbackRefusal } = await import(
	"./feedback-case.mjs"
);
for (const options of [
	{ messages: ["Correct the name"] },
	{},
	{ messages: [] },
	{ mode: "demo", messages: ["Correct the name"] },
	{ validationFirst: true, messages: ["Correct the name"] },
])
	await runFeedback(feedbackFixture, options);
await runFeedbackOwnership(feedbackFixture);
await runScopedFeedback(feedbackFixture);
runFeedbackRefusal(feedbackFixture);
for (const options of [
	{ messages: ["Correct the name"] },
	{},
	{ messages: [] },
	{ mode: "demo", messages: ["Correct the name"] },
])
	await runFirstSubmit(feedbackFixture, options);
await runAttemptFences(feedbackFixture);
dom.window.close();
console.log(
	`PACKED_SUBMIT_ATTEMPTS React ${React.version}: untouched invalid first submit correction/ARIA, authored/generic/empty, repeat/success distinct, reset, stale async/revoke/missing refusal and hidden isolation passed`,
);
console.log(
	`PACKED_VALIDATION_FEEDBACK React ${React.version}: actual schema/demo host owned field aliases, authored/generic/empty messages, valid-invalid-reset, a11y association, independent issue preservation/submit denial, nested row ownership and exact ambiguity/denied/stale refusal passed`,
);
