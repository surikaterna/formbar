import { copyJson } from "@formbar/expressions";
import { compileKaladaV1Program } from "@kalada/core";
import type { CompiledKaladaV1Program, KaladaValue } from "@kalada/core";
import type {
	DataContext,
	DataFrame,
	EnumeratedRow,
	FormbarDataStrategyV1,
	ReadScope,
} from "./kalada-data-strategy.js";
import { admitKaladaDefinitionWithPolicy } from "./kalada-definition-policy.js";
import type { AdmittedDefinition } from "./kalada-definition.js";
import type { TrustedDirectLocations } from "./kalada-direct-location.js";
import { installationIdentityMatches } from "./kalada-installation-identity.js";
import type { AdmissionPolicy, PolicyIdentity } from "./kalada-policy.js";
import type { PreparedKaladaV1Definition } from "./kalada-prepared-definition.js";
import { privateLifecycle } from "./kalada-private-lifecycle.js";
import { privateOmission } from "./kalada-private-omission.js";
import { privateProjections } from "./kalada-private-projections.js";
import { cancelScoped408, privateScoped408 } from "./kalada-private-scoped-408.js";
import { privateSubmission } from "./kalada-private-submission.js";
import { type KaladaReference, ProgramAdmissionError } from "./kalada-program.js";
import { checkedRows } from "./kalada-row-check.js";
import { type Evaluation, safeResult, validScope } from "./kalada-runtime-gates.js";
import { resolveStaticReference } from "./static-references.js";

export { KALADA_RUNTIME_ARTIFACT } from "./kalada-artifact.js";

type Gate = "boolean" | "json";
interface PreparedSlot {
	readonly compiled: CompiledKaladaV1Program<KaladaReference>;
	readonly gate: Gate;
	readonly enclosingScope?: string;
}
export type PrivateEvaluation = Evaluation;

interface RuntimeOptions {
	readonly definition: unknown;
	readonly policy: AdmissionPolicy;
	readonly identity: PolicyIdentity;
	readonly strategy: FormbarDataStrategyV1;
	/** Supplied by the installing host, never by a definition or browser expression. */
	readonly directLocations?: TrustedDirectLocations | undefined;
}

export type PrivateRows =
	| { readonly ok: true; readonly rows: readonly EnumeratedRow[] }
	| { readonly ok: false; readonly path: string; readonly code: string };

function gate(path: string): Gate {
	return /\.(condition|visible|disabled|readOnly|required)$/.test(path) ? "boolean" : "json";
}

function prepare(admitted: AdmittedDefinition): Map<string, PreparedSlot> {
	const prepared = new Map<string, PreparedSlot>();
	for (const slot of admitted.slots) {
		if (slot.path.startsWith("computations[")) continue;
		const compiled = compileKaladaV1Program<KaladaReference>(slot.program, {
			reference: {
				validate: (ref): ref is KaladaReference => {
					try {
						resolveStaticReference(ref, admitted.scopes, slot.enclosingScope);
						return true;
					} catch {
						return false;
					}
				},
			},
		});
		if (!compiled.ok || JSON.stringify(compiled.value.program) !== JSON.stringify(slot.program))
			throw new ProgramAdmissionError(slot.path, "INVALID_PROGRAM");
		prepared.set(slot.path, {
			compiled: compiled.value,
			gate: gate(slot.path),
			...(slot.enclosingScope === undefined ? {} : { enclosingScope: slot.enclosingScope }),
		});
	}
	return prepared;
}

function evaluateFrame(args: {
	readonly slot: PreparedSlot;
	readonly path: string;
	readonly scope: ReadScope;
	readonly admitted: AdmittedDefinition;
	readonly strategy: FormbarDataStrategyV1;
	readonly context: DataContext;
	readonly valid: () => boolean;
	readonly frame: DataFrame;
}): PrivateEvaluation {
	const { slot, path, scope, admitted, strategy, context, valid, frame } = args;
	try {
		if (frame.token !== strategy.current(context) || !valid()) return { ok: false, path, code: "STALE_CAPTURE" };
		let stale = false;
		const outcome = slot.compiled.evaluate((reference) => {
			if (!valid() || frame.token !== strategy.current(context)) {
				stale = true;
				return { found: false, reason: "denied" };
			}
			const read = frame.read(resolveStaticReference(reference, admitted.scopes, slot.enclosingScope), scope);
			if (read.status === "stale") stale = true;
			if (read.status !== "found") return { found: false, reason: read.status === "missing" ? "missing" : "denied" };
			return { found: true, value: copyJson(read.value) as unknown as KaladaValue };
		});
		if (stale || !valid() || frame.token !== strategy.current(context))
			return { ok: false, path, code: "STALE_CAPTURE" };
		if (!outcome.ok) return { ok: false, path, code: outcome.diagnostic.code };
		const result = safeResult(outcome.value, slot.gate, path);
		return valid() && frame.token === strategy.current(context) ? result : { ok: false, path, code: "STALE_CAPTURE" };
	} catch {
		return { ok: false, path, code: "STRATEGY_ERROR" };
	}
}

function enumerateFrame(args: {
	readonly path: string;
	readonly parent: ReadScope;
	readonly capacity: number;
	readonly admitted: AdmittedDefinition;
	readonly frame: DataFrame;
	readonly fresh: () => boolean;
}): PrivateRows {
	const { path, parent, capacity, admitted, frame, fresh } = args;
	const failure = (code: string): PrivateRows => ({ ok: false, path: `${path}.binding`, code });
	try {
		if (!fresh()) return failure("STALE_CAPTURE");
		const name = admitted.repeaters.get(path);
		const binding = admitted.targets.get(`${path}.binding`);
		if (!name || !binding) return failure("UNKNOWN_REPEATER");
		if (!validScope(parent, admitted.scopes[name]?.parent, admitted)) return failure("INVALID_SCOPE");
		if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 1024) return failure("INVALID_CAPACITY");
		if (!frame.enumerateRows) return failure("ROW_ENUMERATION_UNAVAILABLE");
		const result = frame.enumerateRows(parent, binding, name, capacity);
		if (!fresh() || result.status === "stale") return failure("STALE_CAPTURE");
		if (result.status !== "found") {
			if (["missing", "denied", "capacity"].includes(result.status))
				return failure(`ROW_${result.status.toUpperCase()}`);
			return failure("INVALID_ROWS");
		}
		if (!Array.isArray(result.rows) || result.rows.length > capacity) return failure("ROW_CAPACITY");
		const rows = checkedRows(result.rows, parent, name, frame.token);
		if (!fresh()) return failure("STALE_CAPTURE");
		return rows ? { ok: true, rows } : failure("INVALID_ROWS");
	} catch {
		try {
			return failure(fresh() ? "STRATEGY_ERROR" : "STALE_CAPTURE");
		} catch {
			return failure("STRATEGY_ERROR");
		}
	}
}

function installationMatches(
	strategy: FormbarDataStrategyV1,
	context: DataContext,
	policy: AdmissionPolicy,
	identity: PolicyIdentity,
): boolean {
	const installed = strategy.identity(context);
	return (
		strategy.contract === "formbar-data-strategy-v1" &&
		policy.generation === identity.generation &&
		policy.fingerprint === identity.fingerprint &&
		installationIdentityMatches(installed, identity)
	);
}
function capturedTarget(args: {
	readonly path: string;
	readonly scope: ReadScope;
	readonly frame: DataFrame | undefined;
	readonly admitted: AdmittedDefinition;
	readonly context: DataContext;
	readonly fresh: () => boolean;
}): PrivateEvaluation {
	const { path, scope, frame, admitted, context, fresh } = args;
	try {
		if (!fresh() || frame?.instance !== context.instance) return { ok: false, path, code: "STALE_CAPTURE" };
		const target = admitted.targets.get(path);
		const owner = [...admitted.nodes.values()]
			.filter((node) => path.startsWith(`${node.path}.`))
			.sort((left, right) => right.path.length - left.path.length)[0];
		if (!target || !owner || !validScope(scope, owner.enclosingScope, admitted))
			return { ok: false, path, code: "INVALID_TARGET" };
		const read = frame.read(target, scope);
		if (!fresh() || read.status === "stale") return { ok: false, path, code: "STALE_CAPTURE" };
		if (read.status !== "found") return { ok: false, path, code: `TARGET_${read.status.toUpperCase()}` };
		const result = safeResult(read.value, "json", path);
		return fresh() ? result : { ok: false, path, code: "STALE_CAPTURE" };
	} catch {
		return { ok: false, path, code: "STRATEGY_ERROR" };
	}
}

function frameRevision(frame: DataFrame | undefined, context: DataContext, fresh: () => boolean): object | undefined {
	try {
		return fresh() && frame?.instance === context.instance ? frame.token : undefined;
	} catch {
		return undefined;
	}
}
function capturedRows(args: {
	readonly path: string;
	readonly parent: ReadScope;
	readonly capacity: number;
	readonly frame: DataFrame | undefined;
	readonly context: DataContext;
	readonly admitted: AdmittedDefinition;
	readonly valid: () => boolean;
	readonly disposed: () => boolean;
	readonly fresh: () => boolean;
}): PrivateRows {
	const { path, parent, capacity, frame, context, admitted, valid, disposed, fresh } = args;
	const bindingPath = `${path}.binding`;
	try {
		if (!valid()) return { ok: false, path: bindingPath, code: disposed() ? "STALE_INSTALLATION" : "STALE_CAPTURE" };
		if (!frame) return { ok: false, path: bindingPath, code: "STRATEGY_ERROR" };
		if (frame.instance !== context.instance) return { ok: false, path: bindingPath, code: "STALE_CAPTURE" };
		return enumerateFrame({ path, parent, capacity, admitted, frame, fresh });
	} catch {
		return { ok: false, path: bindingPath, code: "STRATEGY_ERROR" };
	}
}

function capturedSession(args: {
	readonly context: DataContext;
	readonly strategy: FormbarDataStrategyV1;
	readonly admitted: AdmittedDefinition;
	readonly slots: ReadonlyMap<string, PreparedSlot>;
	readonly valid: () => boolean;
	readonly disposed: () => boolean;
}) {
	const { context, strategy, admitted, slots, valid, disposed } = args;
	let frame: DataFrame | undefined;
	try {
		if (valid()) frame = strategy.capture(context);
	} catch {
		// Failure is surfaced at the requested declaration path, not during capture.
	}
	const fresh = () => valid() && !!frame && frame.token === strategy.current(context);
	return {
		revision: () => frameRevision(frame, context, fresh),
		readTarget(path: string, scope: ReadScope = { rows: [] }): PrivateEvaluation {
			return capturedTarget({ path, scope, frame, admitted, context, fresh });
		},
		enumerateRows(path: string, parent: ReadScope = { rows: [] }, capacity = 1024): PrivateRows {
			return capturedRows({ path, parent, capacity, frame, context, admitted, valid, disposed, fresh });
		},
		evaluate(path: string, scope: ReadScope = { rows: [] }): PrivateEvaluation {
			const slot = slots.get(path);
			try {
				if (!valid()) return { ok: false, path, code: disposed() ? "STALE_INSTALLATION" : "STALE_CAPTURE" };
				if (!slot) return { ok: false, path, code: "UNKNOWN_SLOT" };
				if (!validScope(scope, slot.enclosingScope, admitted)) return { ok: false, path, code: "INVALID_SCOPE" };
				if (!frame) return { ok: false, path, code: "STRATEGY_ERROR" };
				if (frame.instance !== context.instance) return { ok: false, path, code: "STALE_CAPTURE" };
				return evaluateFrame({ slot, path, scope, admitted, strategy, context, valid, frame });
			} catch {
				return { ok: false, path, code: "STRATEGY_ERROR" };
			}
		},
	};
}

function standaloneRead(args: {
	readonly path: string;
	readonly scope: ReadScope;
	readonly slots: ReadonlyMap<string, PreparedSlot>;
	readonly admitted: AdmittedDefinition;
	readonly strategy: FormbarDataStrategyV1;
	readonly context: DataContext;
	readonly valid: () => boolean;
}): PrivateEvaluation {
	const { path, scope, slots, admitted, strategy, context, valid } = args;
	const slot = slots.get(path);
	try {
		if (!valid()) return { ok: false, path, code: "STALE_INSTALLATION" };
	} catch {
		return { ok: false, path, code: "STALE_INSTALLATION" };
	}
	if (!slot) return { ok: false, path, code: "UNKNOWN_SLOT" };
	if (!validScope(scope, slot.enclosingScope, admitted)) return { ok: false, path, code: "INVALID_SCOPE" };
	let frame: DataFrame;
	try {
		frame = strategy.capture(context);
	} catch {
		return { ok: false, path, code: "STRATEGY_ERROR" };
	}
	return evaluateFrame({ frame, slot, path, scope, admitted, strategy, context, valid });
}

function install(options: RuntimeOptions, prepared?: PreparedKaladaV1Definition) {
	const { strategy, policy, identity } = options;
	const context: DataContext =
		prepared?.context ??
		Object.freeze({
			instance: Object.freeze({}),
			policyGeneration: identity.generation,
			policyFingerprint: identity.fingerprint,
		});
	const matches = () => installationMatches(strategy, context, policy, identity);
	if (!matches()) throw new ProgramAdmissionError("root", "STALE_INSTALLATION");
	const admitted = prepared?.admitted ?? admitKaladaDefinitionWithPolicy(options.definition, policy, identity);
	const slots = prepare(admitted);
	return {
		context,
		strategy,
		admitted,
		slots,
		matches,
		definition: options.definition,
		policy,
		directLocations: options.directLocations,
	};
}
function captureRuntime(installed: ReturnType<typeof install>, valid: () => boolean, disposed: () => boolean) {
	const { context, strategy, admitted, slots } = installed;
	return capturedSession({ context, strategy, admitted, slots, valid, disposed });
}

function liveRead(
	installed: ReturnType<typeof install>,
	valid: () => boolean,
	path: string,
	scope: ReadScope,
): PrivateEvaluation {
	const { slots, admitted, strategy, context } = installed;
	return standaloneRead({ path, scope, slots, admitted, strategy, context, valid });
}

function projectionPorts(installed: ReturnType<typeof install>, live: () => boolean, revision: () => number) {
	const { admitted, strategy, context, slots } = installed;
	return privateProjections({
		admitted,
		definition: installed.definition,
		policy: installed.policy,
		locations: installed.directLocations,
		strategy,
		context,
		live,
		revision,
		validScope: (scope, enclosing) => validScope(scope, enclosing, admitted),
		evaluate: (path, scope) => standaloneRead({ path, scope, slots, admitted, strategy, context, valid: live }),
	});
}

function createRuntime(installed: ReturnType<typeof install>) {
	const { context, strategy, matches } = installed;
	let disposed = false;
	let revision = 0;
	const unsubscribe = strategy.subscribe(context, () => {
		revision++;
	});
	const live = () => !disposed && matches();
	const lifecycle = privateLifecycle(strategy, context, live);
	const ports = projectionPorts(installed, live, () => revision);
	return {
		...privateSubmission(strategy, context, live),
		lifecycle,
		notifyScoped: privateScoped408(strategy, context, live),
		omission: privateOmission(strategy, context, live),
		currentRevision: () => (live() ? strategy.current(context) : undefined),
		subscribe: (invalidate: () => void) => strategy.subscribe(context, invalidate),
		capture() {
			const start = revision;
			return captureRuntime(
				installed,
				() => !disposed && revision === start && matches(),
				() => disposed,
			);
		},
		...ports,
		evaluate(path: string, scope: ReadScope = { rows: [] }): PrivateEvaluation {
			const start = revision;
			return liveRead(installed, () => !disposed && revision === start && matches(), path, scope);
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			revision++;
			cancelScoped408(strategy, context);
			unsubscribe();
		},
	};
}
/** Private per-form proof. Neither static admission nor public Kuery runtime installs an adapter. */
export function createPrivateKaladaRuntime(options: RuntimeOptions) {
	return createRuntime(install(options));
}
/** The prepared boundary owns this instance and admission; it cannot silently mint a second form. */
export function createPrivateKaladaRuntimeFromPrepared(prepared: PreparedKaladaV1Definition) {
	return createRuntime(install(prepared, prepared));
}
