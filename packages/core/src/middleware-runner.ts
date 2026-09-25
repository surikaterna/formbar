import type {
	Middleware,
	MiddlewareDecision,
	MiddlewareInitContext,
	NotifyHookContextMap,
	VetoHookContextMap,
} from "./contracts.js";
import { FormbarError } from "./errors.js";
import { DEFAULT_RUNTIME_CONSTRAINTS, withTimeout } from "./timeout.js";

/** Run veto-capable hooks synchronously (for non-submit pipeline path) */
export function runVetoHooksSync<K extends keyof VetoHookContextMap>(
	middlewares: readonly Middleware[],
	hookName: K,
	context: VetoHookContextMap[K],
	checkpoint?: () => boolean,
): MiddlewareDecision {
	for (const mw of middlewares) {
		if (checkpoint && !checkpoint()) return { action: "continue" };
		const hook = mw[hookName];
		if (!hook) continue;
		try {
			// Justified: TS cannot correlate generic K between hook and context in a loop;
			// callers are type-safe via the generic constraint on K
			const result = (hook as (ctx: VetoHookContextMap[K]) => MiddlewareDecision | Promise<MiddlewareDecision>)(
				context,
			);
			if (checkpoint && !checkpoint()) return { action: "continue" };
			if (isPromiseLike(result)) {
				throw new FormbarError(
					"FORMBAR_ASYNC_IN_SYNC_PIPELINE",
					`Middleware "${mw.id}" returned a Promise from ${String(hookName)}. Use the async pipeline path for async middleware.`,
				);
			}
			if (result && typeof result === "object" && "action" in result) {
				if ((result as MiddlewareDecision).action === "veto") {
					return result as MiddlewareDecision;
				}
			}
		} catch (err) {
			if (checkpoint && !checkpoint()) return { action: "continue" };
			if (err instanceof FormbarError) throw err;
			return { action: "veto", reason: `Middleware "${mw.id}" threw in ${String(hookName)}` };
		}
	}
	return { action: "continue" };
}

/** Run notification hooks synchronously (for non-submit pipeline path) */
export function runNotifyHooksSync<K extends keyof NotifyHookContextMap>(
	middlewares: readonly Middleware[],
	hookName: K,
	context: NotifyHookContextMap[K],
	checkpoint?: () => boolean,
): void {
	for (const mw of middlewares) {
		if (checkpoint && !checkpoint()) return;
		const hook = mw[hookName];
		if (!hook) continue;
		try {
			// Justified: TS correlated-types limitation — callers are type-safe via generic K
			(hook as (ctx: NotifyHookContextMap[K]) => void)(context);
		} catch {
			// Swallow errors in sync notify hooks to match async variant behavior
		}
		if (checkpoint && !checkpoint()) return;
	}
}

/** Run veto-capable hooks with async support and timeout */
export async function runVetoHooksAsync<K extends keyof VetoHookContextMap>(
	middlewares: readonly Middleware[],
	hookName: K,
	context: VetoHookContextMap[K],
	timeoutMs: number = DEFAULT_RUNTIME_CONSTRAINTS.middlewareTimeout,
): Promise<MiddlewareDecision> {
	for (const mw of middlewares) {
		const hook = mw[hookName];
		if (!hook) continue;
		try {
			// Justified: TS correlated-types limitation — callers are type-safe via generic K
			const result = (hook as (ctx: VetoHookContextMap[K]) => MiddlewareDecision | Promise<MiddlewareDecision>)(
				context,
			);
			const decision = isPromiseLike(result)
				? await withTimeout(
						result as Promise<MiddlewareDecision>,
						timeoutMs,
						`Middleware "${mw.id}" timed out in ${String(hookName)}`,
					)
				: (result as MiddlewareDecision);
			if (decision?.action === "veto") return decision;
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			return { action: "veto", reason };
		}
	}
	return { action: "continue" };
}

/** Run notification hooks with async support and timeout */
export async function runNotifyHooksAsync<K extends keyof NotifyHookContextMap>(
	middlewares: readonly Middleware[],
	hookName: K,
	context: NotifyHookContextMap[K],
	timeoutMs: number = DEFAULT_RUNTIME_CONSTRAINTS.middlewareTimeout,
): Promise<void> {
	for (const mw of middlewares) {
		const hook = mw[hookName];
		if (!hook) continue;
		try {
			// Justified: TS correlated-types limitation — callers are type-safe via generic K
			const result = (hook as (ctx: NotifyHookContextMap[K]) => unknown)(context);
			if (isPromiseLike(result)) {
				await withTimeout(
					result as Promise<unknown>,
					timeoutMs,
					`Middleware "${mw.id}" timed out in ${String(hookName)}`,
				);
			}
		} catch {
			// Swallow errors/timeouts in notify hooks
		}
	}
}

/** Run onInit on all middlewares in registration order */
export function initMiddlewares(middlewares: readonly Middleware[], context: MiddlewareInitContext): void {
	for (const mw of middlewares) {
		if (mw.onInit) {
			try {
				mw.onInit(context);
			} catch {
				// Swallow init errors
			}
		}
	}
}

/** Run onDispose on all middlewares in registration order */
export function disposeMiddlewares(middlewares: readonly Middleware[]): void {
	for (const mw of middlewares) {
		if (mw.onDispose) {
			try {
				mw.onDispose();
			} catch {
				// Swallow dispose errors
			}
		}
	}
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return value !== null && typeof value === "object" && typeof (value as { then?: unknown }).then === "function";
}
