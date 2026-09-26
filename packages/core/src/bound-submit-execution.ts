import type { FormApi } from "./contracts.js";
import { validateGuardedSubmitCandidate } from "./guarded-submit-validation.js";
import type { PipelineContext } from "./pipeline.js";
import type { CandidateEgress } from "./submit-candidate-safety.js";
import type { SubmitPreparationGuard } from "./submit-preparation-checkpoint.js";
import type { TransformDefinition } from "./transforms.js";
import type { ValidationCoordinator } from "./validation-coordinator.js";

/** Run the private definition-bound lane with candidate-only egress context. */
export function executeBoundSubmit(
	context: PipelineContext,
	guard: SubmitPreparationGuard,
	coordinator: ValidationCoordinator<unknown, unknown>,
	submitId: string,
	form: FormApi<unknown, unknown>,
) {
	const transforms = (context.options.transforms ?? []) as readonly TransformDefinition[];
	const egress: CandidateEgress[] = transforms
		.filter((transform) => transform.phase === "egress" && !transform.path)
		.map(
			(transform) => (value, scoped) =>
				transform.transform(value, {
					phase: "egress",
					state: Object.freeze({ data: scoped.data, uiState: scoped.uiState }),
				}),
		);
	return validateGuardedSubmitCandidate(context, guard, undefined, coordinator, submitId, egress, form, form);
}
