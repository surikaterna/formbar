import { compileExpression, standardV1 } from "kuery/expression";
import type { CompiledExpression, ExpressionDiagnosticCode } from "kuery/expression";
import { isAsync } from "./async.js";
import { Capabilities, capabilityFailure } from "./capabilities.js";
import { EXPRESSION_LIMITS, stateReferenceCodec } from "./compile.js";
import type {
	DiagnosticCode,
	JsonValue,
	NamespaceProvider,
	Observation,
	Program,
	PropDefinitions,
	ResolvedProps,
	Result,
	ServiceOptions,
	Setter,
	StateRef,
} from "./contracts.js";
import { copyJson } from "./json.js";
import { createObservation } from "./observation.js";
import { createPropObservation } from "./props.js";
import { dependencyKey, parseScopes } from "./references.js";
import { ExpressionError, failure } from "./result.js";

export class ExpressionService {
	private readonly programs = new WeakMap<Program, CompiledExpression<StateRef>>();
	readonly capabilities: Capabilities;
	private readonly options: ServiceOptions;

	constructor(options: ServiceOptions) {
		this.options = {
			...options,
			...(options.scopes !== undefined ? { scopes: parseScopes(options.scopes) } : {}),
		};
		this.capabilities = new Capabilities(options);
	}

	compile(input: unknown): Result<Program> {
		if (this.capabilities.disposed) return failure("disposed");
		try {
			const compiled = compileExpression<StateRef>(copyJson(input), {
				profile: this.options.profile ?? standardV1,
				reference: stateReferenceCodec(this.options.scopes),
				limits: EXPRESSION_LIMITS,
			});
			if (!compiled.ok) return failure(kueryDiagnosticCode(compiled.diagnostic.code));
			const dependencies = [...compiled.value.dependencies].sort((left, right) =>
				dependencyKey(left).localeCompare(dependencyKey(right)),
			);
			const program = Object.freeze({
				expression: compiled.value.expression,
				dependencies: Object.freeze(dependencies),
			});
			this.programs.set(program, compiled.value);
			return { ok: true, value: program };
		} catch (error) {
			return failure(error instanceof ExpressionError ? error.code : "backend");
		}
	}

	/** A context override is trusted host input, still subject to this service's authorization. */
	evaluate(program: Program, context?: Readonly<Record<string, NamespaceProvider>>): Result<JsonValue> {
		if (this.capabilities.disposed) return failure("disposed");
		const compiled = this.programs.get(program);
		if (!compiled) return failure("unknown-program");
		try {
			const providers = context ? new Map(Object.entries(context)) : undefined;
			const frame = this.capabilities.capture(program.dependencies, providers);
			const result = compiled.evaluate((ref: StateRef) => {
				return frame.get(dependencyKey(ref)) ?? { found: false, reason: "denied" };
			});
			if (isAsync(result)) return failure("backend");
			if (!result.ok) return failure(kueryDiagnosticCode(result.diagnostic.code));
			return { ok: true, value: copyJson(result.value) };
		} catch (error) {
			return failure(error instanceof ExpressionError ? error.code : "backend");
		}
	}

	resolveWritable(program: Program, active?: () => boolean): Result<Setter> {
		if (!this.programs.has(program)) return failure("unknown-program");
		if (program.expression.kind !== "ref") return failure("read-only");
		return this.capabilities.writable(program.expression.ref, active);
	}

	writeTarget(program: Program): readonly unknown[] {
		try {
			return program.expression.kind === "ref" ? this.capabilities.target(program.expression.ref) : [];
		} catch (error) {
			return [JSON.stringify(capabilityFailure(error))];
		}
	}

	observe(program: Program): Observation<Result<JsonValue>> {
		return createObservation(
			(_, disposed) => (disposed ? failure("disposed") : this.evaluate(program)),
			this.capabilities.subscribe,
			undefined,
			this.capabilities.lifecycle,
		);
	}

	resolveProps(definitions: PropDefinitions): Observation<ResolvedProps> {
		return createPropObservation(this, definitions);
	}
	registerNamespace(name: string, provider?: NamespaceProvider): void {
		this.capabilities.registerNamespace(name, provider);
	}
	invalidateAuthorization(): void {
		this.capabilities.invalidateAuthorization();
	}
	getLifecycleDiagnostics() {
		return this.capabilities.lifecycle.getDiagnostics();
	}
	dispose(): void {
		this.capabilities.dispose();
	}
}

export const createExpressionService = (options: ServiceOptions): ExpressionService => new ExpressionService(options);

function kueryDiagnosticCode(code: ExpressionDiagnosticCode): DiagnosticCode {
	const codes: Partial<Record<ExpressionDiagnosticCode, DiagnosticCode>> = {
		EXPRESSION_INVALID_INPUT: "invalid-input",
		EXPRESSION_LIMIT_EXCEEDED: "limit",
		EXPRESSION_INVALID_REFERENCE: "invalid-input",
		EXPRESSION_UNKNOWN_OPERATOR: "unsupported-operator",
		EXPRESSION_INVALID_ARITY: "arity",
		EXPRESSION_TYPE_MISMATCH: "type",
		EXPRESSION_DIVISION_BY_ZERO: "division-zero",
		EXPRESSION_NON_FINITE_RESULT: "non-finite",
		EXPRESSION_REFERENCE_ERROR: "backend",
		EXPRESSION_REFERENCE_MISSING: "missing",
		EXPRESSION_REFERENCE_DENIED: "denied",
		EXPRESSION_OPERATOR_ERROR: "backend",
		EXPRESSION_ASYNC_UNSUPPORTED: "backend",
		EXPRESSION_EVALUATION_LIMIT: "limit",
		EXPRESSION_INVALID_RESULT: "backend",
	} as const;
	return codes[code] ?? "backend";
}
