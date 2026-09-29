import { copyJson } from "@formbar/expressions";
import type {
	DataContext,
	FormbarDataStrategyV1,
	SubmissionRequest,
	SubmissionResult,
} from "./kalada-data-strategy.js";

export function privateSubmission(strategy: FormbarDataStrategyV1, context: DataContext, live: () => boolean) {
	const captureSubmission = () => {
		try {
			if (!live()) return { status: "stale" as const };
			if (!strategy.captureSubmission) return { status: "unsupported" as const };
			const result = strategy.captureSubmission(context);
			if (result.status !== "found") return result;
			if (
				result.instance !== context.instance ||
				typeof result.revision !== "object" ||
				!result.revision ||
				!live() ||
				result.revision !== strategy.current(context)
			)
				return { status: "stale" as const };
			const request: SubmissionRequest = Object.freeze({
				contract: "formbar-submission-v1",
				instance: context.instance,
				revision: result.revision,
				data: copyJson(result.data),
			});
			return live() && request.revision === strategy.current(context)
				? { status: "found" as const, request }
				: { status: "stale" as const };
		} catch {
			return { status: "stale" as const };
		}
	};
	return {
		captureSubmission,
		async submit(): Promise<SubmissionResult> {
			const capture = captureSubmission();
			if (capture.status !== "found") return { status: capture.status };
			if (!strategy.submitCaptured) return { status: "unsupported" };
			try {
				if (!live() || strategy.current(context) !== capture.request.revision) return { status: "stale" };
				return await strategy.submitCaptured(
					context,
					capture.request,
					() => live() && strategy.current(context) === capture.request.revision,
				);
			} catch {
				return { status: "stale" };
			}
		},
	};
}
