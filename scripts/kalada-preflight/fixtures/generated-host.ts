import { copyJson } from "@formbar/expressions";
import { KALADA_RUNTIME_ARTIFACT } from "../../../packages/declarative/src/validators/kalada-artifact.js";
import type {
	DataContext,
	DirectWriteRequest,
	FormbarDataStrategyV1,
	ReadScope,
	SchemaValidationIssueV1,
	SchemaValidatorV1,
	ScopedValidatorV1,
} from "../../../packages/declarative/src/validators/kalada-data-strategy.js";

interface Row {
	readonly token: object;
	revision: object;
	quantity: string;
	readonly nested: Row[];
	readOnly: boolean;
}
interface State {
	revision: object;
	name: string;
	readonly rows: Row[];
	readonly listeners: Set<() => void>;
	outgoing?: unknown;
	validators?: readonly SchemaValidatorV1[];
	scoped?: readonly ScopedValidatorV1[];
	readonly scopedIssues: Map<string, readonly OwnedIssue[]>;
	readonly touched: Set<string>;
	closed: boolean;
	pending: number;
	issues: string[];
	issueRecords: readonly OwnedIssue[];
}

interface OwnedIssue extends SchemaValidationIssueV1 {
	readonly validator: number;
	readonly ordinal: number;
}

async function validateOwned(validators: readonly SchemaValidatorV1[], data: Parameters<SchemaValidatorV1>[0]) {
	const signal = new AbortController().signal;
	return (await Promise.all(validators.map((validator) => validator(data, signal)))).flatMap((issues, validator) =>
		issues.map((issue, ordinal) => ({ ...issue, validator, ordinal })),
	);
}

const row = (quantity: string, nested: Row[] = []): Row => ({
	token: {},
	revision: {},
	quantity,
	nested,
	readOnly: false,
});

export function generatedHost(
	outer: string,
	inner: string,
	omissionField?: string,
	origin?: Readonly<{
		validator: number;
		source: "schema" | "extension";
		path: readonly (string | number)[];
		message: string;
	}>,
) {
	const instances = new Map<object, State>();
	const proofs = new WeakMap<
		object,
		{ instance: object; revision: object; epoch: number; candidate: string; draft: string; issue?: OwnedIssue }
	>();
	const originating = (issue: OwnedIssue) =>
		origin !== undefined &&
		issue.validator === origin.validator &&
		issue.source === origin.source &&
		issue.message === origin.message &&
		JSON.stringify(issue.path) === JSON.stringify(origin.path);
	let hidden = true;
	let include = false;
	let revoked = false;
	let epoch = 0;
	const permitted = (context: DataContext) =>
		!revoked && context.policyGeneration === "g1" && context.policyFingerprint === "host";
	const state = (context: DataContext) => {
		let current = instances.get(context.instance);
		if (!current) {
			current = {
				revision: {},
				name: "original",
				rows: [row("first", [row("child")]), row("second")],
				listeners: new Set(),
				issues: [],
				issueRecords: [],
				scopedIssues: new Map(),
				touched: new Set(),
				closed: false,
				pending: 0,
			};
			instances.set(context.instance, current);
		}
		return current;
	};
	const selected = (current: State, scope: ReadScope): Row | undefined => {
		let siblings = current.rows;
		let chosen: Row | undefined;
		if (!Array.isArray(scope.rows) || scope.rows.length > 2) return;
		for (const [index, binding] of scope.rows.entries()) {
			if (binding.name !== (index === 0 ? outer : inner) || typeof binding.token !== "object" || binding.token === null)
				return;
			chosen = siblings.find((item) => item.token === binding.token);
			if (!chosen) return;
			siblings = chosen.nested;
		}
		return chosen;
	};
	const bump = (current: State) => {
		current.revision = {};
		current.pending = 0;
		current.scopedIssues.clear();
		for (const notify of current.listeners) notify();
	};
	const rowTarget = (reference: { namespace: string; path: readonly unknown[] }, scope: ReadScope) => {
		const path = reference.path;
		const marker = (part: unknown, name: string) =>
			!!part &&
			typeof part === "object" &&
			!Array.isArray(part) &&
			Object.keys(part).length === 1 &&
			"row" in part &&
			part.row === name;
		return (
			reference.namespace === "data" &&
			scope.rows.length === 2 &&
			scope.rows[0]?.name === outer &&
			scope.rows[1]?.name === inner &&
			path.length === 5 &&
			path[0] === "rows" &&
			marker(path[1], outer) &&
			path[2] === "nested" &&
			marker(path[3], inner) &&
			path[4] === "quantity"
		);
	};
	const ownsField = (current: State, path: string, scope: ReadScope) => {
		if (!Array.isArray(scope.rows)) return false;
		if (path === "root.children[0].children[0]") return scope.rows.length === 0;
		if (path !== "root.children[1].children[0].children[0].children[0].children[0]") return false;
		return (
			scope.rows.length === 2 &&
			scope.rows[0]?.name === outer &&
			scope.rows[1]?.name === inner &&
			!!selected(current, scope)
		);
	};
	const omissionInventory = (current: State) => [
		{
			field: { path: "root.children[0].children[0]", scope: { rows: [] } },
			visible: !hidden,
			...(include ? { submitWhenHidden: "include" as const } : {}),
		},
		...current.rows.flatMap((parent) =>
			parent.nested.map((child) => ({
				field: {
					path: "root.children[1].children[0].children[0].children[0].children[0]",
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
	const matchesOmission = (
		current: State,
		request: Parameters<NonNullable<FormbarDataStrategyV1["captureOmission"]>>[1],
	) => {
		const expected = omissionInventory(current);
		return (
			request.contract === "formbar-lifecycle-v1" &&
			(request.hiddenValues === "include" || request.hiddenValues === "omit-inactive") &&
			request.fields.length === expected.length &&
			expected.every((entry, index) => {
				const supplied = request.fields[index];
				return (
					supplied?.field.path === entry.field.path &&
					supplied.visible === entry.visible &&
					supplied.submitWhenHidden === ("submitWhenHidden" in entry ? entry.submitWhenHidden : undefined) &&
					supplied.field.scope.rows.length === entry.field.scope.rows.length &&
					entry.field.scope.rows.every(
						(binding, i) =>
							supplied.field.scope.rows[i]?.name === binding.name &&
							supplied.field.scope.rows[i]?.token === binding.token,
					)
				);
			})
		);
	};
	const lifecycleAllowed = (context: DataContext, request: { contract: string; instance: object; revision: object }) =>
		permitted(context) &&
		request.contract === "formbar-lifecycle-v1" &&
		request.instance === context.instance &&
		request.revision === state(context).revision;
	const candidateBytes = (
		context: DataContext,
		request: Parameters<NonNullable<FormbarDataStrategyV1["captureOmission"]>>[1],
	) => {
		const result = strategy.captureOmission?.(context, request);
		return result?.status === "found" ? JSON.stringify(result.candidate) : undefined;
	};
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity: () => ({ artifact: KALADA_RUNTIME_ARTIFACT, policyGeneration: "g1", policyFingerprint: "host" }),
		current: (context) => state(context).revision,
		subscribe(context, notify) {
			state(context).listeners.add(notify);
			return () => state(context).listeners.delete(notify);
		},
		initializeSchema(context, request) {
			const current = state(context);
			if (!permitted(context)) return { status: "denied" };
			if (request.instance !== context.instance || request.revision !== current.revision) return { status: "stale" };
			if (request.contract !== "formbar-schema-initialization-v1") return { status: "denied" };
			const defaults = request.defaults.filter(({ path }) => path.join(".") === "profile.name");
			if (defaults.length !== request.defaults.length || defaults.some(({ value }) => typeof value !== "string"))
				return { status: "denied" };
			const overrides = request.overrides;
			if (overrides !== undefined && (!overrides || typeof overrides !== "object" || Array.isArray(overrides)))
				return { status: "denied" };
			const profile = overrides && "profile" in overrides ? overrides.profile : undefined;
			if (profile !== undefined && (!profile || typeof profile !== "object" || Array.isArray(profile)))
				return { status: "denied" };
			const name = profile && "name" in profile ? profile.name : undefined;
			if (name !== undefined && typeof name !== "string") return { status: "denied" };
			current.name = name ?? (defaults[0]?.value as string | undefined) ?? current.name;
			bump(current);
			return { status: "applied", revision: current.revision };
		},
		installSchemaValidation(context, validators) {
			if (!permitted(context)) return { status: "denied" };
			state(context).validators = validators;
			return { status: "installed" };
		},
		installScopedValidation(context, validators) {
			if (!permitted(context) || !validators.every((entry) => typeof entry.validate === "function"))
				return { status: "denied" };
			state(context).scoped = validators;
			return { status: "installed" };
		},
		notifyScopedValidation(context, request) {
			const current = state(context);
			if (
				!lifecycleAllowed(context, request) ||
				current.closed ||
				request.instance !== context.instance ||
				request.revision !== current.revision
			)
				return { status: "stale" };
			if (!ownsField(current, request.field.path, request.field.scope)) return { status: "denied" };
			const key = JSON.stringify([request.field.path, request.field.scope.rows.map((binding) => binding.token)]);
			if (request.trigger === "onBlur") current.touched.add(key);
			const capture = strategy.captureSubmission?.(context);
			if (capture?.status !== "found") return { status: "stale" };
			for (const entry of current.scoped ?? []) {
				if (entry.field !== request.field.path || entry.trigger !== request.trigger) continue;
				const revision = current.revision;
				const grant = epoch;
				current.pending++;
				void Promise.resolve(entry.validate(capture.data, new AbortController().signal)).then(
					(issues) => {
						if (!permitted(context) || grant !== epoch || current.closed || revision !== current.revision) return;
						current.pending--;
						current.scopedIssues.set(
							JSON.stringify([entry.id, key]),
							issues.map((issue, ordinal) => ({ ...issue, validator: -1, ordinal })),
						);
						for (const notify of current.listeners) notify();
					},
					() => {
						if (!permitted(context) || grant !== epoch || current.closed || revision !== current.revision) return;
						current.pending--;
						current.scopedIssues.set(JSON.stringify([entry.id, key]), [
							{
								path: [],
								message: "Scoped validation failed",
								source: "extension",
								validator: -1,
								ordinal: 0,
							},
						]);
						for (const notify of current.listeners) notify();
					},
				);
			}
			for (const notify of current.listeners) notify();
			return { status: "applied", revision: current.revision };
		},
		cancelScopedValidation(context) {
			const current = state(context);
			current.closed = true;
			current.scopedIssues.clear();
		},
		captureLifecycle(context) {
			const current = state(context);
			if (!permitted(context) || current.closed) return { status: "denied" };
			const revision = current.revision;
			const grant = epoch;
			const status = {
				dirty: false,
				touched: false,
				validating: current.pending > 0,
				submitted: false,
				valid:
					current.pending === 0 &&
					current.issues.length === 0 &&
					[...current.scopedIssues.values()].every((issues) => !issues.length),
				issues: {
					schema: current.issueRecords
						.filter((issue) => issue.source === "schema" && !(omissionField && hidden && originating(issue)))
						.map((issue) => issue.message),
					extension: [
						...current.issueRecords.filter(
							(issue) => issue.source === "extension" && !(omissionField && hidden && originating(issue)),
						),
						...[...current.scopedIssues.values()].flat(),
					].map((issue) => issue.message),
				},
			};
			return {
				instance: context.instance,
				revision: current.revision,
				form: status,
				initial: { profile: { name: "original" }, rows: [] },
				field: ({ path, scope }) => {
					if (!permitted(context) || grant !== epoch || revision !== current.revision || current.closed)
						return { status: "stale" };
					if (!ownsField(current, path, scope)) return { status: "missing" };
					return {
						status: "found",
						value: {
							...status,
							touched: current.touched.has(JSON.stringify([path, scope.rows.map((binding) => binding.token)])),
						},
					};
				},
			};
		},
		async validateLifecycle(context, request, fresh) {
			const current = state(context);
			if (!lifecycleAllowed(context, request) || current.closed || !fresh()) return { status: "stale" };
			const grant = epoch;
			const capture = strategy.captureSubmission?.(context);
			if (capture?.status !== "found") return { status: "stale" };
			const issues = await validateOwned(current.validators ?? [], capture.data);
			if (
				!lifecycleAllowed(context, request) ||
				grant !== epoch ||
				current.closed ||
				!fresh() ||
				JSON.stringify(strategy.captureSubmission?.(context)) !== JSON.stringify(capture)
			)
				return { status: "stale" };
			current.issueRecords = issues;
			current.scopedIssues.clear();
			current.issues = issues
				.filter((issue) => !(omissionField && hidden && originating(issue)))
				.map((issue) => issue.message);
			for (const notify of current.listeners) notify();
			return { status: "applied", revision: current.revision };
		},
		resetLifecycle(context, request) {
			const current = state(context);
			if (!lifecycleAllowed(context, request) || current.closed) return { status: "stale" };
			current.name = "original";
			current.issues = [];
			current.issueRecords = [];
			current.scopedIssues.clear();
			current.touched.clear();
			bump(current);
			return { status: "applied", revision: current.revision };
		},
		capture(context) {
			const current = state(context);
			const revision = current.revision;
			const grant = epoch;
			return {
				instance: context.instance,
				token: revision,
				read(reference, scope) {
					if (!permitted(context) || grant !== epoch || current.revision !== revision) return { status: "stale" };
					if (
						reference.namespace === "ui" &&
						reference.path.length === 1 &&
						reference.path[0] === "nameVisible" &&
						!scope.rows.length
					)
						return { status: "found", value: !hidden };
					if (reference.namespace !== "data") return { status: "denied" };
					if (!scope.rows.length && reference.path.join(".") === "profile.name")
						return { status: "found", value: current.name };
					if (rowTarget(reference, scope)) {
						const item = selected(current, scope);
						return item ? { status: "found", value: item.quantity } : { status: "missing" };
					}
					return { status: "missing" };
				},
				enumerateRows(parent, _reference, name) {
					if (!permitted(context) || grant !== epoch || current.revision !== revision) return { status: "stale" };
					if (
						!Array.isArray(parent.rows) ||
						parent.rows.length > 1 ||
						(parent.rows.length === 1 && !selected(current, parent))
					)
						return { status: "denied" };
					if (name !== (parent.rows.length ? inner : outer)) return { status: "denied" };
					const source = parent.rows.length ? selected(current, parent)?.nested : current.rows;
					if (!source) return { status: "missing" };
					return {
						status: "found",
						rows: source.map((item, order) => ({
							token: item.token,
							order,
							writeRevision: item.revision,
							scope: { rows: [...parent.rows, { name, token: item.token }] },
						})),
					};
				},
			};
		},
		writeDirect(context, request: DirectWriteRequest) {
			const current = state(context);
			if (!permitted(context) || current.closed || request.contract !== "formbar-direct-write-v1")
				return { status: "denied" };
			if (request.expectedInstance !== context.instance || request.expectedRevision !== current.revision)
				return { status: "stale" };
			if (typeof request.value !== "string") return { status: "invalid-target" };
			if (
				request.targetKind === "non-repeater" &&
				!request.scope.rows.length &&
				request.reference.namespace === "data" &&
				request.reference.path.join(".") === "profile.name"
			) {
				current.name = request.value;
				bump(current);
				return { status: "applied" };
			}
			if (request.targetKind !== "row" || !rowTarget(request.reference, request.scope))
				return { status: "invalid-target" };
			const item = selected(current, request.scope);
			if (!item) return { status: "missing" };
			const parent = selected(current, { rows: request.scope.rows.slice(0, 1) });
			if (!parent || parent.readOnly || item.readOnly) return { status: "denied" };
			if (item.revision !== request.expectedRowRevision) return { status: "conflict" };
			item.quantity = request.value;
			item.revision = {};
			bump(current);
			return { status: "applied" };
		},
		captureSubmission(context) {
			const current = state(context);
			if (!permitted(context) || current.closed) return { status: "denied" };
			return {
				status: "found",
				instance: context.instance,
				revision: current.revision,
				data: {
					profile: { name: current.name },
					rows: current.rows.map((item) => ({
						nested: item.nested.map((child) => ({ quantity: child.quantity })),
					})),
				},
			};
		},
		captureOmission(context, request) {
			const current = state(context);
			if (!lifecycleAllowed(context, request) || current.closed) return { status: "denied" };
			if (!omissionField || !matchesOmission(current, request)) return { status: "conflict" };
			const capture = strategy.captureSubmission?.(context);
			if (capture?.status !== "found") return { status: "stale" };
			const candidate = copyJson(capture.data) as { profile: { name: string } };
			if (hidden && request.hiddenValues === "omit-inactive" && !request.fields[0]?.submitWhenHidden)
				return {
					status: "found",
					instance: context.instance,
					revision: current.revision,
					candidate: { ...candidate, profile: {} },
				};
			return { status: "found", instance: context.instance, revision: current.revision, candidate };
		},
		async validateOutgoingCandidate(context, request, fresh) {
			const current = state(context);
			if (!lifecycleAllowed(context, request) || current.closed || !fresh()) return { status: "stale" };
			const grant = epoch;
			const bytes = JSON.stringify(request.candidate);
			if (candidateBytes(context, request) !== bytes) return { status: "conflict" };
			const original = current.issueRecords.find(originating);
			const draft = JSON.stringify(strategy.captureSubmission?.(context));
			const issues = await validateOwned(current.validators ?? [], request.candidate);
			if (!lifecycleAllowed(context, request) || current.closed || grant !== epoch || !fresh())
				return { status: "stale" };
			if (candidateBytes(context, request) !== bytes) return { status: "conflict" };
			if (draft !== JSON.stringify(strategy.captureSubmission?.(context))) return { status: "stale" };
			const omitting =
				hidden &&
				request.hiddenValues === "omit-inactive" &&
				request.fields[0]?.field.path === omissionField &&
				!request.fields[0]?.submitWhenHidden;
			if (issues.some((issue) => !(omitting && originating(issue) && original && issue.ordinal === original.ordinal)))
				return { status: "invalid" };
			const proof = {};
			proofs.set(proof, {
				instance: context.instance,
				revision: request.revision,
				epoch: grant,
				candidate: bytes,
				draft,
				issue: original,
			});
			return { status: "applied", revision: request.revision, proof };
		},
		submitOmission(context, request, fresh) {
			const current = state(context);
			const proof = proofs.get(request.proof);
			proofs.delete(request.proof);
			if (
				!lifecycleAllowed(context, request) ||
				current.closed ||
				!fresh() ||
				request.instance !== context.instance ||
				request.revision !== current.revision
			)
				return { status: "stale" };
			if (candidateBytes(context, request) !== JSON.stringify(request.candidate)) return { status: "conflict" };
			if (
				!proof ||
				proof.instance !== context.instance ||
				proof.epoch !== epoch ||
				proof.issue !== current.issueRecords.find(originating) ||
				proof.draft !== JSON.stringify(strategy.captureSubmission?.(context)) ||
				proof.revision !== current.revision ||
				proof.candidate !== JSON.stringify(request.candidate)
			)
				return { status: "denied" };
			current.outgoing = copyJson(request.candidate);
			return { status: "submitted" };
		},
		submitCaptured(context, request, fresh) {
			const current = state(context);
			if (
				!permitted(context) ||
				request.contract !== "formbar-submission-v1" ||
				current.closed ||
				!fresh() ||
				request.instance !== context.instance ||
				request.revision !== current.revision
			)
				return { status: "stale" };
			const captured = strategy.captureSubmission?.(context);
			if (captured?.status !== "found" || JSON.stringify(captured.data) !== JSON.stringify(request.data))
				return { status: "conflict" };
			current.outgoing = copyJson(request.data);
			return { status: "submitted" };
		},
	};
	return {
		strategy,
		instances,
		bump,
		setHidden: (value: boolean) => {
			if (hidden === value) return;
			hidden = value;
			for (const current of instances.values()) bump(current);
		},
		setInclude: (value: boolean) => {
			include = value;
		},
		revoke: () => {
			revoked = true;
			epoch++;
		},
		regrant: () => {
			revoked = false;
			epoch++;
		},
	};
}
