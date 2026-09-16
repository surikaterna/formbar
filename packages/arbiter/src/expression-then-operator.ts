import type { ThenOperatorHandler, ThenOperatorRegistry } from "@arbitre/core";
import { ExpressionError, createExpressionService, synchronousValue } from "@formbar/expressions";
import type { Authorization, Expression, ExpressionProfile, NamespaceProvider, Program } from "@formbar/expressions";

export const FORMBAR_VALUE_THEN_OPERATOR = "$formbarValue";

export interface ExpressionThenOperatorOptions {
	readonly programs: ReadonlyMap<string, Expression>;
	readonly profile?: ExpressionProfile;
	readonly authorize?: Authorization;
	/** Select trusted external roots from the current incoming stage scope. */
	readonly namespaces?: (scope: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;
}

export interface RegisteredExpressionThenOperator {
	readonly handler: ThenOperatorHandler;
	dispose(): void;
}

function providers(roots: Readonly<Record<string, unknown>>): Record<string, NamespaceProvider> {
	return Object.fromEntries(
		Object.entries(roots).map(([name, root]) => [name, { getSnapshot: () => root, subscribe: () => () => {} }]),
	);
}

function plainRootMap(value: unknown): value is Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== "object") return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	return Reflect.ownKeys(value).every((key) => {
		if (typeof key !== "string") return false;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
	});
}

function scopeProviders(
	options: ExpressionThenOperatorOptions,
	scope: Readonly<Record<string, unknown>>,
): Record<string, NamespaceProvider> {
	try {
		const selected = options.namespaces ? synchronousValue(options.namespaces(scope)) : {};
		if (!plainRootMap(selected)) throw new ExpressionError("adapter");
		const data = Object.fromEntries(Object.entries(scope).filter(([key]) => !key.startsWith("$")));
		return providers({ ...selected, data, ui: scope.$ui });
	} catch {
		throw new ExpressionError("adapter");
	}
}

function compilePrograms(options: ExpressionThenOperatorOptions) {
	const service = createExpressionService({
		...(options.profile ? { profile: options.profile } : {}),
		...(options.authorize ? { authorize: options.authorize } : {}),
	});
	const programs = new Map<string, Program>();
	try {
		for (const [id, expression] of options.programs) {
			if (typeof id !== "string") throw new ExpressionError("invalid-input");
			const compiled = service.compile(expression);
			if (!compiled.ok) throw new ExpressionError(compiled.diagnostics[0].code);
			programs.set(id, compiled.value);
		}
		return { service, programs };
	} catch (error) {
		service.dispose();
		programs.clear();
		throw error;
	}
}

/** Registers Formbar's atomic expression stage in an Arbitre 0.3 public registry. */
export function registerExpressionThenOperator(
	registry: ThenOperatorRegistry,
	options: ExpressionThenOperatorOptions,
): RegisteredExpressionThenOperator {
	if (registry.has(FORMBAR_VALUE_THEN_OPERATOR)) throw new ExpressionError("invalid-input");
	const { service, programs } = compilePrograms(options);
	let disposed = false;
	const handler: ThenOperatorHandler = (entries, scope, write) => {
		if (disposed) throw new ExpressionError("disposed");
		const selected: Array<readonly [string, Program]> = [];
		for (const [path, id] of entries) {
			if (typeof id !== "string") throw new ExpressionError("invalid-input");
			const program = programs.get(id);
			if (!program) throw new ExpressionError("unknown-program");
			selected.push([path, program]);
		}
		const context = scopeProviders(options, scope);
		const values = selected.map(([, program]) => {
			const result = service.evaluate(program, context);
			if (!result.ok) throw new ExpressionError(result.diagnostics[0].code);
			return result.value;
		});
		for (let index = 0; index < selected.length; index++) write(selected[index][0], values[index]);
	};
	try {
		registry.register(FORMBAR_VALUE_THEN_OPERATOR, handler);
	} catch {
		service.dispose();
		programs.clear();
		throw new ExpressionError("adapter");
	}
	return {
		handler,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			service.dispose();
			programs.clear();
		},
	};
}
