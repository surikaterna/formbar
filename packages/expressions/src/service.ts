import { isAsync } from "./async.js";
import { Capabilities, capabilityFailure } from "./capabilities.js";
import { collectDependencies, validateExpression } from "./compile.js";
import type {
	BackendProgram,
	JsonValue,
	NamespaceProvider,
	Observation,
	Program,
	PropDefinitions,
	ResolvedProps,
	Result,
	ServiceOptions,
	Setter,
} from "./contracts.js";
import { copyJson } from "./json.js";
import { createObservation } from "./observation.js";
import { createPropObservation } from "./props.js";
import { dependencyKey, parseScopes } from "./references.js";
import { ExpressionError, diagnosticCode, failure } from "./result.js";

export class ExpressionService {
	private readonly programs = new WeakMap<Program, BackendProgram>();
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
			const expression = validateExpression(input, this.options.scopes);
			const compiled = this.options.backend.compile(expression);
			if (isAsync(compiled)) return failure("backend");
			if (!compiled || typeof compiled.ok !== "boolean") return failure("backend");
			if (!compiled.ok)
				return {
					ok: false,
					diagnostics: compiled.diagnostics.slice(0, 32).map(({ code }) => ({ code: diagnosticCode(code) })),
				};
			if (typeof compiled.value?.evaluate !== "function") return failure("backend");
			const program = Object.freeze({ expression, dependencies: collectDependencies(expression) });
			this.programs.set(program, compiled.value);
			return { ok: true, value: program };
		} catch (error) {
			return failure(error instanceof ExpressionError ? error.code : "backend");
		}
	}

	/** A context override is trusted host input, still subject to this service's authorization. */
	evaluate(program: Program, context?: Readonly<Record<string, NamespaceProvider>>): Result<JsonValue> {
		if (this.capabilities.disposed) return failure("disposed");
		const backend = this.programs.get(program);
		if (!backend) return failure("unknown-program");
		try {
			const read = this.capabilities.reader(context ? new Map(Object.entries(context)) : undefined);
			const values = new Map(program.dependencies.map((ref) => [dependencyKey(ref), read(ref)]));
			const value = backend.evaluate((ref) => {
				const key = dependencyKey(ref);
				const value = values.get(key);
				if (value === undefined) throw new ExpressionError("denied");
				return value;
			});
			if (isAsync(value)) return failure("backend");
			return { ok: true, value: copyJson(value) };
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
