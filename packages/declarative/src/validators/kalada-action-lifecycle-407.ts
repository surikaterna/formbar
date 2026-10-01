import type { DataContext, FormbarDataStrategyV1, LifecycleResult } from "./kalada-data-strategy.js";

function committed(strategy: FormbarDataStrategyV1, context: DataContext, result: LifecycleResult) {
	if (result.status !== "applied" || result.revision !== strategy.current(context)) return false;
	const frame = strategy.captureLifecycle?.(context);
	return !!frame && !("status" in frame) && frame.instance === context.instance && frame.revision === result.revision;
}

/** An authoritative lifecycle commit may retire its own action frame; other aborts remain stale. */
export function committingLifecycle407(strategy: FormbarDataStrategyV1, complete: () => void): FormbarDataStrategyV1 {
	return {
		contract: strategy.contract,
		identity: (context) => strategy.identity(context),
		capture: (context) => strategy.capture(context),
		current: (context) => strategy.current(context),
		subscribe: (context, notify) => strategy.subscribe(context, notify),
		...(strategy.captureLifecycle
			? {
					captureLifecycle: (context: DataContext) =>
						strategy.captureLifecycle?.(context) ?? { status: "missing" as const },
				}
			: {}),
		...(strategy.resetLifecycle
			? {
					resetLifecycle(
						context: DataContext,
						request: Parameters<NonNullable<FormbarDataStrategyV1["resetLifecycle"]>>[1],
					) {
						const result = strategy.resetLifecycle?.(context, request) ?? { status: "unsupported" as const };
						if (committed(strategy, context, result)) complete();
						return result;
					},
				}
			: {}),
		...(strategy.validateLifecycle
			? {
					async validateLifecycle(
						context: DataContext,
						request: Parameters<NonNullable<FormbarDataStrategyV1["validateLifecycle"]>>[1],
						fresh: () => boolean,
					) {
						const result = (await strategy.validateLifecycle?.(context, request, fresh)) ?? {
							status: "unsupported" as const,
						};
						if (committed(strategy, context, result)) complete();
						return result;
					},
				}
			: {}),
	};
}
