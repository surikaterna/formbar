import { copyJson } from "@formbar/expressions";
import type { DataContext, FormbarDataStrategyV1, OmissionRequest } from "./kalada-data-strategy.js";

export type OmissionDiagnostic =
	| "OMISSION_UNAVAILABLE"
	| "STALE_CAPTURE"
	| "OMISSION_DENIED"
	| "OMISSION_MISSING"
	| "OMISSION_CONFLICT"
	| "OMISSION_INVALID"
	| "STRATEGY_ERROR";
export type OmissionResult =
	| { readonly ok: true; readonly status: "submitted" }
	| { readonly ok: false; readonly code: OmissionDiagnostic };

function failure(status: string): OmissionResult {
	switch (status) {
		case "denied":
			return { ok: false, code: "OMISSION_DENIED" };
		case "missing":
			return { ok: false, code: "OMISSION_MISSING" };
		case "conflict":
			return { ok: false, code: "OMISSION_CONFLICT" };
		case "invalid":
			return { ok: false, code: "OMISSION_INVALID" };
		case "unsupported":
			return { ok: false, code: "OMISSION_UNAVAILABLE" };
		default:
			return { ok: false, code: "STALE_CAPTURE" };
	}
}

function boundRequest(
	request: Omit<OmissionRequest, "contract" | "instance" | "revision">,
	context: DataContext,
	revision: object,
): OmissionRequest {
	if (request.hiddenValues !== "include" && request.hiddenValues !== "omit-inactive") throw new Error("invalid mode");
	return Object.freeze({
		contract: "formbar-lifecycle-v1",
		instance: context.instance,
		revision,
		hiddenValues: request.hiddenValues,
		fields: Object.freeze(
			request.fields.map(({ field, visible, submitWhenHidden }) => {
				if (
					typeof field.path !== "string" ||
					typeof visible !== "boolean" ||
					!Array.isArray(field.scope.rows) ||
					(submitWhenHidden !== undefined && submitWhenHidden !== "include")
				)
					throw new Error("invalid directive");
				return Object.freeze({
					visible,
					field: Object.freeze({
						path: field.path,
						scope: Object.freeze({
							rows: Object.freeze(
								field.scope.rows.map(({ name, token }) => {
									if (typeof name !== "string" || typeof token !== "object" || token === null)
										throw new Error("invalid row identity");
									return Object.freeze({ name, token });
								}),
							),
						}),
					}),
					...(submitWhenHidden === "include" ? { submitWhenHidden } : {}),
				});
			}),
		),
	});
}

/** Trusted host re-evaluates observations and issues; visibility alone never authorizes omission. */
export function privateOmission(strategy: FormbarDataStrategyV1, context: DataContext, live: () => boolean) {
	const fresh = (revision: object) => live() && strategy.current(context) === revision;
	return {
		async submit(
			request: Omit<OmissionRequest, "contract" | "instance" | "revision">,
			revision: object,
		): Promise<OmissionResult> {
			if (!strategy.captureOmission || !strategy.validateOutgoingCandidate || !strategy.submitOmission)
				return failure("unsupported");
			try {
				if (!fresh(revision)) return failure("stale");
				const bound = boundRequest(request, context, revision);
				if (!fresh(revision)) return failure("stale");
				const capture = strategy.captureOmission(context, bound);
				if (capture.status !== "found") return failure(capture.status);
				if (capture.instance !== context.instance || capture.revision !== revision || !fresh(revision))
					return failure("stale");
				const candidate = copyJson(capture.candidate);
				if (!fresh(revision)) return failure("stale");
				const outgoing = Object.freeze({ ...bound, candidate });
				const validated = await strategy.validateOutgoingCandidate(context, outgoing, () => fresh(revision));
				if (validated.status !== "applied") return failure(validated.status);
				if (validated.revision !== revision || !fresh(revision)) return failure("stale");
				if (typeof validated.proof !== "object" || validated.proof === null) return failure("denied");
				const result = await strategy.submitOmission(
					context,
					Object.freeze({ ...outgoing, proof: validated.proof }),
					() => fresh(revision),
				);
				return result.status === "submitted" ? { ok: true, status: "submitted" } : failure(result.status);
			} catch {
				return { ok: false, code: "STRATEGY_ERROR" };
			}
		},
	};
}
