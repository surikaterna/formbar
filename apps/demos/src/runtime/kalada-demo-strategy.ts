import type { ArbiterPluginOptions } from "@formbar/arbiter";
import { initializeDemo } from "./kalada-demo-initialize";
import { captureLifecycleDemo, resetDemo, submissionDemo, submitDemo, validateDemo } from "./kalada-demo-lifecycle";
import { omissionDemo } from "./kalada-demo-omission";
import { captureDemo, demoIdentity } from "./kalada-demo-reads";
import { scopedDemo } from "./kalada-demo-scoped";
import { type Authority, DemoSession } from "./kalada-demo-session";
import { DemoStore, type Strategy } from "./kalada-demo-store";
import { mutateDemoArray, writeDemo } from "./kalada-demo-writes";

function strategyFor(session: DemoSession): Strategy {
	return {
		contract: "formbar-data-strategy-v1",
		identity: (context) => demoIdentity(session, context),
		current: () => session.store.revision,
		subscribe: (context, notify) => {
			if (!session.granted(context)) return () => {};
			session.store.subscribers.add(notify);
			return () => session.store.subscribers.delete(notify);
		},
		capture: (context) => captureDemo(session, context),
		writeDirect: (context, request) => writeDemo(session, context, request),
		captureSubmission: (context) => submissionDemo(session, context),
		submitCaptured: (context, request, fresh) => submitDemo(session, context, request, fresh),
		initializeSchema: (context, request) => initializeDemo(session, context, request),
		installSchemaValidation: (context, checks) => {
			if (!session.granted(context)) return { status: "denied" };
			session.store.invalidate();
			session.store.validators = Object.freeze([...checks]);
			session.store.validatorOrigins = checks.map(() => ({}));
			session.store.schemaOrigin =
				checks[0] === session.authority.schemaValidator ? session.store.validatorOrigins[0] : undefined;
			return { status: "installed" };
		},
		captureLifecycle: (context) => captureLifecycleDemo(session, context),
		validateLifecycle: (context, request, fresh) =>
			validateDemo(session, context, request.revision, fresh, request.operation, request),
		resetLifecycle: (context, request) => resetDemo(session, context, request),
		...omissionDemo(session),
		...scopedDemo(session),
	};
}

/** An installation retires the prior grant without resetting its strategy-owned draft and row identities. */
export function createDemoStrategy(
	identity: Authority["identity"],
	paths: Authority["paths"],
	fields: Authority["fields"],
	valueAllowed: Authority["valueAllowed"],
	onSubmit?: DemoSession["submit"],
	ui: Readonly<Record<string, unknown>> = {},
	rules?: ArbiterPluginOptions["rules"],
	configuration: Pick<
		Authority,
		"definition" | "uiPaths" | "arrayBounds" | "schemaValidator" | "schema" | "initialDraftAllowed"
	> = {},
) {
	const store = new DemoStore();
	let previous: DemoSession | undefined;
	const reinstall = (
		nextIdentity = identity,
		nextPaths = paths,
		nextFields = fields,
		nextAllowed = valueAllowed,
		nextUi = ui,
		nextRules = rules,
		nextConfiguration = configuration,
	) => {
		previous?.revoke();
		const session = new DemoSession(
			store,
			{ identity: nextIdentity, paths: nextPaths, fields: nextFields, valueAllowed: nextAllowed, ...nextConfiguration },
			onSubmit,
			nextUi,
			nextRules,
		);
		previous = session;
		return {
			strategy: strategyFor(session),
			arrayHost: {
				mutateArray: (context: Parameters<typeof mutateDemoArray>[1], request: Parameters<typeof mutateDemoArray>[2]) =>
					mutateDemoArray(session, context, request),
			},
			revoke: () => session.revoke(),
		};
	};
	const captureDraft = (expected: object) => {
		if (!previous?.active || !previous.instance || store.revision !== expected)
			throw new TypeError("Stale owned draft capture");
		return structuredClone(store.data);
	};
	return { ...reinstall(), reinstall, captureDraft };
}
