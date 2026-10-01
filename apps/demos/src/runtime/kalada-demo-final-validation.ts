import type { JsonValue } from "@formbar/declarative";
import type { DemoSession } from "./kalada-demo-session";
import { clone } from "./kalada-demo-state";

/** FINAL cancellation belongs to this attempt, never to a replacement attempt's controller. */
export async function validateFinal(session: DemoSession, candidate: JsonValue, signal?: AbortSignal) {
	const controller = new AbortController();
	const dataSignal = session.store.controller.signal;
	const abort = () => controller.abort();
	dataSignal.addEventListener("abort", abort, { once: true });
	signal?.addEventListener("abort", abort, { once: true });
	if (signal?.aborted || dataSignal.aborted) abort();
	try {
		return (
			await Promise.all(session.store.validators.map((check) => check(clone(candidate), controller.signal)))
		).flat();
	} finally {
		dataSignal.removeEventListener("abort", abort);
		signal?.removeEventListener("abort", abort);
	}
}
