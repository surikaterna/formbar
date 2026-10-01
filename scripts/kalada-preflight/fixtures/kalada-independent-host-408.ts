import type {
	DataContext,
	FormbarDataStrategyV1,
	OmissionRequest,
	SchemaValidationIssueV1,
	ScopedValidatorV1,
} from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { generatedHost } from "./generated-host.js";

type Base = ReturnType<typeof generatedHost>;
type State = Base["instances"] extends Map<object, infer S> ? S : never;
type Candidate = Parameters<NonNullable<FormbarDataStrategyV1["validateOutgoingCandidate"]>>[1];
type Origin = Parameters<typeof generatedHost>[3];

const namePath = "root.children[0].children[0]";
const quantityPath = "root.children[1].children[0].children[0].children[0].children[0]";

// A second host policy, built from the current draft's lexical row tree rather than supplied directives.
function inventory(state: State, outer: string, inner: string, hidden: boolean, include: boolean) {
	return [
		{
			field: { path: namePath, scope: { rows: [] } },
			visible: !hidden,
			...(include ? { submitWhenHidden: "include" } : {}),
		},
		...state.rows.flatMap((parent) =>
			parent.nested.map((child) => ({
				field: {
					path: quantityPath,
					scope: {
						rows: [
							{ name: outer, token: parent.token },
							{ name: inner, token: child.token },
						],
					},
				},
				visible: true,
			})),
		),
	];
}

function authorized(
	request: OmissionRequest,
	context: DataContext,
	state: State,
	expected: ReturnType<typeof inventory>,
) {
	if (
		(request.hiddenValues !== "include" && request.hiddenValues !== "omit-inactive") ||
		request.instance !== context.instance ||
		request.revision !== state.revision ||
		request.contract !== "formbar-lifecycle-v1"
	)
		return false;
	if (request.fields.length !== expected.length) return false;
	const remaining = [...expected];
	for (const supplied of request.fields) {
		const index = remaining.findIndex(
			(entry) =>
				entry.field.path === supplied.field.path &&
				entry.field.scope.rows.length === supplied.field.scope.rows.length &&
				entry.field.scope.rows.every(
					(row, i) =>
						row.name === supplied.field.scope.rows[i]?.name && row.token === supplied.field.scope.rows[i]?.token,
				),
		);
		if (index < 0) return false;
		const [match] = remaining.splice(index, 1);
		if (
			match?.visible !== supplied.visible ||
			("submitWhenHidden" in match ? match.submitWhenHidden : undefined) !== supplied.submitWhenHidden
		)
			return false;
	}
	return remaining.length === 0;
}

function expectedCandidate(
	base: Base,
	context: DataContext,
	hidden: boolean,
	include: boolean,
	mode: OmissionRequest["hiddenValues"],
) {
	const capture = base.strategy.captureSubmission?.(context);
	if (capture?.status !== "found" || capture.instance !== context.instance) return;
	const data = structuredClone(capture.data) as { profile: { name: string }; rows: unknown[] };
	if (hidden && !include && mode === "omit-inactive") data.profile = {} as typeof data.profile;
	return { revision: capture.revision, data };
}

// Independent policy: coalesced scoped work and validator-owned candidate receipts.
function scopedTasks(base: Base) {
	const running = new Map<object, Map<string, AbortController>>();
	const cancel = (instance: object) => {
		const tasks = running.get(instance);
		for (const controller of tasks?.values() ?? []) controller.abort();
		tasks?.clear();
		running.delete(instance);
		const state = base.instances.get(instance);
		if (state) {
			state.pending = 0;
			state.scopedIssues.clear();
		}
	};
	return { running, cancel };
}

function scopedRunner(base: Base, permitted: () => boolean, running: Map<object, Map<string, AbortController>>) {
	return (context: DataContext, state: State, entry: ScopedValidatorV1, id: string) => {
		const tasks = running.get(context.instance) ?? new Map<string, AbortController>();
		running.set(context.instance, tasks);
		if (tasks.has(id)) {
			tasks.get(id)?.abort();
			state.pending--;
		}
		const controller = new AbortController();
		tasks.set(id, controller);
		const revision = state.revision;
		state.pending++;
		void Promise.resolve().then(async () => {
			try {
				const capture = base.strategy.captureSubmission?.(context);
				if (capture?.status !== "found" || controller.signal.aborted) return;
				const issues = await entry.validate(capture.data, controller.signal);
				if (controller.signal.aborted || !permitted() || state.closed || state.revision !== revision) return;
				state.scopedIssues.set(
					id,
					issues.map((issue, ordinal) => ({ ...issue, validator: -2, ordinal })),
				);
			} catch {
				if (!controller.signal.aborted && permitted() && !state.closed && state.revision === revision)
					state.scopedIssues.set(id, [
						{ path: [], message: "Scoped validation failed", source: "extension", validator: -2, ordinal: 0 },
					]);
			} finally {
				if (tasks.get(id) === controller) {
					tasks.delete(id);
					state.pending--;
					for (const notify of state.listeners) notify();
				}
			}
		});
	};
}

function scopedPolicy(base: Base, permitted: () => boolean) {
	const { running, cancel } = scopedTasks(base);
	const run = scopedRunner(base, permitted, running);
	const rowIds = new WeakMap<object, number>();
	let nextRowId = 0;
	const rowKey = (token: object) => {
		if (!rowIds.has(token)) rowIds.set(token, ++nextRowId);
		return rowIds.get(token);
	};
	const notify: NonNullable<FormbarDataStrategyV1["notifyScopedValidation"]> = (context, request) => {
		const state = base.instances.get(context.instance);
		if (!permitted() || !state || state.closed || request.revision !== state.revision) return { status: "stale" };
		if (request.contract !== "formbar-lifecycle-v1" || request.instance !== context.instance)
			return { status: "denied" };
		const frame = base.strategy.captureLifecycle?.(context);
		const owned = frame && !("status" in frame) ? frame.field(request.field) : undefined;
		if (owned?.status !== "found") return { status: "denied" };
		const key = JSON.stringify([request.field.path, request.field.scope.rows.map(({ token }) => rowKey(token))]);
		if (request.trigger === "onBlur") state.touched.add(key);
		for (const entry of state.scoped ?? []) {
			if (entry.field !== request.field.path || entry.trigger !== request.trigger) continue;
			run(context, state, entry, JSON.stringify([key, entry.id]));
		}
		for (const listener of state.listeners) listener();
		return { status: "applied", revision: state.revision };
	};
	return { cancel, notify };
}

function exemptOrigin(
	issue: SchemaValidationIssueV1,
	validator: number,
	ordinal: number,
	request: Candidate,
	state: State,
	original: State["issueRecords"][number] | undefined,
	omissionField?: string,
	origin?: Origin,
) {
	return (
		issue.source === origin?.source &&
		validator === origin.validator &&
		issue.message === origin.message &&
		JSON.stringify(issue.path) === JSON.stringify(origin.path) &&
		request.hiddenValues === "omit-inactive" &&
		request.fields.some(
			({ field, visible, submitWhenHidden }) =>
				field.path === omissionField && field.scope.rows.length === 0 && !visible && !submitWhenHidden,
		) &&
		!!original &&
		state.issueRecords.includes(original) &&
		original.validator === validator &&
		original.ordinal === ordinal &&
		original.source === issue.source &&
		original.message === issue.message &&
		JSON.stringify(original.path) === JSON.stringify(issue.path)
	);
}

function candidatePolicy(
	base: Base,
	permitted: () => boolean,
	check: (context: DataContext, request: Candidate) => boolean,
	omissionField?: string,
	origin?: Origin,
) {
	const receipts = new WeakMap<
		object,
		{
			instance: object;
			revision: object;
			bytes: string;
			draft: string;
			epoch: number;
			issue?: State["issueRecords"][number];
		}
	>();
	let epoch = 0;
	const candidateBytes = (context: DataContext, request: Candidate) => {
		if (!check(context, request)) return;
		const capture = base.strategy.captureSubmission?.(context);
		if (capture?.status !== "found" || capture.revision !== request.revision) return;
		const data = structuredClone(capture.data) as { profile: object };
		if (
			request.hiddenValues === "omit-inactive" &&
			request.fields.some(
				({ field, visible, submitWhenHidden }) => field.path === omissionField && !visible && !submitWhenHidden,
			)
		)
			data.profile = {};
		return JSON.stringify(data);
	};
	const validate: NonNullable<FormbarDataStrategyV1["validateOutgoingCandidate"]> = async (context, request, fresh) => {
		const state = base.instances.get(context.instance);
		if (
			!permitted() ||
			!state ||
			!fresh() ||
			!check(context, request) ||
			candidateBytes(context, request) !== JSON.stringify(request.candidate)
		)
			return { status: "stale" };
		const grant = epoch;
		const draft = JSON.stringify(base.strategy.captureSubmission?.(context));
		const original = state.issueRecords.find(
			(issue) =>
				issue.validator === origin?.validator &&
				issue.source === origin.source &&
				issue.message === origin.message &&
				JSON.stringify(issue.path) === JSON.stringify(origin.path),
		);
		const results = await Promise.all(
			(state.validators ?? []).map((check) => check(request.candidate, new AbortController().signal)),
		);
		if (
			!permitted() ||
			grant !== epoch ||
			!fresh() ||
			!check(context, request) ||
			candidateBytes(context, request) !== JSON.stringify(request.candidate)
		)
			return { status: "stale" };
		if (draft !== JSON.stringify(base.strategy.captureSubmission?.(context))) return { status: "stale" };
		if (
			results.some((issues, validator) =>
				issues.some(
					(issue, ordinal) => !exemptOrigin(issue, validator, ordinal, request, state, original, omissionField, origin),
				),
			)
		)
			return { status: "invalid" };
		const proof = {};
		receipts.set(proof, {
			instance: context.instance,
			revision: request.revision,
			bytes: JSON.stringify(request.candidate),
			draft,
			epoch: grant,
			issue: original,
		});
		return { status: "applied", revision: request.revision, proof };
	};
	const submit: NonNullable<FormbarDataStrategyV1["submitOmission"]> = (context, request, fresh) => {
		const state = base.instances.get(context.instance);
		const receipt = receipts.get(request.proof);
		receipts.delete(request.proof);
		if (
			!permitted() ||
			!fresh() ||
			!state ||
			!check(context, request) ||
			candidateBytes(context, request) !== JSON.stringify(request.candidate)
		)
			return { status: "stale" };
		if (
			!receipt ||
			receipt.instance !== context.instance ||
			receipt.revision !== state.revision ||
			receipt.epoch !== epoch ||
			receipt.draft !== JSON.stringify(base.strategy.captureSubmission?.(context)) ||
			receipt.issue !==
				state.issueRecords.find(
					(issue) =>
						issue.validator === origin?.validator &&
						issue.source === origin.source &&
						issue.message === origin.message &&
						JSON.stringify(issue.path) === JSON.stringify(origin.path),
				) ||
			receipt.bytes !== JSON.stringify(request.candidate)
		)
			return { status: "denied" };
		state.outgoing = structuredClone(request.candidate);
		return { status: "submitted" };
	};
	return {
		validate,
		submit,
		discard: (proof: object) => receipts.delete(proof),
		revoke: () => {
			epoch++;
		},
	};
}

export function independentHost(outer: string, inner: string, omissionField?: string, origin?: Origin) {
	const base = generatedHost(outer, inner, omissionField, origin);
	let allowed = true;
	let hidden = true;
	let include = false;
	const permitted = () => allowed;
	const scoped = scopedPolicy(base, permitted);
	const check = (context: DataContext, request: OmissionRequest) => {
		const state = base.instances.get(context.instance);
		if (!allowed || !state || state.closed || request.revision !== state.revision) return false;
		return authorized(request, context, state, inventory(state, outer, inner, hidden, include));
	};
	const candidate = candidatePolicy(base, permitted, check, omissionField, origin);
	const matches = (context: DataContext, request: Candidate) => {
		if (!check(context, request)) return false;
		const expected = expectedCandidate(base, context, hidden, include, request.hiddenValues);
		return (
			expected?.revision === request.revision && JSON.stringify(expected.data) === JSON.stringify(request.candidate)
		);
	};
	const strategy: FormbarDataStrategyV1 = {
		...base.strategy,
		captureOmission(context, request) {
			if (!check(context, request)) return { status: "conflict" };
			const expected = expectedCandidate(base, context, hidden, include, request.hiddenValues);
			if (!expected || expected.revision !== request.revision) return { status: "stale" };
			return { status: "found", instance: context.instance, revision: request.revision, candidate: expected.data };
		},
		captureLifecycle(context) {
			if (!allowed) return { status: "denied" };
			return base.strategy.captureLifecycle?.(context) ?? { status: "denied" };
		},
		validateLifecycle(context, request, fresh) {
			if (!allowed || request.contract !== "formbar-lifecycle-v1" || request.instance !== context.instance)
				return { status: "denied" };
			return base.strategy.validateLifecycle?.(context, request, () => allowed && fresh()) ?? { status: "denied" };
		},
		captureSubmission(context) {
			return allowed ? (base.strategy.captureSubmission?.(context) ?? { status: "denied" }) : { status: "denied" };
		},
		submitCaptured(context, request, fresh) {
			return allowed
				? (base.strategy.submitCaptured?.(context, request, () => allowed && fresh()) ?? { status: "denied" })
				: { status: "denied" };
		},
		writeDirect(context, request) {
			if (!allowed) return { status: "denied" };
			const result = base.strategy.writeDirect?.(context, request) ?? { status: "unsupported" as const };
			if (result.status === "applied") scoped.cancel(context.instance);
			return result;
		},
		installScopedValidation(context, validators) {
			if (!allowed || validators.some(({ validate }) => typeof validate !== "function")) return { status: "denied" };
			const state = base.instances.get(context.instance);
			if (!state) return { status: "denied" };
			state.scoped = validators;
			return { status: "installed" };
		},
		notifyScopedValidation: scoped.notify,
		cancelScopedValidation(context) {
			scoped.cancel(context.instance);
			const state = base.instances.get(context.instance);
			if (state) state.closed = true;
		},
		resetLifecycle(context, request) {
			if (
				!allowed ||
				request.contract !== "formbar-lifecycle-v1" ||
				request.instance !== context.instance ||
				request.revision !== base.instances.get(context.instance)?.revision
			)
				return { status: "denied" };
			scoped.cancel(context.instance);
			return base.strategy.resetLifecycle?.(context, request) ?? { status: "unsupported" };
		},
		validateOutgoingCandidate: (context, request, fresh) =>
			matches(context, request) ? candidate.validate(context, request, fresh) : { status: "conflict" },
		submitOmission: (context, request, fresh) => {
			if (matches(context, request)) return candidate.submit(context, request, fresh);
			candidate.discard(request.proof);
			return { status: "conflict" };
		},
	};
	return {
		...base,
		strategy,
		setHidden(value: boolean) {
			hidden = value;
			base.setHidden(value);
		},
		setInclude(value: boolean) {
			include = value;
		},
		revoke: () => {
			allowed = false;
			base.revoke();
			candidate.revoke();
			for (const instance of base.instances.keys()) scoped.cancel(instance);
		},
		regrant: () => {
			allowed = true;
			base.regrant();
			candidate.revoke();
			for (const state of base.instances.values()) state.closed = false;
		},
	};
}
