import type { OperatorFunction } from "@arbitre/core";
import { ExpressionError, createExpressionService, synchronousValue } from "@formbar/expressions";
import type { Authorization, Expression, ExpressionProfile, NamespaceProvider, Program } from "@formbar/expressions";

export interface ExpressionOperatorOptions {
	readonly profile?: ExpressionProfile;
	readonly programs: Readonly<Record<string, Expression>>;
	readonly authorize?: Authorization;
	/** Explicit external roots selected from the actual current RHS scope by trusted host code. */
	readonly namespaces?: (scope: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;
}

function readProviders(roots: Readonly<Record<string, unknown>>): Record<string, NamespaceProvider> {
	return Object.fromEntries(
		Object.entries(roots).map(([name, root]) => [
			name,
			{
				getSnapshot: () => root,
				subscribe: () => () => {},
			},
		]),
	);
}

function scopeProviders(options: ExpressionOperatorOptions, scope: Readonly<Record<string, unknown>>) {
	try {
		const data = Object.fromEntries(Object.entries(scope).filter(([key]) => !key.startsWith("$")));
		return readProviders({ ...synchronousValue(options.namespaces?.(scope)), data, ui: scope.$ui });
	} catch {
		throw new ExpressionError("adapter");
	}
}

/** Register operator with createSession({ operators: { custom: { $formbarValue: bridge.operator } } }). */
export function createExpressionOperator(options: ExpressionOperatorOptions): {
	operator: OperatorFunction;
	dispose(): void;
} {
	let disposed = false;
	const service = createExpressionService({
		...(options.profile ? { profile: options.profile } : {}),
		...(options.authorize ? { authorize: options.authorize } : {}),
	});
	const programs = new Map<string, Program>();
	for (const [id, expression] of Object.entries(options.programs)) {
		const compiled = service.compile(expression);
		if (!compiled.ok) throw new ExpressionError(compiled.diagnostics[0].code);
		programs.set(id, compiled.value);
	}
	const operator: OperatorFunction = (args, scope) => {
		if (disposed) throw new ExpressionError("disposed");
		if (args.length !== 1 || typeof args[0] !== "string") throw new ExpressionError("invalid-input");
		const program = programs.get(args[0]);
		if (!program) throw new ExpressionError("unknown-program");
		const result = service.evaluate(program, scopeProviders(options, scope));
		if (!result.ok) throw new ExpressionError(result.diagnostics[0].code);
		return result.value;
	};
	return {
		operator,
		dispose: () => {
			disposed = true;
			service.dispose();
			programs.clear();
		},
	};
}
