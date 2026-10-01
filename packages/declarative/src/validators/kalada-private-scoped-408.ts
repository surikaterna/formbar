import type { DataContext, FormbarDataStrategyV1, LifecycleField } from "./kalada-data-strategy.js";
import { privateLifecycle } from "./kalada-private-lifecycle.js";

/** No client-side scheduling: the installed strategy alone owns scoped validation. */
export function privateScoped408(strategy: FormbarDataStrategyV1, context: DataContext, live: () => boolean) {
	const lifecycle = privateLifecycle(strategy, context, live);
	return (field: LifecycleField, trigger: "onChange" | "onBlur", revision: object) => {
		if (!strategy.notifyScopedValidation) return { status: "unsupported" as const };
		try {
			if (!live() || revision !== strategy.current(context)) return { status: "stale" as const };
			const owned = lifecycle.field(field);
			if (!owned.ok) return { status: "denied" as const };
			if (!live() || revision !== strategy.current(context)) return { status: "stale" as const };
			const result = strategy.notifyScopedValidation(context, {
				contract: "formbar-lifecycle-v1",
				instance: context.instance,
				revision,
				field,
				trigger,
			});
			return result.status === "applied" && result.revision === strategy.current(context) && live()
				? { status: "applied" as const }
				: { status: "denied" as const };
		} catch {
			return { status: "denied" as const };
		}
	};
}

export function cancelScoped408(strategy: FormbarDataStrategyV1, context: DataContext) {
	try {
		strategy.cancelScopedValidation?.(context);
	} catch {
		// Disposing is terminal even when the host rejects cancellation.
	}
}
