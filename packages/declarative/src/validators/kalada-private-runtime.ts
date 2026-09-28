import { type JsonValue, copyJson } from "@formbar/expressions";
import { compileKaladaV1Program, isDuration, isInstant, isOption, isResult } from "@kalada/core";
import type { CompiledKaladaV1Program, KaladaValue } from "@kalada/core";
import type { DataContext, FormbarDataStrategyV1, ReadScope } from "./kalada-data-strategy.js";
import { admitKaladaDefinitionWithPolicy } from "./kalada-definition-policy.js";
import type { AdmittedDefinition } from "./kalada-definition.js";
import type { AdmissionPolicy, PolicyIdentity } from "./kalada-policy.js";
import { type KaladaReference, ProgramAdmissionError } from "./kalada-program.js";
import { resolveStaticReference } from "./static-references.js";

// Audited #302 source-built @kalada/core@0.6.0 pack, not a production dependency.
export const KALADA_RUNTIME_ARTIFACT =
	"@kalada/core@0.6.0:44c8bd208fa4b1d0588821345a5b84eb521619acf7ecaf6eddabd1a79e63c0be";

type Gate = "boolean" | "json";
interface PreparedSlot {
	readonly compiled: CompiledKaladaV1Program<KaladaReference>;
	readonly gate: Gate;
	readonly enclosingScope?: string;
}
export type PrivateEvaluation =
	| { readonly ok: true; readonly value: JsonValue }
	| { readonly ok: false; readonly path: string; readonly code: string };

interface RuntimeOptions {
	readonly definition: unknown;
	readonly policy: AdmissionPolicy;
	readonly identity: PolicyIdentity;
	readonly strategy: FormbarDataStrategyV1;
}

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

function validScope(scope: ReadScope, enclosing: string | undefined, admitted: AdmittedDefinition): boolean {
	const expected: string[] = [];
	let name = enclosing;
	while (name !== undefined) {
		expected.unshift(name);
		name = admitted.scopes[name]?.parent;
		if (expected.length > 32) return false;
	}
	return (
		scope.rows.length === expected.length &&
		scope.rows.every(
			(row, index) => row.name === expected[index] && typeof row.token === "object" && row.token !== null,
		)
	);
}

function safeResult(value: unknown, kind: Gate, path: string): PrivateEvaluation {
	if (isOption(value) || isResult(value) || isInstant(value) || isDuration(value))
		return { ok: false, path, code: "INVALID_RESULT_TYPE" };
	if (kind === "boolean" && typeof value !== "boolean") return { ok: false, path, code: "BOOLEAN_REQUIRED" };
	try {
		return { ok: true, value: copyJson(value) };
	} catch {
		return { ok: false, path, code: "NON_JSON_RESULT" };
	}
}

function evaluateFrame(args: {
	readonly slot: PreparedSlot;
	readonly path: string;
	readonly scope: ReadScope;
	readonly admitted: AdmittedDefinition;
	readonly strategy: FormbarDataStrategyV1;
	readonly context: DataContext;
	readonly valid: () => boolean;
}): PrivateEvaluation {
	const { slot, path, scope, admitted, strategy, context, valid } = args;
	try {
		const frame = strategy.capture(context);
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

function installationMatches(
	strategy: FormbarDataStrategyV1,
	context: DataContext,
	policy: AdmissionPolicy,
	identity: PolicyIdentity,
): boolean {
	const installed = strategy.identity(context);
	return (
		strategy.contract === "formbar-data-strategy-v1" &&
		installed.artifact === KALADA_RUNTIME_ARTIFACT &&
		installed.policyGeneration === policy.generation &&
		installed.policyGeneration === identity.generation &&
		installed.policyFingerprint === policy.fingerprint &&
		installed.policyFingerprint === identity.fingerprint
	);
}

/** Private per-form proof. Neither static admission nor public Kuery runtime installs an adapter. */
export function createPrivateKaladaRuntime(options: RuntimeOptions) {
	const { strategy, policy, identity } = options;
	const context: DataContext = Object.freeze({
		instance: Object.freeze({}),
		policyGeneration: identity.generation,
		policyFingerprint: identity.fingerprint,
	});
	const matches = () => installationMatches(strategy, context, policy, identity);
	if (!matches()) throw new ProgramAdmissionError("root", "STALE_INSTALLATION");
	const admitted = admitKaladaDefinitionWithPolicy(options.definition, policy, identity);
	const slots = prepare(admitted);
	let disposed = false;
	let revision = 0;
	const unsubscribe = strategy.subscribe(context, () => {
		revision++;
	});
	return {
		evaluate(path: string, scope: ReadScope = { rows: [] }): PrivateEvaluation {
			const slot = slots.get(path);
			try {
				if (disposed || !matches()) return { ok: false, path, code: "STALE_INSTALLATION" };
			} catch {
				return { ok: false, path, code: "STALE_INSTALLATION" };
			}
			if (!slot) return { ok: false, path, code: "UNKNOWN_SLOT" };
			if (!validScope(scope, slot.enclosingScope, admitted)) return { ok: false, path, code: "INVALID_SCOPE" };
			const start = revision;
			return evaluateFrame({
				slot,
				path,
				scope,
				admitted,
				strategy,
				context,
				valid: () => !disposed && revision === start && matches(),
			});
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			revision++;
			unsubscribe();
		},
	};
}
